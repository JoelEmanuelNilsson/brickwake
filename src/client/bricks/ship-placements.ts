import type { GeneratedShip } from "../../sim/ship/generate.ts"
import type { ShipSpec } from "../../sim/ship/spec.ts"
import { exposure, footprint } from "../../sim/ship/structure.ts"
import type { BrickPlacement } from "./brick-ship-mesh.ts"
import { gridMatrix } from "./parts.ts"

/** Render placements of a generated ship in ship-local metres, and which ship part each one draws. */
export interface ShipPlacements {
  readonly placements: ReadonlyArray<BrickPlacement>
  /** Ship part index of each placement. */
  readonly partIndex: ReadonlyArray<number>
}

/** Placements for the parts outside air can reach; enclosed parts and covered studs are left out. */
export const shipPlacements = (spec: ShipSpec, ship: GeneratedShip): ShipPlacements => {
  const seen = exposure(ship.parts)
  const placements: Array<BrickPlacement> = []
  const partIndex: Array<number> = []
  ship.parts.forEach((p, i) => {
    if (seen.parts[i] !== 1) return
    const [fx, fz] = footprint(p)
    placements.push({ part: p.part, color: p.color, matrix: gridMatrix(p.x + fx / 2 - spec.midship, p.y - spec.waterline, p.z + fz / 2, p.turns), hiddenStuds: seen.hiddenStuds[i] ?? [] })
    partIndex.push(i)
  })
  return { placements, partIndex }
}
