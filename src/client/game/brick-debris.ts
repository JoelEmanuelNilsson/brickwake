import { type BufferGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Quaternion, type Scene, Vector3 } from "three"
import { oceanHeight, type SeaState } from "../../sim/ocean.ts"
import { metresPerLdu, partCatalog, type PartId } from "../../sim/ship/parts.ts"
import type { GameAudio } from "../audio/game-audio.ts"
import { brickColorLinear } from "../bricks/brick-ship-mesh.ts"
import { pirateLivery } from "../rig/sail-livery.ts"
import { ShipRig } from "../rig/ship-rig.ts"
import type { Effects } from "./effects.ts"
import { deckHeight, type GalleonModel } from "./galleon.ts"
import type { ShipView } from "./ship-view.ts"

const bodyCapacity = 1024
const pieceCapacity = 6144
const studCapacity = 6144
/** Contact points one body carries: a brick's eight box corners, or pieces spread through a chunk. */
const maxPoints = 16
const ghostCount = 4
const gravity = 9.81
/** Lego bricks are light and springy: they bounce off a deck and skitter. */
const restitution = 0.38
const friction = 0.45
/** How far under a deck surface a point still counts as on it; deeper, it is inside the hull and passes through. */
const deckSlab = 0.6
/** Studs are drawn on debris nearer than this, metres; beyond, a stud is under a pixel. */
const studReach = 70
/** Seconds a body spends shrinking away when its time is up on a deck or in the air. */
const shrinkSeconds = 0.5
/** A body gone this far under the surface is out of sight. */
const sunkDepth = 3.5
/** Pieces in a body at which it counts as a chunk: a big splash, a crash on deck, a ghost rig if it carries a mast. */
const chunkPieces = 10


/** A thrown body's motion: linear velocity and angular velocity, world m/s and rad/s. */
export interface DebrisMotion {
  vx: number
  vy: number
  vz: number
  wx: number
  wy: number
  wz: number
}

/** What debris needs of a drawn ship: its pose, where its parts are drawn, its detail level, and its rig when it has one to tear off. */
export type DebrisSource = Pick<ShipView, "pose" | "partMatrix" | "detail"> & { readonly rig?: ShipRig }

/** The effects and sounds debris sets off. */
export type DebrisEffects = Pick<Effects, "splash" | "plop" | "dust">
export type DebrisAudio = Pick<GameAudio, "hullHit" | "splash">

/** One live body, for tests and the debug hook: world centre, how upright its up axis stands (1 upright), wet, parts. */
export interface DebrisBody {
  readonly position: readonly [number, number, number]
  readonly up: number
  readonly wet: boolean
  readonly pieces: number
}

/** Timing and counts for the debug hook. */
export interface DebrisStats {
  readonly bodies: number
  readonly pieces: number
  readonly studs: number
  /** Mean CPU milliseconds of `update` over the last 120 frames, and the worst of them. */
  readonly meanMs: number
  readonly worstMs: number
}

/**
 * The actual bricks a ship loses, as rigid bodies: each removed part flies alone, each cut-off group of parts
 * (a rail run, a fallen mast with its yards) tumbles as one rigid chunk. A small custom solver: gravity, impulse
 * contacts at up to 16 points against the deck they came off, per-point buoyancy and drag on `oceanHeight`.
 * Bricks bounce, splash, float briefly and sink. A chunk that carries a mast takes a torn-off copy of that mast's
 * sails, flags and ropes with it. Drawn instanced per part shape; nothing allocates per frame.
 */
export class BrickDebris {
  readonly root = new Group()
  readonly #model: GalleonModel
  readonly #unit: () => number
  readonly #effects: DebrisEffects
  readonly #audio: DebrisAudio
  // Bodies: slot arrays with an alive flag; `#high` bounds the live slots.
  readonly #alive = new Uint8Array(bodyCapacity)
  readonly #pos = new Float32Array(bodyCapacity * 3)
  readonly #quat = new Float32Array(bodyCapacity * 4)
  readonly #vel = new Float32Array(bodyCapacity * 3)
  readonly #ang = new Float32Array(bodyCapacity * 3)
  /** Inverse principal inertia per unit mass, body frame. */
  readonly #invInertia = new Float32Array(bodyCapacity * 3)
  readonly #points = new Float32Array(bodyCapacity * maxPoints * 3)
  readonly #pointCount = new Uint8Array(bodyCapacity)
  /** Half the body's smallest extent: the depth over which a point goes from dry to fully wet. */
  readonly #thickness = new Float32Array(bodyCapacity)
  readonly #age = new Float32Array(bodyCapacity)
  readonly #life = new Float32Array(bodyCapacity)
  /** Seconds of buoyancy left once wet; then it sinks. */
  readonly #floatLeft = new Float32Array(bodyCapacity)
  readonly #wet = new Uint8Array(bodyCapacity)
  readonly #pieceCount = new Uint16Array(bodyCapacity)
  readonly #crashClock = new Float32Array(bodyCapacity)
  /**
   * How far below the deck surface this body's contacts sit: a part cut loose where it stood starts inside the surface
   * its own top helped define, so it rests there; the allowance shrinks as it moves out and never grows.
   */
  readonly #lower = new Float32Array(bodyCapacity)
  readonly #ships: Array<DebrisSource | undefined> = new Array<DebrisSource | undefined>(bodyCapacity)
  readonly #ghostOf = new Int8Array(bodyCapacity).fill(-1)
  readonly #matrices = new Float32Array(bodyCapacity * 16)
  #high = 0
  #bodies = 0
  // Pieces: one drawn part each, fixed in its body's frame.
  readonly #pieceAlive = new Uint8Array(pieceCapacity)
  readonly #pieceBody = new Int32Array(pieceCapacity)
  readonly #pieceShape = new Uint8Array(pieceCapacity)
  readonly #pieceLocal = new Float32Array(pieceCapacity * 16)
  readonly #pieceColor = new Float32Array(pieceCapacity * 3)
  #pieceHigh = 0
  #pieces = 0
  readonly #shapes: ReadonlyArray<PartId>
  readonly #shapeOf = new Map<PartId, number>()
  readonly #meshes: ReadonlyArray<InstancedMesh>
  readonly #studs: InstancedMesh
  #studsDrawn = 0
  // Built on first use: a ship rig needs a canvas for its livery.
  readonly #ghosts: Array<{ readonly rig: ShipRig; readonly holder: Group; body: number; readonly com: Vector3 }> = []
  readonly #times = new Float64Array(120)
  #frames = 0
  readonly #m = new Matrix4()
  readonly #m2 = new Matrix4()
  readonly #q = new Quaternion()
  readonly #v = new Vector3()
  readonly #v2 = new Vector3()
  readonly #one = new Vector3(1, 1, 1)
  readonly #scale = new Vector3()
  readonly #motion: DebrisMotion = { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 }
  readonly #component: Array<number> = []
  readonly #inSet: Uint8Array
  readonly #seen: Uint8Array
  readonly #r = new Float32Array(9)

