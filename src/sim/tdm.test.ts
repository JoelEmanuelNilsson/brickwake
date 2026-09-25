import { expect, test } from "bun:test"
import { addShip, balanceBots, createMatch, removeShip, spawnPoint, stepMatch, type MatchEvent, type MatchState } from "./match.ts"
import { seas } from "./ocean.ts"
import { noTeamSinks, scoreSink, tdmRules, winnerOf } from "./rules.ts"
import { shipId, type ShipState } from "./ship.ts"
import { SIM_HZ, tuning } from "./tuning.ts"
import { vec3 } from "./vector.ts"
import { makeWind } from "./wind.ts"

const wind = makeWind({ toward: 0.7, speed: 14, gustiness: 1 })
const tdmMatch = (seed: number, scoreLimit: number) =>
  balanceBots(createMatch({ seed, rules: { ...tdmRules, warmupSeconds: 0, scoreLimit }, sea: seas.open, wind, ships: [] }))

const sides = (state: MatchState) => ({
  pirates: state.ships.filter((ship) => ship.team === "pirates").length,
  navy: state.ships.filter((ship) => ship.team === "navy").length,
})

const shipOf = (state: MatchState, id: string): ShipState => {
  const ship = state.ships.find((candidate) => candidate.id === id)
  if (!ship) throw new Error(`no ship ${id}`)
  return ship
}

test("TDM ships join the smaller side, spawn on their side's half of the ring, and bots leave from the larger side", () => {
  let state = tdmMatch(1, 20)
  expect(sides(state)).toEqual({ pirates: 3, navy: 3 })
  for (const ship of state.ships) expect(ship.position.z * (ship.team === "pirates" ? 1 : -1)).toBeGreaterThan(-1e-6)
  for (let human = 1; human <= 5; human++) {
    const id = shipId(`ship-${human}`)
    state = balanceBots(addShip(state, spawnPoint(state, id)))
    const { pirates, navy } = sides(state)
    expect(Math.abs(pirates - navy)).toBeLessThanOrEqual(1)
  }
  state = balanceBots(removeShip(removeShip(state, shipId("ship-1")), shipId("ship-3")))
  const { pirates, navy } = sides(state)
  expect(state.ships.length).toBe(tuning.bots.fillTo)
  expect(Math.abs(pirates - navy)).toBeLessThanOrEqual(1)
  expect(createMatch({ seed: 1, sea: seas.calm, wind, ships: [{ id: shipId("solo"), x: 0, z: 0, heading: 0 }] }).ships[0]!.team).toBeUndefined()
})

test("a sink scores for the sinker's side, an ally's sink scores nobody, and the side ahead wins", () => {
  const state = tdmMatch(2, 20)
  const pirate = state.ships.find((ship) => ship.team === "pirates")!
  const mate = state.ships.find((ship) => ship.team === "pirates" && ship.id !== pirate.id)!
  const navy = state.ships.find((ship) => ship.team === "navy")!
  const scored = scoreSink(state.rules, { ships: state.ships, teamSinks: noTeamSinks }, navy.id, pirate.id)
  expect(scored.teamSinks).toEqual({ pirates: 1, navy: 0 })
  expect(scored.credited).toBe(pirate.id)
  expect(shipOf({ ...state, ships: scored.ships }, pirate.id).kills).toBe(1)
  const friendly = scoreSink(state.rules, scored, mate.id, pirate.id)
  expect(friendly.teamSinks).toEqual({ pirates: 1, navy: 0 })
  expect(friendly.credited).toBeUndefined()
  expect(shipOf({ ...state, ships: friendly.ships }, pirate.id).kills).toBe(1)
  expect(winnerOf(state.rules, scored)).toEqual({ _tag: "team", team: "pirates" })
  expect(winnerOf(state.rules, { ships: state.ships, teamSinks: { pirates: 4, navy: 4 } })).toBeUndefined()
})

