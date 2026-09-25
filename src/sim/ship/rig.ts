import type { BrickColor } from "./colors.ts"
import { gridMetres } from "./generate.ts"
import type { PartId } from "./parts.ts"
import type { ShipSpec } from "./spec.ts"
import type { QuarterTurns, ShipPart } from "./structure.ts"

/** One section of a mast, bottom up: round bricks, a yard crossing it, or a crow's nest around it. */
export type MastSection =
  | { readonly kind: "bricks"; readonly count: number }
  | { readonly kind: "yard"; readonly half: number }
  | { readonly kind: "nest" }

/** A mast as bricks: a 2 × 2 column of round bricks astride the centreline, stepped on a deck. */
export interface MastSpec {
  readonly name: string
  /** Stud x of the mast's aft face. */
  readonly x: number
  /** Plate height of the deck top it stands on. */
  readonly step: number
  readonly sections: ReadonlyArray<MastSection>
  /** Plate height the foot of its lowest sail reaches down to. */
  readonly courseFoot: number
  /** Where its lower shrouds are set up: plate height of the rail top and half-breadth in studs there. */
  readonly chains: { readonly y: number; readonly half: number }
}

/** Masts, yards and crow's nests as brick sub-assemblies, plus where the cosmetic spars stand. */
export interface RigSpec {
  readonly masts: ReadonlyArray<MastSpec>
  readonly colors: { readonly mast: BrickColor; readonly yard: BrickColor; readonly nest: BrickColor }
  /** The sail that carries the livery emblem: mast index and yard index, bottom up. */
  readonly emblem: { readonly mast: number; readonly yard: number }
  /** Bowsprit heel and tip on the centreline, [stud x, plate y]; a cosmetic spar that carries the jib. */
  readonly bowsprit: { readonly heel: readonly [number, number]; readonly tip: readonly [number, number] }
  /** Foot of the stern flagstaff, [stud x, plate y]. */
  readonly ensign: readonly [number, number]
}

/** The galleon's three masts: fore on the forecastle, main in the waist, mizzen on the quarterdeck, clear of every ornament cell. */
export const galleonRig: RigSpec = {
  masts: [
    {
      name: "fore",
      x: 60,
      step: 43,
      sections: [
        { kind: "bricks", count: 9 }, { kind: "yard", half: 13 }, { kind: "bricks", count: 1 }, { kind: "nest" },
        { kind: "bricks", count: 7 }, { kind: "yard", half: 10 }, { kind: "bricks", count: 7 }, { kind: "yard", half: 6 }, { kind: "bricks", count: 2 },
      ],
      courseFoot: 52,
      chains: { y: 47, half: 7.5 },
    },
    {
      name: "main",
      x: 34,
      step: 31,
      sections: [
        { kind: "bricks", count: 14 }, { kind: "yard", half: 14 }, { kind: "bricks", count: 1 }, { kind: "nest" },
        { kind: "bricks", count: 8 }, { kind: "yard", half: 11 }, { kind: "bricks", count: 8 }, { kind: "yard", half: 7 }, { kind: "bricks", count: 2 },
      ],
      courseFoot: 49,
      chains: { y: 43, half: 8.5 },
    },
    {
      name: "mizzen",
      x: 12,
      step: 43,
      sections: [{ kind: "bricks", count: 8 }, { kind: "yard", half: 11 }, { kind: "bricks", count: 7 }, { kind: "yard", half: 7 }, { kind: "bricks", count: 3 }],
      courseFoot: 58,
      chains: { y: 47, half: 8 },
    },
  ],
  colors: { mast: "reddishBrown", yard: "reddishBrown", nest: "black" },
  emblem: { mast: 1, yard: 0 },
  bowsprit: { heel: [64, 47], tip: [82, 62] },
  ensign: [1, 53],
}

const plateIds: Readonly<Record<number, PartId>> = { 1: "3024", 2: "3023", 3: "3623", 4: "3710", 6: "3666", 8: "3460" }
const tileIds: Readonly<Record<number, PartId>> = { 1: "3070b", 2: "3069b", 3: "63864", 4: "2431" }

/** Lengths that fill [start, end) greedily, largest first, never ending a piece on a seam in `avoid` except at `end`. */
const run = (start: number, end: number, sizes: ReadonlyArray<number>, avoid: ReadonlySet<number>): Array<number> => {
  const out: Array<number> = []
  for (let at = start; at < end; ) {
    const fits = sizes.filter((s) => at + s <= end)
    const size = fits.find((s) => at + s === end || !avoid.has(at + s)) ?? fits[fits.length - 1] ?? 1
    out.push(size)
    at += size
  }
  return out
}

/**
 * The parts of every mast on the ship grid: a cross-bonded 4 × 4 step on the deck (many stud edges into the
 * deck, so a mast falls only when its base is shot away), round bricks, yards and crow's nests threaded on it.
 */
