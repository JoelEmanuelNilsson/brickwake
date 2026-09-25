import type { ShipAir } from "../../sim/ship/air.ts"
import type { BrickShipMesh } from "./brick-ship-mesh.ts"

/**
 * Take parts that were knocked out or fell off out of a ship's mesh and show what the hole opens onto: parts the
 * outside air now reaches are revealed at every detail level, and studs the removed parts covered are bared.
 * Studs that only face newly aired enclosed space (the hold floor) stay hidden: seen through a hole they cost
 * ~50k triangles and add nothing. Returns how many parts were revealed.
 */
export const removeAndReveal = (mesh: BrickShipMesh, air: ShipAir, gone: ReadonlyArray<number>): number => {
  for (const i of gone) mesh.remove(i)
  let revealed = 0
  for (const i of air.open(gone)) {
    const placement = mesh.parts[i]
    if (placement === undefined || !mesh.isPresent(i)) continue
    const level = air.partLevel(i)
    if (level === 0) continue
    if (!mesh.isShown(i)) revealed++
    mesh.reveal(i, level === 1)
    for (const s of air.uncoveredStuds(i)) mesh.setStudVisible(i, s, true)
  }
  return revealed
}
