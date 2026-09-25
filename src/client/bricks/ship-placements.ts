import { Matrix4 } from "three"
import type { GeneratedShip } from "../../sim/ship/generate.ts"
import type { ShipSpec } from "../../sim/ship/spec.ts"
import { ShipAir } from "../../sim/ship/air.ts"
import { footprint, occupiedCells } from "../../sim/ship/structure.ts"
import type { BrickPlacement, BrickPlug } from "./brick-ship-mesh.ts"
import { gridMatrix } from "./parts.ts"

/** Render placements of a generated ship in ship-local metres, one per ship part and indexed alike, the far-detail plugs for its gunports, and the air that decides what shows. */
export interface ShipPlacements {
  readonly placements: ReadonlyArray<BrickPlacement>
  readonly plugs: ReadonlyArray<BrickPlug>
  /** Air with the gunports sealed: level 2 is outside, level 1 reached only through a port. */
  readonly air: ShipAir
}

/**
 * Placements for every part; enclosed parts start `hidden` (a hole can reveal them) and covered studs are left
 * out. Parts that air reaches only through gunports are marked `interior`, and each gunport gets a plug one
 * stud inside the hull face, owned by the part over the port so it falls with it.
 */
export const shipPlacements = (spec: ShipSpec, ship: GeneratedShip): ShipPlacements => {
  const air = new ShipAir(ship.parts, ship.openings)
  const placements = ship.parts.map((p, i): BrickPlacement => {
    const [fx, fz] = footprint(p)
    const level = air.partLevel(i)
    return {
      part: p.part,
      color: p.color,
      matrix: gridMatrix(p.x + fx / 2 - spec.midship, p.y - spec.waterline, p.z + fz / 2, p.turns),
      hiddenStuds: air.hiddenStuds(i),
      interior: level === 1,
      hidden: level === 0,
    }
  })

  const owner = new Map<string, number>()
  ship.parts.forEach((p, i) => {
    for (const cell of occupiedCells(p)) owner.set(cell.join(","), i)
  })
  const plugs = ship.ports.flatMap((port): Array<BrickPlug> => {
    const zs = ship.openings.filter(([x, y, z]) => x === port.x[0] && y === port.y[0] && (z < 0) === (port.side === "port")).map(([, , z]) => z)
    if (zs.length === 0) return []
    const inner = port.side === "port" ? Math.max(...zs) : Math.min(...zs)
    const outer = port.side === "port" ? Math.min(...zs) : Math.max(...zs)
    const index = owner.get(`${port.x[0]},${port.y[1]},${outer}`)
    if (index === undefined) return []
    const width = port.x[1] - port.x[0]
    const height = port.y[1] - port.y[0]
    const matrix = gridMatrix((port.x[0] + port.x[1]) / 2 - spec.midship, port.y[0] - spec.waterline, inner + 0.5).multiply(new Matrix4().makeScale(width, height * 8, 1))
    return [{ owner: index, matrix }]
  })
  return { placements, plugs, air }
}
