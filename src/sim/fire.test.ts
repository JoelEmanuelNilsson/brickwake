import { expect, test } from "bun:test"
import { burnFires, catchFire, igniteChance, type ShipFire } from "./fire.ts"
import { stepMatch, type MatchEvent, type MatchState } from "./match.ts"
import { seedRng } from "./rng.ts"
import { duelShipIds, scenarios } from "./scenarios.ts"
import type { ShipId, ShipState } from "./ship.ts"
import { SIM_DT, SIM_HZ, tuning } from "./tuning.ts"
import { vec3 } from "./vector.ts"

const [a, b] = duelShipIds

const ship = (state: MatchState, id: ShipId): ShipState => {
  const found = state.ships.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`no ship ${id}`)
  return found
}

const withShip = (state: MatchState, id: ShipId, change: Partial<ShipState>): MatchState => ({
  ...state,
  ships: state.ships.map((s) => (s.id === id ? { ...s, ...change } : s)),
})

const run = (start: MatchState, seconds: number) => {
  let state = start
  const events: Array<MatchEvent> = []
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    const step = stepMatch(state, new Map())
    state = step.state
    events.push(...step.events)
  }
  return { state, events }
}

/** Fires started by A on B's starboard side at the start of the duel. */
const firesOnB = (count: number): ReadonlyArray<ShipFire> =>
  Array.from({ length: count }, (_, i) => catchFire(vec3(-6 + i * 4, 1.5, 3.8), a, 0))

test("heavier and closer hits are likelier to start a fire", () => {
  const { perHp, rangeFactor } = tuning.fire
  expect(igniteChance(tuning.damage.perBall, 150)).toBeCloseTo(perHp * tuning.damage.perBall)
  expect(igniteChance(tuning.damage.perBall, 150)).toBeGreaterThan(igniteChance(tuning.damage.upperWorksPerBall, 150))
  expect(igniteChance(tuning.damage.perBall, 75)).toBeCloseTo(2 * igniteChance(tuning.damage.perBall, 150))
  expect(igniteChance(tuning.damage.perBall, 10)).toBeCloseTo(perHp * tuning.damage.perBall * rangeFactor.max)
  expect(igniteChance(tuning.damage.perBall, 5000)).toBeCloseTo(perHp * tuning.damage.perBall * rangeFactor.min)
})

test("a fire burns hpPerBurn every burnInterval for its life, then goes out", () => {
  let fires: ReadonlyArray<ShipFire> = [catchFire(vec3(0, 1.5, 3.8), a, 0)]
  let rng = seedRng(1)
  let burnt = 0
  for (let t = 0; fires.length > 0 && t < 60; t += SIM_DT) {
    const step = burnFires(fires.slice(0, 1), t, t + SIM_DT, rng)
    burnt += step.burns.length
    fires = step.fires.slice(0, 1)
    rng = step.rng
  }
  const { seconds, burnInterval } = tuning.fire
  expect(burnt).toBe(seconds / burnInterval)
  expect(fires).toHaveLength(0)
})

test("fires spread fore and aft along the same side, never past the per-ship cap", () => {
  let spread = 0
  for (let seed = 0; seed < 40; seed++) {
    let fires: ReadonlyArray<ShipFire> = firesOnB(3)
    let rng = seedRng(seed)
    for (let t = 0; t < tuning.fire.seconds; t += SIM_DT) {
      const step = burnFires(fires, t, t + SIM_DT, rng)
      fires = step.fires
      rng = step.rng
      expect(fires.length).toBeLessThanOrEqual(tuning.fire.maxPerShip)
    }
    for (const fire of fires) {
      spread++
      expect(fire.since).toBeGreaterThanOrEqual(tuning.fire.spreadAfter)
      expect(fire.localPoint.z).toBe(3.8)
      expect(fire.by).toBe(a)
    }
  }
  expect(spread).toBeGreaterThan(0)
})

test("a burning ship loses HP over time, each fire adding to it, credited to the ship that set them", () => {
  const start = withShip(scenarios.duel, b, { hp: tuning.damage.hullHp })
  const one = run(withShip(start, b, { fires: firesOnB(1) }), 10.5).state
  const three = run(withShip(start, b, { fires: firesOnB(3) }), 10.5).state
  const perFire = (10 / tuning.fire.burnInterval) * tuning.fire.hpPerBurn
  expect(tuning.damage.hullHp - ship(one, b).hp).toBe(perFire)
  expect(tuning.damage.hullHp - ship(three, b).hp).toBe(3 * perFire)
  expect(ship(three, a).damage).toBe(3 * perFire)
  expect(ship(three, a).hits).toBe(0)
  expect(ship(three, b).lastHitBy?.shipId).toBe(a)
})

test("fire that burns a ship to 0 HP sinks it, credited to the ship that set it; it goes out when the ship respawns", () => {
  const { state, events } = run(withShip(scenarios.duel, b, { hp: 2, fires: firesOnB(1) }), tuning.fire.burnInterval * 2 + 0.1)
  expect(events.find((event) => event._tag === "shipSunk")).toMatchObject({ shipId: b, by: a })
  expect(ship(state, b).life._tag).toBe("sinking")
  expect(ship(state, a).kills).toBe(1)
  expect(ship(state, b).deaths).toBe(1)
  const respawned = run(state, tuning.sinking.respawnSeconds).state
  expect(ship(respawned, b).life._tag).toBe("afloat")
  expect(ship(respawned, b).fires).toHaveLength(0)
})

test("a sink by fire heals the ship that set it, as a sink by a ball does", () => {
  const hurt = withShip(withShip(scenarios.duel, a, { hp: 100 }), b, { hp: 2, fires: firesOnB(1) })
  const { state, events } = run(hurt, tuning.fire.burnInterval * 2 + 0.1)
  const sunk = events.findIndex((event) => event._tag === "shipSunk")
  expect(events[sunk + 1]).toMatchObject({ _tag: "shipHealed", shipId: a, hp: 100 + Math.round(tuning.damage.sinkRepair * tuning.damage.hullHp) })
  expect(ship(state, a).hp).toBe(100 + Math.round(tuning.damage.sinkRepair * tuning.damage.hullHp))
})

test("broadsides at close range set the target alight, the fire at a struck point and started by the shooter", () => {
  let state = withShip(scenarios.duel, b, { hp: tuning.damage.hullHp })
  const hitsAt: Array<{ readonly x: number; readonly z: number }> = []
  let lit: ShipFire | undefined
  for (let i = 0; i < 60 * SIM_HZ && lit === undefined; i++) {
    const target = ship(state, b)
    const step = stepMatch(state, new Map(), new Map([[a, { side: "starboard", aimPoint: vec3(target.position.x, 0, target.position.z) }]]))
    state = step.state
    for (const event of step.events) if (event._tag === "ballHit" && event.target === b) hitsAt.push(event.localPoint)
    lit = ship(state, b).fires[0]
  }
  if (lit === undefined) throw new Error("no fire in a minute of broadsides")
  expect(lit.by).toBe(a)
  expect(hitsAt.some((hit) => hit.x === lit.localPoint.x && hit.z === lit.localPoint.z)).toBe(true)
})
