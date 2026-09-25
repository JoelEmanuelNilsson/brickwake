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
/** Seconds after `tuning.sinking.seconds` that a hulk stops being drawn: the sea hides it well before. */
const drawnSunkSeconds = 1.5
const { plungeAt } = tuning.sinking
/** Seconds into the sinking a mast may crack, each with `crackChance`; it gives way `toppleDelay` seconds later. */
const crackTimes = [1.4, 4.2, plungeAt + 0.8] as const
const crackChance = 0.8
const toppleDelay = { min: 0.6, max: 1.5 } as const
/** Seconds into the sinking trapped air bursts out at the waterline: once as it settles, then fast as it plunges. */
const burstTimes = [3.2, plungeAt + 0.4, plungeAt + 1.5, plungeAt + 2.3, plungeAt + 3, plungeAt + 3.6, plungeAt + 4.2] as const
/** Seconds after the plunge that the last air boils up where it went down. */
const afterBursts = [0.7, 1.8, 3.2] as const
/** Loose bricks shed over the low side per second, from the start of the sinking to the plunge. */
const shedHz = { first: 2, last: 9 } as const
/** Planks and bricks floating free of the flooding hull per second. */
const floatHz = 3
/** Waterline samples per second where the sea pours in or churns along the side. */
const rushHz = 18
/** Ship-local rail edge, gunwale height and half-beam, where the sea pours over once the deck is awash. */
const railY = 2.4
const railZ = 3.8
const vortexSeconds = 5
const vortexHz = 6
const flotsamParts = 36
/** HP share below which a ship smokes from its holes, and above `burningFrom` of the smoke's intensity it burns. */
const smokeBelow = 0.55
const burningFrom = 0.45
/** Smoke puffs per second from each hole at full intensity, and seconds before a smoking ship picks fresh holes. */
const smokeHz = 6
const smokeRefreshSeconds = 9

interface Foundering {
  clock: number
  plunged: boolean
  plungedAt: number
  cracks: number
  bursts: number
  afterBursts: number
  shedClock: number
  floatClock: number
  rushClock: number
  bubbleClock: number
  vortexLeft: number
  /** A cracked mast part that gives way at `toppleAt`; −1 when none is pending. */
  crackedPart: number
  toppleAt: number
  readonly plunge: Vector3
}

interface Smoulder {
  readonly holes: Int32Array
  clock: number
  refreshAt: number
}

/**
 * Plays a ship's damage and foundering on top of the sim's physical sinking. A battered ship smokes from its holes and
 * burns when near sinking. When it founders, it settles and lists as it floods: the sea pours over the low rail and
 * churns along the side, bricks and planks break loose and float, masts crack and give way a moment later, air bursts
 * out. Then the flooding end goes and the far end lifts, and it plunges in a heave of spray, a boil of air and a whirl
 * of foam and flotsam. Says when a sunk hull may stop being drawn.
 */
