import { expect, test } from "bun:test"
import { generateShip } from "../../sim/ship/generate.ts"
import { galleonSpec } from "../../sim/ship/spec.ts"
import { BrickShipMesh, createBrickLibrary } from "./brick-ship-mesh.ts"
import { shipPlacements } from "./ship-placements.ts"

test("the galleon hull renders within the per-ship budget: ≤ 300k triangles, ≤ 45 draws", () => {
  const ship = generateShip(galleonSpec)
  const { placements, partIndex } = shipPlacements(galleonSpec, ship)
  const stats = new BrickShipMesh(createBrickLibrary(), placements).stats()
  expect(placements.length).toBeLessThan(ship.parts.length)
  expect(new Set(partIndex).size).toBe(placements.length)
  expect(stats.triangles).toBeLessThanOrEqual(300_000)
  expect(stats.draws).toBeLessThanOrEqual(45)
})
