import { buildDamageGraph, ShipDamage, type DamageGraph, type ShipHit } from "./ship/damage.ts"
import { generateShip, gridMetres, type GeneratedShip } from "./ship/generate.ts"
import { rigLayout } from "./ship/rig.ts"
import { galleonSpec } from "./ship/spec.ts"
import { defaultHull } from "./hull.ts"
import { tuning } from "./tuning.ts"
import { vec3, type Vec3 } from "./vector.ts"

/** A set sail a ball can pass through: the plane x = `x` between `foot` and `top`, ship-local metres, carried by `yardPart`. */
export interface SailPlane {
  readonly x: number
  readonly foot: number
  readonly top: number
  readonly footHalf: number
  readonly topHalf: number
  /** Part the sail hangs from; the sail goes when it does. −1 when no part holds the yard cell. */
  readonly yardPart: number
}

/** The one ship class: its generated parts, damage graph, a box around every part and sail, and its sails. */
export interface ShipClass {
  readonly ship: GeneratedShip
  readonly graph: DamageGraph
  readonly min: Vec3
  readonly max: Vec3
  readonly sails: ReadonlyArray<SailPlane>
}

const buildGalleon = (): ShipClass => {
  const spec = galleonSpec
  const ship = generateShip(spec)
  const graph = buildDamageGraph(spec, ship)
  const { boxes } = graph
  const partAt = (x: number, y: number, z: number) => {
    for (let i = graph.count - 1; i >= 0; i--) {
      const o = i * 6
      if (x >= boxes[o]! && x <= boxes[o + 3]! && y >= boxes[o + 1]! && y <= boxes[o + 4]! && z >= boxes[o + 2]! && z <= boxes[o + 5]!) return i
    }
    return -1
  }
  const sails = rigLayout(spec).sails.map((sail): SailPlane => {
    const [cx, cy, cz] = sail.cell
    const yardPart = partAt((cx + 0.5 - spec.midship) * gridMetres.stud, (cy + 0.5 - spec.waterline) * gridMetres.plate, (cz + 0.5) * gridMetres.stud)
    return { x: sail.x, foot: sail.foot, top: sail.top, footHalf: sail.footHalf, topHalf: sail.topHalf, yardPart }
  })
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < graph.count; i++)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, boxes[i * 6 + a]!)
      max[a] = Math.max(max[a]!, boxes[i * 6 + 3 + a]!)
    }
  for (const sail of sails) {
    const half = Math.max(sail.footHalf, sail.topHalf)
    min[2] = Math.min(min[2]!, -half)
    max[2] = Math.max(max[2]!, half)
    max[1] = Math.max(max[1]!, sail.top)
  }
  return { ship, graph, min: vec3(min[0]!, min[1]!, min[2]!), max: vec3(max[0]!, max[1]!, max[2]!), sails }
}

let galleon: ShipClass | undefined

/** The galleon every ship is, generated on first use (~150 ms): call once at startup so no tick pays for it. */
export const galleonClass = (): ShipClass => (galleon ??= buildGalleon())

// Memoises a pure function of the removed list: each list maps to the ship it leaves, so a hit clones instead of replaying.
const wrecks = new WeakMap<ReadonlyArray<number>, ShipDamage>()

/** The galleon's parts left after `removedParts` were knocked out in order. Read-only: never call `hit` or `apply` on it. */
export const shipWreck = (removedParts: ReadonlyArray<number>): ShipDamage => {
  const known = wrecks.get(removedParts)
  if (known !== undefined) return known
  const wreck = new ShipDamage(galleonClass().graph)
  wreck.apply(removedParts)
  wrecks.set(removedParts, wreck)
  return wreck
}

/** A ball strikes a ship that has lost `removedParts` at ship-local `point`, travelling along `direction`: the hit and the new removed list. */
export const strikeWreck = (
  removedParts: ReadonlyArray<number>,
  point: Vec3,
  direction: Vec3,
): { readonly hit: ShipHit; readonly removedParts: ReadonlyArray<number> } => {
  const wreck = shipWreck(removedParts).clone()
  const hit = wreck.hit(point, direction)
  if (hit.removed.length === 0) return { hit, removedParts }
  const next = [...removedParts, ...hit.removed]
  wrecks.set(next, wreck)
  return { hit, removedParts: next }
}

const floodings = new WeakMap<ReadonlyArray<number>, Float64Array>()

/** Share of each `defaultHull` column's buoyancy lost to the holes at the waterline `removedParts` leave. */
export const shipFlooding = (removedParts: ReadonlyArray<number>): Float64Array => {
  const known = floodings.get(removedParts)
  if (known !== undefined) return known
  const { perPart, maxPerColumn, height } = tuning.damage.flooding
  const columns = defaultHull.columns
  const flooded = new Float64Array(columns.length)
  if (removedParts.length > 0) {
    const { graph } = galleonClass()
    const wreck = shipWreck(removedParts)
    for (let i = 0; i < graph.count; i++) {
      const o = i * 6
      if (wreck.isPresent(i) || graph.upperWorks[i] === 1 || graph.boxes[o + 1]! >= height) continue
      const x = (graph.boxes[o]! + graph.boxes[o + 3]!) / 2
      const z = (graph.boxes[o + 2]! + graph.boxes[o + 5]!) / 2
      let nearest = 0
      for (let c = 1; c < columns.length; c++)
        if (Math.hypot(columns[c]!.bottom.x - x, columns[c]!.bottom.z - z) < Math.hypot(columns[nearest]!.bottom.x - x, columns[nearest]!.bottom.z - z)) nearest = c
      flooded[nearest] = Math.min(maxPerColumn, flooded[nearest]! + perPart)
    }
  }
  floodings.set(removedParts, flooded)
  return flooded
}
