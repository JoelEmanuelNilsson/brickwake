import { Matrix4, Quaternion, Vector3 } from "three"
import { oceanHeight, type SeaState } from "../../sim/ocean.ts"
import { ShipDamage } from "../../sim/ship/damage.ts"
import { tuning } from "../../sim/tuning.ts"
import type { GameAudio } from "../audio/game-audio.ts"
import type { BrickDebris } from "./brick-debris.ts"
import type { ChaseCamera } from "./chase-camera.ts"
import type { Effects } from "./effects.ts"
import type { GalleonModel } from "./galleon.ts"
import type { ShipView } from "./ship-view.ts"
import type { ShipPose } from "./timeline.ts"

/** Founder effect bursts per second while a ship goes down. */
const founderHz = 14
/** Ship-local deck points the smoke and churn come from, bow to stern. */
const deckPoints = [-11, -6, -1, 4, 9].map((x) => new Vector3(x, 2.6, 0))
/** Seconds after going under that a sunk hull stops being drawn: the sea hides it well before. */
const drawnSunkSeconds = 1.5
/** Seconds into the sinking a mast may snap, each with `snapChance`. */
const snapTimes = [0.9, 2.2] as const
const snapChance = 0.75
/** Seconds into the sinking trapped air bursts out at the waterline. */
const burstTimes = [1.6, 2.8, 3.6] as const
/** Loose bricks shed per second while it founders. */
const shedHz = 6
const vortexSeconds = 4
const vortexHz = 6
const flotsamParts = 28

interface Foundering {
  clock: number
  plunged: boolean
  life: ShipPose["life"]
  snaps: number
  bursts: number
  shedClock: number
  bubbleClock: number
  vortexLeft: number
  readonly plunge: Vector3
}

/**
 * Plays a ship's foundering on top of the sim's physical sinking, which lists it and settles it by the bow or stern:
 * the breach, smoke and churn along the deck, masts snapping and falling with their rig, bricks shedding over the
 * low side, air bursting out and boiling up, then the sea closing over it in a whirl of foam and floating debris.
 * Says when a sunk hull may stop being drawn.
 */
export class SinkingShips {
  readonly #effects: Effects
  readonly #audio: GameAudio
  readonly #debris: BrickDebris
  readonly #model: GalleonModel
  readonly #foundering = new Map<string, Foundering>()
  readonly #q = new Quaternion()
  readonly #p = new Vector3()
  readonly #side = new Vector3()
  readonly #parts: Array<number> = []

  constructor(effects: Effects, audio: GameAudio, debris: BrickDebris, model: GalleonModel) {
    this.#effects = effects
    this.#audio = audio
    this.#debris = debris
    this.#model = model
  }

  /** Plays ship `id` (drawn by `view`, posed for this frame) at the render time; returns false when its hull should not be drawn. */
  update(id: string, view: ShipView, dt: number, renderTime: number, sea: SeaState, camera: ChaseCamera): boolean {
    const pose = view.pose
    if (pose.life === "afloat") {
      this.#foundering.delete(id)
      return true
    }
    let f = this.#foundering.get(id)
    if (f === undefined) {
      f = { clock: 0, plunged: false, life: pose.life, snaps: 0, bursts: 0, shedClock: 0, bubbleClock: 0, vortexLeft: 0, plunge: new Vector3() }
      this.#foundering.set(id, f)
      if (pose.life === "sinking") this.#breach(pose, camera)
    }
    f.life = pose.life
    const since = pose.life === "sinking" ? renderTime - pose.lifeTime : renderTime - (pose.lifeTime - tuning.sinking.respawnSeconds) + tuning.sinking.seconds
    this.#q.set(pose.qx, pose.qy, pose.qz, pose.qw)
    // The low side: where the starboard axis points down, over it; debris goes that way.
    this.#side.set(0, 0, 1).applyQuaternion(this.#q)
    const lowSign = this.#side.y < 0 ? 1 : -1
    const lowX = this.#side.x * lowSign
    const lowZ = this.#side.z * lowSign
    const flat = Math.hypot(lowX, lowZ) || 1

    const middle = this.#world(pose, deckPoints[2]!)
    if (!f.plunged && middle.y < oceanHeight(sea, middle.x, middle.z, renderTime) - 0.5) {
      f.plunged = true
      const water = oceanHeight(sea, middle.x, middle.z, renderTime)
      f.plunge.set(middle.x, water, middle.z)
      f.vortexLeft = vortexSeconds
      this.#effects.plunge(middle.x, water, middle.z)
      this.#audio.plunge(middle.x, middle.y, middle.z)
      this.#shake(camera, middle, 0.45, 60)
      this.#flotsam(view, f.plunge, renderTime, sea)
    }
    if (f.vortexLeft > 0) {
      const before = f.vortexLeft
      f.vortexLeft -= dt
      if (Math.floor(before * vortexHz) !== Math.floor(f.vortexLeft * vortexHz))
        this.#effects.vortex(f.plunge.x, oceanHeight(sea, f.plunge.x, f.plunge.z, renderTime), f.plunge.z, Math.max(0, f.vortexLeft / vortexSeconds))
    }
    if (f.plunged) return pose.life === "sinking" || since < tuning.sinking.seconds + drawnSunkSeconds

    f.clock -= dt
    if (f.clock <= 0) {
      f.clock += 1 / founderHz
      const intensity = Math.min(1, 0.4 + since / tuning.sinking.seconds)
      const point = this.#world(pose, deckPoints[Math.floor(Math.random() * deckPoints.length)]!)
      this.#effects.founder(point.x, point.y, point.z, oceanHeight(sea, point.x, point.z, renderTime), intensity)
    }
    f.bubbleClock -= dt
    if (f.bubbleClock <= 0) {
      f.bubbleClock += 0.08
      const along = (Math.random() * 2 - 1) * 13
      const point = this.#world(pose, this.#p.set(along, 0, (Math.random() * 2 - 1) * 4))
      this.#effects.bubbles(point.x, oceanHeight(sea, point.x, point.z, renderTime), point.z, 2)
    }
    const snapTime = snapTimes[f.snaps]
    if (snapTime !== undefined && since >= snapTime) {
      f.snaps++
      if (Math.random() < snapChance) this.#snapMast(view, lowX / flat, lowZ / flat, camera)
    }
    const burstTime = burstTimes[f.bursts]
    if (burstTime !== undefined && since >= burstTime) {
      f.bursts++
      this.#airBurst(pose, sea, renderTime)
    }
    f.shedClock -= dt
    if (since > 0.4 && f.shedClock <= 0) {
      f.shedClock += 1 / shedHz
      const part = this.#randomUpperPart(view)
      if (part >= 0) {
        this.#parts.length = 0
        this.#parts.push(part)
        this.#breakOff(view, this.#parts, lowX / flat, lowZ / flat, 1.5)
      }
    }
    return true
  }