test("allies' balls strike each other's hulls and sails for no damage and break no bricks", () => {
  const pirates = [shipId("a"), shipId("b")]
  let state = createMatch({
    seed: 3,
    rules: { ...tdmRules, warmupSeconds: 0 },
    sea: seas.calm,
    wind: makeWind({ toward: -Math.PI / 2, speed: 14, gustiness: 0 }),
    ships: pirates.map((id, i) => ({ id, x: 0, z: 150 * i, heading: 0, team: "pirates" as const })),
  })
  const events: Array<MatchEvent> = []
  for (let i = 0; i < 4 * SIM_HZ; i++) {
    const step = stepMatch(state, new Map(), i === 0 ? new Map([[pirates[0]!, { side: "starboard" as const, aimPoint: vec3(0, 0, 150) }]]) : new Map())
    state = step.state
    events.push(...step.events)
  }
  const hits = events.filter((event) => event._tag === "ballHit" || event._tag === "sailHit")
  expect(hits.length).toBeGreaterThan(0)
  expect(hits.every((hit) => (hit._tag === "ballHit" || hit._tag === "sailHit") && hit.damage === 0)).toBe(true)
  expect(hits.every((hit) => hit._tag !== "ballHit" || hit.removed.length === 0)).toBe(true)
  expect(shipOf(state, "b").hp).toBe(tuning.damage.hullHp)
  expect(shipOf(state, "b").removedParts).toEqual([])
  expect(shipOf(state, "a").shots).toBe(12)
  expect(shipOf(state, "a").hits).toBe(0)
})

test("TDM win: a headless Pirates-vs-Navy bot match ends with the side that first reached the score limit, bots never aiming at allies", () => {
  let state = tdmMatch(6, 5)
  const events: Array<MatchEvent> = []
  let allyTargets = 0
  const started = Bun.nanoseconds()
  while (state.phase._tag !== "ended" && state.tick < tdmRules.timeLimit * SIM_HZ) {
    const step = stepMatch(state, new Map())
    state = step.state
    events.push(...step.events)
    for (const bot of state.bots)
      if (bot.target !== undefined && shipOf(state, bot.target).team === shipOf(state, bot.id).team) allyTargets++
  }
  const seconds = (Bun.nanoseconds() - started) / 1e9
  console.log(`TDM bot match: ${(state.tick / SIM_HZ).toFixed(0)} s of play, sinks ${JSON.stringify(state.teamSinks)}, ${seconds.toFixed(2)} s`)
  expect(allyTargets).toBe(0)
  const teamOf = (id: string) => shipOf(state, id).team
  const friendlyDamage = events.filter((event) => event._tag === "ballHit" && event.damage > 0 && teamOf(event.shooter) === teamOf(event.target))
  expect(friendlyDamage).toHaveLength(0)

  expect(state.phase._tag).toBe("ended")
  if (state.phase._tag !== "ended") return
  const { pirates, navy } = state.teamSinks
  expect(Math.max(pirates, navy)).toBe(5)
  expect(state.phase.winner).toEqual({ _tag: "team", team: pirates > navy ? "pirates" : "navy" })
  const credited = events.filter((event) => event._tag === "shipSunk" && event.by !== undefined)
  expect(credited).toHaveLength(pirates + navy)
  for (const team of ["pirates", "navy"] as const)
    expect(state.ships.filter((ship) => ship.team === team).reduce((sum, ship) => sum + ship.kills, 0)).toBe(state.teamSinks[team])
}, 60_000)

test("with no bots to even the sides, a ship respawning on a side two ships larger crosses to the other", () => {
  const empty = createMatch({ seed: 4, rules: { ...tdmRules, warmupSeconds: 0 }, sea: seas.calm, wind, ships: [] })
  let state = empty
  for (let human = 1; human <= 8; human++) state = addShip(state, spawnPoint(state, shipId(`ship-${human}`)))
  expect(sides(state)).toEqual({ pirates: 4, navy: 4 })
  const navy = state.ships.filter((ship) => ship.team === "navy").map((ship) => ship.id)
  state = removeShip(removeShip(state, navy[0]!), navy[1]!)
  expect(sides(state)).toEqual({ pirates: 4, navy: 2 })
  const pirate = state.ships.find((ship) => ship.team === "pirates")!
  const time = state.tick / SIM_HZ
  state = { ...state, ships: state.ships.map((ship) => (ship.id === pirate.id ? { ...ship, life: { _tag: "sunk", respawnAt: time } } : ship)) }
  const respawned = stepMatch(state, new Map()).state
  expect(shipOf(respawned, pirate.id).team).toBe("navy")
  expect(sides(respawned)).toEqual({ pirates: 3, navy: 3 })
  expect(shipOf(respawned, pirate.id).position.z).toBeLessThan(1e-6)
  const again = stepMatch({ ...respawned, ships: respawned.ships.map((ship) => (ship.id === pirate.id ? { ...ship, life: { _tag: "sunk", respawnAt: time } } : ship)) }, new Map()).state
  expect(shipOf(again, pirate.id).team).toBe("navy")
})
