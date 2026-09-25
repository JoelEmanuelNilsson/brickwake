import { galleonGunSpec, type GunLayoutSpec } from "../gun-layout.ts"
import { type Assembly, balustrade, cannon, figurehead, galleryRail, helm, lanternPost, railPost, skullPlaque, tallLanternPost } from "./assemblies.ts"
import type { BrickColor } from "./colors.ts"
import type { QuarterTurns } from "./structure.ts"

/** A piecewise-linear curve as [input, output] points with increasing inputs; clamped at both ends. */
export type Curve = ReadonlyArray<readonly [number, number]>

/** One colour band of the hull side, bottom up; `share`d mottle colours replace some of its parts. */
export interface Strake {
  /** Band ends below this sheer-relative plate height. */
  readonly below: number
  readonly color: BrickColor
  readonly mottle?: ReadonlyArray<{ readonly color: BrickColor; readonly share: number }>
}

/** A raised part of the hull with its own walls: stern castle or forecastle. */
export interface Castle {
  /** Stud x range from the stern, [from, to). */
  readonly from: number
  readonly to: number
  /** Plate height its walls end below. */
  readonly top: number
}

/** A deck: a plate course of beams across the ship under a plate course of planks along it. */
export interface Deck {
  readonly beams: number
  readonly planks: number
  /** Studded plates, or tiles; tile decks turn to plates under anything built on them. */
  readonly surface: "plates" | "tiles"
  /** Stud x range from the stern, [from, to). */
  readonly from: number
  readonly to: number
}

/** A panel on the transom's outer face, [from, to) in z studs and y plates: a window glazed a stud deep, or a colour. Mirrored across the centreline. */
export interface SternPanel {
  readonly z: readonly [number, number]
  readonly y: readonly [number, number]
  readonly fill: "window" | BrickColor
}

/** An assembly placed by anchor cell; `y: "top"` stands it on the highest cell of the anchor column. `mirror` adds the port-side twin. */
export interface Ornament {
  readonly assembly: Assembly
  readonly x: number
  readonly y: number | "top"
  readonly z: number
  readonly turns?: QuarterTurns
  readonly mirror?: boolean
}

/**
 * One ship class as data. Grid units: x in studs from the stern (bow +x), z in studs from the
 * centreline (starboard +z), heights in plates from the keel bottom. Heights along the hull are
 * sampled at course centres, so every curve is read at brick-grid resolution.
 */
export interface ShipSpec {
  /** Stud x of the ship-local origin. */
  readonly midship: number
  /** Plate height of the design waterline (ship-local y = 0). */
  readonly waterline: number
  /** Hull wall thickness in studs. */
  readonly shell: number
  /** Course heights of the body from the keel up; bow columns (x ≥ `bowFrom`) are all plates. */
  readonly courses: ReadonlyArray<"brick" | "plate">
  /** Stud x where plate-by-plate bow courses start, so wedge plates can smooth the plan curve. */
  readonly bowFrom: number
  /** Half-breadth in studs by stud x, at full section and the waterline. */
  readonly plan: Curve
  /** Half-breadth factor by plate height: narrow keel, full sides, tumblehome at the rail. */
  readonly section: Curve
  /** Keel bottom plate height by stud x (rises into the forefoot). */
  readonly keel: Curve
  /** Studs the bow profile moves forward per plate above the waterline (stem rake). */
  readonly stemRake: number
  /** Stud x of the flat transom at the waterline, and studs it moves aft per plate above it (the stern's overhang). */
  readonly transom: { readonly x: number; readonly rake: number }
  /** Plates the strakes and rail rise by stud x. */
  readonly sheer: Curve
  /** Plate height the waist bulwark ends below, before sheer. */
  readonly rail: number
  /** Plate height, before sheer, where the upper works start: parts from here up (bulwark rail, castles, rig) are cheap to hit. */
  readonly upperWorks: number
  readonly castles: ReadonlyArray<Castle>
  readonly decks: ReadonlyArray<Deck>
  readonly deckColor: BrickColor
  readonly deckMottle: ReadonlyArray<{ readonly color: BrickColor; readonly share: number }>
  /** Hull side colours by sheer-relative plate height, bottom up; the last band runs to the top. */
  readonly strakes: ReadonlyArray<Strake>
  /** The gun layout the gunports are carved for, in ship-local metres. */
  readonly guns: GunLayoutSpec
  /** Gunport opening size: width in studs, height in plates. */
  readonly port: { readonly width: number; readonly height: number }
  /** Colours of the frame around each gunport, a stud proud of the hull: side jambs, sill below, lintel above. */
  readonly portFrame: { readonly jamb: BrickColor; readonly sill: BrickColor; readonly lintel: BrickColor }
  /** The assembly at every gunport, anchored at the port's inboard-aft bottom corner, muzzle out. */
  readonly gun: Assembly
  readonly stern: ReadonlyArray<SternPanel>
  /** Stern gallery: a ledge a stud proud of the transom along the course at plate height `y`. */
  readonly gallery: { readonly y: number; readonly color: BrickColor }
  readonly ornaments: ReadonlyArray<Ornament>
  /** Accepted part count, [min, max]. */
  readonly partRange: readonly [number, number]
}

