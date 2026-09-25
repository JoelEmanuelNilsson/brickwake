import { expect, test } from "bun:test"
import { generateShip } from "../../sim/ship/generate.ts"
import { rigLayout } from "../../sim/ship/rig.ts"
import { galleonSpec } from "../../sim/ship/spec.ts"
import { buildRigGeometry } from "../rig/ship-rig.ts"
import { BrickShipMesh, createBrickLibrary } from "./brick-ship-mesh.ts"
import { shipPlacements } from "./ship-placements.ts"

const ship = generateShip(galleonSpec)
const { placements, plugs } = shipPlacements(galleonSpec, ship)
const mesh = new BrickShipMesh(createBrickLibrary(), placements, plugs)

test("the full galleon with masts, sails and rigging fits the per-ship budget at near detail", () => {
  const near = mesh.stats("near")
  expect(placements.length).toBe(ship.parts.length)
  expect(near.parts).toBe(placements.filter((p) => p.hidden !== true).length)
  expect(near.parts).toBeLessThan(ship.parts.length)
  const rig = buildRigGeometry(rigLayout(galleonSpec))
  const rigTriangles = [rig.sails, rig.flags, rig.lines].reduce((n, g) => n + (g.getIndex()?.count ?? 0) / 3, 0)
  expect(near.triangles + rigTriangles).toBeLessThanOrEqual(300_000)
  expect(near.draws + 3).toBeLessThanOrEqual(45)
})

test("mid and far detail cost a quarter of near or less, and far drops the gun deck interior for port plugs", () => {
  const near = mesh.stats("near")
  const mid = mesh.stats("mid")
  const far = mesh.stats("far")
  expect(mid.triangles).toBeLessThanOrEqual(near.triangles / 3.5)
  expect(far.triangles).toBeLessThan(mid.triangles)
  expect(mid.draws).toBeLessThanOrEqual(14)
  expect(far.studs).toBe(0)
  expect(far.parts).toBe(placements.filter((p) => p.interior !== true && p.hidden !== true).length)
  expect(placements.filter((p) => p.interior === true).length).toBeGreaterThan(300)
  expect(plugs).toHaveLength(ship.ports.length)
})

test("interior parts are the ones outside air reaches only through gunports: the stern windows and cannons stay outside", () => {
  const exterior = (part: string) => placements.filter((p) => p.part === part).every((p) => p.interior !== true)
  expect(exterior("2527c01")).toBe(true)
  expect(placements.filter((p) => p.color === "transOrange").length).toBeGreaterThan(0)
  expect(placements.filter((p) => p.color === "transOrange").every((p) => p.interior !== true)).toBe(true)
})
