import { ShipAir } from "./air.ts"
import type { Assembly } from "./assemblies.ts"
import type { BrickColor } from "./colors.ts"
import type { PartId } from "./parts.ts"
import { rigParts } from "./rig.ts"
import type { Curve, ShipSpec } from "./spec.ts"
import { connectParts, footprint, heightInPlates, keelParts, occupiedCells, reachable, type QuarterTurns, type ShipEdge, type ShipPart } from "./structure.ts"

/** A generated ship: its parts, their stud connections and the keel parts damage floods from. */
export interface GeneratedShip {
  readonly parts: ReadonlyArray<ShipPart>
  readonly edges: ReadonlyArray<ShipEdge>
  readonly keel: ReadonlyArray<number>
  /** Gunport openings carved into the hull, grid units, [from, to) ranges. */
  readonly ports: ReadonlyArray<GunPort>
  /** Hull wall cells carved open for gunports: sealing them separates the inside of the hull from the outside. */
  readonly openings: ReadonlyArray<readonly [number, number, number]>
  /** Parts dropped because no joint placement could attach them to the keel. */
  readonly pruned: number
  /** Parts from this index on are the rig: mast steps, masts, yards and crow's nests. */
  readonly rigFrom: number
}

/** One gunport opening on the grid. */
export interface GunPort {
  readonly side: "port" | "starboard"
  readonly x: readonly [number, number]
  readonly y: readonly [number, number]
}

/** Metres per stud and per plate. */
export const gridMetres = { stud: 0.4, plate: 0.16 } as const

const mirroredTurns = (turns: QuarterTurns): QuarterTurns => (turns % 2 === 0 ? ((turns + 2) % 4) as QuarterTurns : turns)
const mirroredPart: Partial<Record<PartId, PartId>> = { "41769": "41770", "41770": "41769", "43722": "43723", "43723": "43722", "24307": "24299", "24299": "24307" }

/**
 * An assembly's parts on the ship grid: turned `turns` quarter turns about +y, moved so the min corner of
 * its footprint sits on the anchor cell, then, when `mirror`, reflected across the centreline.
 */
export const placeAssembly = (assembly: Assembly, x: number, y: number, z: number, turns: QuarterTurns, mirror: boolean): ReadonlyArray<ShipPart> => {
  const turned = assembly.parts.map((p) => {
    let [px, pz] = [p.x, p.z]
    let [fx, fz] = footprint(p)
    for (let t = 0; t < turns; t++) {
      // A quarter turn maps (x, z) to (z, -x); the footprint's min corner follows.
      ;[px, pz] = [pz, -px - fx]
      ;[fx, fz] = [fz, fx]
    }
    return { ...p, x: px, z: pz, turns: ((p.turns + turns) % 4) as QuarterTurns }
  })
  const minX = Math.min(...turned.map((p) => p.x))
  const minZ = Math.min(...turned.map((p) => p.z))
  return turned.map((p) => {
    const placed: ShipPart = { ...p, x: x + p.x - minX, y: y + p.y, z: z + p.z - minZ }
    return mirror ? { ...placed, part: mirroredPart[placed.part] ?? placed.part, z: -placed.z - (footprint(placed)[1] ?? 1), turns: mirroredTurns(placed.turns) } : placed
  })
}

/**
 * Where a gun at `height` m (its barrel axis) and `gx` m along the ship gets its port, grid units: `base` is the deck
 * plate its carriage stands on, the port starts `port.sill` plates above it, and its x range is centred on the gun.
 */
export const gunPortCells = (spec: ShipSpec, height: number, gx: number) => {
  const base = Math.round(spec.waterline + height / gridMetres.plate - spec.gunAxis)
  const x0 = Math.round(spec.midship + gx / gridMetres.stud - spec.port.width / 2)
  const y0 = base + spec.port.sill
  return { x: [x0, x0 + spec.port.width] as const, y: [y0, y0 + spec.port.height] as const, base }
}

/** Samples a piecewise-linear curve, clamped at both ends. */
export const sampleCurve = (curve: Curve, t: number): number => {
  const first = curve[0]
  if (first === undefined) return 0
  if (t <= first[0]) return first[1]
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1] ?? first
    const b = curve[i] ?? first
    if (t <= b[0]) return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0])
  }
  return curve[curve.length - 1]?.[1] ?? 0
}