  /** `unit` draws the randomness (uniform 0–1): a seeded one replays the same debris. */
  constructor(scene: Scene, model: GalleonModel, effects: DebrisEffects, audio: DebrisAudio, unit: () => number = Math.random) {
    this.#unit = unit
    this.#model = model
    this.#effects = effects
    this.#audio = audio
    this.#seen = new Uint8Array(model.placements.length)
    this.#inSet = new Uint8Array(model.placements.length)
    const counts = new Map<PartId, number>()
    for (const placement of model.placements) counts.set(placement.part, (counts.get(placement.part) ?? 0) + 1)
    this.#shapes = [...counts.keys()]
    this.#shapes.forEach((part, i) => this.#shapeOf.set(part, i))
    const { library } = model
    const white = new Color(1, 1, 1)
    const pooled = (geometry: BufferGeometry, capacity: number, name: string) => {
      const mesh = new InstancedMesh(geometry, library.plastic, capacity)
      mesh.name = name
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.setColorAt(0, white)
      mesh.instanceColor?.setUsage(DynamicDrawUsage)
      mesh.count = 0
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.root.add(mesh)
      return mesh
    }
    this.#meshes = this.#shapes.map((part) => pooled(library.geometry(part), Math.min(counts.get(part) ?? 0, pieceCapacity), `debris ${part}`))
    this.#studs = pooled(library.studGeometry, studCapacity, "debris studs")
    this.#studs.castShadow = false
    this.root.name = "brick debris"
    scene.add(this.root)
  }