  /** The moment a ship's HP runs out: the hull splits with fire, splinters and a gout of smoke. */
  #breach(pose: ShipPose, camera: ChaseCamera) {
    this.#q.set(pose.qx, pose.qy, pose.qz, pose.qw)
    for (const local of deckPoints) {
      const point = this.#world(pose, local)
      this.#effects.hit(point.x, point.y - 1, point.z, 0, -1, 0)
    }
    const middle = this.#world(pose, deckPoints[2]!)
    this.#audio.sinking(middle.x, middle.y, middle.z)
    this.#shake(camera, middle, 0.6, 70)
  }

  /** A standing mast snaps low or high with a crack and falls over the low side, its sails and rigging with it. */
  #snapMast(view: ShipView, dx: number, dz: number, camera: ChaseCamera) {
    const standing = this.#model.masts.filter((mast) => mast.topPart >= 0 && view.isPresent(mast.topPart))
    const mast = standing[Math.floor(Math.random() * standing.length)]
    if (mast === undefined) return
    const choices = mast.snapParts.filter((part) => part >= 0 && view.isPresent(part))
    const snap = choices[Math.floor(Math.random() * choices.length)]
    if (snap === undefined) return
    this.#parts.length = 0
    this.#parts.push(snap)
    const at = this.#p.setFromMatrixPosition(view.partMatrix(snap, scratchMatrix))
    this.#effects.hit(at.x, at.y, at.z, dx, 0, dz)
    this.#audio.hullHit(at.x, at.y, at.z, false)
    this.#shake(camera, at, 0.3, 50)
    this.#breakOff(view, this.#parts, dx, dz, 1.2)
  }

  /** Take `parts` and everything only they held off the drawn ship and throw them as debris toward (dx, dz). */
  #breakOff(view: ShipView, parts: ReadonlyArray<number>, dx: number, dz: number, push: number) {
    const graph = this.#model.graph
    const damage = new ShipDamage(graph)
    const gone: Array<number> = []
    for (let i = 0; i < graph.count; i++) if (!view.isPresent(i)) gone.push(i)
    damage.apply(gone)
    const detached = damage.apply(parts).filter((part) => view.isPresent(part))
    this.#debris.drop(view, parts, dx, dz, push)
    this.#debris.drop(view, detached, dx, dz, push)
    view.shed(parts)
    view.shed(detached)
  }

  /** Air bursts out where the hull meets the sea: at the deck point nearest the water. */
  #airBurst(pose: ShipPose, sea: SeaState, renderTime: number) {
    let best = Number.POSITIVE_INFINITY
    let x = pose.x
    let z = pose.z
    let water = 0
    for (const local of deckPoints) {
      const point = this.#world(pose, local)
      const surface = oceanHeight(sea, point.x, point.z, renderTime)
      if (Math.abs(point.y - surface) < best) {
        best = Math.abs(point.y - surface)
        x = point.x
        z = point.z
        water = surface
      }
    }
    this.#effects.airBurst(x, water, z)
    this.#audio.splash(x, water, z, 60)
  }

  /** Bricks, spars and timber bob up where the ship went down. */
  #flotsam(view: ShipView, at: Vector3, renderTime: number, sea: SeaState) {
    this.#parts.length = 0
    for (let i = 0; i < flotsamParts; i++) {
      const part = this.#randomUpperPart(view)
      if (part >= 0 && !this.#parts.includes(part)) this.#parts.push(part)
    }
    this.#debris.flotsam(view, this.#parts, at.x, at.z, 9, renderTime, sea)
    view.shed(this.#parts)
  }

  /** A random upper-works part still on the drawn ship, not the rig; −1 when a few tries find none. */
  #randomUpperPart(view: ShipView) {
    const { graph, rigFrom } = this.#model
    for (let tries = 0; tries < 24; tries++) {
      const part = Math.floor(Math.random() * rigFrom)
      if (graph.upperWorks[part] === 1 && view.isPresent(part)) return part
    }
    return -1
  }

  #world(pose: ShipPose, local: Vector3) {
    const p = this.#p.copy(local).applyQuaternion(this.#q)
    p.x += pose.x
    p.y += pose.y
    p.z += pose.z
    return p
  }

  #shake(camera: ChaseCamera, at: Vector3, strength: number, reach: number) {
    const d = at.distanceTo(camera.camera.position)
    camera.shake(strength / (1 + (d / reach) ** 2))
  }
}

const scratchMatrix = new Matrix4()
