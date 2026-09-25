import { expect, test } from "bun:test"
import { buildDamageGraph, ShipDamage } from "../../sim/ship/damage.ts"
import { generateShip } from "../../sim/ship/generate.ts"
import { galleonSpec } from "../../sim/ship/spec.ts"
import { BrickShipMesh, createBrickLibrary } from "./brick-ship-mesh.ts"
import { shipPlacements } from "./ship-placements.ts"
import { removeAndReveal } from "./ship-wreck.ts"

const library = createBrickLibrary()
const ship = generateShip(galleonSpec)
const graph = buildDamageGraph(galleonSpec, ship)

test("a breach below the gun deck reveals the hold behind it at every detail level", () => {
  const { placements, plugs, air } = shipPlacements(galleonSpec, ship)
  const mesh = new BrickShipMesh(library, placements, plugs)
  const damage = new ShipDamage(graph)
  const before = { near: mesh.stats("near").parts, far: mesh.stats("far").parts }
  const direction = { x: 0, y: 0, z: 1 }
  const distance = damage.firstPartAlong({ x: 0, y: 0.2, z: -30 }, direction, 60) ?? 0
  const hit = damage.hit({ x: 0, y: 0.2, z: -30 + distance }, direction)
  const gone = [...hit.removed, ...hit.detached]
  const revealed = removeAndReveal(mesh, air, gone)
  expect(revealed).toBeGreaterThan(50)
  const shown = placements.flatMap((p, i) => (p.hidden === true && mesh.isShown(i) ? [i] : []))
  expect(shown).toHaveLength(revealed)
  expect(mesh.stats("near").parts).toBe(before.near - gone.filter((i) => placements[i]?.hidden !== true).length + revealed)
  // Air reaching the hold through the breach is outside air, so far detail draws what it reveals too.
  expect(mesh.stats("far").parts).toBeGreaterThan(before.far + revealed / 2)
})

test("the graph builds in a few ms, and a hit with its mesh update and reveals costs well under a millisecond", () => {
  const buildStart = performance.now()
  const built = buildDamageGraph(galleonSpec, ship)
  const buildMs = performance.now() - buildStart
  const { placements, plugs, air } = shipPlacements(galleonSpec, ship)
  const mesh = new BrickShipMesh(library, placements, plugs)
  const damage = new ShipDamage(built)
  const direction = { x: 0, y: 0, z: 1 }
  const start = performance.now()
  let hits = 0
  for (let x = -11; x <= 11; x += 1.1)
    for (const y of [0.4, 2.2, 3.6]) {
      const distance = damage.firstPartAlong({ x, y, z: -30 }, direction, 60)
      if (distance === undefined) continue
      const hit = damage.hit({ x, y, z: -30 + distance }, direction)
      removeAndReveal(mesh, air, [...hit.removed, ...hit.detached])
      hits++
    }
  expect(buildMs).toBeLessThan(20)
  expect(hits).toBeGreaterThan(50)
  expect((performance.now() - start) / hits).toBeLessThan(1)
})

test("pools are sized for every part: revealing all hidden parts draws them all without a rebuild", () => {
  const { placements, plugs } = shipPlacements(galleonSpec, ship)
  const mesh = new BrickShipMesh(library, placements, plugs)
  const meshes = mesh.root.children.flatMap((layer) => layer.children)
  placements.forEach((p, i) => {
    if (p.hidden === true) mesh.reveal(i, false)
    else if (p.interior === true) mesh.reveal(i, false)
  })
  expect(mesh.stats("near").parts).toBe(placements.length)
  expect(mesh.stats("far").parts).toBe(placements.length)
  expect(mesh.root.children.flatMap((layer) => layer.children)).toEqual(meshes)
})
