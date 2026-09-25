import { balanceBots, createMatch, type MatchState } from "./match.ts"
import { ffaRules, type MatchRules } from "./rules.ts"
import { seas, swell } from "./ocean.ts"
import { shipId, type ShipId } from "./ship.ts"
import { tuning } from "./tuning.ts"
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
  rules: { ...ffaRules, warmupSeconds: 0, timeLimit: 30, endedSeconds: 6 },
  sea: seas.calm,
  wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }),
  ships: [
    { id: duelShipIds[0], x: 0, z: 0, heading: 0 },
    { id: duelShipIds[1], x: 0, z: 150, heading: 0 },
  ],
})

/**
 * Named start states, usable from tests and as `?scenario=<name>` in the browser. The ship heads +x,
 * sails furled, with the wind from port (blowing toward +z): a beam reach once sail is set.
 */
export const scenarios = {
  /** Flat water. */
  calm: createMatch({ seed: 1, sea: seas.calm, wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }), ships: solo, rules: practice }),
  /** Swell rolling in from port, across the ship. */
  "beam-sea": createMatch({ seed: 2, sea: swell(-quarter), wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }), ships: solo, rules: practice }),
  /** Swell running straight at the bow. */
  "head-sea": createMatch({ seed: 3, sea: swell(Math.PI), wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }), ships: solo, rules: practice }),
  /** The match sea and a gusty wind. */
  "open-sea": createMatch({ seed: 4, sea: seas.open, wind: makeWind({ toward: -quarter, speed: 14, gustiness: 1 }), ships: solo, rules: practice }),
  /** Flat water with an unmanned ship 150 m off the starboard beam, close-hauled under half sail: it drifts at ~1.4 m/s. */
  "target-dummy": createMatch({
    seed: 5,
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
  armada: balanceBots(createMatch({ seed: 7, sea: seas.open, wind: makeWind({ toward: -quarter, speed: 14, gustiness: 1 }), ships: solo, rules: practice }), tuning.match.maxShips),
  duel: { ...duel, ships: duel.ships.map((ship) => (ship.id === duelShipIds[1] ? { ...ship, hp: duelBHp } : ship)) },
} as const satisfies Record<string, MatchState>

/** A scenario name. */
export type ScenarioName = keyof typeof scenarios

/** The ships joining clients take in a scenario, in order; the rest stay unmanned. A second client in a named `target-dummy` room crews the dummy. */
export const scenarioSeats = (name: ScenarioName): ReadonlyArray<ShipId> =>
  name === "duel" ? duelShipIds : name === "target-dummy" ? [scenarioShipId, dummyShipId] : [scenarioShipId]