export class SinkingShips {
  readonly #effects: Effects
  readonly #audio: GameAudio
  readonly #debris: BrickDebris
  readonly #model: GalleonModel
  readonly #foundering = new Map<string, Foundering>()
  readonly #smoulder = new Map<string, Smoulder>()
  readonly #q = new Quaternion()
  readonly #p = new Vector3()
  readonly #side = new Vector3()
  readonly #inward = new Vector3()
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
    this.#q.set(pose.qx, pose.qy, pose.qz, pose.qw)
    this.#smoke(id, view, dt, renderTime, sea)
    if (pose.life === "afloat") {
      this.#foundering.delete(id)
      return true
    }
    let f = this.#foundering.get(id)
    if (f === undefined) {
      f = {
        clock: 0,
        plunged: false,
        plungedAt: 0,
        cracks: 0,
        bursts: 0,
        afterBursts: 0,
        shedClock: 0,
        floatClock: 0,
        rushClock: 0,
        bubbleClock: 0,
        vortexLeft: 0,
        crackedPart: -1,
        toppleAt: 0,
        plunge: new Vector3(),
      }
      this.#foundering.set(id, f)
      this.#breach(pose, camera)
    }
    const since = renderTime - pose.lifeTime
    const drawn = since < tuning.sinking.seconds + drawnSunkSeconds
    // The low side: where the starboard axis points down, over it; debris goes that way.
    this.#side.set(0, 0, 1).applyQuaternion(this.#q)
    const lowSign = this.#side.y < 0 ? 1 : -1
    const flat = Math.hypot(this.#side.x, this.#side.z) || 1
    const lowX = (this.#side.x * lowSign) / flat
    const lowZ = (this.#side.z * lowSign) / flat

    const middle = this.#world(pose, deckPoints[2]!)
    if (!f.plunged && middle.y < oceanHeight(sea, middle.x, middle.z, renderTime) - 0.5) {
      f.plunged = true
      f.plungedAt = since
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
      const water = oceanHeight(sea, f.plunge.x, f.plunge.z, renderTime)
      if (Math.floor(before * vortexHz) !== Math.floor(f.vortexLeft * vortexHz)) {
        const strength = Math.max(0, f.vortexLeft / vortexSeconds)
        this.#effects.vortex(f.plunge.x, water, f.plunge.z, strength)
        this.#effects.bubbles(f.plunge.x, water, f.plunge.z, 2 + 4 * strength)
      }
      const after = afterBursts[f.afterBursts]
      if (after !== undefined && since - f.plungedAt >= after) {
        f.afterBursts++
        this.#effects.airBurst(f.plunge.x + (Math.random() * 2 - 1) * 3, water, f.plunge.z + (Math.random() * 2 - 1) * 3)
        this.#audio.splash(f.plunge.x, water, f.plunge.z, 40)
      }
    }
    if (f.plunged) return drawn

    // How far the flood has got: 0 as it starts to settle, 1 as the plunge begins.
    const flood = Math.min(1, since / plungeAt)
    f.clock -= dt
    if (f.clock <= 0) {
      f.clock += 1 / founderHz
      const point = this.#world(pose, deckPoints[Math.floor(Math.random() * deckPoints.length)]!)
      this.#effects.founder(point.x, point.y, point.z, oceanHeight(sea, point.x, point.z, renderTime), 0.35 + 0.65 * flood)
    }
    f.rushClock -= dt
    while (f.rushClock <= 0) {
      f.rushClock += 1 / rushHz
      this.#rush(pose, sea, renderTime, 0.5 + 0.5 * flood)
    }
    f.bubbleClock -= dt
    if (f.bubbleClock <= 0) {
      f.bubbleClock += 0.12 - 0.08 * flood
      const point = this.#world(pose, this.#p.set((Math.random() * 2 - 1) * 13, 0, (Math.random() * 2 - 1) * 4))
      this.#effects.bubbles(point.x, oceanHeight(sea, point.x, point.z, renderTime), point.z, 2)
    }
    const crackTime = crackTimes[f.cracks]
    if (crackTime !== undefined && since >= crackTime && f.crackedPart < 0) {
      f.cracks++
      if (Math.random() < crackChance) this.#crackMast(view, f, since, lowX, lowZ, camera)
    }
    if (f.crackedPart >= 0 && since >= f.toppleAt) {
      const part = f.crackedPart
      f.crackedPart = -1
      if (view.isPresent(part)) {
        const at = this.#p.setFromMatrixPosition(view.partMatrix(part, scratchMatrix))
        this.#audio.hullHit(at.x, at.y, at.z, false)
        this.#shake(camera, at, 0.25, 50)
        this.#parts.length = 0
        this.#parts.push(part)
        this.#breakOff(view, this.#parts, lowX, lowZ, 1.2)
      }
    }
    const burstTime = burstTimes[f.bursts]
    if (burstTime !== undefined && since >= burstTime) {
      f.bursts++
      this.#airBurst(pose, sea, renderTime)
    }
    f.shedClock -= dt
    if (since > 0.4 && f.shedClock <= 0) {
      f.shedClock += 1 / (shedHz.first + (shedHz.last - shedHz.first) * flood)
      const part = this.#randomUpperPart(view)
      if (part >= 0) {
        this.#parts.length = 0
        this.#parts.push(part)
        this.#breakOff(view, this.#parts, lowX, lowZ, 1.5)
      }
    }
    f.floatClock -= dt
    if (since > 1 && f.floatClock <= 0) {
      f.floatClock += 1 / floatHz
      this.#floatFree(view, pose, lowSign, sea, renderTime)
    }
    return drawn
  }

  /** Ship `id`'s foundering carries on as hulk `key`: the ship respawned and left its drawn hull behind. */
  handOff(id: string, key: string): void {
    const f = this.#foundering.get(id)
    if (f !== undefined) this.#foundering.set(key, f)
    const s = this.#smoulder.get(id)
    if (s !== undefined) this.#smoulder.set(key, s)
    this.#foundering.delete(id)
    this.#smoulder.delete(id)
  }

  /** Drops what is kept for `key`, a hulk no longer drawn. */
  forget(key: string): void {
    this.#foundering.delete(key)
    this.#smoulder.delete(key)
  }

  /** A ship below `smokeBelow` of its HP smokes from a few of its holes above the water, and burns when close to sinking. */
  #smoke(id: string, view: ShipView, dt: number, renderTime: number, sea: SeaState) {
    const pose = view.pose
    const intensity = Math.min(1, (smokeBelow - pose.hp / tuning.damage.hullHp) / smokeBelow)
    let s = this.#smoulder.get(id)
    if (intensity <= 0 && pose.life === "afloat") {
      if (s !== undefined) this.#smoulder.delete(id)
      return
    }
    if (s === undefined) {
      s = { holes: new Int32Array(3).fill(-1), clock: 0, refreshAt: 0 }
      this.#smoulder.set(id, s)
    }
    const burning = intensity > burningFrom || pose.life === "sinking"
    const holes = 1 + Math.min(2, Math.floor(Math.max(0, intensity) * 3))
    if (renderTime >= s.refreshAt) {
      s.refreshAt = renderTime + smokeRefreshSeconds
      for (let h = 0; h < s.holes.length; h++) s.holes[h] = h < holes ? this.#randomHole(view) : -1
    }
    s.clock -= dt
    if (s.clock > 0) return
    s.clock += 1 / (smokeHz * (0.35 + 0.65 * Math.max(0, intensity)))
    for (let h = 0; h < holes; h++) {
      const hole = s.holes[h]!
      if (hole < 0) continue
      const at = this.#p.setFromMatrixPosition(view.partMatrix(hole, scratchMatrix))
      if (at.y < oceanHeight(sea, at.x, at.z, renderTime) + 0.3) continue
      this.#effects.smoulder(at.x, at.y, at.z, Math.max(0.3, intensity), burning)
    }
  }

  /** A random part shot out of the hull or upper works, not the rig; −1 when a few tries find none. */
  #randomHole(view: ShipView) {
    const { rigFrom } = this.#model
    for (let tries = 0; tries < 32; tries++) {
      const part = Math.floor(Math.random() * rigFrom)
      if (!view.isPresent(part)) return part
    }
    return -1
  }

