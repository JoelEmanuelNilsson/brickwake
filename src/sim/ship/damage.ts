import { tuning } from "../tuning.ts"
import type { Vec3 } from "../vector.ts"
import { type GeneratedShip, gridMetres, sampleCurve } from "./generate.ts"
import type { ShipSpec } from "./spec.ts"
import { footprint, heightInPlates } from "./structure.ts"

/** Where a ball struck: the hull costs HP and bricks, the upper works bricks for little HP, the sails only cloth. */
export type DamageZone = "hull" | "upperWorks" | "sails"

/**
 * A ship's parts as the damage rules see them, built once per ship class at load. Nodes are parts, indexed
 * like `GeneratedShip.parts`; edges are the ship's connections, sub-assembly edges included; anchors are the keel.
 */
export interface DamageGraph {
  readonly count: number
  /** Ship-local boxes in metres, six numbers per part: min x, y, z, then max x, y, z. */
  readonly boxes: Float64Array
  /** 1 where the part belongs to the upper works. */
  readonly upperWorks: Uint8Array
  /** Neighbours of part i are `neighbours[neighbourStart[i]]` up to `neighbours[neighbourStart[i + 1]]`. */
  readonly neighbourStart: Int32Array
  readonly neighbours: Int32Array
  readonly anchors: Int32Array
}

/** Build the damage graph of a generated ship: boxes, zones and adjacency. */
export const buildDamageGraph = (spec: ShipSpec, ship: GeneratedShip): DamageGraph => {
  const count = ship.parts.length
  const boxes = new Float64Array(count * 6)
  const upperWorks = new Uint8Array(count)
  ship.parts.forEach((p, i) => {
    const [fx, fz] = footprint(p)
    const h = heightInPlates(p)
    boxes.set([(p.x - spec.midship) * gridMetres.stud, (p.y - spec.waterline) * gridMetres.plate, p.z * gridMetres.stud, (p.x + fx - spec.midship) * gridMetres.stud, (p.y + h - spec.waterline) * gridMetres.plate, (p.z + fz) * gridMetres.stud], i * 6)
    upperWorks[i] = p.y >= spec.upperWorks + Math.round(sampleCurve(spec.sheer, p.x + fx / 2)) ? 1 : 0
  })
  const neighbourStart = new Int32Array(count + 1)
  for (const [a, b] of ship.edges) {
    neighbourStart[a + 1] = (neighbourStart[a + 1] ?? 0) + 1
    neighbourStart[b + 1] = (neighbourStart[b + 1] ?? 0) + 1
  }
  for (let i = 0; i < count; i++) neighbourStart[i + 1] = (neighbourStart[i + 1] ?? 0) + (neighbourStart[i] ?? 0)
  const neighbours = new Int32Array(neighbourStart[count] ?? 0)
  const fill = neighbourStart.slice(0, count)
  for (const [a, b] of ship.edges) {
    neighbours[fill[a] ?? 0] = b
    fill[a] = (fill[a] ?? 0) + 1
    neighbours[fill[b] ?? 0] = a
    fill[b] = (fill[b] ?? 0) + 1
  }
  return { count, boxes, upperWorks, neighbourStart, neighbours, anchors: Int32Array.from(ship.keel) }
}

/** What one ball did: the zone it struck, the parts it knocked out, and the parts that lost their path to the keel. */
export interface ShipHit {
  readonly zone: DamageZone
  readonly removed: ReadonlyArray<number>
  readonly detached: ReadonlyArray<number>
}

/** HP a hit on `zone` costs. */
export const hitDamage = (zone: DamageZone): number =>
  zone === "hull" ? tuning.damage.perBall : zone === "upperWorks" ? tuning.damage.upperWorksPerBall : tuning.damage.sailsPerBall

// Sample the ball's path every 5 cm: finer than any part, so the nearest approach is within 2.5 cm.
const pathStep = 0.05

/**
 * Which parts of one ship are still on it. Deterministic: the same graph and the same sequence of hits (server)
 * or of removed part lists (clients) give the same parts, so only removed part indices need to travel.
 */
export class ShipDamage {
  readonly graph: DamageGraph
  readonly #present: Uint8Array
  readonly #reached: Uint8Array
  readonly #stack: Int32Array

  constructor(graph: DamageGraph) {
    this.graph = graph
    this.#present = new Uint8Array(graph.count).fill(1)
    this.#reached = new Uint8Array(graph.count)
    this.#stack = new Int32Array(graph.count)
  }

  isPresent(i: number): boolean {
    return this.#present[i] === 1
  }

