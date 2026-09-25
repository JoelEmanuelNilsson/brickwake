import { expect, test } from "bun:test"
import { addShip, createMatch, stepMatch, type BroadsideOrders, type MatchEvent, type MatchState } from "./match.ts"
import { sampleOcean, seas } from "./ocean.ts"
import { ffaRules } from "./rules.ts"
import { duelShipIds, scenarios } from "./scenarios.ts"
import { shipAttitude, shipId, shipPointToWorld, type ShipId, type ShipState } from "./ship.ts"
import { SIM_DT, SIM_HZ, tuning } from "./tuning.ts"
import { quatFromAxisAngle, vec3 } from "./vector.ts"
import { makeWind } from "./wind.ts"

const [a, b] = duelShipIds

const run = (start: MatchState, seconds: number, orders: (state: MatchState) => BroadsideOrders = () => new Map()) => {
  let state = start
  const events: Array<MatchEvent> = []
  for (let i = 0; i < Math.round(seconds * SIM_HZ); i++) {
    const step = stepMatch(state, new Map(), orders(state))
    state = step.state
    events.push(...step.events)
  }
  return { state, events }
}

const ship = (state: MatchState, id: ShipId): ShipState => {
  const found = state.ships.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`no ship ${id}`)
  return found
}

/** A fires its starboard broadside at B whenever it is loaded. */
const aTargetsB = (state: MatchState): BroadsideOrders => {
  const target = ship(state, b)
  return new Map([[a, { side: "starboard", aimPoint: vec3(target.position.x, 0, target.position.z) }]])
}

/** Runs the duel until B founders, and returns the state at that tick. */
const sinkB = (start: MatchState) => {
  let state = start
  const events: Array<MatchEvent> = []
  for (let i = 0; i < 30 * SIM_HZ && ship(state, b).life._tag === "afloat"; i++) {
    const step = stepMatch(state, new Map(), aTargetsB(state))
    state = step.state
    events.push(...step.events)
  }
  expect(ship(state, b).life._tag).toBe("sinking")
  return { state, events }
}

const hullCorners = [-14, 14].flatMap((x) => [-4, 4].flatMap((z) => [vec3(x, 5, z), vec3(x, -2, z)]))

test("a ship at 0 HP founders by the end the killing ball struck and goes under within the sinking time", () => {
  const { state, events } = sinkB(scenarios.duel)
  const sunk = events.find((event) => event._tag === "shipSunk")
  expect(sunk).toMatchObject({ shipId: b, by: a })
  const life = ship(state, b).life
  if (life._tag !== "sinking") throw new Error("B is not sinking")
  const killing = events.findLast((event) => event._tag === "ballHit" && event.target === b)
  if (killing?._tag !== "ballHit") throw new Error("no killing hit")
  expect(life.floodEnd).toBe(killing.localPoint.x >= 0 ? 1 : -1)
  expect(ship(state, b).controls).toEqual({ rudder: 0, sail: 0 })

  const pitches: Array<number> = []
  let after = state
  for (let t = 0; t < tuning.sinking.seconds; t += SIM_DT) {
    after = stepMatch(after, new Map([[b, { rudder: 1, sail: 2 }]])).state
    pitches.push(shipAttitude(ship(after, b)).pitch)
  }
  // Bow down is negative pitch: the flooding end goes first.
  const settle = Math.max(...pitches.map((pitch) => -life.floodEnd * pitch)) * (180 / Math.PI)
  expect(settle).toBeGreaterThan(20)
  expect(ship(after, b).controls).toEqual({ rudder: 0, sail: 0 })
  after = run(after, 0.5).state
  const b2 = ship(after, b)
  expect(b2.life._tag).toBe("sunk")
  const time = after.tick * SIM_DT
  for (const corner of hullCorners) {
    const world = shipPointToWorld(b2, corner)
    expect(world.y).toBeLessThan(sampleOcean(after.sea, world.x, world.z, time).height)
  }
})

test("a sinking ship takes no damage and no orders; its hull still stops balls", () => {
  const { state } = sinkB(scenarios.duel)
  const { events } = run(state, 3, (s) => new Map([...aTargetsB(s), [b, { side: "port", aimPoint: vec3(0, 0, 0) }]]))
  const hits = events.filter((event) => event._tag === "ballHit" && event.target === b)
  expect(hits.length).toBeGreaterThan(0)
  for (const hit of hits) expect(hit).toMatchObject({ damage: 0, hp: 0 })
  expect(events.filter((event) => event._tag === "shipSunk")).toEqual([])
  expect(events.filter((event) => event._tag === "cannonFired" && event.ball.shooter === b)).toEqual([])
})

test("a sunk ship respawns on the spawn ring at full HP after the respawn wait, keeping its score", () => {
  const sunk = sinkB(scenarios.duel)
  const since = sunk.events.find((event) => event._tag === "shipSunk")!.time
  const respawnAt = since + tuning.sinking.seconds + tuning.sinking.respawnSeconds
  const before = run(sunk.state, respawnAt - sunk.state.tick * SIM_DT - 0.1)
  expect(ship(before.state, b).life).toEqual({ _tag: "sunk", respawnAt })
  const after = run(before.state, 0.2)
  const back = ship(after.state, b)
  expect(after.events).toContainEqual(expect.objectContaining({ _tag: "shipRespawned", shipId: b }))
  expect(back).toMatchObject({ life: { _tag: "afloat" }, hp: tuning.damage.hullHp, spawn: 2, deaths: 1, kills: 0 })
  expect(Math.hypot(back.position.x, back.position.z)).toBeCloseTo(tuning.match.spawnRing.radius, 0)
  expect(back.position.y).toBeGreaterThan(-1)
})