const bricks: Readonly<Record<number, PartId>> = { 1: "3005", 2: "3004", 3: "3622", 4: "3010", 6: "3009", 8: "3008" }
const plates: Readonly<Record<number, PartId>> = { 1: "3024", 2: "3023", 3: "3623", 4: "3710", 6: "3666", 8: "3460" }
const tiles: Readonly<Record<number, PartId>> = { 1: "3070b", 2: "3069b", 3: "63864", 4: "2431" }
const widePlates: Readonly<Record<number, PartId>> = { 2: "3022", 3: "3021", 4: "3020", 6: "3795" }
const lengths = [8, 6, 4, 3, 2, 1] as const
const wideLengths = [6, 4, 3, 2] as const
const tileLengths = [4, 3, 2, 1] as const
const bondPattern = [4, 6, 3, 8, 4, 2, 6, 4, 3, 6] as const
const wedges: Readonly<Record<number, readonly [right: PartId, left: PartId]>> = { 2: ["24307", "24299"], 3: ["43722", "43723"], 4: ["41769", "41770"] }

const empty = 0
const wall = 1
const plank = 2
const beam = 3
const tile = 4

/** Integer hash in [0, 1): identical on every JS engine, unlike Math.sin-based hashes. */
const hash = (a: number, b: number, c: number, salt: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f) ^ Math.imul(c ^ 0x165667b1, 0x9e3779b1) ^ Math.imul(salt, 0x61c88647)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

const pickMottle = (base: BrickColor, mottle: ReadonlyArray<{ readonly color: BrickColor; readonly share: number }> | undefined, roll: number): BrickColor => {
  let acc = 0
  for (const m of mottle ?? []) {
    acc += m.share
    if (roll < acc) return m.color
  }
  return base
}

const lineFamilies = [bricks, plates, tiles] as const
const lineOf = (p: ShipPart) => {
  const family = lineFamilies.find((table) => Object.values(table).includes(p.part))
  if (family === undefined) return undefined
  const length = Number(Object.entries(family).find(([, id]) => id === p.part)?.[0] ?? 0)
  const alongX = p.turns % 2 === 0
  return { family, length, alongX, start: alongX ? p.x : p.z, row: alongX ? p.z : p.x }
}

/**
 * Moves joints so parts the bond left hanging share a part with a connected neighbour in the same run.
 * Packing sees only the course below; this pass fixes what only the finished graph can show.
 */
const repairConnections = (input: ReadonlyArray<ShipPart>): ReadonlyArray<ShipPart> => {
  let parts: Array<ShipPart | undefined> = [...input]
  for (let round = 0; round < 12; round++) {
    const present = parts.filter((p): p is ShipPart => p !== undefined)
    parts = present
    const seen = reachable(present.length, connectParts(present), keelParts(present))
    if (seen.every((v) => v === 1)) break
    const owner = new Map<string, number>()
    present.forEach((p, i) => {
      const [fx, fz] = footprint(p)
      for (let dx = 0; dx < fx; dx++) for (let dz = 0; dz < fz; dz++) owner.set(`${p.x + dx},${p.y},${p.z + dz}`, i)
    })
    const touched = new Set<number>()
    let changed = false
    present.forEach((p, i) => {
      const line = lineOf(p)
      if (seen[i] === 1 || touched.has(i) || line === undefined) return
      for (const forward of [true, false]) {
        const at = forward ? line.start + line.length : line.start - 1
        const j = owner.get(line.alongX ? `${at},${p.y},${p.z}` : `${p.x},${p.y},${at}`)
        const q = j === undefined ? undefined : present[j]
        const other = q === undefined ? undefined : lineOf(q)
        if (j === undefined || q === undefined || other === undefined || seen[j] !== 1 || touched.has(j)) continue
        if (other.family !== line.family || other.alongX !== line.alongX || other.row !== line.row || q.color !== p.color) continue
        const total = line.length + other.length
        const sizes = Object.keys(line.family).map(Number)
        const give = sizes.includes(total) ? other.length : Array.from({ length: other.length - 1 }, (_, k) => k + 1).find((k) => sizes.includes(line.length + k) && sizes.includes(other.length - k))
        if (give === undefined) continue
        const from = forward ? line.start : line.start - give
        const make = (start: number, length: number): ShipPart => {
          const id = line.family[length] ?? p.part
          return line.alongX ? { ...p, part: id, x: start } : { ...p, part: id, z: start }
        }
        parts[i] = make(from, line.length + give)
        parts[j] = give === other.length ? undefined : make(forward ? other.start + give : other.start, other.length - give)
        touched.add(i)
        touched.add(j)
        changed = true
        return
      }
    })
    if (!changed) break
  }
  return parts.filter((p): p is ShipPart => p !== undefined)
}

