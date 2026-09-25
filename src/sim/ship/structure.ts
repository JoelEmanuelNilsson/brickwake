import type { BrickColor } from "./colors.ts"
import { ldu, type PartId, partCatalog } from "./parts.ts"

/** Quarter turns of a part about +y. */
export type QuarterTurns = 0 | 1 | 2 | 3

/**
 * One part on the ship grid: `x`, `z` are its footprint's min corner in studs (x from the stern,
 * z from the centreline, starboard +z), `y` its bottom in plates from the keel bottom.
 */
export interface ShipPart {
  readonly part: PartId
  readonly color: BrickColor
  readonly x: number
  readonly y: number
  readonly z: number
  readonly turns: QuarterTurns
}

/** A connection: `below` has a stud in a socket of `above`. Indices into the part list. */
export type ShipEdge = readonly [below: number, above: number]

const cosine = [1, 0, -1, 0] as const
const sine = [0, 1, 0, -1] as const

/** Footprint in studs along ship x and z after the part's turns. */
export const footprint = ({ part, turns }: ShipPart): readonly [number, number] => {
  const [sx, sz] = partCatalog[part].size
  return turns % 2 === 1 ? [sz, sx] : [sx, sz]
}

/** Height a part occupies, in whole plates. */
export const heightInPlates = ({ part }: ShipPart): number => Math.ceil(partCatalog[part].height / ldu.plate - 1e-9)

/** The grid cell holding a part-local point (x, z in LDU). */
const cellAt = (p: ShipPart, lx: number, lz: number): readonly [number, number] => {
  const [fx, fz] = footprint(p)
  const c = cosine[p.turns]
  const s = sine[p.turns]
  const wx = (lx * c + lz * s) / ldu.stud
  const wz = (-lx * s + lz * c) / ldu.stud
  return [Math.floor(p.x + fx / 2 + wx), Math.floor(p.z + fz / 2 + wz)]
}

/** Cells (x, z) under each of a part's studs, in the order of its catalogue `studs`. */
export const studCells = (p: ShipPart): ReadonlyArray<readonly [number, number]> => partCatalog[p.part].studs.map(([x, , z]) => cellAt(p, x, z))

const socketCells = (p: ShipPart): ReadonlyArray<readonly [number, number]> => {
  const info = partCatalog[p.part]
  if (info.sockets !== undefined) return info.sockets.map(([x, z]) => cellAt(p, x, z))
  const [sx, sz] = info.size
  return Array.from({ length: sx * sz }, (_, i) => cellAt(p, (i % sx) * ldu.stud - ((sx - 1) * ldu.stud) / 2, Math.floor(i / sx) * ldu.stud - ((sz - 1) * ldu.stud) / 2))
}

// Cells pack into one integer; the grid stays within ±512 studs/plates of the origin.
const key = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512)

/** Stud connections between parts: a stud on a part's top in a socket on the underside of the part above. */
export const connectParts = (parts: ReadonlyArray<ShipPart>): ReadonlyArray<ShipEdge> => {
  const sockets = new Map<number, number>()
  parts.forEach((p, i) => {
    for (const [x, z] of socketCells(p)) sockets.set(key(x, p.y, z), i)
  })
  const edges: Array<ShipEdge> = []
  parts.forEach((p, i) => {
    const top = p.y + partCatalog[p.part].height / ldu.plate
    if (!Number.isInteger(top)) return
    const above = new Set<number>()
    for (const [x, z] of studCells(p)) {
      const j = sockets.get(key(x, top, z))
      if (j !== undefined) above.add(j)
    }
    for (const j of above) edges.push([i, j])
  })
  return edges
}

/** Parts on the lowest course: the keel the damage flood fill starts from. */
export const keelParts = (parts: ReadonlyArray<ShipPart>): ReadonlyArray<number> => {
  const bottom = parts.reduce((m, p) => Math.min(m, p.y), Infinity)
  return parts.flatMap((p, i) => (p.y === bottom ? [i] : []))
}

/** Which parts a flood fill over `edges` reaches from `anchors`, skipping `removed`. */
export const reachable = (count: number, edges: ReadonlyArray<ShipEdge>, anchors: ReadonlyArray<number>, removed: ReadonlySet<number> = new Set()): Uint8Array => {
  const neighbours: Array<Array<number>> = Array.from({ length: count }, () => [])
  for (const [a, b] of edges) {
    neighbours[a]?.push(b)
    neighbours[b]?.push(a)
  }
  const seen = new Uint8Array(count)
  const stack = anchors.filter((i) => !removed.has(i))
  for (const i of stack) seen[i] = 1
  for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
    for (const j of neighbours[i] ?? []) {
      if (seen[j] === 1 || removed.has(j)) continue
      seen[j] = 1
      stack.push(j)
    }
  }
  return seen
}

/** Every grid cell (x, y, z) a part occupies. */
export const occupiedCells = (p: ShipPart): ReadonlyArray<readonly [number, number, number]> => {
  const [fx, fz] = footprint(p)
  const h = heightInPlates(p)
  const cells: Array<readonly [number, number, number]> = []
  for (let dx = 0; dx < fx; dx++) for (let dy = 0; dy < h; dy++) for (let dz = 0; dz < fz; dz++) cells.push([p.x + dx, p.y + dy, p.z + dz])
  return cells
}

/** Cell overlaps between parts, as [first, second, cell] triples. */
export const findOverlaps = (parts: ReadonlyArray<ShipPart>): ReadonlyArray<readonly [number, number, readonly [number, number, number]]> => {
  const owner = new Map<number, number>()
  const overlaps: Array<readonly [number, number, readonly [number, number, number]]> = []
  parts.forEach((p, i) => {
    for (const cell of occupiedCells(p)) {
      const k = key(...cell)
      const other = owner.get(k)
      if (other === undefined) owner.set(k, i)
      else overlaps.push([other, i, cell])
    }
  })
  return overlaps
}
