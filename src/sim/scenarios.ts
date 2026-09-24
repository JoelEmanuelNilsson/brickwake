import { createMatch, type MatchState } from "./match.ts"
import { seas, swell } from "./ocean.ts"
import { shipId } from "./ship.ts"
import { makeWind } from "./wind.ts"

/** The ship every single-ship scenario spawns, at the origin heading +x. */
export const scenarioShipId = shipId("player")

/** The target ship of the `target-dummy` scenario. */
export const dummyShipId = shipId("dummy")

const quarter = Math.PI / 2
const solo = [{ id: scenarioShipId, x: 0, z: 0, heading: 0 }] as const

/**
 * Named start states, usable from tests and as `?scenario=<name>` in the browser. The ship heads +x,
 * sails furled, with the wind from port (blowing toward +z): a beam reach once sail is set.
 */
export const scenarios = {
  /** Flat water. */
  calm: createMatch({ seed: 1, sea: seas.calm, wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }), ships: solo }),
  /** Swell rolling in from port, across the ship. */
  "beam-sea": createMatch({ seed: 2, sea: swell(-quarter), wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }), ships: solo }),
  /** Swell running straight at the bow. */
  "head-sea": createMatch({ seed: 3, sea: swell(Math.PI), wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }), ships: solo }),
  /** The match sea and a gusty wind. */
  "open-sea": createMatch({ seed: 4, sea: seas.open, wind: makeWind({ toward: -quarter, speed: 14, gustiness: 1 }), ships: solo }),
  /** Flat water with an unmanned ship 150 m off the starboard beam, close-hauled under half sail: it drifts at ~1.4 m/s. */
  "target-dummy": createMatch({
    seed: 5,
    sea: seas.calm,
    wind: makeWind({ toward: -quarter, speed: 14, gustiness: 0 }),
    ships: [...solo, { id: dummyShipId, x: 0, z: 150, heading: quarter / 2, controls: { rudder: 0, sail: 1 } }],
  }),
} as const satisfies Record<string, MatchState>

/** A scenario name. */
export type ScenarioName = keyof typeof scenarios
