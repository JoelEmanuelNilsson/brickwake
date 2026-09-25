import { AdditiveBlending, Color, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3, type Scene } from "three"
import type { ClientMessage, ServerEvent } from "../../protocol/messages.ts"
import { gunLayout, gunsOnSide, type BroadsideSide } from "../../sim/gun-layout.ts"
import { ballVelocityAt, broadsideRefusal, type BroadsideRefusal, type Cannonball } from "../../sim/gunnery.ts"
import { oceanHeight, type SeaState } from "../../sim/ocean.ts"
import { shipId } from "../../sim/ship.ts"
import { tuning } from "../../sim/tuning.ts"
import type { GameAudio } from "../audio/game-audio.ts"
import { Cannonballs, type BallEnd } from "./balls.ts"
import type { ChaseCamera } from "./chase-camera.ts"
import type { Effects } from "./effects.ts"
import type { Reticle, ReticleReading } from "./reticle.ts"
import type { ShipPose } from "./timeline.ts"

/** What a fire request did. */
export type FireOutcome = "fired" | BroadsideRefusal | "no-aim"

/** The reticle's aim as the debug hook reports it. */
export interface AimReading {
  readonly aimPoint: readonly [number, number, number] | null
  readonly side: BroadsideSide
  readonly state: ReticleReading["state"]
  readonly range: number
  readonly reloadLeft: number
}

/** Farthest the reticle looks for the sea from the ship, metres: past the guns' ~300 m reach so "out of range" shows. */
const maxAimRange = 600
const minMarchStep = 0.5
const maxMarchStep = 40
const marchSteps = 200
const bisections = 16
/** Cross-range and along-range spread of a broadside per metre of range (1° cone; ±4 m across, ±18 m along at 220 m). */
const spreadAcross = Math.tan(tuning.guns.spread)
const spreadAlong = 18 / 220

const guns = { port: gunsOnSide(gunLayout, "port"), starboard: gunsOnSide(gunLayout, "starboard") }

const ringColors = {
  ready: new Color(2.4, 1.6, 0.45),
  refused: new Color(2.2, 0.35, 0.2),
  reloading: new Color(0.9, 0.9, 0.85),
}

const falloff = (distance: number, reach: number) => 1 / (1 + (distance / reach) ** 2)

/**
 * The player's guns: picks the aim point on the drawn sea under the reticle, says whether the facing broadside can
 * fire, sends the order on click with a local fuse sizzle, and plays every ball's flight, flash, splash and hit.
 */