  /** Live bodies and pieces, and the update's cost. */
  stats(): DebrisStats {
    const n = Math.min(this.#frames, this.#times.length)
    let sum = 0
    let worst = 0
    for (let i = 0; i < n; i++) {
      const t = this.#times[i] ?? 0
      sum += t
      worst = Math.max(worst, t)
    }
    return { bodies: this.#bodies, pieces: this.#pieces, studs: this.#studsDrawn, meanMs: n === 0 ? 0 : sum / n, worstMs: worst }
  }

  /**
   * Build the torn-off rigs and show one of everything, so a renderer compile at load covers every debris draw:
   * the first fallen mast then costs no shader link mid-battle. `done` hides them again.
   */
  warm(): { readonly done: () => void } {
    while (this.#ghosts.length < ghostCount) {
      const holder = new Group()
      holder.matrixAutoUpdate = false
      const rig = new ShipRig(this.#model.rig, pirateLivery)
      holder.add(rig.root)
      this.root.add(holder)
      this.#ghosts.push({ rig, holder, body: -1, com: new Vector3() })
    }
    const meshes = [...this.#meshes, this.#studs]
    for (const mesh of meshes) {
      mesh.count = 1
      mesh.visible = true
    }
    for (const ghost of this.#ghosts) ghost.holder.visible = true
    return {
      done: () => {
        for (const mesh of meshes) {
          mesh.count = 0
          mesh.visible = false
        }
        for (const ghost of this.#ghosts) ghost.holder.visible = false
      },
    }
  }

  /** Every live body. */
  bodies(): ReadonlyArray<DebrisBody> {
    const out: Array<DebrisBody> = []
    for (let b = 0; b < this.#high; b++) {
      if (this.#alive[b] === 0) continue
      const r = this.#rotation(b)
      out.push({ position: [this.#pos[b * 3]!, this.#pos[b * 3 + 1]!, this.#pos[b * 3 + 2]!], up: r[4]!, wet: this.#wet[b] === 1, pieces: this.#pieceCount[b]! })
    }
    return out
  }

  /**
   * A ball knocked `removed` out of `view`'s ship and `detached` fell with them, the ball travelling at world `velocity`
   * m/s (undefined: unknown). Removed parts burst out: most spall back toward the gun, the rest ride on with the ball.
   * Each connected group of detached parts falls as one rigid body with a shove from the blow.
   */
  shatter(view: DebrisSource, removed: ReadonlyArray<number>, detached: ReadonlyArray<number>, velocity: Vector3 | undefined): void {
    const speed = velocity === undefined ? 70 : velocity.length()
    const dx = velocity === undefined ? 0 : velocity.x / speed
    const dy = velocity === undefined ? 0 : velocity.y / speed
    const dz = velocity === undefined ? 0 : velocity.z / speed
    const pose = view.pose
    const m = this.#motion
    for (const part of removed) {
      if (this.#unit() < 0.55) {
        const back = this.#random(3, 11)
        m.vx = pose.vx - dx * back + this.#jitter(4)
        m.vy = pose.vy + this.#random(2, 8)
        m.vz = pose.vz - dz * back + this.#jitter(4)
      } else {
        const carried = speed * this.#random(0.06, 0.18)
        m.vx = pose.vx + dx * carried + this.#jitter(3)
        m.vy = pose.vy + dy * carried + this.#random(1, 4)
        m.vz = pose.vz + dz * carried + this.#jitter(3)
      }
      this.#spin(m, this.#random(4, 14))
      this.#single[0] = part
      this.#spawn(view, this.#single, m, this.#random(8, 14))
    }
    this.#fall(view, detached, dx, dz, 1)
  }

  /** `view` no longer draws the ship its bricks came off (it went back to the pool): they stop resting on its deck. */
  forget(view: DebrisSource): void {
    for (let b = 0; b < this.#ships.length; b++) if (this.#ships[b] === view) this.#ships[b] = undefined
  }

  /**
   * Parts come off `view`'s foundering ship on their own: each connected group falls as one body, shoved sideways by
   * `push` m/s along world (dx, dz). A group carrying a mast brings its sails and rigging down with it.
   */
  drop(view: DebrisSource, parts: ReadonlyArray<number>, dx: number, dz: number, push: number): void {
    this.#fall(view, parts, dx, dz, push)
  }

  /**
   * Flotsam where a ship went down: `parts` of `view` pop up on the surface around world (x, z) within `radius`,
   * drifting outward, and float a while before they sink.
   */
  flotsam(view: DebrisSource, parts: ReadonlyArray<number>, x: number, z: number, radius: number, time: number, sea: SeaState): void {
    const m = this.#motion
    for (const part of parts) {
      const angle = this.#unit() * Math.PI * 2
      const out = Math.sqrt(this.#unit()) * radius
      m.vx = Math.cos(angle) * this.#random(0.5, 2.5)
      m.vy = this.#random(1, 3)
      m.vz = Math.sin(angle) * this.#random(0.5, 2.5)
      this.#spin(m, this.#random(1, 4))
      this.#single[0] = part
      const b = this.#spawn(view, this.#single, m, this.#random(14, 22))
      if (b < 0) continue
      const px = x + Math.cos(angle) * out
      const pz = z + Math.sin(angle) * out
      this.#pos[b * 3] = px
      this.#pos[b * 3 + 1] = oceanHeight(sea, px, pz, time) - this.#random(0, 0.6)
      this.#pos[b * 3 + 2] = pz
      this.#q.set(this.#jitter(1), this.#jitter(1), this.#jitter(1), this.#jitter(1)).normalize().toArray(this.#quat, b * 4)
      this.#wet[b] = 1
      this.#floatLeft[b] = this.#random(6, 12)
      this.#ships[b] = undefined
    }
  }

  readonly #single = [0]

  /** Split `parts` into connected groups (the damage graph's edges) and throw each as one body. */
  #fall(view: DebrisSource, parts: ReadonlyArray<number>, dx: number, dz: number, push: number) {
    if (parts.length === 0) return
    const { neighbourStart, neighbours } = this.#model.graph
    const inSet = this.#inSet
    const seen = this.#seen
    for (const p of parts) inSet[p] = 1
    const pose = view.pose
    const m = this.#motion
    for (const start of parts) {
      if (seen[start] === 1) continue
      const component = this.#component
      component.length = 0
      component.push(start)
      seen[start] = 1
      for (let c = 0; c < component.length; c++) {
        const i = component[c] ?? 0
        for (let e = neighbourStart[i] ?? 0, end = neighbourStart[i + 1] ?? 0; e < end; e++) {
          const j = neighbours[e] ?? 0
          if (inSet[j] === 1 && seen[j] === 0) {
            seen[j] = 1
            component.push(j)
          }
        }
      }
      const big = component.length >= chunkPieces
      const shove = push * (big ? this.#random(0.6, 1.4) : this.#random(1, 3))
      m.vx = pose.vx + dx * shove + (big ? 0 : this.#jitter(1.5))
      m.vy = pose.vy + (big ? this.#random(0, 0.5) : this.#random(0.5, 3))
      m.vz = pose.vz + dz * shove + (big ? 0 : this.#jitter(1.5))
      if (big) {
        // Topple away from the blow: about the horizontal axis square to it.
        const tip = this.#random(0.25, 0.5) * Math.min(2, push)
        m.wx = dz * tip
        m.wy = this.#jitter(0.1)
        m.wz = -dx * tip
      } else this.#spin(m, this.#random(1, 5))
      this.#spawn(view, component, m, big ? this.#random(22, 30) : this.#random(8, 14))
    }
    for (const p of parts) {
      inSet[p] = 0
      seen[p] = 0
    }
  }

  #random(min: number, max: number) {
    return min + this.#unit() * (max - min)
  }

  #jitter(spread: number) {
    return (this.#unit() * 2 - 1) * spread
  }

  #spin(m: DebrisMotion, rate: number) {
    const v = this.#v.set(this.#jitter(1), this.#jitter(1), this.#jitter(1)).normalize().multiplyScalar(rate)
    m.wx = v.x
    m.wy = v.y
    m.wz = v.z
  }

  /** One rigid body of `parts` as drawn on `view` now, moving with `m`. Returns its slot, or −1 when full. */
  #spawn(view: DebrisSource, parts: ReadonlyArray<number>, m: DebrisMotion, life: number): number {
    if (parts.length === 0 || parts.length > pieceCapacity) return -1
    // When full, the body nearest the end of its life makes room: fresh debris near the action matters more.
    while (this.#pieces + parts.length > pieceCapacity || this.#bodies >= bodyCapacity) this.#kill(this.#oldest())
    let b = -1
    for (let i = 0; i < bodyCapacity; i++)
      if (this.#alive[i] === 0) {
        b = i
        break
      }
    if (b < 0) return -1
    const { boxes } = this.#model.graph
    // Body frame: the ship's axes at this moment, origin at the centre of the parts' boxes.
    let x0 = Infinity
    let y0 = Infinity
    let z0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    let z1 = -Infinity
    let cx = 0
    let cy = 0
    let cz = 0
    for (const p of parts) {
      const o = p * 6
      x0 = Math.min(x0, boxes[o]!)
      y0 = Math.min(y0, boxes[o + 1]!)
      z0 = Math.min(z0, boxes[o + 2]!)
      x1 = Math.max(x1, boxes[o + 3]!)
      y1 = Math.max(y1, boxes[o + 4]!)
      z1 = Math.max(z1, boxes[o + 5]!)
      cx += (boxes[o]! + boxes[o + 3]!) / 2
      cy += (boxes[o + 1]! + boxes[o + 4]!) / 2
      cz += (boxes[o + 2]! + boxes[o + 5]!) / 2
    }
    cx /= parts.length
    cy /= parts.length
    cz /= parts.length
    const pose = view.pose
    const q = this.#q.set(pose.qx, pose.qy, pose.qz, pose.qw)
    const com = this.#v2.set(cx, cy, cz).applyQuaternion(q)
    this.#pos[b * 3] = pose.x + com.x
    this.#pos[b * 3 + 1] = pose.y + com.y
    this.#pos[b * 3 + 2] = pose.z + com.z
    q.toArray(this.#quat, b * 4)
    this.#vel[b * 3] = m.vx
    this.#vel[b * 3 + 1] = m.vy
    this.#vel[b * 3 + 2] = m.vz
    this.#ang[b * 3] = m.wx
    this.#ang[b * 3 + 1] = m.wy
    this.#ang[b * 3 + 2] = m.wz
    const ex = Math.max(x1 - x0, 0.1)
    const ey = Math.max(y1 - y0, 0.1)
    const ez = Math.max(z1 - z0, 0.1)
    // A box of the parts' extent; chunks are hollow frames, so their inertia leans outward (×1.5).
    const k = parts.length > 1 ? 1.5 : 1
    this.#invInertia[b * 3] = 12 / (k * (ey * ey + ez * ez))
    this.#invInertia[b * 3 + 1] = 12 / (k * (ex * ex + ez * ez))
    this.#invInertia[b * 3 + 2] = 12 / (k * (ex * ex + ey * ey))
    this.#thickness[b] = Math.max(0.08, Math.min(ex, ey, ez) / 2)
    const points = this.#points
    let n = 0
    if (parts.length === 1) {
      for (let c = 0; c < 8; c++) {
        const o = (b * maxPoints + n++) * 3
        points[o] = (c & 1 ? x1 : x0) - cx
        points[o + 1] = (c & 2 ? y1 : y0) - cy
        points[o + 2] = (c & 4 ? z1 : z0) - cz
      }
    } else {
      // Spread the contact points through the chunk: its lowest, highest and outermost parts first, then an even stride.
      const pick = (p: number) => {
        if (n >= maxPoints) return
        const o = p * 6
        const at = (b * maxPoints + n++) * 3
        points[at] = (boxes[o]! + boxes[o + 3]!) / 2 - cx
        points[at + 1] = (boxes[o + 1]! + boxes[o + 4]!) / 2 - cy
        points[at + 2] = (boxes[o + 2]! + boxes[o + 5]!) / 2 - cz
      }
      const extreme = (axis: number, sign: number) => parts.reduce((best, p) => (sign * boxes[p * 6 + axis]! > sign * boxes[best * 6 + axis]! ? p : best), parts[0] ?? 0)
      for (const [axis, sign] of [[1, -1], [1, 1], [0, -1], [0, 1], [2, -1], [2, 1]] as const) pick(extreme(axis, sign))
      const stride = Math.max(1, Math.floor(parts.length / (maxPoints - n)))
      for (let i = 0; i < parts.length && n < maxPoints; i += stride) pick(parts[i] ?? 0)
    }
    this.#pointCount[b] = n
    this.#age[b] = 0
    this.#life[b] = life
    this.#floatLeft[b] = parts.length >= chunkPieces ? this.#random(7, 11) : this.#random(2, 6)
    this.#wet[b] = 0
    this.#crashClock[b] = 0
    this.#ships[b] = view
    this.#lower[b] = deckSlab
    this.#pieceCount[b] = parts.length
    this.#alive[b] = 1
    this.#high = Math.max(this.#high, b + 1)
    this.#bodies++

    // Pieces: each part's drawn world matrix, brought into the body's frame.
    const inverse = this.#m2.compose(this.#v.set(this.#pos[b * 3]!, this.#pos[b * 3 + 1]!, this.#pos[b * 3 + 2]!), q, this.#one).invert()
    let slot = 0
    for (const part of parts) {
      const placement = this.#model.placements[part]
      const shape = placement === undefined ? undefined : this.#shapeOf.get(placement.part)
      if (placement === undefined || shape === undefined) continue
      while (slot < pieceCapacity && this.#pieceAlive[slot] === 1) slot++
      if (slot >= pieceCapacity) break
      view.partMatrix(part, this.#m).premultiply(inverse).toArray(this.#pieceLocal, slot * 16)
      const color = brickColorLinear(placement.color)
      this.#pieceColor[slot * 3] = color.r
      this.#pieceColor[slot * 3 + 1] = color.g
      this.#pieceColor[slot * 3 + 2] = color.b
      this.#pieceShape[slot] = shape
      this.#pieceBody[slot] = b
      this.#pieceAlive[slot] = 1
      this.#pieceHigh = Math.max(this.#pieceHigh, slot + 1)
      this.#pieces++
    }
    this.#attachGhost(view, parts, b, cx, cy, cz)
    return b
  }

  /** A body carrying a mast's top takes a copy of that mast's rig (sails, flags and ropes, as they were set); one carrying only a yard, its sail. */
  #attachGhost(view: DebrisSource, parts: ReadonlyArray<number>, b: number, cx: number, cy: number, cz: number) {
    const source = view.rig
    if (source === undefined) return
    const masts = this.#model.masts
    let carried = -1
    for (let m = 0; m < masts.length; m++) if (parts.includes(masts[m]?.topPart ?? -1)) carried = m
    // A mast brings its rig down only as a chunk; a yard, even shot off alone, brings its sail.
    if (carried >= 0 ? parts.length < chunkPieces : !this.#model.sails.some((sail) => parts.includes(sail.yardPart))) return
    const ghost = this.#ghosts.find((g) => g.body < 0)
    if (ghost === undefined) return
    ghost.body = b
    ghost.com.set(cx, cy, cz)
    ghost.rig.mend()
    ghost.rig.copyFrom(source)
    ghost.rig.setHullRigShown(false)
    masts.forEach((_, m) => ghost.rig.setMastShown(m, m === carried))
    this.#model.sails.forEach((sail, i) => ghost.rig.setSailHeld(i, parts.includes(sail.yardPart) ? "yard" : "gone"))
    ghost.rig.setDetail(view.detail)
    ghost.holder.visible = true
    this.#ghostOf[b] = this.#ghosts.indexOf(ghost)
  }

  /** Steps every body by `dt` and draws them. `time` is the sim time the sea is drawn at; wind in m/s drives ghost sails. */
  update(dt: number, time: number, sea: SeaState | undefined, cameraPosition: Vector3, windX: number, windZ: number): void {
    const started = performance.now()
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)))
    const h = dt / steps
    const crest = sea === undefined ? 0 : sea.waves.reduce((sum, wave) => sum + wave.amplitude, 0)
    for (let b = 0; b < this.#high; b++) {
      if (this.#alive[b] === 0) continue
      const age = this.#age[b]! + dt
      this.#age[b] = age
      if (age > this.#life[b]!) {
        this.#kill(b)
        continue
      }
      const p = b * 3
      // Water height at the body, once a frame, only when it can be near the surface.
      const reach = this.#thickness[b]! * 2 + 8
      const water = sea !== undefined && this.#pos[p + 1]! < crest + reach ? oceanHeight(sea, this.#pos[p]!, this.#pos[p + 2]!, time) : Number.NEGATIVE_INFINITY
      for (let s = 0; s < steps; s++) this.#step(b, h, water)
      if (this.#wet[b] === 1) this.#floatLeft[b] = this.#floatLeft[b]! - dt
      if (this.#pos[p + 1]! < water - sunkDepth - this.#thickness[b]! * 4) this.#kill(b)
    }
    this.#draw(cameraPosition)
    for (const ghost of this.#ghosts) if (ghost.body >= 0) ghost.rig.update(dt, windX, windZ)
    this.#times[this.#frames % this.#times.length] = performance.now() - started
    this.#frames++
  }

  #oldest() {
    let oldest = 0
    let most = -1
    for (let b = 0; b < this.#high; b++) {
      const spent = this.#alive[b] === 1 ? this.#age[b]! / this.#life[b]! : -1
      if (spent > most) {
        most = spent
        oldest = b
      }
    }
    return oldest
  }

  #kill(b: number) {
    this.#alive[b] = 0
    this.#bodies--
    this.#ships[b] = undefined
    for (let i = 0; i < this.#pieceHigh; i++)
      if (this.#pieceAlive[i] === 1 && this.#pieceBody[i] === b) {
        this.#pieceAlive[i] = 0
        this.#pieces--
      }
    const g = this.#ghostOf[b] ?? -1
    const ghost = this.#ghosts[g]
    if (ghost !== undefined) {
      ghost.body = -1
      ghost.holder.visible = false
    }
    this.#ghostOf[b] = -1
    while (this.#high > 0 && this.#alive[this.#high - 1] === 0) this.#high--
    while (this.#pieceHigh > 0 && this.#pieceAlive[this.#pieceHigh - 1] === 0) this.#pieceHigh--
  }

  /** One substep of body `b`: gravity, buoyancy and drag per wet point, impulse contacts with its ship's deck, integration. */
  #step(b: number, h: number, water: number) {
    const p = b * 3
    const pos = this.#pos
    const vel = this.#vel
    const ang = this.#ang
    const r = this.#rotation(b)
    const ix = this.#invInertia[p]!
    const iy = this.#invInertia[p + 1]!
    const iz = this.#invInertia[p + 2]!
    vel[p + 1] = vel[p + 1]! - gravity * h
    const n = this.#pointCount[b]!
    const thick = this.#thickness[b]!
    const chunk = this.#pieceCount[b]! >= chunkPieces
    // Floating: lift up to twice its weight when all points are under (rides at about half depth); then it waterlogs and sinks.
    const lift = this.#floatLeft[b]! > 0 ? 2 : Math.max(0.55, 2 + this.#floatLeft[b]! * 0.5)
    let wetShare = 0
    const view = this.#ships[b]
    const pose = view?.pose
    let deepest = 0
    let walled = false
    let embedded = Number.NEGATIVE_INFINITY
    const lower = this.#lower[b]!
    let nx = 0
    let ny = 1
    let nz = 0
    if (pose !== undefined) {
      nx = 2 * (pose.qx * pose.qy - pose.qw * pose.qz)
      ny = 1 - 2 * (pose.qx * pose.qx + pose.qz * pose.qz)
      nz = 2 * (pose.qy * pose.qz + pose.qw * pose.qx)
    }
    for (let k = 0; k < n; k++) {
      const o = (b * maxPoints + k) * 3
      const lx = this.#points[o]!
      const ly = this.#points[o + 1]!
      const lz = this.#points[o + 2]!
      const rx = r[0]! * lx + r[3]! * ly + r[6]! * lz
      const ry = r[1]! * lx + r[4]! * ly + r[7]! * lz
      const rz = r[2]! * lx + r[5]! * ly + r[8]! * lz
      const wx = pos[p]! + rx
      const wy = pos[p + 1]! + ry
      const wz = pos[p + 2]! + rz
      if (wy < water) {
        const share = Math.min(1, (water - wy) / (2 * thick))
        wetShare += share / n
        this.#push(b, r, rx, ry, rz, 0, (gravity * lift * share * h) / n, 0, ix, iy, iz)
        if (this.#wet[b] === 0) this.#enterWater(b, wx, water, wz, chunk)
      }
      if (pose === undefined || this.#wet[b] === 1) continue
      // Against the deck, in the ship's frame; the ship is held still over one substep.
      const sx = wx - pose.x
      const sy = wy - pose.y
      const sz = wz - pose.z
      const qx = -pose.qx
      const qy = -pose.qy
      const qz = -pose.qz
      const qw = pose.qw
      // Rotate (sx, sy, sz) by the inverse ship quaternion.
      const tx = 2 * (qy * sz - qz * sy)
      const ty = 2 * (qz * sx - qx * sz)
      const tz = 2 * (qx * sy - qy * sx)
      const localX = sx + qw * tx + (qy * tz - qz * ty)
      const localY = sy + qw * ty + (qz * tx - qx * tz)
      const localZ = sz + qw * tz + (qx * ty - qy * tx)
      const surface = deckHeight(this.#model.deck, localX, localZ)
      if (surface === Number.NEGATIVE_INFINITY) continue
      embedded = Math.max(embedded, surface - localY)
      const depth = surface - lower - localY
      // A point that runs into a step up (castle wall, rail) on a body already loose on deck: it rebounds off the wall.
      if (depth > deckSlab && lower === 0 && depth < 4 && !chunk) walled = true
      if (depth <= 0 || depth > deckSlab) continue
      deepest = Math.max(deepest, depth)
      // Velocity of the point relative to the deck, along the deck's normal.
      const vx = vel[p]! + (ang[p + 1]! * rz - ang[p + 2]! * ry) - pose.vx
      const vy = vel[p + 1]! + (ang[p + 2]! * rx - ang[p]! * rz) - pose.vy
      const vz = vel[p + 2]! + (ang[p]! * ry - ang[p + 1]! * rx) - pose.vz
      const vn = vx * nx + vy * ny + vz * nz
      if (vn >= 0) continue
      if (chunk && vn < -3 && this.#crashClock[b]! <= 0) {
        this.#crashClock[b] = 0.6
        this.#audio.hullHit(wx, wy, wz, false)
        this.#effects.dust(wx, wy, wz, Math.min(1.5, -vn / 5))
      }
      const e = vn < -1.2 ? restitution : 0
      const j = (-(1 + e) * vn) / this.#effectiveMass(r, rx, ry, rz, nx, ny, nz, ix, iy, iz)
      this.#push(b, r, rx, ry, rz, nx * j, ny * j, nz * j, ix, iy, iz)
      let tx2 = vx - vn * nx
      let ty2 = vy - vn * ny
      let tz2 = vz - vn * nz
      const vt = Math.hypot(tx2, ty2, tz2)
      if (vt > 1e-4) {
        tx2 /= vt
        ty2 /= vt
        tz2 /= vt
        const jt = Math.min(vt / this.#effectiveMass(r, rx, ry, rz, tx2, ty2, tz2, ix, iy, iz), friction * j)
        this.#push(b, r, rx, ry, rz, -tx2 * jt, -ty2 * jt, -tz2 * jt, ix, iy, iz)
      }
      // Rolling resistance: studs and edges catch, so a brick on a deck stops rocking in a second or so.
      ang[p] = ang[p]! * 0.97
      ang[p + 1] = ang[p + 1]! * 0.97
      ang[p + 2] = ang[p + 2]! * 0.97
    }
    if (walled && pose !== undefined) {
      const vx = vel[p]! - pose.vx
      const vy = vel[p + 1]! - pose.vy
      const vz = vel[p + 2]! - pose.vz
      const vn = vx * nx + vy * ny + vz * nz
      const tx = vx - vn * nx
      const ty = vy - vn * ny
      const tz = vz - vn * nz
      pos[p] = pos[p]! - tx * h * 2
      pos[p + 1] = pos[p + 1]! - ty * h * 2
      pos[p + 2] = pos[p + 2]! - tz * h * 2
      vel[p] = vel[p]! - 1.3 * tx
      vel[p + 1] = vel[p + 1]! - 1.3 * ty
      vel[p + 2] = vel[p + 2]! - 1.3 * tz
    }
    if (pose !== undefined) this.#lower[b] = Math.max(0, Math.min(lower, embedded))
    if (deepest > 0) {
      pos[p] = pos[p]! + nx * deepest * 0.8
      pos[p + 1] = pos[p + 1]! + ny * deepest * 0.8
      pos[p + 2] = pos[p + 2]! + nz * deepest * 0.8
    }
    const air = Math.exp(-0.05 * h)
    const drag = Math.exp(-(chunk ? 1.6 : 3) * wetShare * h)
    const spinDrag = Math.exp(-(chunk ? 1.2 : 2.5) * wetShare * h - 0.1 * h)
    vel[p] = vel[p]! * air * drag
    vel[p + 1] = vel[p + 1]! * air * Math.exp(-4 * wetShare * h)
    vel[p + 2] = vel[p + 2]! * air * drag
    ang[p] = ang[p]! * spinDrag
    ang[p + 1] = ang[p + 1]! * spinDrag
    ang[p + 2] = ang[p + 2]! * spinDrag
    pos[p] = pos[p]! + vel[p]! * h
    pos[p + 1] = pos[p + 1]! + vel[p + 1]! * h
    pos[p + 2] = pos[p + 2]! + vel[p + 2]! * h
    const q = this.#q.fromArray(this.#quat, b * 4)
    const wx = ang[p]!
    const wy = ang[p + 1]!
    const wz = ang[p + 2]!
    const qx = q.x
    const qy = q.y
    const qz = q.z
    const qw = q.w
    q.set(qx + 0.5 * h * (wx * qw + wy * qz - wz * qy), qy + 0.5 * h * (wy * qw + wz * qx - wx * qz), qz + 0.5 * h * (wz * qw + wx * qy - wy * qx), qw - 0.5 * h * (wx * qx + wy * qy + wz * qz))
      .normalize()
      .toArray(this.#quat, b * 4)
    if (this.#crashClock[b]! > 0) this.#crashClock[b] = this.#crashClock[b]! - h
  }

  #enterWater(b: number, x: number, water: number, z: number, chunk: boolean) {
    this.#wet[b] = 1
    this.#ships[b] = undefined
    const p = b * 3
    const speed = Math.hypot(this.#vel[p]!, this.#vel[p + 1]!, this.#vel[p + 2]!)
    if (chunk) {
      const size = Math.min(2.2, 0.8 + this.#pieceCount[b]! / 80)
      this.#effects.splash(x, water, z, 45 * size + speed * 4)
      this.#audio.splash(x, water, z, 40 + speed * 4)
    } else this.#effects.plop(x, water, z, speed)
  }

  /** 1 / (impulse per unit velocity change) at offset r along unit d: 1 + d·((I⁻¹(r×d))×r), unit mass. */
  #effectiveMass(r: Float32Array, rx: number, ry: number, rz: number, dx: number, dy: number, dz: number, ix: number, iy: number, iz: number) {
    const cx = ry * dz - rz * dy
    const cy = rz * dx - rx * dz
    const cz = rx * dy - ry * dx
    const i = this.#applyInverseInertia(r, cx, cy, cz, ix, iy, iz)
    const ax = i.y * rz - i.z * ry
    const ay = i.z * rx - i.x * rz
    const az = i.x * ry - i.y * rx
    return 1 + ax * dx + ay * dy + az * dz
  }

  /** Apply impulse (jx, jy, jz) per unit mass at world offset r from the body's centre. */
  #push(b: number, r: Float32Array, rx: number, ry: number, rz: number, jx: number, jy: number, jz: number, ix: number, iy: number, iz: number) {
    const p = b * 3
    this.#vel[p] = this.#vel[p]! + jx
    this.#vel[p + 1] = this.#vel[p + 1]! + jy
    this.#vel[p + 2] = this.#vel[p + 2]! + jz
    const w = this.#applyInverseInertia(r, ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx, ix, iy, iz)
    this.#ang[p] = this.#ang[p]! + w.x
    this.#ang[p + 1] = this.#ang[p + 1]! + w.y
    this.#ang[p + 2] = this.#ang[p + 2]! + w.z
  }

  /** R · diag(I⁻¹) · Rᵀ · (x, y, z), into a scratch vector. */
  #applyInverseInertia(r: Float32Array, x: number, y: number, z: number, ix: number, iy: number, iz: number) {
    const bx = (r[0]! * x + r[1]! * y + r[2]! * z) * ix
    const by = (r[3]! * x + r[4]! * y + r[5]! * z) * iy
    const bz = (r[6]! * x + r[7]! * y + r[8]! * z) * iz
    return this.#v.set(r[0]! * bx + r[3]! * by + r[6]! * bz, r[1]! * bx + r[4]! * by + r[7]! * bz, r[2]! * bx + r[5]! * by + r[8]! * bz)
  }

  /** Body `b`'s rotation as a column-major 3 × 3, into a scratch array. */
  #rotation(b: number) {
    const o = b * 4
    const x = this.#quat[o]!
    const y = this.#quat[o + 1]!
    const z = this.#quat[o + 2]!
    const w = this.#quat[o + 3]!
    const r = this.#r
    r[0] = 1 - 2 * (y * y + z * z)
    r[1] = 2 * (x * y + w * z)
    r[2] = 2 * (x * z - w * y)
    r[3] = 2 * (x * y - w * z)
    r[4] = 1 - 2 * (x * x + z * z)
    r[5] = 2 * (y * z + w * x)
    r[6] = 2 * (x * z + w * y)
    r[7] = 2 * (y * z - w * x)
    r[8] = 1 - 2 * (x * x + y * y)
    return r
  }

  #draw(camera: Vector3) {
    for (let b = 0; b < this.#high; b++) {
      if (this.#alive[b] === 0) continue
      const left = this.#life[b]! - this.#age[b]!
      const scale = Math.max(1e-3, Math.min(1, left / shrinkSeconds))
      this.#m
        .compose(this.#v.fromArray(this.#pos, b * 3), this.#q.fromArray(this.#quat, b * 4), this.#scale.set(scale, scale, scale))
        .toArray(this.#matrices, b * 16)
      const ghost = this.#ghosts[this.#ghostOf[b] ?? -1]
      if (ghost !== undefined) ghost.holder.matrix.copy(this.#m).multiply(this.#m2.makeTranslation(-ghost.com.x, -ghost.com.y, -ghost.com.z))
      if (ghost !== undefined) ghost.holder.matrixWorldNeedsUpdate = true
    }
    for (const mesh of this.#meshes) mesh.count = 0
    let studs = 0
    const studMesh = this.#studs
    const studColors = studMesh.instanceColor?.array
    const reach2 = studReach * studReach
    for (let i = 0; i < this.#pieceHigh; i++) {
      if (this.#pieceAlive[i] === 0) continue
      const mesh = this.#meshes[this.#pieceShape[i]!]
      if (mesh === undefined) continue
      const b = this.#pieceBody[i]!
      const world = this.#m.fromArray(this.#matrices, b * 16).multiply(this.#m2.fromArray(this.#pieceLocal, i * 16))
      const slot = mesh.count++
      world.toArray(mesh.instanceMatrix.array, slot * 16)
      const colors = mesh.instanceColor?.array
      if (colors !== undefined) {
        colors[slot * 3] = this.#pieceColor[i * 3]!
        colors[slot * 3 + 1] = this.#pieceColor[i * 3 + 1]!
        colors[slot * 3 + 2] = this.#pieceColor[i * 3 + 2]!
      }
      const e = world.elements
      const dx = e[12]! - camera.x
      const dy = e[13]! - camera.y
      const dz = e[14]! - camera.z
      if (dx * dx + dy * dy + dz * dz > reach2 || studColors === undefined) continue
      const offsets = partCatalog[this.#shapes[this.#pieceShape[i]!]!].studs
      for (const [ox, oy, oz] of offsets) {
        if (studs >= studCapacity) break
        this.#m2.makeTranslation(ox * metresPerLdu, oy * metresPerLdu, oz * metresPerLdu).premultiply(world).toArray(studMesh.instanceMatrix.array, studs * 16)
        studColors[studs * 3] = this.#pieceColor[i * 3]!
        studColors[studs * 3 + 1] = this.#pieceColor[i * 3 + 1]!
        studColors[studs * 3 + 2] = this.#pieceColor[i * 3 + 2]!
        studs++
      }
    }
    studMesh.count = studs
    for (let i = 0; i <= this.#meshes.length; i++) {
      const mesh = this.#meshes[i] ?? studMesh
      mesh.visible = mesh.count > 0
      if (mesh.count === 0) continue
      mesh.instanceMatrix.clearUpdateRanges()
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16)
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.clearUpdateRanges()
        mesh.instanceColor.addUpdateRange(0, mesh.count * 3)
        mesh.instanceColor.needsUpdate = true
      }
    }
    this.#studsDrawn = studs
  }
}
