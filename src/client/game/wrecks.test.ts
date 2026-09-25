import { expect, test } from "bun:test"
import { shipId } from "../../sim/ship.ts"
import { galleonClass, shipWreck } from "../../sim/wreck.ts"
import { Wrecks } from "./wrecks.ts"

const dummy = shipId("dummy")
const hit = (removed: ReadonlyArray<number>) =>
  ({ _tag: "ballHit", tick: 1, time: 0, ballId: 1, shooter: shipId("player"), target: dummy, point: [0, 0, 0], localPoint: [0, 0, 0], zone: "hull", removed, damage: 5, hp: 95 }) as const

test("a welcome's list plus later hits give the server's parts gone; a respawn starts a new, whole wreck", () => {
  const { graph } = galleonClass()
  const mast = graph.count - 60
  const wrecks = new Wrecks(graph)
  wrecks.load([{ shipId: dummy, removed: [10, 11] }])
  const first = wrecks.of(dummy)
  wrecks.onEvent(hit([mast]))
  expect(wrecks.of(dummy)).toBe(first)
  const server = shipWreck([10, 11, mast])
  const gone = Array.from({ length: graph.count }, (_, i) => i).filter((i) => !server.isPresent(i))
  expect([...(first?.gone ?? [])].sort((a, b) => a - b)).toEqual(gone)
  wrecks.onEvent({ _tag: "shipRespawned", tick: 2, shipId: dummy, hulk: null })
  expect(wrecks.of(dummy)).toBeUndefined()
})

test("a heal keeps the first parts knocked out as a new wreck, or none when every part is rebuilt", () => {
  const { graph } = galleonClass()
  const mast = graph.count - 60
  const wrecks = new Wrecks(graph)
  wrecks.load([{ shipId: dummy, removed: [10, 11] }])
  wrecks.onEvent(hit([mast]))
  const before = wrecks.of(dummy)
  wrecks.onEvent({ _tag: "shipHealed", tick: 2, shipId: dummy, healed: 68, hp: 200, keptParts: 2 })
  const healed = wrecks.of(dummy)
  expect(healed).not.toBe(before)
  expect(healed?.removed).toEqual([10, 11])
  const server = shipWreck([10, 11])
  const gone = Array.from({ length: graph.count }, (_, i) => i).filter((i) => !server.isPresent(i))
  expect([...(healed?.gone ?? [])].sort((a, b) => a - b)).toEqual(gone)
  wrecks.onEvent({ _tag: "shipHealed", tick: 3, shipId: dummy, healed: 25, hp: 225, keptParts: 0 })
  expect(wrecks.of(dummy)).toBeUndefined()
})