const black = [{ color: "darkRed", share: 0.07 }] as const
const red = [{ color: "black", share: 0.08 }] as const

/** The pirate galleon: ~28 m, two gun decks, stern castle and forecastle, strakes of ref-01. */
export const galleonSpec: ShipSpec = {
  midship: 35,
  waterline: 13,
  shell: 2,
  courses: [
    "brick", "brick", "brick", "brick", "plate", // 0–13 bottom, to the waterline
    "brick", "plate", "plate", // 13–18 wale, gold line, lower gun deck
    "brick", "brick", "plate", // 18–25 lower gunports, gold line
    "brick", "plate", "plate", "plate", // 25–31 red band, gold line, upper gun deck
    "brick", "brick", "plate", // 31–38 upper gunports, gold line
    "brick", "plate", "plate", // 38–43 red rail, gold cap, quarterdeck and forecastle
    "brick", "plate", "plate", "plate", // 43–49 castle walls, gold cap, poop deck
    "brick", "plate", // 49–53 poop walls, gold cap
  ],
  bowFrom: 51,
  plan: [[0, 8.6], [3, 9.3], [6, 9.8], [8.5, 10], [50, 10], [53.5, 9.8], [56.9, 9.17], [59.5, 8.35], [62.1, 7.14], [63.8, 6], [65.6, 4.36], [66.4, 3.12], [66.8, 2.4], [67.3, 0]],
  section: [[1.5, 0.65], [4.5, 0.75], [7.5, 0.85], [10.5, 0.95], [12.5, 1], [24.5, 1], [25.5, 0.9], [37.5, 0.9], [38.5, 0.8], [60, 0.8]],
  keel: [[0, 1], [5, 0], [46, 0], [52, 1], [57, 3], [61, 5.5], [63.5, 9], [65, 13]],
  stemRake: 0.12,
  transom: { x: 4, rake: 0.1 },
  sheer: [[0, 0], [50, 0], [58, 1], [63, 2], [68, 4]],
  rail: 42,
  upperWorks: 38,
  castles: [
    { from: 0, to: 22, top: 47 },
    { from: 0, to: 11, top: 53 },
    { from: 57, to: 99, top: 47 },
  ],
  decks: [
    { beams: 16, planks: 17, surface: "tiles", from: 0, to: 99 },
    { beams: 29, planks: 30, surface: "tiles", from: 0, to: 99 },
    { beams: 41, planks: 42, surface: "tiles", from: 0, to: 22 },
    { beams: 47, planks: 48, surface: "tiles", from: 0, to: 11 },
    { beams: 41, planks: 42, surface: "tiles", from: 57, to: 99 },
  ],
  deckColor: "reddishBrown",
  deckMottle: [{ color: "darkTan", share: 0.12 }],
  strakes: [
    { below: 13, color: "black", mottle: black },
    { below: 16, color: "darkRed", mottle: red },
    { below: 24, color: "black", mottle: black },
    { below: 25, color: "pearlGold" },
    { below: 28, color: "darkRed", mottle: red },
    { below: 37, color: "black", mottle: black },
    { below: 38, color: "pearlGold" },
    { below: 41, color: "darkRed", mottle: red },
    { below: 42, color: "pearlGold" },
    { below: 46, color: "black", mottle: black },
    { below: 47, color: "pearlGold" },
    { below: 52, color: "darkRed", mottle: red },
    { below: 99, color: "pearlGold" },
  ],
  guns: galleonGunSpec,
  port: { width: 2, height: 6 },
  portFrame: { jamb: "darkRed", sill: "darkRed", lintel: "pearlGold" },
  gun: cannon,
  stern: [
    { z: [1, 3], y: [31, 37], fill: "window" },
    { z: [4, 6], y: [31, 37], fill: "window" },
    { z: [3, 4], y: [31, 37], fill: "pearlGold" },
    { z: [6, 8], y: [28, 37], fill: "pearlGold" },
    { z: [1, 3], y: [43, 46], fill: "window" },
    { z: [4, 6], y: [43, 46], fill: "window" },
    { z: [0, 1], y: [43, 46], fill: "pearlGold" },
    { z: [3, 4], y: [43, 46], fill: "pearlGold" },
    { z: [6, 8], y: [38, 47], fill: "pearlGold" },
    { z: [5, 8], y: [47, 52], fill: "pearlGold" },
  ],
  gallery: { y: 41, color: "pearlGold" },
  ornaments: [
    // Poop: stern crest between gold posts, balustrades, lanterns on the four corners.
    { assembly: skullPlaque, x: 0, y: "top", z: -1, turns: 3 },
    { assembly: skullPlaque, x: 2, y: 31, z: -1, turns: 3 },
    { assembly: railPost, x: 0, y: "top", z: 1, mirror: true },
    { assembly: balustrade, x: 0, y: "top", z: 2, turns: 1, mirror: true },
    { assembly: tallLanternPost, x: 0, y: "top", z: 6, mirror: true },
    { assembly: balustrade, x: 1, y: "top", z: 6, mirror: true },
    { assembly: balustrade, x: 5, y: "top", z: 6, mirror: true },
    { assembly: railPost, x: 9, y: "top", z: 6, mirror: true },
    { assembly: tallLanternPost, x: 10, y: "top", z: 6, mirror: true },
    // Stern gallery on the ledge: a low rail so the upper windows show, lanterns at its ends.
    { assembly: lanternPost, x: 0, y: 42, z: 6, mirror: true },
    { assembly: galleryRail, x: 0, y: 42, z: 2, turns: 1, mirror: true },
    // Quarterdeck: helm, side and front balustrades, lanterns at the break.
    { assembly: helm, x: 16, y: "top", z: -1 },
    { assembly: balustrade, x: 11, y: "top", z: 6, mirror: true },
    { assembly: balustrade, x: 15, y: "top", z: 6, mirror: true },
    { assembly: railPost, x: 19, y: "top", z: 6, mirror: true },
    { assembly: tallLanternPost, x: 21, y: "top", z: 7, mirror: true },
    { assembly: balustrade, x: 21, y: "top", z: 2, turns: 1, mirror: true },
    { assembly: railPost, x: 21, y: "top", z: 0, mirror: true },
    // Waist rail: posts between the upper gunports, lanterns on two of them.
    { assembly: lanternPost, x: 27, y: "top", z: 7, mirror: true },
    { assembly: railPost, x: 34, y: "top", z: 7, mirror: true },
    { assembly: lanternPost, x: 41, y: "top", z: 7, mirror: true },
    { assembly: railPost, x: 48, y: "top", z: 7, mirror: true },
    // Forecastle: aft balustrade and corner lanterns, side balustrades, bow crest.
    { assembly: tallLanternPost, x: 57, y: "top", z: 6, mirror: true },
    { assembly: balustrade, x: 57, y: "top", z: 2, turns: 1, mirror: true },
    { assembly: railPost, x: 57, y: "top", z: 0, mirror: true },
    { assembly: balustrade, x: 58, y: "top", z: 6, mirror: true },
    { assembly: figurehead, x: 69, y: "top", z: -2, turns: 1 },
  ],
  partRange: [2500, 6000],
}