  /**
   * A ball strikes ship-local `point` travelling along ship-local `direction`: knock out the parts nearest its
   * path, up to the cap of the zone it struck, and drop whatever that cuts off from the keel.
   */
  hit(point: Vec3, direction: Vec3): ShipHit {
    const { radius, depth, hullCap, upperWorksCap } = tuning.damage.bricks
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1
    const [dx, dy, dz] = [direction.x / length, direction.y / length, direction.z / length]
    const steps = Math.ceil(depth / pathStep)
    const candidates: Array<{ readonly index: number; readonly key: number }> = []
    const { boxes } = this.graph
    const reach = [Math.min(point.x, point.x + dx * depth) - radius, Math.min(point.y, point.y + dy * depth) - radius, Math.min(point.z, point.z + dz * depth) - radius, Math.max(point.x, point.x + dx * depth) + radius, Math.max(point.y, point.y + dy * depth) + radius, Math.max(point.z, point.z + dz * depth) + radius] as const
    for (let i = 0; i < this.graph.count; i++) {
      if (this.#present[i] !== 1) continue
      const o = i * 6
      const [x0, y0, z0, x1, y1, z1] = [boxes[o] ?? 0, boxes[o + 1] ?? 0, boxes[o + 2] ?? 0, boxes[o + 3] ?? 0, boxes[o + 4] ?? 0, boxes[o + 5] ?? 0]
      if (x1 < reach[0] || y1 < reach[1] || z1 < reach[2] || x0 > reach[3] || y0 > reach[4] || z0 > reach[5]) continue
      let best = Infinity
      for (let s = 0; s <= steps; s++) {
        const t = s * pathStep
        const x = point.x + dx * t
        const y = point.y + dy * t
        const z = point.z + dz * t
        const gap = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1), Math.max(z0 - z, 0, z - z1))
        // Across the path counts double along it, so the ball breaks through the part behind before widening the hole.
        if (gap <= radius) best = Math.min(best, 2 * gap + t)
      }
      if (best < Infinity) candidates.push({ index: i, key: best })
    }
    candidates.sort((a, b) => a.key - b.key || a.index - b.index)
    const struck = candidates[0]
    if (struck === undefined) return { zone: "sails", removed: [], detached: [] }
    const zone: DamageZone = this.graph.upperWorks[struck.index] === 1 ? "upperWorks" : "hull"
    const removed = candidates.slice(0, zone === "hull" ? hullCap : upperWorksCap).map((c) => c.index)
    return { zone, removed, detached: this.apply(removed) }
  }

  /** Take out `removed` and every part that no longer connects to a keel part; returns those detached parts. */
  apply(removed: ReadonlyArray<number>): ReadonlyArray<number> {
    for (const i of removed) this.#present[i] = 0
    const { neighbourStart, neighbours, anchors } = this.graph
    const reached = this.#reached.fill(0)
    const stack = this.#stack
    let top = 0
    for (const a of anchors)
      if (this.#present[a] === 1 && reached[a] === 0) {
        reached[a] = 1
        stack[top++] = a
      }
    while (top > 0) {
      const i = stack[--top] ?? 0
      for (let e = neighbourStart[i] ?? 0, end = neighbourStart[i + 1] ?? 0; e < end; e++) {
        const j = neighbours[e] ?? 0
        if (reached[j] === 1 || this.#present[j] !== 1) continue
        reached[j] = 1
        stack[top++] = j
      }
    }
    const detached: Array<number> = []
    for (let i = 0; i < this.graph.count; i++)
      if (this.#present[i] === 1 && reached[i] === 0) {
        this.#present[i] = 0
        detached.push(i)
      }
    return detached
  }

  /** Distance along a ship-local ray to the first present part it enters, if any within `maxDistance`. */
  firstPartAlong(origin: Vec3, direction: Vec3, maxDistance: number): number | undefined {
    const o = [origin.x, origin.y, origin.z]
    const inverse = [1 / direction.x, 1 / direction.y, 1 / direction.z]
    const { boxes } = this.graph
    let nearest = maxDistance
    let found = false
    for (let i = 0; i < this.graph.count; i++) {
      if (this.#present[i] !== 1) continue
      let near = 0
      let far = nearest
      for (let a = 0; a < 3 && near <= far; a++) {
        const lo = boxes[i * 6 + a] ?? 0
        const hi = boxes[i * 6 + 3 + a] ?? 0
        const t0 = (lo - (o[a] ?? 0)) * (inverse[a] ?? 0)
        const t1 = (hi - (o[a] ?? 0)) * (inverse[a] ?? 0)
        near = Math.max(near, Math.min(t0, t1))
        far = Math.min(far, Math.max(t0, t1))
      }
      if (near <= far && near < nearest) {
        nearest = near
        found = true
      }
    }
    return found ? nearest : undefined
  }
}
