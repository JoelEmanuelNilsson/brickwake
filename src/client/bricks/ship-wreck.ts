import type { ShipAir } from "../../sim/ship/air.ts"
import type { BrickShipMesh } from "./brick-ship-mesh.ts"

/** Where one ship part is drawn: the mesh holding it and its index there. */
export interface DrawnPart {
  readonly mesh: BrickShipMesh
  readonly index: number
}

/** Locator for a mesh built from every ship part, in part order. */
export const wholeShip =
  (mesh: BrickShipMesh) =>
  (part: number): DrawnPart => ({ mesh, index: part })

/**
 * Take parts that were knocked out or fell off out of a ship's meshes and show what the hole opens onto: parts the
 * outside air now reaches are revealed at every detail level, and studs the removed parts covered are bared.
 * Studs that only face newly aired enclosed space (the hold floor) stay hidden: seen through a hole they cost
 * ~50k triangles and add nothing. `locate` maps a ship part to where it is drawn. Returns how many parts were revealed.
 */
export const removeAndReveal = (locate: (part: number) => DrawnPart | undefined, air: ShipAir, gone: ReadonlyArray<number>): number => {
  for (const i of gone) {
    const drawn = locate(i)
    drawn?.mesh.remove(drawn.index)
  }
  let revealed = 0
  for (const i of air.open(gone)) {
    const drawn = locate(i)
    if (drawn === undefined || !drawn.mesh.isPresent(drawn.index)) continue
    const level = air.partLevel(i)
    if (level === 0) continue
    if (!drawn.mesh.isShown(drawn.index)) revealed++
    drawn.mesh.reveal(drawn.index, level === 1)
    for (const s of air.uncoveredStuds(i)) drawn.mesh.setStudVisible(drawn.index, s, true)
  }
  return revealed
}
