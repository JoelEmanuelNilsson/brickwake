import { drawBotSkill, type Bot } from "./bots.ts"
import { catchFire } from "./fire.ts"
import { balanceBots, createMatch, type MatchState, type ShipSpawn } from "./match.ts"
import { ffaRules, tdmRules, type MatchRules } from "./rules.ts"
import { seas, swell } from "./ocean.ts"
import { shipId, type ShipId } from "./ship.ts"
import { tuning } from "./tuning.ts"
import { vec3 } from "./vector.ts"
import { makeWind } from "./wind.ts"

/** The ship every single-ship scenario spawns, at the origin heading +x. */
export const scenarioShipId = shipId("player")

/** The target ship of the `target-dummy` scenario. */
export const dummyShipId = shipId("dummy")

/** The two captains' ships of the `duel` scenario, in the order joining clients take them. */
export const duelShipIds = [shipId("duel-a"), shipId("duel-b")] as const

const quarter = Math.PI / 2
const solo = [{ id: scenarioShipId, x: 0, z: 0, heading: 0 }] as const
/** Scenarios start in play and last a full match, so a test never meets warmup or a restart it did not ask for. */
const practice: MatchRules = { ...ffaRules, warmupSeconds: 0 }
/** HP the second duel ship starts with: one broadside's worth, so a test can sink it at once. */
const duelBHp = 15

const duel = createMatch({
  seed: 6,
  weather: "clear",
  rules: { ...ffaRules, warmupSeconds: 0, timeLimit: 30, endedSeconds: 6 },
  sea: seas.calm,
  wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }),
  ships: [
    { id: duelShipIds[0], x: 0, z: 0, heading: 0 },
    { id: duelShipIds[1], x: 0, z: 150, heading: 0 },
  ],
})

const skirmish = balanceBots(
  createMatch({
    seed: 8,
    weather: "clear",
    rules: { ...tdmRules, warmupSeconds: 0, scoreLimit: 1, timeLimit: 120, endedSeconds: 30 },
    sea: seas.calm,
    wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }),
    ships: [
      { ...solo[0], team: "pirates" },
      { id: dummyShipId, x: 0, z: 150, heading: 0, team: "navy" },
    ],
  }),
)

/** Two lines of six in the match sea, 110 m apart and 140 m between ships, sailing the same way: the player leads the port line, bots crew the rest. */
const lineOfBattle = (() => {
  const ships = Array.from({ length: 12 }, (_, i): ShipSpawn => ({
    id: i === 0 ? scenarioShipId : shipId(`bot-${i}`),
    x: (i % 6) * 140 - 350,
    z: i < 6 ? -55 : 55,
    heading: 0,
    controls: { rudder: 0, sail: 1 },
  }))
  const state = createMatch({ seed: 8, weather: "clear", sea: seas.open, wind: makeWind({ toward: -quarter, speed: 14, gustiness: 1 }), ships, rules: practice })
  let rng = state.rng
  const bots: Array<Bot> = ships.slice(1).map(({ id }) => {
    const drawn = drawBotSkill(rng)
    rng = drawn.rng
    return { id, skill: drawn.skill, target: undefined, turn: 0 }
  })
  return { ...state, rng, bots, botsJoined: bots.length }
})()

/**
 * Named start states, usable from tests and as `?scenario=<name>` in the browser. The ship heads +x,
 * sails furled, with the wind from port (blowing toward +z): a beam reach once sail is set. All are clear weather.
 */
export const scenarios = {
  /** Flat water. */
  calm: createMatch({ seed: 1, weather: "clear", sea: seas.calm, wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }), ships: solo, rules: practice }),
  /** Swell rolling in from port, across the ship. */
  "beam-sea": createMatch({ seed: 2, weather: "clear", sea: swell(-quarter), wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }), ships: solo, rules: practice }),
  /** Swell running straight at the bow. */
  "head-sea": createMatch({ seed: 3, weather: "clear", sea: swell(Math.PI), wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }), ships: solo, rules: practice }),
  /** The match sea and a gusty wind. */
  "open-sea": createMatch({ seed: 4, weather: "clear", sea: seas.open, wind: makeWind({ toward: -quarter, speed: 14, gustiness: 1 }), ships: solo, rules: practice }),
  /** Flat water with an unmanned ship 150 m off the starboard beam, close-hauled under half sail: it drifts at ~1.4 m/s. */
  "target-dummy": createMatch({
    seed: 5,
    weather: "clear",
    sea: seas.calm,
    wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }),
    ships: [...solo, { id: dummyShipId, x: 0, z: 150, heading: quarter / 2, controls: { rudder: 0, sail: 1 } }],
    rules: practice,
  }),
  /**
   * Two captains in flat water 150 m apart, the second off the first's starboard beam at 15 HP; a 30 s FFA match with 6 s of
   * results and no warmup. Two clients joining with the same `room` share it.
   */
  /** A full room: the player at the arena centre and bots on the spawn ring filling it to the most ships a room holds. */
  armada: balanceBots(createMatch({ seed: 7, weather: "clear", sea: seas.open, wind: makeWind({ toward: -quarter, speed: 14, gustiness: 1 }), ships: solo, rules: practice }), tuning.match.maxShips),
  /** Twelve ships in two lines trading broadsides at once: the effects' and debris' frame budget. */
  "line-of-battle": lineOfBattle,
  duel: { ...duel, ships: duel.ships.map((ship) => (ship.id === duelShipIds[1] ? { ...ship, hp: duelBHp } : ship)) },
  /**
   * TDM to one sink: the player (pirates) with a navy ship 150 m off the starboard beam at 15 HP, bots filling both sides
   * to three; 30 s of results, so a test sinks the target and reads the results screen.
   */
  skirmish: { ...skirmish, ships: skirmish.ships.map((ship) => (ship.id === dummyShipId ? { ...ship, hp: duelBHp } : ship)) },
  /**
   * Both ships already burning, the dummy 70 m off the starboard beam: three fires along its near side and 40 HP, so a
   * broadside sinks it; two fires on the player's starboard side.
   */
  burning: (() => {
    const start = createMatch({
      seed: 5,
      weather: "clear",
      sea: seas.calm,
      wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }),
      ships: [...solo, { id: dummyShipId, x: 0, z: 70, heading: 0, controls: { rudder: 0, sail: 0 } }],
      rules: practice,
    })
    const fires = {
      [scenarioShipId]: [catchFire(vec3(-5, 2, 3.8), dummyShipId, 0), catchFire(vec3(6, 3, 3.6), dummyShipId, 0)],
      [dummyShipId]: [catchFire(vec3(-8, 2, -3.8), scenarioShipId, 0), catchFire(vec3(1, 2.5, -3.8), scenarioShipId, 0), catchFire(vec3(9, 3, -3.4), scenarioShipId, 0)],
    }
    return { ...start, ships: start.ships.map((ship) => ({ ...ship, hp: ship.id === dummyShipId ? 40 : 180, fires: fires[ship.id] ?? [] })) }
  })(),
} as const satisfies Record<string, MatchState>

/** A scenario name. */
export type ScenarioName = keyof typeof scenarios

/** The ships joining clients take in a scenario, in order; the rest stay unmanned. A second client in a named `target-dummy` room crews the dummy. */
export const scenarioSeats = (name: ScenarioName): ReadonlyArray<ShipId> =>
  name === "duel" ? duelShipIds : name === "target-dummy" ? [scenarioShipId, dummyShipId] : [scenarioShipId]
