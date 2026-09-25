import { expect, test } from "bun:test"
import { generateShip } from "./generate.ts"
import { rigLayout, rigParts } from "./rig.ts"
import { galleonSpec } from "./spec.ts"
import { keelParts, occupiedCells, reachable } from "./structure.ts"

const ship = generateShip(galleonSpec)
const key = (p: { x: number; y: number; z: number; part: string }) => `${p.part}@${p.x},${p.y},${p.z}`
const index = new Map(ship.parts.map((p, i) => [key(p), i]))
const rig = rigParts(galleonSpec.rig)
const mastOf = (mast: number) => rigParts({ ...galleonSpec.rig, masts: galleonSpec.rig.masts.slice(mast, mast + 1) })

test("every mast, yard and crow's nest part is on the ship and attached to the keel", () => {
  expect(rig.length).toBeGreaterThan(150)
  const missing = rig.filter((p) => !index.has(key(p)))
  expect(missing).toEqual([])
})

test("mast feet stand clear of every ornament cell", () => {
  const ornamentCells = new Set(
    galleonSpec.ornaments.flatMap((o) => o.assembly.parts.map((p) => `${o.x + p.x},${o.z + p.z}`)).concat(galleonSpec.ornaments.flatMap((o) => (o.mirror === true ? o.assembly.parts.map((p) => `${o.x + p.x},${-1 - o.z - p.z}`) : []))),
  )
  for (const mast of galleonSpec.rig.masts) {
    const feet = rig.filter((p) => p.y === mast.step).flatMap(occupiedCells)
    expect(feet.filter(([x, , z]) => ornamentCells.has(`${x},${z}`))).toEqual([])
  }
})

test("a mast is a sub-graph: one shot deck part leaves it standing, losing its step drops all of it and nothing else", () => {
  for (let m = 0; m < galleonSpec.rig.masts.length; m++) {
    const mast = mastOf(m).map((p) => index.get(key(p)) ?? -1)
    const step = new Set(mast.slice(0, 4))
    const deckUnder = ship.edges.filter(([below, above]) => step.has(above) && !mast.includes(below)).map(([below]) => below)
    expect(new Set(deckUnder).size).toBeGreaterThanOrEqual(2)
    for (const deck of deckUnder) {
      const seen = reachable(ship.parts.length, ship.edges, keelParts(ship.parts), new Set([deck]))
      expect(mast.every((i) => seen[i] === 1)).toBe(true)
    }
    const seen = reachable(ship.parts.length, ship.edges, keelParts(ship.parts), step)
    const fallen = ship.parts.flatMap((_, i) => (seen[i] === 1 || step.has(i) ? [] : [i]))
    expect(fallen.sort((a, b) => a - b)).toEqual(mast.filter((i) => !step.has(i)).sort((a, b) => a - b))
  }
})

test("the layout hangs each sail from a yard part, the emblem on the main course, and sails are longer aloft than below", () => {
  const layout = rigLayout(galleonSpec)
  const occupied = new Map(ship.parts.flatMap((p) => occupiedCells(p).map((c) => [c.join(","), p] as const)))
  expect(layout.sails).toHaveLength(8)
  for (const sail of layout.sails) {
    expect(occupied.get(sail.cell.join(","))?.color).toBe(galleonSpec.rig.colors.yard)
    expect(sail.top).toBeGreaterThan(sail.foot + 1.5)
  }
  expect(layout.sails.filter((s) => s.emblem).map((s) => [s.mast, s.yard])).toEqual([[1, 0]])
  const main = layout.masts[1]
  expect(main?.top).toBeGreaterThan(19)
  expect(layout.masts.every((m) => m.yards.every((y, i) => i === 0 || y.half < (m.yards[i - 1]?.half ?? 0)))).toBe(true)
})
