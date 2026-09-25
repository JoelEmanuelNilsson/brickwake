import { Schema } from "effect"
import { ballId, type Cannonball } from "../sim/gunnery.ts"
import type { MatchEvent, MatchState } from "../sim/match.ts"
import type { MatchPhase } from "../sim/rules.ts"
import { shipId, type ShipId, type ShipState } from "../sim/ship.ts"
import { vec3, type Vec3 } from "../sim/vector.ts"
import { scenarios, type ScenarioName } from "../sim/scenarios.ts"
import { weatherNames } from "../sim/weather.ts"

const isShipId = (u: unknown): u is ShipId => typeof u === "string" && u.length > 0 && u.length <= 32

/** A ship id on the wire. */
export const ShipIdSchema = Schema.declare(isShipId, { expected: "a ship id (1–32 characters)" })

const isScenarioName = (u: unknown): u is ScenarioName => typeof u === "string" && Object.hasOwn(scenarios, u)

/** A scenario name on the wire (see `scenarios`). */
export const ScenarioNameSchema = Schema.declare(isScenarioName, { expected: `one of ${Object.keys(scenarios).join(", ")}` })

/** A match weather on the wire, as in `WeatherName`. */
export const WeatherNameSchema = Schema.Literals(weatherNames)

/** A 3-vector as `[x, y, z]`. */
export const Vec3Tuple = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])

/** A broadside side on the wire. */
export const BroadsideSideSchema = Schema.Literals(["port", "starboard"])

/** Why a broadside was refused, as in `BroadsideRefusal`. */
export const BroadsideRefusalSchema = Schema.Literals(["reloading", "out-of-arc", "out-of-range"])

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

/** A ship's life, as in `ShipLife`. */
export const ShipLifeSchema = Schema.TaggedUnion({
  afloat: {},
  sinking: { since: Schema.Finite, floodEnd: Schema.Literals([1, -1]), floodSide: Schema.Literals([1, -1]) },
  sunk: { respawnAt: Schema.Finite },
})

/** A game mode on the wire, as in `MatchMode`. */
export const MatchModeSchema = Schema.Literals(["ffa", "tdm"])

/** A TDM side on the wire, as in `Team`. */
export const TeamSchema = Schema.Literals(["pirates", "navy"])

/** Sinks each TDM side has scored, as in `TeamSinks`. */
export const TeamSinksSchema = Schema.Struct({ pirates: Schema.Int, navy: Schema.Int })

/** How the match is paced and won, as in `MatchRules`; fixed for a room, sent on join. */
export const MatchRulesSchema = Schema.Struct({
  mode: MatchModeSchema,
  scoreLimit: Schema.Int,
  timeLimit: Schema.Finite,
  warmupSeconds: Schema.Finite,
  endedSeconds: Schema.Finite,
})

/** Who won, as in `MatchWinner`; null on a draw. */
export const MatchWinnerSchema = Schema.NullOr(Schema.TaggedUnion({ ship: { shipId: ShipIdSchema }, team: { team: TeamSchema } }))

/** Where the match is in its lifecycle, as in `MatchPhase`; times are sim seconds. */
export const MatchPhaseSchema = Schema.TaggedUnion({
  warmup: { endsAt: Schema.Finite },
  playing: { endsAt: Schema.Finite },
  ended: { restartAt: Schema.Finite, winner: MatchWinnerSchema },
})

/** Wire form of `MatchPhase`. */
export type MatchPhaseSnapshot = typeof MatchPhaseSchema.Type

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
  hp: Schema.Finite,
  /** Sim time, seconds, from which the `[port, starboard]` guns may fire again. */
  reloadedAt: Schema.Tuple([Schema.Finite, Schema.Finite]),
  life: ShipLifeSchema,
  /** Changes when the ship respawns or the match restarts: clients must not interpolate across it. */
  spawn: Schema.Int,
  kills: Schema.Int,
  deaths: Schema.Int,
  /** Balls fired, balls that struck an enemy for damage, and the HP they took, this match. */
  shots: Schema.Int,
  hits: Schema.Int,
  damage: Schema.Finite,
  /** TDM side; null in FFA. */
  team: Schema.NullOr(TeamSchema),
})

