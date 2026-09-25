import { AdditiveBlending, BufferAttribute, BufferGeometry, CircleGeometry, Color, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3, type Scene } from "three"
import type { ClientMessage, ServerEvent } from "../../protocol/messages.ts"
import { gunLayout, gunsOnSide, type BroadsideSide } from "../../sim/gun-layout.ts"
import { aimGun, ballId, ballVelocityAt, broadsideRefusal, writeBallPosition, type BroadsideRefusal, type Cannonball } from "../../sim/gunnery.ts"
import { oceanHeight, type SeaState } from "../../sim/ocean.ts"
import { shipId } from "../../sim/ship.ts"
import { tuning } from "../../sim/tuning.ts"
import { add, scale } from "../../sim/vector.ts"
import type { GameAudio } from "../audio/game-audio.ts"
import { Cannonballs, type BallEnd } from "./balls.ts"
import type { ChaseCamera } from "./chase-camera.ts"
import type { Effects } from "./effects.ts"
import type { Reticle, ReticleReading } from "./reticle.ts"
import { OwnReloads } from "./own-reloads.ts"
import type { ShipPose } from "./timeline.ts"

/** Distance along a world ray to the first part of another ship's hull within `reach`, or undefined when it meets none. */
export type HullAlong = (origin: Vector3, direction: Vector3, reach: number) => number | undefined

/** What a fire request did. */
export type FireOutcome = "fired" | BroadsideRefusal | "no-aim"

/** The reticle's aim as the debug hook reports it. */
export interface AimReading {
  readonly aimPoint: readonly [number, number, number] | null
  /** The aim is on a ship's hull rather than the sea. */
  readonly onHull: boolean
  readonly side: BroadsideSide
  readonly state: ReticleReading["state"]
  readonly range: number
  readonly reloadLeft: number
  /** The predicted flights of the facing broadside are drawn. */
  readonly fan: boolean
}

/** Cross-range and along-range spread of a broadside per metre of range (±4 m across, ±6 m along at 220 m). */
const spreadAcross = Math.tan(tuning.guns.spread.traverse)
const spreadAlong = 6 / 220

const guns = { port: gunsOnSide(gunLayout, "port"), starboard: gunsOnSide(gunLayout, "starboard") }
/** The guns whose predicted flights draw the fan: the lower deck, bow to stern; the upper deck's flights lie just above them. */
const fanGuns = {
  port: gunLayout.flatMap((gun, index) => (gun.side === "port" && gun.deck === "lower" ? [{ gun, index }] : [])),
  starboard: gunLayout.flatMap((gun, index) => (gun.side === "starboard" && gun.deck === "lower" ? [{ gun, index }] : [])),
}
const fanSamples = 24
const fanVertices = fanGuns.starboard.length * (fanSamples - 1) * 2

const ringColors = {
  ready: new Color(2.4, 1.6, 0.45),
  refused: new Color(2.2, 0.35, 0.2),
  reloading: new Color(0.9, 0.9, 0.85),
}

const falloff = (distance: number, reach: number) => 1 / (1 + (distance / reach) ** 2)

