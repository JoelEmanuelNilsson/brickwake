import { expect, test } from "bun:test"
import { addShip, createMatch, removeShip, spawnPoint, stepMatch, type MatchState, type ShipInputs } from "./match.ts"
import { seas } from "./ocean.ts"
import { scenarios, scenarioShipId } from "./scenarios.ts"
import { shipId, type ShipControls } from "./ship.ts"
import { SIM_HZ, tuning } from "./tuning.ts"
import { makeWind } from "./wind.ts"

const script: ReadonlyArray<readonly [tick: number, controls: ShipControls]> = [
  [0, { rudder: 0, sail: 2 }],
  [150, { rudder: 1, sail: 2 }],
  [300, { rudder: -1, sail: 1 }],
  [600, { rudder: 0, sail: 2 }],
]

const replay = (start: MatchState, seconds: number) => {
  let state = start
  for (let tick = 0; tick < seconds * SIM_HZ; tick++) {
    const input = script.find(([at]) => at === tick)
    const inputs: ShipInputs = input ? new Map([[scenarioShipId, input[1]]]) : new Map()
    state = stepMatch(state, inputs).state
  }
  return state
}

test("same seed and inputs replay to an identical state", () => {
  expect(replay(scenarios["open-sea"], 40)).toEqual(replay(scenarios["open-sea"], 40))
})

test("the seed drives the gusts", () => {
  const a = replay(scenarios["open-sea"], 30)
  const b = replay({ ...scenarios["open-sea"], rng: scenarios.calm.rng }, 30)
  expect(a.wind.speed).not.toBe(b.wind.speed)
  expect(a.ships[0]?.position).not.toEqual(b.ships[0]?.position)
})

test("gusts wander around the base wind; a gust-free wind holds steady", () => {
  const speeds: Array<number> = []
  let state = scenarios["open-sea"]
  for (let tick = 0; tick < 120 * SIM_HZ; tick++) {
    state = stepMatch(state, new Map()).state
    speeds.push(state.wind.speed)
  }
  expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(1)
  expect(Math.max(...speeds.map((s) => Math.abs(s / state.wind.baseSpeed - 1)))).toBeLessThan(0.2)
  expect(replay(scenarios.calm, 20).wind.speed).toBe(scenarios.calm.wind.speed)
})

test("controls persist until the next input for that ship", () => {
  const state = replay(scenarios.calm, 11)
  expect(state.ships[0]?.controls).toEqual({ rudder: -1, sail: 1 })
  expect(state.tick).toBe(11 * SIM_HZ)
})

test("joining ships spawn far apart on a beam reach, and a removed ship is gone", () => {
  let state = createMatch({ seed: 1, sea: seas.calm, wind: makeWind({ toward: 0.3, speed: 14, gustiness: 0 }), ships: [] })
  const ids = Array.from({ length: tuning.match.maxShips }, (_, index) => shipId(`ship-${index + 1}`))
  for (const id of ids) state = addShip(state, spawnPoint(state, id))
  const gaps = state.ships.flatMap((a, i) => state.ships.slice(i + 1).map((b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)))
  expect(Math.min(...gaps)).toBeGreaterThan(100)
  expect(spawnPoint(state, shipId("next")).heading).toBeCloseTo(0.3 + Math.PI / 2)
  const removed = removeShip(state, ids[3]!)
  expect(removed.ships.map((ship) => ship.id)).toEqual(ids.filter((id) => id !== ids[3]))
  expect(removeShip(removed, ids[3]!)).toEqual(removed)
})
