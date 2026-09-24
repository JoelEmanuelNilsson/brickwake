import { expect, test } from "bun:test"
import { gunLayout } from "../gun-layout.ts"
import { generateShip, gridMetres } from "./generate.ts"
import { toLdr } from "./ldr.ts"
import { galleonSpec } from "./spec.ts"
import { connectParts, exposure, keelParts, occupiedCells, reachable } from "./structure.ts"
import { validateShip } from "./validate.ts"

const ship = generateShip(galleonSpec)

test("the galleon passes validation: part count in range, no overlaps, every part on the keel, ports on the gun layout", () => {
  expect(validateShip(galleonSpec, ship)).toEqual([])
  expect(ship.pruned).toBeLessThanOrEqual(10)
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

test("every gun in the gun layout has an open port in the hull side at its mount", () => {
  const occupied = new Set(ship.parts.flatMap(occupiedCells).map((c) => c.join(",")))
  for (const gun of gunLayout) {
    const x = Math.floor(galleonSpec.midship + gun.position.x / gridMetres.stud)
    const y = Math.floor(galleonSpec.waterline + gun.position.y / gridMetres.plate)
    const face = Math.round(gun.position.z / gridMetres.stud)
    const outer = face > 0 ? face - 1 : face
    const inner = face > 0 ? outer - 1 : outer + 1
    expect({ gun: gun.position, open: !occupied.has(`${x},${y},${outer}`) && !occupied.has(`${x},${y},${inner}`) }).toEqual({ gun: gun.position, open: true })
    expect({ gun: gun.position, hull: occupied.has(`${x - 2},${y},${outer}`) && !occupied.has(`${x - 2},${y},${outer + Math.sign(face)}`) }).toEqual({ gun: gun.position, hull: true })
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