export class Gunnery {
  readonly balls: Cannonballs
  readonly #effects: Effects
  readonly #reticle: Reticle
  readonly #audio: GameAudio
  readonly #send: (message: ClientMessage) => void
  readonly #ownId: () => string | null
  readonly #gunFired: (ball: Cannonball, muzzle: Vector3) => boolean
  readonly #muzzle = new Vector3()
  readonly #ring: Mesh<RingGeometry, MeshBasicMaterial>
  readonly #aim = new Vector3()
  #hasAim = false
  readonly #reading: ReticleReading = { side: "starboard", state: "no-aim", range: 0, reloadLeft: 0, loaded: 1 }
  /** Reload deadlines assumed from our own orders until snapshots carry the server's. */
  readonly #ordered = { port: Number.NEGATIVE_INFINITY, starboard: Number.NEGATIVE_INFINITY }
  readonly #ship = {
    id: shipId("own"),
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    controls: { rudder: 0, sail: 0 } as const,
    rudderAngle: 0,
    sailSet: 0,
    hp: 0,
    reloadedAt: { port: 0, starboard: 0 },
    life: { _tag: "afloat" } as const,
    spawn: 0,
    kills: 0,
    deaths: 0,
    shots: 0,
    hits: 0,
    damage: 0,
    team: undefined,
  }
  readonly #aimScratch = { x: 0, y: 0, z: 0 }
  readonly #q = new Quaternion()
  readonly #v = new Vector3()
  readonly #starboard = new Vector3()
  #pose: ShipPose | undefined
  #camera: ChaseCamera | undefined
  #sea: SeaState | undefined
  #time = 0
  #trailClock = 0

  constructor(options: {
    readonly scene: Scene
    readonly effects: Effects
    readonly reticle: Reticle
    readonly audio: GameAudio
    readonly send: (message: ClientMessage) => void
    readonly ownId: () => string | null
    /** A gun fires on its drawn ship: animate it and write its muzzle's world position; false when the shooter is not drawn. */
    readonly gunFired: (ball: Cannonball, muzzle: Vector3) => boolean
  }) {
    this.#effects = options.effects
    this.#reticle = options.reticle
    this.#audio = options.audio
    this.#send = options.send
    this.#ownId = options.ownId
    this.#gunFired = options.gunFired
    this.balls = new Cannonballs(options.scene, {
      fired: (ball) => this.#fired(ball),
      flying: (ball, x, y, z) => {
        if (this.#trailClock <= 0) this.#effects.trail(x, y, z)
        if (ball.shooter !== this.#ownId()) this.#audio.ballFlying(ball, x, y, z, this.#time)
      },
      ended: (end, ball) => this.#ended(end, ball),
    })
    this.#ring = new Mesh(
      new RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: ringColors.ready, transparent: true, opacity: 0.75, depthWrite: false, fog: false, blending: AdditiveBlending }),
    )
    this.#ring.visible = false
    this.#ring.renderOrder = 4
    options.scene.add(this.#ring)
  }

  /** Handles the gunnery events among the server events. */
  onEvent(event: ServerEvent): void {
    this.balls.onEvent(event)
    if (event._tag === "broadsideRefused" && event.shipId === this.#ownId()) {
      this.#ordered[event.side] = Number.NEGATIVE_INFINITY
      this.#reticle.deny()
    }
  }

  /** Aims from the camera's centre ray, updates the reticle, and plays balls at `renderTime`. */
  update(dt: number, renderTime: number, pose: ShipPose | undefined, camera: ChaseCamera, sea: SeaState, sailing: boolean): void {
    this.#pose = pose
    this.#camera = camera
    this.#sea = sea
    this.#time = renderTime
    this.#trailClock -= dt
    this.balls.update(renderTime)
    if (this.#trailClock <= 0) this.#trailClock = 1 / 30
    this.#reticle.visible = sailing && pose !== undefined
    if (pose === undefined) {
      this.#ring.visible = false
      return
    }
    this.#hasAim = this.#pickAim(camera, sea, renderTime, pose)
    const reading = this.#read(this.#hasAim ? this.#aim : undefined, pose, renderTime)
    this.#reticle.update(reading)
    this.#placeRing(reading, sea, renderTime)
  }

  /** The current aim, for the debug hook. */
  aim(): AimReading {
    const r = this.#reading
    return {
      aimPoint: this.#hasAim ? [this.#aim.x, this.#aim.y, this.#aim.z] : null,
      side: r.side,
      state: r.state,
      range: r.range,
      reloadLeft: r.reloadLeft,
    }
  }

  /** Fires the facing broadside at the reticle, or at `point` on the sea (debug), if it can fire. */
  fire(point?: { readonly x: number; readonly y: number; readonly z: number }): FireOutcome {
    const pose = this.#pose
    const sea = this.#sea
    if (pose === undefined || sea === undefined) return "no-aim"
    const target = this.#aimScratch
    if (point !== undefined) {
      target.x = point.x
      target.y = point.y
      target.z = point.z
    } else if (this.#hasAim) {
      target.x = this.#aim.x
      target.y = this.#aim.y
      target.z = this.#aim.z
    } else {
      this.#reticle.deny()
      return "no-aim"
    }
    const reading = this.#read(target, pose, this.#time)
    if (reading.state !== "ready") {
      this.#reticle.deny()
      return reading.state
    }
    const side = reading.side
    this.#send({ _tag: "fireBroadside", side, aimPoint: [target.x, target.y, target.z] })
    this.#ordered[side] = this.#time + tuning.guns.reload
    // The reading must say "reloading" from this moment, not from the next frame.
    this.#read(target, pose, this.#time)
    this.#audio.sizzle()
    this.#q.set(pose.qx, pose.qy, pose.qz, pose.qw)
    for (const gun of guns[side]) {
      this.#v.set(gun.position.x, gun.position.y + 0.5, gun.position.z * 0.85).applyQuaternion(this.#q)
      this.#effects.fuse(pose.x + this.#v.x, pose.y + this.#v.y, pose.z + this.#v.z)
    }
    return "fired"
  }

  /** Marches the camera's centre ray to the drawn sea at `time`; false when it meets no water within range. */
  #pickAim(camera: ChaseCamera, sea: SeaState, time: number, pose: ShipPose): boolean {
    const o = camera.aimOrigin
    const d = camera.aimDirection
    const gap = (t: number) => o.y + d.y * t - oceanHeight(sea, o.x + d.x * t, o.z + d.z * t, time)
    const descent = Math.max(-d.y, 0.02)
    let t = 0
    let above = gap(0)
    if (above <= 0) return false
    for (let i = 0; i < marchSteps; i++) {
      const next = t + Math.min(maxMarchStep, Math.max(minMarchStep, (0.8 * above) / descent))
      const g = gap(next)
      if (Math.hypot(o.x + d.x * next - pose.x, o.z + d.z * next - pose.z) > maxAimRange) return false
      if (g <= 0) {
        let low = t
        let high = next
        for (let k = 0; k < bisections; k++) {
          const mid = (low + high) / 2
          if (gap(mid) > 0) low = mid
          else high = mid
        }
        const x = o.x + d.x * high
        const z = o.z + d.z * high
        this.#aim.set(x, oceanHeight(sea, x, z, time), z)
        return true
      }
      t = next
      above = g
    }
    return false
  }

  #read(aim: { readonly x: number; readonly y: number; readonly z: number } | undefined, pose: ShipPose, time: number): ReticleReading {
    const r = this.#reading
    const ship = this.#ship
    ship.position.x = pose.x
    ship.position.y = pose.y
    ship.position.z = pose.z
    ship.orientation.x = pose.qx
    ship.orientation.y = pose.qy
    ship.orientation.z = pose.qz
    ship.orientation.w = pose.qw
    ship.velocity.x = pose.vx
    ship.velocity.y = pose.vy
    ship.velocity.z = pose.vz
    ship.reloadedAt.port = Math.max(pose.reloadPort, this.#ordered.port)
    ship.reloadedAt.starboard = Math.max(pose.reloadStarboard, this.#ordered.starboard)
    this.#starboard.set(0, 0, 1).applyQuaternion(this.#q.set(pose.qx, pose.qy, pose.qz, pose.qw))
    const toward = aim === undefined ? this.#camera?.aimDirection : this.#v.set(aim.x - pose.x, 0, aim.z - pose.z)
    r.side = toward !== undefined && toward.x * this.#starboard.x + toward.z * this.#starboard.z < 0 ? "port" : "starboard"
    const reloadedAt = ship.reloadedAt[r.side]
    r.reloadLeft = Math.max(0, reloadedAt - time)
    r.loaded = 1 - Math.min(1, r.reloadLeft / tuning.guns.reload)
    r.range = aim === undefined ? 0 : Math.hypot(aim.x - pose.x, aim.z - pose.z)
    r.state = aim === undefined ? (r.reloadLeft > 0 ? "reloading" : "no-aim") : (broadsideRefusal(ship, r.side, aim, time) ?? "ready")
    return r
  }

  #placeRing(reading: ReticleReading, sea: SeaState, time: number) {
    const ring = this.#ring
    ring.visible = this.#hasAim
    if (!this.#hasAim || this.#pose === undefined) return
    const aim = this.#aim
    ring.position.set(aim.x, oceanHeight(sea, aim.x, aim.z, time) + 0.15, aim.z)
    ring.rotation.y = Math.atan2(-(aim.z - this.#pose.z), aim.x - this.#pose.x)
    const across = Math.max(1.2, reading.range * spreadAcross)
    ring.scale.set(Math.max(across, reading.range * spreadAlong), 1, across)
    ring.material.color.copy(reading.state === "ready" ? ringColors.ready : reading.state === "reloading" ? ringColors.reloading : ringColors.refused)
  }

  #fired(ball: Cannonball) {
    const { velocity } = ball
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z)
    // The flash and smoke leave the drawn cannon's muzzle; the ball's own origin is the sim's gun position inside the port.
    const origin = this.#gunFired(ball, this.#muzzle) ? this.#muzzle : this.#muzzle.set(ball.origin.x, ball.origin.y, ball.origin.z)
    this.#effects.muzzle(origin.x, origin.y, origin.z, velocity.x / speed, velocity.y / speed, velocity.z / speed)
    this.#audio.cannon(origin.x, origin.y, origin.z, this.#time - ball.firedAt)
    this.#shake(origin.x, origin.y, origin.z, ball.shooter === this.#ownId() ? 0.1 : 0.14, 60)
  }

  #ended(end: BallEnd, ball: Cannonball | undefined) {
    const [x, y, z] = end.point
    const velocity = ball === undefined ? undefined : ballVelocityAt(ball, end.time)
    const speed = velocity === undefined ? 70 : Math.hypot(velocity.x, velocity.y, velocity.z)
    if (end._tag === "ballSplash") {
      this.#effects.splash(x, y, z, speed)
      this.#audio.splash(x, y, z, speed)
      this.#shake(x, y, z, 0.35, 30)
      return
    }
    const dx = velocity === undefined ? 0 : velocity.x / speed
    const dy = velocity === undefined ? 0 : velocity.y / speed
    const dz = velocity === undefined ? 1 : velocity.z / speed
    this.#effects.hit(x, y, z, dx, dy, dz)
    this.#audio.hullHit(x, y, z, end.target === this.#ownId())
    this.#shake(x, y, z, 0.7, 45)
    if (end.shooter === this.#ownId()) this.#reticle.hit()
  }

  #shake(x: number, y: number, z: number, strength: number, reach: number) {
    const camera = this.#camera
    if (camera === undefined) return
    const p = camera.camera.position
    camera.shake(strength * falloff(Math.hypot(x - p.x, y - p.y, z - p.z), reach))
  }
}
