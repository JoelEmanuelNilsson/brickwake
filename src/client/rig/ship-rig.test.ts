import { expect, test } from "bun:test"
import { rigLayout } from "../../sim/ship/rig.ts"
import { galleonSpec } from "../../sim/ship/spec.ts"
import { buildRigGeometry } from "./ship-rig.ts"

const layout = rigLayout(galleonSpec)
const rig = buildRigGeometry(layout)
const triangles = (count: number) => count / 3

test("sails, flags and rigging stay under the 20k-triangle cosmetic budget, and far detail keeps shrouds and stays but drops ratlines", () => {
  const lines = rig.lines.getIndex()?.count ?? 0
  const total = triangles((rig.sails.getIndex()?.count ?? 0) + (rig.flags.getIndex()?.count ?? 0) + lines)
  expect(total).toBeLessThan(20_000)
  expect(rig.farLineIndices).toBeGreaterThan(0)
  expect(rig.farLineIndices).toBeLessThan(lines / 2)
})

test("every square sail and the jib is in the one sail geometry, tagged by index for furling and hiding", () => {
  expect(rig.sailCount).toBe(layout.sails.length + 1)
  const cloth = rig.sails.getAttribute("cloth")
  const ids = new Set(Array.from({ length: cloth.count }, (_, i) => cloth.getW(i)))
  expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: rig.sailCount }, (_, i) => i))
  expect(rig.sailCount).toBeLessThanOrEqual(16)
})

test("sails hang forward of their yards and inside the ship's beam plus the yard arms", () => {
  const position = rig.sails.getAttribute("position")
  const cloth = rig.sails.getAttribute("cloth")
  for (let i = 0; i < position.count; i++) {
    const sail = layout.sails[cloth.getW(i)]
    if (sail === undefined) continue
    expect(position.getX(i)).toBeGreaterThan(sail.x)
    expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(Math.max(sail.topHalf, sail.footHalf) + 1e-6)
  }
})