test("in play a sink scores for the shooter and against the sunk ship", () => {
  const { state } = sinkB(scenarios.duel)
  expect(ship(state, a)).toMatchObject({ kills: 1, deaths: 0 })
  expect(ship(state, b)).toMatchObject({ kills: 0, deaths: 1 })
})

const warmupDuel = () => {
  const empty = createMatch({ seed: 7, sea: seas.calm, wind: makeWind({ toward: -Math.PI / 2, speed: 14, gustiness: 0 }), ships: [] })
  const two = addShip(addShip(empty, { id: a, x: 0, z: 0, heading: 0 }), { id: b, x: 0, z: 150, heading: 0 })
  return { ...two, ships: two.ships.map((s) => (s.id === b ? { ...s, hp: 15 } : s)) }
}

test("warmup: sinks do not score; play starts on time with scores cleared and afloat ships repaired", () => {
  const start = warmupDuel()
  expect(start.phase).toEqual({ _tag: "warmup", endsAt: ffaRules.warmupSeconds })
  const { state } = sinkB(start)
  expect(ship(state, a).kills).toBe(0)
  expect(ship(state, b).deaths).toBe(0)
  const damaged = { ...state, ships: state.ships.map((s) => (s.id === a ? { ...s, hp: 40 } : s)) }
  const played = run(damaged, ffaRules.warmupSeconds - damaged.tick * SIM_DT + SIM_DT).state
  expect(played.phase).toEqual({ _tag: "playing", endsAt: expect.closeTo(ffaRules.warmupSeconds + ffaRules.timeLimit, 1) })
  expect(ship(played, a).hp).toBe(tuning.damage.hullHp)
})

test("the score limit ends the match at once with the leader as winner; the guns fall silent", () => {
  const leading = { ...scenarios.duel, ships: scenarios.duel.ships.map((s) => (s.id === a ? { ...s, kills: ffaRules.scoreLimit - 1 } : s)) }
  const { state } = sinkB(leading)
  const ended = run(state, SIM_DT).state
  expect(ended.phase).toMatchObject({ _tag: "ended", winner: { _tag: "ship", shipId: a } })
  const quiet = run(ended, 2, (s) => new Map([[a, { side: "starboard", aimPoint: ship(s, b).position }]]))
  expect(quiet.events.filter((event) => event._tag === "cannonFired" || event._tag === "broadsideRefused")).toEqual([])
})

test("the time limit ends a scoreless match as a draw; after the results it restarts with everyone respawned", () => {
  const rules = scenarios.duel.rules
  const ended = run(scenarios.duel, rules.timeLimit + SIM_DT)
  expect(ended.state.phase).toEqual({ _tag: "ended", restartAt: expect.closeTo(rules.timeLimit + rules.endedSeconds, 1), winner: undefined })
  const scored = { ...ended.state, ships: ended.state.ships.map((s) => ({ ...s, kills: 3, deaths: 2, hp: 20 })) }
  const restarted = run(scored, rules.endedSeconds)
  expect(restarted.state.phase._tag).toBe("playing")
  expect(restarted.state.balls).toEqual([])
  for (const s of restarted.state.ships) expect(s).toMatchObject({ kills: 0, deaths: 0, hp: tuning.damage.hullHp, spawn: 2, life: { _tag: "afloat" } })
  expect(restarted.events.filter((event) => event._tag === "shipRespawned")).toHaveLength(2)
  const [first, second] = restarted.state.ships
  expect(Math.hypot(first!.position.x - second!.position.x, first!.position.z - second!.position.z)).toBeGreaterThan(200)
})

test("a match restarts into warmup when its rules have one", () => {
  const rules = { ...ffaRules, warmupSeconds: 2, timeLimit: 3, endedSeconds: 1 }
  const start = createMatch({ seed: 3, rules, sea: seas.calm, wind: makeWind({ toward: 0, speed: 14, gustiness: 0 }), ships: [{ id: shipId("x"), x: 0, z: 0, heading: 0 }] })
  const phases = new Set<string>()
  let state = start
  for (let i = 0; i < 5.9 * SIM_HZ; i++) {
    state = stepMatch(state, new Map()).state
    phases.add(`${state.phase._tag}`)
  }
  expect([...phases]).toEqual(["warmup", "playing", "ended"])
  expect(run(state, 0.2).state.phase._tag).toBe("warmup")
})

test("a ship knocked onto its beam ends founders instead of sailing on capsized", () => {
  const start = scenarios.duel
  const capsized = { ...ship(start, b), orientation: quatFromAxisAngle(vec3(1, 0, 0), 80 * (Math.PI / 180)) }
  const { state, events } = run({ ...start, ships: start.ships.map((s) => (s.id === b ? capsized : s)) }, 1)
  expect(ship(state, b).life._tag).toBe("sinking")
  expect(events.find((event) => event._tag === "shipSunk")).toMatchObject({ shipId: b, by: undefined })
  expect(ship(state, a).life._tag).toBe("afloat")
})
