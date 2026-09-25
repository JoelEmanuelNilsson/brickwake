import type { BrickColor } from "./colors.ts"
import type { PartId } from "./parts.ts"
import type { QuarterTurns, ShipPart } from "./structure.ts"

/** A sub-assembly written once: parts relative to its anchor cell, facing +z at zero turns. */
export interface Assembly {
  readonly name: string
  readonly parts: ReadonlyArray<ShipPart>
}

const part = (id: PartId, color: BrickColor, x: number, y: number, z: number, turns: QuarterTurns = 0): ShipPart => ({ part: id, color, x, y, z, turns })

/** One cannon on its carriage, muzzle toward +z; placed at every gunport. */
export const cannon: Assembly = { name: "cannon", parts: [part("2527c01", "black", 0, 0, 0)] }

/** A black round-brick post with a gold collar and a lantern on top. */
export const lanternPost: Assembly = {
  name: "lantern post",
  parts: [part("3062b", "black", 0, 0, 0), part("6141", "pearlGold", 0, 3, 0), part("37776", "black", 0, 4, 0)],
}

/** A taller lantern post for castle corners. */
export const tallLanternPost: Assembly = {
  name: "tall lantern post",
  parts: [part("3062b", "pearlGold", 0, 0, 0), part("3062b", "black", 0, 3, 0), part("6141", "pearlGold", 0, 6, 0), part("37776", "black", 0, 7, 0)],
}

/** A gold rail post: round brick under a round plate. */
export const railPost: Assembly = { name: "rail post", parts: [part("3062b", "pearlGold", 0, 0, 0), part("6141", "pearlGold", 0, 3, 0)] }

/** A gallery rail along +x: a gold plate bridging four ledge studs, a gold post on its third stud (between two stern windows). */
export const galleryRail: Assembly = {
  name: "gallery rail",
  parts: [part("3710", "pearlGold", 0, 0, 0), part("3062b", "pearlGold", 2, 1, 0), part("6141", "pearlGold", 2, 4, 0)],
}

/** Four studs of balustrade running along +x. */
export const balustrade: Assembly = { name: "balustrade", parts: [part("3633", "black", 0, 0, 0)] }

/** A gold skull-and-crossbones plaque, face toward +z. */
export const skullPlaque: Assembly = { name: "skull plaque", parts: [part("3068bp9b", "pearlGold", 0, 0, 0)] }

/** The ship's wheel on its post, turning across the ship. */
export const helm: Assembly = { name: "helm", parts: [part("4790", "reddishBrown", 0, 0, 0, 1)] }

/** Two barrels side by side along x. */
export const barrels: Assembly = { name: "barrels", parts: [part("2489", "reddishBrown", 0, 0, 0), part("2489", "reddishBrown", 2, 0, 0)] }

/** The figurehead on the stem head: a skull plaque between gold posts, facing +z. */
export const figurehead: Assembly = {
  name: "figurehead",
  parts: [part("3062b", "pearlGold", 0, 0, 0), part("6141", "pearlGold", 0, 3, 0), part("3068bp9b", "pearlGold", 1, 0, 0), part("3062b", "pearlGold", 3, 0, 0), part("6141", "pearlGold", 3, 3, 0)],
}
