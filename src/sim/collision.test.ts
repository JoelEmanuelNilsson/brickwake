import { expect, test } from "bun:test"
import { collideShips } from "./collision.ts"
import { createMatch, stepMatch, type MatchState } from "./match.ts"
import { seas } from "./ocean.ts"
import { shipId, shipPointToWorld, type ShipState } from "./ship.ts"
import { SIM_HZ, tuning } from "./tuning.ts"
import { vec3 } from "./vector.ts"
import { makeWind } from "./wind.ts"

const [a, b] = [shipId("a"), shipId("b")]
const wind = makeWind({ toward: -Math.PI / 2, speed: 14, gustiness: 0 })

/** Least distance between the two keel segments, horizontal, sampled finely. */
const keelGap = (s1: ShipState, s2: ShipState) => {
  const h = tuning.collision.halfLength
  let least = Infinity
  for (let i = 0; i <= 40; i++)
    for (let j = 0; j <= 40; j++) {
      const p = shipPointToWorld(s1, vec3(-h + (2 * h * i) / 40, 0, 0))
      const q = shipPointToWorld(s2, vec3(-h + (2 * h * j) / 40, 0, 0))
      least = Math.min(least, Math.hypot(p.x - q.x, p.z - q.z))
    }
  return least
}

const pair = (state: MatchState) => [state.ships[0]!, state.ships[1]!] as const

test("ships sailing into each other bow to bow are held apart and glance off", () => {
  let state = createMatch({
    seed: 1,
    sea: seas.open,
    wind,
    ships: [
      { id: a, x: -60, z: 0, heading: 0, controls: { rudder: 0, sail: 2 } },
      { id: b, x: 60, z: 2, heading: Math.PI, controls: { rudder: 0, sail: 2 } },
    ],
  })
  let least = Infinity
  for (let i = 0; i < 40 * SIM_HZ; i++) {
    state = stepMatch(state, new Map()).state
    least = Math.min(least, keelGap(...pair(state)))
  }
  const hulls = 2 * tuning.collision.radius
  expect(least).toBeGreaterThan(hulls - 1.5)
  expect(least).toBeLessThan(hulls + 0.5)
  const [s1, s2] = pair(state)
  expect(Math.hypot(s1.position.x - s2.position.x, s1.position.z - s2.position.z)).toBeGreaterThan(30)
})

test("overlapping ships are pushed apart evenly, and closing speed is taken out", () => {
  const base = createMatch({ seed: 1, sea: seas.calm, wind, ships: [{ id: a, x: 0, z: 0, heading: 0 }, { id: b, x: 0, z: 5, heading: 0 }] })
  const [s1, s2] = pair(base)
  const closing = [{ ...s1, velocity: vec3(0, 0, 2) }, { ...s2, velocity: vec3(0, 0, -2) }]
  const [c1, c2] = collideShips(closing, () => true)
  expect(c2!.position.z - c1!.position.z).toBeCloseTo(2 * tuning.collision.radius, 6)
  expect(c1!.position.z).toBeCloseTo(-1.5, 6)
  expect(c2!.velocity.z - c1!.velocity.z).toBeGreaterThan(0)
  expect(c2!.velocity.z - c1!.velocity.z).toBeLessThan(4 * tuning.collision.restitution + 0.01)
  expect(collideShips(closing, (ship) => ship.id !== b)).toEqual(closing)
})
