import type { SeaState } from "./ocean.ts"
import { seedRng, type RngState } from "./rng.ts"
import { makeShip, stepShip, type ShipControls, type ShipId, type ShipState } from "./ship.ts"
import { SIM_DT } from "./tuning.ts"
import { stepWind, type Wind } from "./wind.ts"

/** Everything that decides a match's outcome. Replays exactly from its seed and the inputs per tick. */
export interface MatchState {
  readonly tick: number
  readonly rng: RngState
  readonly sea: SeaState
  readonly wind: Wind
  readonly ships: ReadonlyArray<ShipState>
}

/** Something that happened during a tick, for clients to present. None exist yet. */
export type MatchEvent = never

/** Controls received this tick, by ship. Ships without an entry keep their last controls. */
export type ShipInputs = ReadonlyMap<ShipId, ShipControls>

/** Where and how a ship enters the match. */
export interface ShipSpawn {
  readonly id: ShipId
  readonly x: number
  readonly z: number
  /** Yaw angle of the bow (see `directionFromAngle`). */
  readonly heading: number
  readonly controls?: ShipControls
}

/** Sim time of a match state, seconds. */
export const matchTime = (state: MatchState): number => state.tick * SIM_DT

/** Adds a ship at rest on the water. */
export const addShip = (state: MatchState, spawn: ShipSpawn): MatchState => ({
  ...state,
  ships: [...state.ships, makeShip(spawn, state.sea, matchTime(state))],
})

/** A match at tick 0. */
export const createMatch = (options: {
  readonly seed: number
  readonly sea: SeaState
  readonly wind: Wind
  readonly ships: ReadonlyArray<ShipSpawn>
}): MatchState =>
  options.ships.reduce(addShip, { tick: 0, rng: seedRng(options.seed), sea: options.sea, wind: options.wind, ships: [] })

/** Advances a match by one fixed 30 Hz tick (`SIM_DT`). Pure. */
export const stepMatch = (
  state: MatchState,
  inputs: ShipInputs,
): { readonly state: MatchState; readonly events: ReadonlyArray<MatchEvent> } => {
  const env = { sea: state.sea, wind: state.wind, time: matchTime(state) }
  const ships = state.ships.map((ship) => stepShip({ ...ship, controls: inputs.get(ship.id) ?? ship.controls }, env))
  const { wind, rng } = stepWind(state.wind, state.rng)
  return { state: { tick: state.tick + 1, rng, sea: state.sea, wind, ships }, events: [] }
}