/** Turns a `ShipSpec` into parts on the brick grid, deterministically. */
export const generateShip = (spec: ShipSpec): GeneratedShip => {
  const height = spec.courses.reduce((sum, c) => sum + (c === "brick" ? 3 : 1), 0)
  const bodyStart = new Int32Array(height)
  const bodyEnd = new Int32Array(height)
  for (let y = 0, i = 0; i < spec.courses.length; i++) {
    const h = spec.courses[i] === "brick" ? 3 : 1
    for (let p = y; p < y + h; p++) {
      bodyStart[p] = y
      bodyEnd[p] = y + h
    }
    y += h
  }
  const planEnd = spec.plan[spec.plan.length - 1]?.[0] ?? 0
  const lengthX = Math.ceil(planEnd + spec.stemRake * (height - spec.waterline)) + 2
  // Two studs of margin outside the widest hull for parts built proud of it.
  const half = Math.ceil(spec.plan.reduce((m, [, hb]) => Math.max(m, hb), 0) * spec.section.reduce((m, [, f]) => Math.max(m, f), 0)) + 2
  const widthZ = 2 * half
  const inGrid = (x: number, p: number, z: number) => x >= 0 && x < lengthX && p >= 0 && p < height && z >= -half && z < half
  const at = (x: number, p: number, z: number) => (x * height + p) * widthZ + z + half

  const layerStart = (x: number, p: number) => (x >= spec.bowFrom ? p : (bodyStart[p] ?? p))
  const layerEnd = (x: number, p: number) => (x >= spec.bowFrom ? p + 1 : (bodyEnd[p] ?? p + 1))
  const bowSpan = Math.max(1, planEnd - spec.bowFrom)

  const halfBreadth = (xc: number, h: number) => {
    const bowShare = Math.min(1, Math.max(0, (xc - spec.bowFrom) / bowSpan))
    return sampleCurve(spec.plan, xc - spec.stemRake * (h - spec.waterline) * bowShare) * sampleCurve(spec.section, h)
  }
  const topAt = (x: number) => spec.castles.reduce((top, c) => (x >= c.from && x < c.to ? Math.max(top, c.top) : top), spec.rail + Math.round(sampleCurve(spec.sheer, x + 0.5)))

  const inside = new Uint8Array(lengthX * height * widthZ)
  for (let x = 0; x < lengthX; x++) {
    const top = topAt(x)
    const keel = sampleCurve(spec.keel, x + 0.5)
    for (let p = 0; p < height; p++) {
      const h = (layerStart(x, p) + layerEnd(x, p)) / 2
      if (h <= keel || h >= top || x + 0.5 < spec.transom.x - spec.transom.rake * (h - spec.waterline)) continue
      const hb = halfBreadth(x + 0.5, h)
      for (let z = -half; z < half; z++) inside[at(x, p, z)] = (z < 0 ? -z - 0.5 : z + 0.5) < hb ? 1 : 0
    }
  }
  const isInside = (x: number, p: number, z: number) => inGrid(x, p, z) && inside[at(x, p, z)] === 1

  const kind = new Uint8Array(inside.length)
  const floor = new Uint8Array(inside.length)
  const face = new Uint8Array(inside.length)
  const setLayer = (x: number, p: number, z: number, target: Uint8Array, value: number) => {
    for (let q = layerStart(x, p); q < layerEnd(x, p); q++) target[at(x, q, z)] = value
  }
  const deckAt = (x: number, y0: number, y1: number) => {
    if (y1 - y0 !== 1) return empty
    for (const d of spec.decks) {
      if (x < d.from || x >= d.to) continue
      if (d.planks === y0) return d.surface === "tiles" ? tile : plank
      if (d.beams === y0) return beam
    }
    return empty
  }
  for (let x = 0; x < lengthX; x++) {
    for (let y0 = 0; y0 < height; y0 = layerEnd(x, y0)) {
      const y1 = layerEnd(x, y0)
      const below = y0 > 0 ? layerStart(x, y0 - 1) : 0
      for (let z = -half; z < half; z++) {
        if (!isInside(x, y0, z)) continue
        let shell = false
        for (let p = y0; p < y1 && !shell; p++)
          for (let dx = -spec.shell; dx <= spec.shell && !shell; dx++)
            for (let dz = -spec.shell; dz <= spec.shell && !shell; dz++) shell = !isInside(x + dx, p, z + dz)
        const bottom = !isInside(x, y0 - 1, z)
        const onFloor = bottom || !isInside(x, below - 1, z)
        let outer = bottom
        for (let p = y0; p < y1 && !outer; p++) outer = !isInside(x + 1, p, z) || !isInside(x - 1, p, z) || !isInside(x, p, z + 1) || !isInside(x, p, z - 1)
        const deck = deckAt(x, y0, y1)
        // Deck courses take the cells jutting out over air too, so the deck's cross-bond holds them.
        const value = deck !== empty && (!outer || bottom) ? deck : shell || onFloor ? wall : empty
        setLayer(x, y0, z, kind, value)
        setLayer(x, y0, z, floor, onFloor ? 1 : 0)
        setLayer(x, y0, z, face, outer ? 1 : 0)
      }
    }
  }

  // Walls stepped inward going up (tumblehome, castle walls) need a wall under them down to solid footing.
  for (let p = height - 1; p > 0; p--) {
    for (let x = 0; x < lengthX; x++) {
      if (layerStart(x, p) !== p) continue
      for (let z = -half; z < half; z++) {
        if (kind[at(x, p, z)] !== wall || !isInside(x, p - 1, z) || kind[at(x, p - 1, z)] !== empty) continue
        setLayer(x, p - 1, z, kind, wall)
      }
    }
  }

  // Deck beams hang under the lower gun deck's ceiling, so the deck seen through a port reads as a gun deck, not a box.
  const { y: beamY, every } = spec.deckBeams
  for (let x = 0; x < lengthX; x++)
    if (x % every >= every - 2) for (let z = -half; z < half; z++) if (isInside(x, beamY, z) && kind[at(x, beamY, z)] === empty) kind[at(x, beamY, z)] = beam

  const paint = new Map<number, BrickColor>()
  const openings: Array<readonly [number, number, number]> = []
  const carve = (x: number, p: number, z: number) => {
    if (!inGrid(x, p, z) || kind[at(x, p, z)] !== wall) return false
    kind[at(x, p, z)] = empty
    return true
  }
  const build = (x: number, p: number, z: number, c: BrickColor) => {
    if (!inGrid(x, p, z)) return
    if (kind[at(x, p, z)] === empty) {
      kind[at(x, p, z)] = wall
      face[at(x, p, z)] = 1
    }
    paint.set(at(x, p, z), c)
  }
  const framed = new Set<number>()
  const fixtures: Array<ShipPart> = []
  const ports: Array<GunPort> = []
  for (const deck of spec.guns.decks) {
    const faceZ = Math.round(deck.halfBeam / gridMetres.stud)
    for (const gx of deck.xs) {
      const { x: [x0, x1], y: [y0, y1], base } = gunPortCells(spec, deck.height, gx)
      for (const side of ["port", "starboard"] as const) {
        const zOf = (z: number) => (side === "port" ? -1 - z : z)
        ports.push({ side, x: [x0, x1], y: [y0, y1] })
        for (let x = x0; x < x1; x++) for (let p = y0; p < y1; p++) for (let z = 0; z < half; z++) if (carve(x, p, zOf(z))) openings.push([x, p, zOf(z)])
        // The frame is painted into the shell, flush with the hull, so the port is no deeper than the wall. The side
        // steps in (tumblehome) within a port's height, so each row's frame follows that row's outer face.
        const frame = (x: number, p: number, c: BrickColor) => {
          let z = half - 1
          while (z > 0 && !isInside(x, p, zOf(z))) z--
          for (let k = 0; k < spec.shell; k++) {
            paint.set(at(x, p, zOf(z - k)), c)
            framed.add(at(x, p, zOf(z - k)))
          }
        }
        for (const x of [x0 - 1, x1]) for (let p = y0; p < y1; p++) frame(x, p, spec.portFrame.jamb)
        // A rib stands against the wall's inner face either side of the port, from the deck to the lintel.
        for (const x of [x0 - 1, x1])
          for (let p = base; p <= y1; p++) {
            let z = half - 1
            while (z > 0 && !(isInside(x, p, zOf(z)) && kind[at(x, p, zOf(z))] === wall)) z--
            while (z > 0 && kind[at(x, p, zOf(z - 1))] === wall) z--
            if (z > 0) build(x, p, zOf(z - 1), spec.portFrame.rib)
          }
        for (let x = x0 - 1; x <= x1; x++) {
          frame(x, y0 - 1, spec.portFrame.sill)
          frame(x, y1, spec.portFrame.lintel)
        }
        // Centred in the port and inboard, so the carriage stands on the deck and only the muzzle clears the hull.
        fixtures.push(...placeAssembly(spec.gun, x0 + (spec.port.width - 2) / 2, base, faceZ - spec.gunInboard, 0, side === "port"))
      }
    }
  }

  // Stern panels paint or glaze the transom's outer face; windows sit a stud deep behind a carved recess.
  const transomFace = (p: number, z: number) => {
    for (let x = 0; x <= spec.transom.x; x++) if (inGrid(x, p, z) && kind[at(x, p, z)] !== empty) return kind[at(x, p, z)] === wall ? x : undefined
    return undefined
  }
  for (const panel of spec.stern)
    for (const sign of [1, -1])
      for (let zs = panel.z[0]; zs < panel.z[1]; zs++)
        for (let p = panel.y[0]; p < panel.y[1]; p++) {
          const z = sign > 0 ? zs : -1 - zs
          const x = transomFace(p, z)
          if (x === undefined) continue
          if (panel.fill !== "window") build(x, p, z, panel.fill)
          else if (inGrid(x + 1, p, z) && kind[at(x + 1, p, z)] === wall) {
            carve(x, p, z)
            build(x + 1, p, z, "transOrange")
          }
        }
  for (let z = -half; z < half; z++) {
    const x = transomFace(spec.gallery.y, z)
    if (x !== undefined && x > 0) build(x - 1, spec.gallery.y, z, spec.gallery.color)
  }

  // Ornaments: "top" anchors stand on the column's highest cell; wall cells they sit in are carved for them.
  const columnTop = (x: number, z: number) => {
    for (let p = height - 1; p >= 0; p--) if (inGrid(x, p, z) && kind[at(x, p, z)] !== empty) return p + 1
    return 0
  }
  for (const o of spec.ornaments) {
    const y = o.y === "top" ? columnTop(o.x, o.z) : o.y
    for (const mirror of o.mirror === true ? [false, true] : [false]) fixtures.push(...placeAssembly(o.assembly, o.x, y, o.z, o.turns ?? 0, mirror))
  }
  const rig = rigParts(spec.rig)
  const reserved = new Uint8Array(inside.length)
  for (const f of [...fixtures, ...rig])
    for (const [x, p, z] of occupiedCells(f)) {
      if (!inGrid(x, p, z)) continue
      if (kind[at(x, p, z)] === wall) carve(x, p, z)
      kind[at(x, p, z)] = empty
      reserved[at(x, p, z)] = 1
    }
  // A tile deck turns to plates wherever something stands on it, so it has studs to hold on to.
  for (let x = 0; x < lengthX; x++)
    for (let p = 0; p + 1 < height; p++)
      for (let z = -half; z < half; z++) if (kind[at(x, p, z)] === tile && (kind[at(x, p + 1, z)] !== empty || reserved[at(x, p + 1, z)] === 1)) kind[at(x, p, z)] = plank

  const colorTable: Array<BrickColor> = []
  const colorIndex = (c: BrickColor) => {
    const i = colorTable.indexOf(c)
    return i >= 0 ? i : colorTable.push(c) - 1
  }
  const strakeOf = (x: number, y0: number, y1: number) => {
    const rel = y0 + Math.floor((y1 - y0) / 2) - Math.round(sampleCurve(spec.sheer, x + 0.5))
    return spec.strakes.find((s) => rel < s.below) ?? spec.strakes[spec.strakes.length - 1]
  }
  const color = new Uint8Array(inside.length)
  for (let x = 0; x < lengthX; x++)
    for (let p = 0; p < height; p++)
      for (let z = -half; z < half; z++) {
        const k = kind[at(x, p, z)]
        const painted = paint.get(at(x, p, z))
        if (k === wall) color[at(x, p, z)] = colorIndex(painted ?? strakeOf(x, layerStart(x, p), layerEnd(x, p))?.color ?? "black")
        else if (k !== empty) color[at(x, p, z)] = colorIndex(spec.deckColor)
      }

  const filled = (x: number, p: number, z: number) => inGrid(x, p, z) && kind[at(x, p, z)] !== empty
  const taken = new Uint8Array(inside.length)
  const free = (x: number, p: number, z: number, k: number) => inGrid(x, p, z) && kind[at(x, p, z)] === k && taken[at(x, p, z)] === 0
  const parts: Array<ShipPart> = []
  // Cells of parts that stand on the keel through the courses packed so far; the bond steers joints toward them.
  const grounded = new Uint8Array(inside.length)
  const ground = (p: ShipPart) => {
    const [fx, fz] = footprint(p)
    let held = p.y === 0
    for (let dx = 0; dx < fx && !held; dx++) for (let dz = 0; dz < fz && !held; dz++) held = inGrid(p.x + dx, p.y - 1, p.z + dz) && grounded[at(p.x + dx, p.y - 1, p.z + dz)] === 1
    if (!held) return
    for (let dx = 0; dx < fx; dx++) for (let dz = 0; dz < fz; dz++) for (let q = p.y; q < p.y + heightInPlates(p); q++) if (inGrid(p.x + dx, q, p.z + dz)) grounded[at(p.x + dx, q, p.z + dz)] = 1
  }
  const place = (part: PartId, c: BrickColor, x: number, y: number, z: number, turns: QuarterTurns, fx: number, fz: number) => {
    for (let dx = 0; dx < fx; dx++) for (let dz = 0; dz < fz; dz++) for (let p = y; p < layerEnd(x + dx, y); p++) taken[at(x + dx, p, z + dz)] = 1
    const placed: ShipPart = { part, color: c, x, y, z, turns }
    parts.push(placed)
    ground(placed)
  }
  const colorAt = (x: number, p: number, z: number) => colorTable[color[at(x, p, z)] ?? 0] ?? "black"

  // Slopes where a brick course's outer edge steps in under the course above; inverted slopes where it juts out over the course below.
  const directions: ReadonlyArray<readonly [number, number, QuarterTurns]> = [[0, 1, 0], [0, -1, 2], [1, 0, 1], [-1, 0, 3]]
  type Finish = { readonly inverted: boolean; readonly x: number; readonly z: number; readonly d: number; readonly y: number }
  const finishes: Array<Finish> = []
  for (let x = 0; x < spec.bowFrom; x++) {
    for (let y0 = 0; y0 < height; y0 = layerEnd(x, y0)) {
      const y1 = layerEnd(x, y0)
      if (y1 - y0 !== 3) continue
      for (let z = -half; z < half; z++) {
        if (!free(x, y0, z, wall)) continue
        directions.forEach(([dx, dz], d) => {
          const bx = x - dx
          const bz = z - dz
          if (taken[at(x, y0, z)] === 1 || bx >= spec.bowFrom || !free(bx, y0, bz, wall) || isInside(x + dx, y0, z + dz) || colorAt(bx, y0, bz) !== colorAt(x, y0, z)) return
          const inverted = y0 > 0 && !filled(x, y0 - 1, z) && filled(bx, y0 - 1, bz)
          const slope = !filled(x, y1, z) && filled(bx, y1, bz)
          if (!inverted && !slope) return
          taken[at(x, y0, z)] = 1
          taken[at(bx, y0, bz)] = 1
          finishes.push({ inverted, x, z, d, y: y0 })
        })
      }
    }
  }
  const merged = new Set<Finish>()
  for (const f of finishes) {
    if (merged.has(f)) continue
    const [dx, dz, turns] = directions[f.d] ?? [0, 1, 0]
    const along = dz !== 0 ? [1, 0] : [0, 1]
    const twin = finishes.find((g) => !merged.has(g) && g !== f && g.d === f.d && g.y === f.y && g.inverted === f.inverted && g.x === f.x + (along[0] ?? 0) && g.z === f.z + (along[1] ?? 0) && colorAt(g.x, g.y, g.z) === colorAt(f.x, f.y, f.z))
    const wide = twin !== undefined
    if (twin !== undefined) merged.add(twin)
    merged.add(f)
    const minX = Math.min(f.x, f.x - dx)
    const minZ = Math.min(f.z, f.z - dz)
    const id: PartId = f.inverted ? (wide ? "3660" : "3665") : wide ? "3039" : "3040b"
    parts.push({ part: id, color: colorAt(f.x, f.y, f.z), x: minX, y: f.y, z: minZ, turns })
  }

  // Wedge plates cut the corner where a bow plate course's plan outline steps in by one stud.
  for (let p = 0; p < height; p++) {
    for (const sign of [1, -1] as const) {
      const edge = (x: number) => {
        let e = 0
        for (let k = 0; k < half; k++) if (filled(x, p, sign > 0 ? k : -1 - k)) e = k + 1
        return e
      }
      let runStart = spec.bowFrom
      for (let x = spec.bowFrom; x < lengthX; x++) {
        const e = edge(x)
        const next = x + 1 < lengthX ? edge(x + 1) : 0
        if (next === e) continue
        const run = x - runStart + 1
        runStart = x + 1
        const w = Math.min(run, 4)
        if (next !== e - 1 || e < 2 || w < 2) continue
        const rows = sign > 0 ? [e - 2, e - 1] : [-e, -e + 1]
        const xs = Array.from({ length: w }, (_, i) => x - w + 1 + i)
        const c = colorAt(x, p, sign > 0 ? e - 1 : -e)
        if (!xs.every((wx) => rows.every((wz) => free(wx, p, wz, wall) && colorAt(wx, p, wz) === c))) continue
        const [right, left] = wedges[w] ?? ["24307", "24299"]
        place(sign > 0 ? right : left, c, x - w + 1, p, rows[0] ?? 0, 1, w, 2)
      }
    }
  }

  // Running bond: courses split into parts whose joints avoid the joints of the course below.
  const seams = new Map<string, Set<number>>()
  const addSeams = (k: string, a: number, b: number) => {
    const set = seams.get(k) ?? new Set<number>()
    set.add(a)
    set.add(b)
    seams.set(k, set)
  }
  const split = (length: number, seamBelow: (i: number) => boolean, supported: (i: number) => boolean, salt: number, sizes: ReadonlyArray<number>) => {
    const support = new Int32Array(length + 1)
    for (let i = 0; i < length; i++) support[i + 1] = (support[i] ?? 0) + (supported(i) ? 1 : 0)
    const out: Array<number> = []
    for (let i = 0, k = salt; i < length; k++) {
      const left = length - i
      const want = bondPattern[k % bondPattern.length] ?? 4
      const order = [want, ...sizes.filter((s) => s !== want)].filter((s) => s <= left && sizes.includes(s))
      const has = (a: number, b: number) => (support[b] ?? 0) - (support[a] ?? 0) > 0
      // Every part needs a supported cell, and must not strand an unsupported tail.
      const holds = (s: number) => !has(i, length) || (has(i, i + s) && (i + s === length || has(i + s, length)))
      const pick = order.find((s) => holds(s) && (i + s === length || !seamBelow(i + s))) ?? order.find(holds) ?? order[0] ?? 1
      out.push(pick)
      i += pick
    }
    return out
  }

  const layers = new Map<number, Set<number>>()
  for (let x = 0; x < lengthX; x++) for (let y0 = 0; y0 < height; y0 = layerEnd(x, y0)) layers.set(y0 * 16 + (layerEnd(x, y0) - y0), (layers.get(y0 * 16 + (layerEnd(x, y0) - y0)) ?? new Set()).add(x))
  const layerKeys = [...layers.keys()].sort((a, b) => a - b)
  for (const layerKey of layerKeys) {
    const y0 = Math.floor(layerKey / 16)
    const h = layerKey % 16
    const columns = layers.get(layerKey) ?? new Set<number>()
    const inLayer = (x: number) => columns.has(x)
    const byLength = h === 3 ? bricks : plates
    const cell = (x: number, z: number, k: number) => inLayer(x) && free(x, y0, z, k)
    const same = (x: number, z: number, k: number, c: number) => cell(x, z, k) && color[at(x, y0, z)] === c
    const supportedAt = (x: number, z: number) => y0 === 0 || (inGrid(x, y0 - 1, z) && grounded[at(x, y0 - 1, z)] === 1)
    for (const p of parts) if (p.y === y0) ground(p)

    // Decks: planks run along the ship and beams across it, two studs wide where the rows pair up.
    for (const [k, alongX] of [[plank, true], [beam, false]] as const) {
      const [runMax, pairMax] = alongX ? [lengthX, half] : [half, lengthX]
      const pos = (i: number, j: number) => (alongX ? ([i, j] as const) : ([j, i] as const))
      for (let j = alongX ? -half : 0; j < pairMax; j += 2) {
        for (let i = alongX ? 0 : -half; i < runMax; ) {
          const [ax, az] = pos(i, j)
          const [bx, bz] = pos(i, j + 1)
          if (!cell(ax, az, k) || !cell(bx, bz, k)) {
            i++
            continue
          }
          let end = i
          while (end < runMax && cell(...pos(end, j), k) && cell(...pos(end, j + 1), k)) end++
          // Beams pair up on even x and plank rows on even z; joints on odd lines keep every deck part bridging two others.
          const sizes = split(end - i, (n) => (i + n) % 2 === 0, () => true, j * 7 + y0, [...wideLengths, 1])
          let s = i
          for (const n of sizes) {
            const [px, pz] = pos(s, j)
            const c = colorAt(px, y0, pz)
            if (n === 1) place("3023", c, px, y0, pz, alongX ? 1 : 0, alongX ? 1 : 2, alongX ? 2 : 1)
            else place(widePlates[n] ?? "3022", c, px, y0, pz, alongX ? 0 : 1, alongX ? n : 2, alongX ? 2 : n)
            s += n
          }
          i = end
        }
      }
    }

    // Everything left, one stud wide; floor cells alternate direction per course so the bottom cross-bonds.
    const axisX = (x: number, z: number) => {
      const k = kind[at(x, y0, z)] ?? empty
      if (k === plank || k === tile) return true
      if (k === beam) return false
      const c = color[at(x, y0, z)] ?? 0
      let xr = 1
      let xHeld = supportedAt(x, z)
      for (; same(x + xr, z, k, c); xr++) xHeld ||= supportedAt(x + xr, z)
      for (let d = 1; same(x - d, z, k, c); d++, xr++) xHeld ||= supportedAt(x - d, z)
      let zr = 1
      let zHeld = supportedAt(x, z)
      for (; same(x, z + zr, k, c); zr++) zHeld ||= supportedAt(x, z + zr)
      for (let d = 1; same(x, z - d, k, c); d++, zr++) zHeld ||= supportedAt(x, z - d)
      if (xHeld !== zHeld) return xHeld
      if (floor[at(x, y0, z)] === 1 && Math.min(xr, zr) >= 3) return y0 % 2 === 0
      return xr === zr ? y0 % 2 === 0 : xr > zr
    }
    const axis = new Map<number, boolean>()
    for (const x of columns) for (let z = -half; z < half; z++) if (inLayer(x) && !taken[at(x, y0, z)] && kind[at(x, y0, z)] !== empty) axis.set(x * 1024 + z, axisX(x, z))
    // An unsupported cell hangs off its run, so the cells between it and the nearest support must run the same way.
    for (const [cellKey, alongX] of [...axis]) {
      const x = Math.floor((cellKey + half) / 1024)
      const z = cellKey - x * 1024
      if (supportedAt(x, z)) continue
      const k = kind[at(x, y0, z)] ?? empty
      const c = color[at(x, y0, z)] ?? 0
      const [dx, dz] = alongX ? [1, 0] : [0, 1]
      for (const sign of [1, -1]) {
        let n = 1
        while (same(x + sign * n * dx, z + sign * n * dz, k, c) && !supportedAt(x + sign * n * dx, z + sign * n * dz)) n++
        if (!same(x + sign * n * dx, z + sign * n * dz, k, c)) continue
        for (let m = 1; m <= n; m++) axis.set((x + sign * m * dx) * 1024 + z + sign * m * dz, alongX)
        break
      }
    }
    for (const alongX of [true, false]) {
      const [runMin, runMax, rowMin, rowMax] = alongX ? [0, lengthX, -half, half] : [-half, half, 0, lengthX]
      for (let row = rowMin; row < rowMax; row++) {
        const xz = (i: number) => (alongX ? ([i, row] as const) : ([row, i] as const))
        const open = (i: number) => {
          const [x, z] = xz(i)
          return inLayer(x) && axis.get(x * 1024 + z) === alongX && taken[at(x, y0, z)] === 0
        }
        for (let i = runMin; i < runMax; ) {
          if (!open(i)) {
            i++
            continue
          }
          const [sx, sz] = xz(i)
          const c = color[at(sx, y0, sz)]
          const k = kind[at(sx, y0, sz)]
          const sameRun = (n: number) => {
            const [x, z] = xz(n)
            return open(n) && color[at(x, y0, z)] === c && kind[at(x, y0, z)] === k
          }
          let end = i + 1
          while (end < runMax && sameRun(end)) end++
          const seamKey = `${alongX ? "x" : "z"}:${y0}:${row}`
          const below = seams.get(seamKey)
          const table = k === tile ? tiles : byLength
          const onDeck = k === tile || k === plank || k === beam
          const sizes = split(end - i, (n) => (below?.has(i + n) ?? false) || (onDeck && (i + n) % 2 === 0), (n) => supportedAt(...xz(i + n)), row * 5 + y0 * 3, k === tile ? tileLengths : lengths)
          let s = i
          for (const n of sizes) {
            const [px, pz] = xz(s)
            place(table[n] ?? "3005", colorAt(px, y0, pz), px, y0, pz, alongX ? 0 : 1, alongX ? n : 1, alongX ? 1 : n)
            addSeams(`${alongX ? "x" : "z"}:${y0 + h}:${row}`, s, s + n)
            s += n
          }
          i = end
        }
      }
    }
  }

  const mottled = [...repairConnections(parts), ...fixtures].map((p): ShipPart => {
    // Plates and tiles stay plain: mottle on one-plate courses reads as noise at game distance.
    if (!Object.values(bricks).includes(p.part) && p.color !== spec.deckColor) return p
    const roll = hash(p.x, p.y, p.z, 7)
    if (p.color === spec.deckColor) return { ...p, color: pickMottle(p.color, spec.deckMottle, roll) }
    const strake = strakeOf(p.x, p.y, p.y + heightInPlates(p))
    return strake?.color === p.color ? { ...p, color: pickMottle(p.color, strake.mottle, roll) } : p
  })
  // Whatever the bond cannot attach would fall off a real model, so it is left out.
  const all = [...mottled, ...rig]
  const seen = reachable(all.length, connectParts(all), keelParts(all))
  const attached = all.filter((_, i) => seen[i] === 1)
  const rigFrom = attached.length - rig.filter((_, i) => seen[mottled.length + i] === 1).length
  // Paint is outside only: hull parts the outside cannot reach (ports sealed) are bare timber, as in ref-04's gun
  // deck, so a breach shows broken wood against the painted hull instead of black on black. Port frames keep their paint
  // through the wall, so a port's reveal reads as its frame (ref-04) rather than bare wood lit by the sun.
  const hullPaint = new Set(spec.strakes.flatMap((s) => [s.color, ...(s.mottle ?? []).map((m) => m.color)]))
  const air = new ShipAir(attached, openings)
  const finished = attached.map((p, i): ShipPart => (i < rigFrom && hullPaint.has(p.color) && air.partLevel(i) < 2 && !framed.has(at(p.x, p.y, p.z)) ? { ...p, color: pickMottle(spec.deckColor, spec.deckMottle, hash(p.x, p.y, p.z, 11)) } : p))
  const edges = connectParts(finished)
  return { parts: finished, edges, keel: keelParts(finished), ports, openings, pruned: all.length - attached.length, rigFrom }
}