/** Wire form of one ship. */
export interface ShipSnapshot extends Schema.Schema.Type<typeof ShipSnapshot> {}

/** Where a ball struck, as in `DamageZone`. */
export const DamageZoneSchema = Schema.Literals(["hull", "upperWorks", "sails"])

/** One ship's knocked-out parts, as in `ShipState.removedParts`. */
export const ShipWreck = Schema.Struct({ shipId: ShipIdSchema, removed: Schema.Array(Schema.Int) })

/** Something that happened at `tick`; clients apply it when their render clock reaches that tick. */
export const ServerEvent = Schema.TaggedUnion({
  shipJoined: { tick: Schema.Int, shipId: ShipIdSchema },
  shipLeft: { tick: Schema.Int, shipId: ShipIdSchema },
  /** One gun fired; `ballFromWire` turns it back into a `Cannonball` for `ballPositionAt`. `gun` indexes `gunLayout`. */
  cannonFired: {
    tick: Schema.Int,
    ballId: Schema.Int,
    shooter: ShipIdSchema,
    gun: Schema.Int,
    origin: Vec3Tuple,
    velocity: Vec3Tuple,
    firedAt: Schema.Finite,
  },
  /** A broadside order the sim would not carry out, with why. */
  broadsideRefused: { tick: Schema.Int, shipId: ShipIdSchema, side: BroadsideSideSchema, reason: BroadsideRefusalSchema },
  /**
   * A ball struck a ship's parts at sim time `time`; `localPoint` is target-local. `removed` are the parts it knocked
   * out in order: apply them to the target's `ShipDamage` in arrival order to get the same parts falling off.
   */
  ballHit: {
    tick: Schema.Int,
    time: Schema.Finite,
    ballId: Schema.Int,
    shooter: ShipIdSchema,
    target: ShipIdSchema,
    point: Vec3Tuple,
    localPoint: Vec3Tuple,
    zone: DamageZoneSchema,
    removed: Schema.Array(Schema.Int),
    damage: Schema.Finite,
    hp: Schema.Finite,
  },
  /** A ball tore through one of the target's sails at sim time `time` and flew on. */
  sailHit: {
    tick: Schema.Int,
    time: Schema.Finite,
    ballId: Schema.Int,
    shooter: ShipIdSchema,
    target: ShipIdSchema,
    point: Vec3Tuple,
    localPoint: Vec3Tuple,
    damage: Schema.Finite,
    hp: Schema.Finite,
  },
  /** A ball met the wave surface at sim time `time`. */
  ballSplash: { tick: Schema.Int, time: Schema.Finite, ballId: Schema.Int, point: Vec3Tuple },
  /** A ship's HP reached 0 at sim time `time`; `by` sank it (null when no ship did). */
  shipSunk: { tick: Schema.Int, time: Schema.Finite, shipId: ShipIdSchema, by: Schema.NullOr(ShipIdSchema) },
  /** A ship re-entered on the spawn ring, after sinking or at a restart. */
  shipRespawned: { tick: Schema.Int, shipId: ShipIdSchema },
  /** A ship afloat was made whole in place: full HP, every part back. */
  shipRepaired: { tick: Schema.Int, shipId: ShipIdSchema },
})

/** A server event. */
export type ServerEvent = typeof ServerEvent.Type