/**
 * The player's guns: picks the aim point on the drawn sea at the camera's aim (or the hull in front of it), draws the
 * predicted fall of shot (a fan of each gun's flight and the spread band where the balls land), says whether the facing
 * broadside can fire, sends the order on click with a local fuse sizzle, and plays every ball's flight, flash, splash and hit.
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
  readonly #band: Mesh<CircleGeometry, MeshBasicMaterial>
  readonly #fan: LineSegments<BufferGeometry, LineBasicMaterial>
  readonly #fanPositions = new Float32Array(fanVertices * 3)
  readonly #fanPoint = { x: 0, y: 0, z: 0 }
  readonly #ray = new Vector3()
  readonly #screen = new Vector3()
  readonly #aim = new Vector3()
  #hasAim = false
  /** The aim is on another ship's hull, not the sea: the spread ring would lie hidden under it. */
  #onHull = false
  readonly #hullAlong: HullAlong
  readonly #reading: ReticleReading = { side: "starboard", state: "no-aim", range: 0, reloadLeft: 0, loaded: 1 }
  readonly #reloads = new OwnReloads()
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
    removedParts: [],
    shots: 0,
    hits: 0,
    damage: 0,
    team: undefined,
    lastHitBy: undefined,
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
    readonly hullAlong: HullAlong
  }) {
    this.#hullAlong = options.hullAlong
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
    // The indicator draws over everything, the own ship included: the fall of shot must read from any view.
    const overlay = { transparent: true, depthTest: false, depthWrite: false, fog: false, blending: AdditiveBlending } as const
    this.#ring = new Mesh(new RingGeometry(0.88, 1, 64).rotateX(-Math.PI / 2), new MeshBasicMaterial({ ...overlay, color: ringColors.ready, opacity: 0.85 }))
    this.#band = new Mesh(new CircleGeometry(0.88, 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ ...overlay, color: ringColors.ready, opacity: 0.16 }))
    this.#ring.add(this.#band)
    this.#ring.visible = false
    this.#ring.renderOrder = 4
    this.#band.renderOrder = 4
    options.scene.add(this.#ring)
    const fan = new BufferGeometry()
    fan.setAttribute("position", new BufferAttribute(this.#fanPositions, 3))
    this.#fan = new LineSegments(fan, new LineBasicMaterial({ ...overlay, color: ringColors.ready, opacity: 0.45 }))
    this.#fan.frustumCulled = false
    this.#fan.visible = false
    this.#fan.renderOrder = 4
    options.scene.add(this.#fan)
  }

  /** A welcome joined a room, whose clock owes nothing to the last one. */
  joined(): void {
    this.#reloads.joined()
  }

  /** Handles the gunnery events among the server events. */
  onEvent(event: ServerEvent): void {
    this.balls.onEvent(event)
    if (event._tag === "broadsideRefused" && event.shipId === this.#ownId()) {
      this.#reloads.refused(event.side)
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
    this.balls.update(renderTime, camera.camera.position)
    if (this.#trailClock <= 0) this.#trailClock = 1 / 30
    this.#reticle.visible = sailing && pose !== undefined
    if (pose === undefined) {
      this.#ring.visible = false
      this.#fan.visible = false
      return
    }
    this.#hasAim = this.#pickAim(camera, sea, renderTime)
    const reading = this.#read(this.#hasAim ? this.#aim : undefined, pose, renderTime)
    this.#reticle.update(reading)
    const screen = this.#screen.copy(this.#aim).project(camera.camera)
    this.#reticle.place(screen.x, screen.z > 1 ? -1 : screen.y)
    this.#placeRing(reading, sea, renderTime)
    this.#placeFan(reading)
  }

  /** The current aim, for the debug hook. */
  aim(): AimReading {
    const r = this.#reading
    return {
      aimPoint: this.#hasAim ? [this.#aim.x, this.#aim.y, this.#aim.z] : null,
      onHull: this.#hasAim && this.#onHull,
      side: r.side,
      state: r.state,
      range: r.range,
      reloadLeft: r.reloadLeft,
      fan: this.#fan.visible,
    }
  }

  /** True when the facing broadside could fire at the reticle now. */
  get canFire(): boolean {
    return this.#hasAim && this.#reading.state === "ready"
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
    this.#reloads.ordered(side, this.#time)
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

  /** The aim: the drawn sea at the camera's aim target at `time`, or the first other ship's hull on the line of sight to it. */
  #pickAim(camera: ChaseCamera, sea: SeaState, time: number): boolean {
    const target = camera.aimTarget
    const eye = camera.camera.position
    this.#aim.set(target.x, oceanHeight(sea, target.x, target.z, time), target.z)
    const toward = this.#ray.subVectors(this.#aim, eye)
    const reach = toward.length()
    if (reach === 0) return false
    toward.divideScalar(reach)
    const hull = this.#hullAlong(eye, toward, reach)
    this.#onHull = hull !== undefined
    if (hull !== undefined) this.#aim.copy(toward).multiplyScalar(hull).add(eye)
    return true
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
    ship.reloadedAt.port = this.#reloads.reloadedAt("port", pose.reloadPort)
    ship.reloadedAt.starboard = this.#reloads.reloadedAt("starboard", pose.reloadStarboard)
    this.#starboard.set(0, 0, 1).applyQuaternion(this.#q.set(pose.qx, pose.qy, pose.qz, pose.qw))
    const toward = aim === undefined ? this.#v.set(0, 0, 0) : this.#v.set(aim.x - pose.x, 0, aim.z - pose.z)
    r.side = toward.x * this.#starboard.x + toward.z * this.#starboard.z < 0 ? "port" : "starboard"
    const reloadedAt = ship.reloadedAt[r.side]
    r.reloadLeft = Math.max(0, reloadedAt - time)
    r.loaded = 1 - Math.min(1, r.reloadLeft / tuning.guns.reload)
    r.range = aim === undefined ? 0 : Math.hypot(aim.x - pose.x, aim.z - pose.z)
    r.state = aim === undefined ? (r.reloadLeft > 0 ? "reloading" : "no-aim") : (broadsideRefusal(ship, r.side, aim, time) ?? "ready")
    return r
  }

  #placeRing(reading: ReticleReading, sea: SeaState, time: number) {
    const ring = this.#ring
    ring.visible = this.#hasAim && !this.#onHull
    if (!ring.visible || this.#pose === undefined) return
    const aim = this.#aim
    ring.position.set(aim.x, oceanHeight(sea, aim.x, aim.z, time) + 0.15, aim.z)
    ring.rotation.y = Math.atan2(-(aim.z - this.#pose.z), aim.x - this.#pose.x)
    const across = Math.max(1.2, reading.range * spreadAcross)
    ring.scale.set(Math.max(across, reading.range * spreadAlong), 1, across)
    ring.material.color.copy(reading.state === "ready" ? ringColors.ready : reading.state === "reloading" ? ringColors.reloading : ringColors.refused)
    this.#band.material.color.copy(ring.material.color)
  }

  /** Draws each fan gun's predicted flight to the aim; hidden when the broadside cannot bear, grey while it reloads. */
  #placeFan(reading: ReticleReading) {
    const fan = this.#fan
    fan.visible = this.#hasAim && (reading.state === "ready" || reading.state === "reloading")
    if (!fan.visible) return
    fan.material.color.copy(reading.state === "ready" ? ringColors.ready : ringColors.reloading)
    const positions = this.#fanPositions
    const point = this.#fanPoint
    let v = 0
    for (const { gun, index } of fanGuns[reading.side]) {
      const aim = aimGun(this.#ship, gun, this.#aim)
      const flight = aim.flightTime ?? 0
      const ball: Cannonball = { id: ballId(0), shooter: this.#ship.id, gun: index, origin: aim.muzzle, velocity: add(aim.muzzleVelocity, scale(aim.barrel, tuning.guns.muzzleSpeed)), firedAt: 0 }
      for (let k = 0; k < fanSamples - 1; k++) {
        for (const end of [k, k + 1]) {
          writeBallPosition(ball, (end / (fanSamples - 1)) * flight, point)
          positions[v++] = point.x
          positions[v++] = point.y
          positions[v++] = point.z
        }
      }
    }
    const position = fan.geometry.getAttribute("position")
    position.needsUpdate = true
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
