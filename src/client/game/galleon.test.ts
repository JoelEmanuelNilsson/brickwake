import { expect, test } from "bun:test"
import { Vector3 } from "three"
import { gunLayout } from "../../sim/gun-layout.ts"
import { tuning } from "../../sim/tuning.ts"
import { loadGalleon } from "./galleon.ts"
import { recoilAt } from "./ship-view.ts"

const model = loadGalleon()
const at = new Vector3()

test("every gun of the sim's layout has a drawn cannon at its port, muzzle outboard along its side", () => {
  expect(model.guns).toHaveLength(gunLayout.length)
  model.guns.forEach((gun, i) => {
    const mount = gunLayout[i]
    if (mount === undefined) throw new Error(`gun ${i} has no mount`)
    expect(gun.cannon.x).toBeCloseTo(mount.position.x, 5)
    expect(Math.sign(gun.muzzle.z)).toBe(Math.sign(mount.outward.z))
    expect(Math.abs(gun.muzzle.z) - Math.abs(mount.position.z)).toBeGreaterThan(0.8)
    expect(Math.abs(gun.muzzle.y - mount.position.y)).toBeLessThan(0.3)
  })
})

test("the moving parts are the 24 cannons below the yards and the yard parts above them, and every drawn part has one slot", () => {
  const cannons = model.moving.filter((p) => p.part === "2527c01")
  expect(cannons).toHaveLength(gunLayout.length)
  const yards = model.moving.filter((p) => at.setFromMatrixPosition(p.matrix).y > model.yardFloor)
  expect(yards.length).toBeGreaterThan(20)
  expect(cannons.length + yards.length).toBe(model.moving.length)
  for (const p of cannons) expect(at.setFromMatrixPosition(p.matrix).y).toBeLessThan(model.yardFloor)
  const slots = model.slots.filter((slot) => slot !== undefined)
  expect(slots).toHaveLength(model.hull.placements.length + model.moving.length)
})

test("the brick hull sits on the sim's waterline inside its hit box", () => {
  const { length, beam, bottom } = tuning.hull.hitBox
  let low = Number.POSITIVE_INFINITY
  for (const p of model.hull.placements) {
    at.setFromMatrixPosition(p.matrix)
    low = Math.min(low, at.y)
    if (Math.abs(at.y) < 0.2) {
      expect(Math.abs(at.x)).toBeLessThanOrEqual(length / 2)
      expect(Math.abs(at.z)).toBeLessThanOrEqual(beam / 2)
    }
  }
  expect(Math.abs(low - bottom)).toBeLessThan(0.15)
  expect(model.rudderHinge).toBeLessThan(-length / 2 + 2)
})

test("a cannon kicks in at once, stays in while loading and is run out before the reload ends", () => {
  expect(recoilAt(0)).toBe(0)
  expect(recoilAt(0.09)).toBeGreaterThan(0.6)
  expect(recoilAt(2)).toBeGreaterThan(0.5)
  expect(recoilAt(tuning.guns.reload - 1)).toBe(0)
})
