import { expect, test } from "bun:test"
import { balanceBots, createMatch, stepMatch, type MatchEvent, type MatchState, type ShipInputs, type ShipSpawn } from "./match.ts"
import { seas } from "./ocean.ts"
import { ffaRules } from "./rules.ts"
import { shipAttitude, shipId, type ShipControls } from "./ship.ts"
import { SIM_HZ, tuning } from "./tuning.ts"
import { angleOffWind, makeWind } from "./wind.ts"

const botMatch = (seed: number, scoreLimit: number, humans: ReadonlyArray<ShipSpawn> = [], toward = 0.7) =>
  balanceBots(
    createMatch({
      seed,
      rules: { ...ffaRules, warmupSeconds: 0, scoreLimit },
      sea: seas.open,
      wind: makeWind({ toward, speed: 14, gustiness: 1 }),
      ships: humans,
    }),
  )

/** Plays until the match ends, with an optional human input log by tick; returns the end state, every event and per-second samples. */
const play = (start: MatchState, log: ReadonlyMap<number, ShipInputs> = new Map()) => {
  let state = start
  const events: Array<MatchEvent> = []
  const samples: Array<MatchState> = []
  while (state.phase._tag !== "ended" && state.tick < ffaRules.timeLimit * SIM_HZ) {
    const step = stepMatch(state, log.get(state.tick) ?? new Map())
    state = step.state
    events.push(...step.events)
    if (state.tick % SIM_HZ === 0) samples.push(state)
  }
  return { state, events, samples }
}

test("bots fill a match to six ships and leave as humans join", () => {
  let state = botMatch(1, 3)
  expect(state.ships.map((ship) => String(ship.id))).toEqual(["bot-1", "bot-2", "bot-3", "bot-4", "bot-5", "bot-6"])
  expect(new Set(state.bots.map((bot) => bot.skill.standoff)).size).toBe(6)
  for (let human = 1; human <= 7; human++) {
    state = balanceBots({ ...state, ships: [...state.ships, { ...state.ships[0]!, id: shipId(`ship-${human}`) }] })
    expect(state.ships.length).toBe(Math.max(tuning.bots.fillTo, human))
    expect(state.bots.length).toBe(Math.max(0, tuning.bots.fillTo - human))
  }
})

test("a headless bots-only match sails, fights and finishes with a winner in seconds", () => {
  const started = Bun.nanoseconds()
  const { state, events, samples } = play(botMatch(8, 3))
  const seconds = (Bun.nanoseconds() - started) / 1e9
  expect(state.phase._tag === "ended" && state.phase.winner).toBeTruthy()
  expect(seconds).toBeLessThan(10)
  console.log(`bots-only match to ${state.rules.scoreLimit} sinks: ${(state.tick / SIM_HZ).toFixed(0)} s of play in ${seconds.toFixed(2)} s`)

  const afloat = samples.flatMap((sample) => sample.ships.filter((ship) => ship.life._tag === "afloat").map((ship) => ({ ship, wind: sample.wind })))
  const inIrons = afloat.filter(({ ship, wind }) => angleOffWind(shipAttitude(ship).heading, wind) < Math.PI / 4).length
  expect(inIrons / afloat.length).toBeLessThan(0.02)

  const fired = events.filter((event) => event._tag === "cannonFired")
  const hits = events.filter((event) => event._tag === "ballHit")
  expect(new Set(fired.map((event) => event.ball.shooter)).size).toBe(6)
  expect(hits.length / fired.length).toBeGreaterThan(0.3)
  const sinks = events.filter((event) => event._tag === "shipSunk")
  expect(new Set(sinks.map((event) => event.by)).size).toBeGreaterThan(1)
}, 30_000)

test("bots stay inside the arena and upright whatever the seed and wind", () => {
  const seconds = 180
  for (let seed = 1; seed <= 10; seed++) {
    // The golden angle walks the wind round the compass, so ten seeds meet ten different winds.
    const toward = (seed * 2.399963) % (2 * Math.PI)
    let state = botMatch(seed, 1000, [], toward)
    let furthest = 0
    let steepest = 0
    while (state.tick < seconds * SIM_HZ) {
      state = stepMatch(state, new Map()).state
      if (state.tick % 10 !== 0) continue
      for (const ship of state.ships) {
        if (ship.life._tag !== "afloat") continue
        furthest = Math.max(furthest, Math.hypot(ship.position.x, ship.position.z))
        steepest = Math.max(steepest, Math.abs(shipAttitude(ship).heel))
      }
    }
    expect({ seed, inside: furthest < tuning.arena.softRadius }).toEqual({ seed, inside: true })
    expect(steepest).toBeLessThan(tuning.sinking.capsizeHeel)
  }
}, 60_000)

test("a match with bots replays exactly from its seed and input log", () => {
  const human = shipId("ship-1")
  const joined = botMatch(3, 2, [{ id: human, x: 0, z: 0, heading: 0 }])
  const helm = (rudder: ShipControls["rudder"]): ShipInputs => new Map([[human, { rudder, sail: 2 }]])
  const log = new Map([
    [0, helm(0)],
    [600, helm(1)],
    [700, helm(0)],
    [1500, helm(-1)],
    [1600, helm(0)],
  ])
  const a = play(joined, log)
  const b = play(joined, log)
  expect(a.state.phase._tag).toBe("ended")
  expect(b.state).toEqual(a.state)
  expect(b.events).toEqual(a.events)
}, 30_000)