export const rigParts = (rig: RigSpec): ReadonlyArray<ShipPart> => {
  const parts: Array<ShipPart> = []
  const add = (part: PartId, color: BrickColor, x: number, y: number, z: number, turns: QuarterTurns = 0) => parts.push({ part, color, x, y, z, turns })
  for (const mast of rig.masts) {
    const mx = mast.x
    const { mast: wood, yard: spar, nest } = rig.colors
    add("3020", wood, mx - 1, mast.step, -2)
    add("3020", wood, mx - 1, mast.step, 0)
    add("3020", wood, mx - 1, mast.step + 1, -2, 1)
    add("3020", wood, mx + 1, mast.step + 1, -2, 1)
    let y = mast.step + 2
    for (const section of mast.sections) {
      if (section.kind === "bricks") {
        for (let i = 0; i < section.count; i++, y += 3) add("3941", wood, mx, y, -1)
      } else if (section.kind === "yard") {
        // Two plate courses on the mast's forward stud row, seams staggered; the lower one spans the mast with one 1 × 8.
        const half = section.half
        const upper = [3, ...run(3, half, [4, 3, 2, 1], new Set([4]))]
        const upperSeams = new Set(upper.reduce<Array<number>>((seams, s) => [...seams, (seams[seams.length - 1] ?? 0) + s], [0]))
        const lower = run(4, half, [8, 6, 4, 3, 2, 1], upperSeams)
        add("3460", spar, mx + 1, y, -4, 1)
        for (const side of [1, -1]) {
          let at = 4
          for (const s of lower) {
            add(plateIds[s] ?? "3024", spar, mx + 1, y, side > 0 ? at : -at - s, 1)
            at += s
          }
          at = 0
          upper.forEach((s, i) => {
            // The pieces the mast above stands on keep their studs; the rest of the yard is tiled.
            add((i === 0 ? plateIds : tileIds)[s] ?? "3024", spar, mx + 1, y + 1, side > 0 ? at : -at - s, 1)
            at += s
          })
        }
        add("3023", spar, mx, y, -1, 1)
        add("3023", spar, mx, y + 1, -1, 1)
        y += 2
      } else {
        for (const z of [-3, -1, 1]) add("3795", wood, mx - 2, y, z)
        for (const x of [mx - 2, mx, mx + 2]) add("3795", wood, x, y + 1, -3, 1)
        add("3009", nest, mx - 2, y + 2, -3)
        add("3009", nest, mx - 2, y + 2, 2)
        add("3010", nest, mx - 2, y + 2, -2, 1)
        add("3010", nest, mx + 3, y + 2, -2, 1)
        y += 2
      }
    }
  }
  return parts
}

/** A yard in ship-local metres: bottom and top heights, half span, the x of its forward face, and a grid cell of the part it hangs from. */
export interface RigYard {
  readonly bottom: number
  readonly top: number
  readonly half: number
  readonly front: number
  readonly cell: readonly [number, number, number]
}

/** A mast in ship-local metres: centre x, deck and truck heights, yards bottom up, and its crow's nest floor and rim when it has one. */
export interface RigMast {
  readonly x: number
  readonly foot: number
  readonly top: number
  readonly yards: ReadonlyArray<RigYard>
  readonly nest?: { readonly floor: number; readonly rim: number; readonly half: number }
  readonly chains: { readonly y: number; readonly half: number }
}

/** A square sail in ship-local metres, hung on the forward face of a yard; `cell` is a grid cell of that yard, so it can fall with it. */
export interface RigSail {
  readonly mast: number
  readonly yard: number
  readonly x: number
  readonly top: number
  readonly foot: number
  readonly topHalf: number
  readonly footHalf: number
  readonly emblem: boolean
  readonly cell: readonly [number, number, number]
}

/** Everything the cosmetic rig is built on, in ship-local metres (bow +x, starboard +z, waterline y = 0). */
export interface RigLayout {
  readonly masts: ReadonlyArray<RigMast>
  readonly sails: ReadonlyArray<RigSail>
  readonly bowsprit: { readonly heel: readonly [number, number]; readonly tip: readonly [number, number] }
  readonly ensign: readonly [number, number]
}

/** The rig of `spec` in ship-local metres, derived from the same sections the bricks are placed from. */
export const rigLayout = (spec: ShipSpec): RigLayout => {
  const toX = (studX: number) => (studX - spec.midship) * gridMetres.stud
  const toY = (plateY: number) => (plateY - spec.waterline) * gridMetres.plate
  const masts: Array<RigMast> = []
  const sails: Array<RigSail> = []
  spec.rig.masts.forEach((mast, m) => {
    const yards: Array<RigYard> = []
    let nest: RigMast["nest"]
    let y = mast.step + 2
    // Top of the last yard or crow's nest below the running height: where the next sail's foot is sheeted.
    let footAt = mast.courseFoot
    let footHalf: number | undefined
    for (const section of mast.sections) {
      if (section.kind === "bricks") {
        y += section.count * 3
        continue
      }
      if (section.kind === "yard") {
        const yard: RigYard = { bottom: toY(y), top: toY(y + 2), half: section.half * gridMetres.stud, front: toX(mast.x + 2), cell: [mast.x + 1, y, 0] }
        const index = yards.push(yard) - 1
        sails.push({
          mast: m,
          yard: index,
          x: yard.front,
          top: yard.bottom,
          foot: toY(footAt),
          topHalf: yard.half - 0.2,
          footHalf: footHalf ?? yard.half,
          emblem: spec.rig.emblem.mast === m && spec.rig.emblem.yard === index,
          cell: yard.cell,
        })
        footAt = y + 2
        footHalf = yard.half
        y += 2
      } else {
        nest = { floor: toY(y), rim: toY(y + 5), half: 3 * gridMetres.stud }
        footAt = y + 5
        y += 2
      }
    }
    masts.push({ x: toX(mast.x + 1), foot: toY(mast.step), top: toY(y), yards, ...(nest === undefined ? {} : { nest }), chains: { y: toY(mast.chains.y), half: mast.chains.half * gridMetres.stud } })
  })
  const point = ([x, y]: readonly [number, number]) => [toX(x), toY(y)] as const
  return { masts, sails, bowsprit: { heel: point(spec.rig.bowsprit.heel), tip: point(spec.rig.bowsprit.tip) }, ensign: point(spec.rig.ensign) }
}
