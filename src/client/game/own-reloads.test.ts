import { expect, test } from "bun:test"
import { tuning } from "../../sim/tuning.ts"
import { OwnReloads } from "./own-reloads.ts"

test("a broadside ordered in one room does not hold the guns in the next room, whose clock starts over", () => {
  const reloads = new OwnReloads()
  reloads.ordered("port", 110)
  expect(reloads.reloadedAt("port", 0)).toBe(110 + tuning.guns.reload)
  reloads.joined()
  expect(reloads.reloadedAt("port", 0)).toBe(0)
  expect(reloads.reloadedAt("starboard", 0)).toBe(0)
})

test("each side reloads for the tuned time from its own order, and a refusal cancels it", () => {
  const reloads = new OwnReloads()
  reloads.ordered("port", 10)
  reloads.ordered("starboard", 12)
  expect(reloads.reloadedAt("port", 0) - 10).toBe(tuning.guns.reload)
  expect(reloads.reloadedAt("starboard", 0) - 12).toBe(tuning.guns.reload)
  reloads.refused("starboard")
  expect(reloads.reloadedAt("starboard", 3)).toBe(3)
})