/** Every message a client may send. The server treats each as untrusted and decodes it. */
export const ClientMessage = Schema.TaggedUnion({
  /** Quick play: take a ship in a room of `mode` with space, or a new room. `scenario` starts a private room from that start state instead. */
  join: {
    mode: MatchModeSchema,
    scenario: Schema.optionalKey(ScenarioNameSchema),
    /** With `scenario`: joins the private room of that scenario opened under this name while it has a free seat. */
    room: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32))),
    /** With `scenario`: the weather a newly opened room takes instead of the scenario's clear sky. */
    weather: Schema.optionalKey(WeatherNameSchema),
  },
  leave: {},
  setHelm: { rudder: Schema.Literals([-1, 0, 1]) },
  setSail: { level: Schema.Literals([0, 1, 2]) },
  /** Fire the `side` broadside at a world point on the sea; the server lays each gun itself. */
  fireBroadside: { side: BroadsideSideSchema, aimPoint: Vec3Tuple },
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
    weather: WeatherNameSchema,
    rules: MatchRulesSchema,
    phase: MatchPhaseSchema,
    teamSinks: TeamSinksSchema,
    wind: WindSnapshot,
    ships: Schema.Array(ShipSnapshot),
    /** Every damaged ship's `removedParts`, in hit order; later hits arrive as `ballHit.removed`. */
    wrecks: Schema.Array(ShipWreck),
  },
  /** The full world after a tick, with the events that tick produced. Sent every tick. */
  snapshot: {
    tick: Schema.Int,
    phase: MatchPhaseSchema,
    teamSinks: TeamSinksSchema,
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
  hp: ship.hp,
  reloadedAt: [round(ship.reloadedAt.port, 4), round(ship.reloadedAt.starboard, 4)],
  life: ship.life._tag === "sinking" ? { ...ship.life, since: round(ship.life.since, 4) } : ship.life,
  spawn: ship.spawn,
  kills: ship.kills,
  deaths: ship.deaths,
  shots: ship.shots,
  hits: ship.hits,
  damage: ship.damage,
  team: ship.team ?? null,
})

/** The damaged ships' removed parts, for the welcome. */
export const wreckSnapshots = (state: MatchState): ReadonlyArray<typeof ShipWreck.Type> =>
  state.ships.flatMap((ship) => (ship.removedParts.length === 0 ? [] : [{ shipId: ship.id, removed: ship.removedParts }]))

/** The match phase on the wire. */
export const phaseSnapshot = (phase: MatchPhase): MatchPhaseSnapshot =>
  phase._tag === "ended" ? { ...phase, winner: phase.winner ?? null } : phase

/** The wind as clients see it. */
export const windSnapshot = (state: MatchState): WindSnapshot => ({ toward: round(state.wind.toward, 4), speed: round(state.wind.speed, 2) })

const tuple = (v: Vec3, decimals: number): readonly [number, number, number] => [round(v.x, decimals), round(v.y, decimals), round(v.z, decimals)]

/**
 * A sim event on the wire. Ball origin, velocity and fire time keep enough digits that a client's `ballPositionAt`
 * stays within a centimetre of the server's over a whole flight.
 */
export const serverEvent = (event: MatchEvent): ServerEvent => {
  switch (event._tag) {
    case "cannonFired": {
      const { ball } = event
      return {
        _tag: "cannonFired",
        tick: event.tick,
        ballId: ball.id,
        shooter: ball.shooter,
        gun: ball.gun,
        origin: tuple(ball.origin, 4),
        velocity: tuple(ball.velocity, 4),
        firedAt: round(ball.firedAt, 6),
      }
    }
    case "broadsideRefused":
      return event
    case "ballHit":
      return { ...event, time: round(event.time, 6), point: tuple(event.point, 3), localPoint: tuple(event.localPoint, 3) }
    case "sailHit":
      return { ...event, time: round(event.time, 6), point: tuple(event.point, 3), localPoint: tuple(event.localPoint, 3) }
    case "ballSplash":
      return { ...event, time: round(event.time, 6), point: tuple(event.point, 3) }
    case "shipSunk":
      return { ...event, time: round(event.time, 6), by: event.by ?? null }
    case "shipRespawned":
    case "shipRepaired":
      return event
  }
}

/** The ball a `cannonFired` event launched, for `ballPositionAt`. */
export const ballFromWire = (event: Extract<ServerEvent, { readonly _tag: "cannonFired" }>): Cannonball => ({
  id: ballId(event.ballId),
  shooter: shipId(event.shooter),
  gun: event.gun,
  origin: vec3(...event.origin),
  velocity: vec3(...event.velocity),
  firedAt: event.firedAt,
})