  /**
   * One waterline sample along a random side: where the rail is awash, the sea pours in over it toward the centreline;
   * elsewhere it churns along the hull as the ship settles.
   */
  #rush(pose: ShipPose, sea: SeaState, renderTime: number, intensity: number) {
    const side = Math.random() < 0.5 ? 1 : -1
    const x = (Math.random() * 2 - 1) * 12
    const rail = this.#world(pose, this.#p.set(x, railY, side * railZ))
    const rx = rail.x
    const ry = rail.y
    const rz = rail.z
    const water = oceanHeight(sea, rx, rz, renderTime)
    const inward = this.#inward.set(0, 0, -side).applyQuaternion(this.#q)
    const flat = Math.hypot(inward.x, inward.z) || 1
    if (ry < water + 0.7 && ry > water - 1.2) {
      this.#effects.inrush(rx, water, rz, inward.x / flat, inward.z / flat, intensity)
      return
    }
    const hull = this.#world(pose, this.#p.set(x, 0, side * (railZ + 0.4)))
    if (Math.random() < 0.5) this.#effects.inrush(hull.x, oceanHeight(sea, hull.x, hull.z, renderTime), hull.z, -inward.x / flat, -inward.z / flat, 0.4 * intensity)
  }

  /** A brick or plank works loose from the flooding hull and bobs up beside it on the low side. */
  #floatFree(view: ShipView, pose: ShipPose, lowSign: number, sea: SeaState, renderTime: number) {
    const part = this.#randomUpperPart(view)
    if (part < 0) return
    const at = this.#world(pose, this.#p.set((Math.random() * 2 - 1) * 12, 0, lowSign * (railZ + 1.5)))
    this.#parts.length = 0
    this.#parts.push(part)
    this.#debris.flotsam(view, this.#parts, at.x, at.z, 2.5, renderTime, sea)
    view.shed(this.#parts)
  }

  /** A standing mast cracks low or high with splinters and a jolt; it gives way over the low side a moment later. */
  #crackMast(view: ShipView, f: Foundering, since: number, dx: number, dz: number, camera: ChaseCamera) {
    const standing = this.#model.masts.filter((mast) => mast.topPart >= 0 && view.isPresent(mast.topPart))
    const mast = standing[Math.floor(Math.random() * standing.length)]
    if (mast === undefined) return
    const choices = mast.snapParts.filter((part) => part >= 0 && view.isPresent(part))
    const snap = choices[Math.floor(Math.random() * choices.length)]
    if (snap === undefined) return
    const at = this.#p.setFromMatrixPosition(view.partMatrix(snap, scratchMatrix))
    this.#effects.hit(at.x, at.y, at.z, dx, 0, dz)
    this.#effects.dust(at.x, at.y, at.z, 1.2)
    this.#audio.hullHit(at.x, at.y, at.z, false)
    this.#shake(camera, at, 0.3, 50)
    f.crackedPart = snap
    f.toppleAt = since + toppleDelay.min + Math.random() * (toppleDelay.max - toppleDelay.min)
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
