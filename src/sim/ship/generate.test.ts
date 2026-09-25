import { expect, test } from "bun:test"
import { gunLayout } from "../gun-layout.ts"
import { generateShip, gridMetres, placeAssembly } from "./generate.ts"
import { toLdr } from "./ldr.ts"
import { galleonSpec } from "./spec.ts"
import { connectParts, exposure, keelParts, occupiedCells, reachable } from "./structure.ts"
import { validateShip } from "./validate.ts"

const ship = generateShip(galleonSpec)

test("the galleon passes validation: part count in range, no overlaps, every part on the keel, ports on the gun layout", () => {
  expect(validateShip(galleonSpec, ship)).toEqual([])
  expect(ship.pruned).toBeLessThanOrEqual(2)
})

test("generation is deterministic", () => {
  expect(JSON.stringify(generateShip(galleonSpec))).toBe(JSON.stringify(ship))
})

test("the hull is mirror-symmetric in plan", () => {
  const occupied = new Set(ship.parts.flatMap(occupiedCells).map(([x, y, z]) => `${x},${y},${z}`))
  const asymmetric = [...occupied].filter((cell) => {
    const [x, y, z = 0] = cell.split(",").map(Number)
    return !occupied.has(`${x},${y},${-1 - z}`)
  })
  expect(asymmetric).toEqual([])
})

test("every gun in the gun layout has an open port in the hull side at its mount, with a cannon in it", () => {
  const cannons = ship.parts.filter((p) => p.part === "2527c01")
  expect(cannons).toHaveLength(gunLayout.length)
  const occupied = new Set(ship.parts.flatMap((p) => (p.part === "2527c01" ? [] : occupiedCells(p))).map((c) => c.join(",")))
  for (const gun of gunLayout) {
    const x = Math.floor(galleonSpec.midship + gun.position.x / gridMetres.stud)
    const y = Math.floor(galleonSpec.waterline + gun.position.y / gridMetres.plate)
    const face = Math.round(gun.position.z / gridMetres.stud)
    const outer = face > 0 ? face - 1 : face
    const inner = face > 0 ? outer - 1 : outer + 1
    expect({ gun: gun.position, open: !occupied.has(`${x},${y},${outer}`) && !occupied.has(`${x},${y},${inner}`) }).toEqual({ gun: gun.position, open: true })
    expect({ gun: gun.position, hull: occupied.has(`${x - 3},${y},${outer}`) && !occupied.has(`${x - 3},${y},${outer + Math.sign(face)}`) }).toEqual({ gun: gun.position, hull: true })
  }
})

test("validation reports overlaps and parts cut off from the keel", () => {
  const [first] = ship.parts
  if (first === undefined) throw new Error("no parts")
  const floating = { ...first, y: first.y + 200 }
  const broken = { ...ship, parts: [...ship.parts, first, floating], edges: connectParts([...ship.parts, first, floating]) }
  const issues = validateShip(galleonSpec, broken)
  expect(issues.some((issue) => issue.includes("overlap"))).toBe(true)
  expect(issues.some((issue) => issue.includes("not connected to the keel"))).toBe(true)
})

test("removing a band of hull parts detaches exactly what lost its path to the keel", () => {
  const removed = new Set(ship.parts.flatMap((p, i) => (p.y >= 13 && p.y < 16 ? [i] : [])))
  const seen = reachable(ship.parts.length, ship.edges, keelParts(ship.parts), removed)
  const above = ship.parts.filter((p, i) => p.y >= 16 && seen[i] === 1)
  expect(above).toEqual([])
})

test("the hold is sealed: hull parts that face only the hold are left out of rendering", () => {
  const occupied = new Set(ship.parts.flatMap(occupiedCells).map((c) => c.join(",")))
  const open = (x: number, y: number, z: number) => !occupied.has(`${x},${y},${z}`)
  const seen = exposure(ship.parts)
  const facingHold = ship.parts.flatMap((p, i) => {
    if (p.y < 3 || p.y > 15 || p.x < 15 || p.x > 45) return []
    const cells = occupiedCells(p)
    const inward = cells.some(([x, y, z]) => open(x, y, z >= 0 ? z - 1 : z + 1))
    const outward = cells.some(([x, y, z]) => open(x, y, z >= 0 ? z + 1 : z - 1) || open(x, y - 1, z))
    return inward && !outward ? [seen.parts[i]] : []
  })
  expect(facingHold.length).toBeGreaterThan(10)
  expect(facingHold.every((v) => v === 0)).toBe(true)
})

test(".ldr export has one type-1 line per part with LDraw colour codes", () => {
  const lines = toLdr("galleon", ship.parts).split("\n").filter((line) => line.startsWith("1 "))
  expect(lines).toHaveLength(ship.parts.length)
  expect(lines.every((line) => line.split(" ").length === 15 && line.endsWith(".dat"))).toBe(true)
})

test("every ornament and its mirror stands on the ship, attached to the keel", () => {
  const present = new Set(ship.parts.map((p) => JSON.stringify(p)))
  for (const o of galleonSpec.ornaments) {
    for (const mirror of o.mirror === true ? [false, true] : [false]) {
      const placed = placeAssembly(o.assembly, o.x, 0, o.z, o.turns ?? 0, mirror)
      const [first] = placed
      // "top" anchors resolve at generation; any height where every part is present counts.
      const heights = typeof o.y === "number" ? [o.y] : ship.parts.filter((p) => p.part === first?.part && p.x === first.x && p.z === first.z).map((p) => p.y - (first?.y ?? 0))
      const found = heights.some((dy) => placed.every((q) => present.has(JSON.stringify({ ...q, y: q.y + dy }))))
      expect({ ornament: o.assembly.name, x: o.x, z: o.z, mirror, found }).toEqual({ ornament: o.assembly.name, x: o.x, z: o.z, mirror, found: true })
    }
  }
})

test("an assembly turned and mirrored keeps its footprint's min corner on the anchor and swaps sides", () => {
  const fence = { name: "fence", parts: [{ part: "3633", color: "black", x: 0, y: 0, z: 0, turns: 0 }] } as const
  expect(placeAssembly(fence, 5, 2, 3, 1, false)).toEqual([{ part: "3633", color: "black", x: 5, y: 2, z: 3, turns: 1 }])
  expect(placeAssembly(fence, 5, 2, 3, 1, true)).toEqual([{ part: "3633", color: "black", x: 5, y: 2, z: -7, turns: 1 }])
  const gun = placeAssembly(galleonSpec.gun, 10, 18, 8, 0, true)[0]
  expect(gun === undefined ? undefined : { z: gun.z, turns: gun.turns }).toEqual({ z: -12, turns: 2 })
})
