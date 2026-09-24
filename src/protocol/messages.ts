import { Schema } from "effect"
import type { MatchState } from "../sim/match.ts"
import type { ShipId, ShipState } from "../sim/ship.ts"
import { scenarios, type ScenarioName } from "../sim/scenarios.ts"

const isShipId = (u: unknown): u is ShipId => typeof u === "string" && u.length > 0 && u.length <= 32

/** A ship id on the wire. */
export const ShipIdSchema = Schema.declare(isShipId, { expected: "a ship id (1–32 characters)" })

const isScenarioName = (u: unknown): u is ScenarioName => typeof u === "string" && Object.hasOwn(scenarios, u)

/** A scenario name on the wire (see `scenarios`). */
export const ScenarioNameSchema = Schema.declare(isScenarioName, { expected: `one of ${Object.keys(scenarios).join(", ")}` })

/** A 3-vector as `[x, y, z]`. */
export const Vec3Tuple = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])

/** A unit quaternion as `[x, y, z, w]`. */
export const QuatTuple = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])

/** One Gerstner wave, as in `OceanWave`. */
export const OceanWaveSchema = Schema.Struct({
  direction: Schema.Finite,
  wavelength: Schema.Finite,
  amplitude: Schema.Finite,
  sharpness: Schema.Finite,
  phase: Schema.Finite,
})

/** The match sea, as in `SeaState`; clients evaluate `sampleOcean`/`gerstnerPoint` on it. */
export const SeaStateSchema = Schema.Struct({ waves: Schema.Array(OceanWaveSchema) })

/** The wind a client shows: the yaw angle it blows toward and its speed in m/s. */
export const WindSnapshot = Schema.Struct({ toward: Schema.Finite, speed: Schema.Finite })

/** Wire form of `WindSnapshot`. */
export interface WindSnapshot extends Schema.Schema.Type<typeof WindSnapshot> {}

/** What a client needs to draw one ship at one tick. Axes and units as in `ShipState`. */
export const ShipSnapshot = Schema.Struct({
  id: ShipIdSchema,
  position: Vec3Tuple,
  orientation: QuatTuple,
  velocity: Vec3Tuple,
  rudder: Schema.Literals([-1, 0, 1]),
  sail: Schema.Literals([0, 1, 2]),
  rudderAngle: Schema.Finite,
  sailSet: Schema.Finite,
})

/** Wire form of one ship. */
export interface ShipSnapshot extends Schema.Schema.Type<typeof ShipSnapshot> {}

/** Something that happened at `tick`; clients apply it when their render clock reaches that tick. */
export const ServerEvent = Schema.TaggedUnion({
  shipJoined: { tick: Schema.Int, shipId: ShipIdSchema },
  shipLeft: { tick: Schema.Int, shipId: ShipIdSchema },
})

/** A server event. */
export type ServerEvent = typeof ServerEvent.Type

/** Every message a client may send. The server treats each as untrusted and decodes it. */
export const ClientMessage = Schema.TaggedUnion({
  /** Quick play: take a ship in a room of `mode` with space, or a new room. `scenario` starts a private room from that start state instead. */
  join: { mode: Schema.Literal("ffa"), scenario: Schema.optionalKey(ScenarioNameSchema) },
  leave: {},
  setHelm: { rudder: Schema.Literals([-1, 0, 1]) },
  setSail: { level: Schema.Literals([0, 1, 2]) },
})

/** A client message. */
export type ClientMessage = typeof ClientMessage.Type

/** Every message the server sends. */
export const ServerMessage = Schema.TaggedUnion({
  /** Sent once on join: the client's ship and everything that stays fixed for the match. */
  welcome: {
    shipId: ShipIdSchema,
    simHz: Schema.Int,
    tick: Schema.Int,
    sea: SeaStateSchema,
    wind: WindSnapshot,
    ships: Schema.Array(ShipSnapshot),
  },
  /** The full world after a tick, with the events that tick produced. Sent every tick. */
  snapshot: {
    tick: Schema.Int,
    wind: WindSnapshot,
    ships: Schema.Array(ShipSnapshot),
    events: Schema.Array(ServerEvent),
  },
  /** A client message the server would not act on; the connection stays open. */
  rejected: { reason: Schema.String },
})

/** A server message. */
export type ServerMessage = typeof ServerMessage.Type

/** `ClientMessage` as a JSON text frame. */
export const ClientMessageJson = Schema.fromJsonString(ClientMessage)

/** `ServerMessage` as a JSON text frame. */
export const ServerMessageJson = Schema.fromJsonString(ServerMessage)

// Dividing by a power of ten, not multiplying by a step, keeps the shortest decimal form in JSON.
const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals

/** A ship on the wire, rounded to what a client can see: millimetres, 1e-5 of a quaternion, cm/s. */
export const shipSnapshot = (ship: ShipState): ShipSnapshot => ({
  id: ship.id,
  position: [round(ship.position.x, 3), round(ship.position.y, 3), round(ship.position.z, 3)],
  orientation: [
    round(ship.orientation.x, 5),
    round(ship.orientation.y, 5),
    round(ship.orientation.z, 5),
    round(ship.orientation.w, 5),
  ],
  velocity: [round(ship.velocity.x, 2), round(ship.velocity.y, 2), round(ship.velocity.z, 2)],
  rudder: ship.controls.rudder,
  sail: ship.controls.sail,
  rudderAngle: round(ship.rudderAngle, 4),
  sailSet: round(ship.sailSet, 4),
})

/** The wind as clients see it. */
export const windSnapshot = (state: MatchState): WindSnapshot => ({ toward: round(state.wind.toward, 4), speed: round(state.wind.speed, 2) })
