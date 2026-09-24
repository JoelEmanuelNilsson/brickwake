import { Clock, Context, Effect, Fiber, Layer, Random, Schema, Semaphore } from "effect"
import {
  ServerMessageJson,
  shipSnapshot,
  windSnapshot,
  type ClientMessage,
  type ServerEvent,
  type ServerMessage,
} from "../protocol/messages.ts"
import { addShip, createMatch, removeShip, spawnPoint, stepMatch, type MatchState } from "../sim/match.ts"
import { seas } from "../sim/ocean.ts"
import { scenarios, scenarioShipId } from "../sim/scenarios.ts"
import { shipId, type ShipControls, type ShipId } from "../sim/ship.ts"
import { SIM_DT, SIM_HZ, tuning } from "../sim/tuning.ts"
import { makeWind } from "../sim/wind.ts"

/** What a client asks for when it joins. */
export type JoinRequest = Omit<Extract<ClientMessage, { readonly _tag: "join" }>, "_tag">

/** Sends one encoded server message to one client. */
export type Send = (text: string) => Effect.Effect<void>

/** A client's ship in a room, held from join until `leave`. */
export interface Seat {
  readonly shipId: ShipId
  /** Changes the ship's helm or sail from the next tick on. */
  readonly command: (change: Partial<ShipControls>) => Effect.Effect<void>
  /** Takes the ship out of the room. Idempotent. */
  readonly leave: Effect.Effect<void>
}

/** Quick play: rooms that each own a match and run its 30 Hz tick loop while anyone is in them. */
export interface Interface {
  /** Seats the client in a room of the requested mode with space, or in a new room; `send` receives the welcome and then every snapshot. */
  readonly join: (request: JoinRequest, send: Send) => Effect.Effect<Seat>
}

/** The room registry. */
export class Service extends Context.Service<Service, Interface>()("brickwake/Rooms") {}

interface Room {
  readonly id: number
  /** Scenario rooms are private: quick play never puts anyone else in them. */
  readonly isPrivate: boolean
  state: MatchState
  /** Controls to apply on the next tick, by ship. */
  commands: Map<ShipId, ShipControls>
  /** Events since the last snapshot, sent with it. */
  events: Array<ServerEvent>
  readonly members: Map<ShipId, Send>
  shipsJoined: number
  loop: Fiber.Fiber<void> | undefined
}

const tickMs = SIM_DT * 1000
/** Ticks the loop may run back to back after a stall before it drops the backlog instead of fast-forwarding. */
const maxCatchUpTicks = 5

const encode = Schema.encodeSync(ServerMessageJson)

const broadcast = (room: Room, message: ServerMessage) => {
  const text = encode(message)
  return Effect.forEach(room.members.values(), (send) => send(text), { discard: true })
}

const stepRoom = (room: Room) => {
  room.state = stepMatch(room.state, room.commands).state
  room.commands = new Map()
  const events = room.events
  room.events = []
  return broadcast(room, {
    _tag: "snapshot",
    tick: room.state.tick,
    wind: windSnapshot(room.state),
    ships: room.state.ships.map(shipSnapshot),
    events,
  })
}

/** Runs the room's ticks on a fixed timestep: an accumulator absorbs timer jitter so ticks average exactly `SIM_HZ`. */
const runRoom = (room: Room) =>
  Effect.gen(function* () {
    let last = yield* Clock.currentTimeMillis
    let behind = 0
    while (true) {
      const now = yield* Clock.currentTimeMillis
      behind += now - last
      last = now
      for (let steps = 0; behind >= tickMs && steps < maxCatchUpTicks; steps++) {
        yield* stepRoom(room)
        behind -= tickMs
      }
      if (behind >= tickMs) {
        yield* Effect.logWarning(`room ${room.id} fell ${Math.round(behind)} ms behind; dropping the backlog`)
        behind = 0
      }
      yield* Effect.sleep(tickMs - behind)
    }
  })

const quickPlayMatch = Effect.gen(function* () {
  const seed = yield* Random.nextIntBetween(0, 2 ** 31)
  const toward = yield* Random.nextBetween(-Math.PI, Math.PI)
  return createMatch({ seed, sea: seas.open, wind: makeWind({ toward, speed: 14, gustiness: 1 }), ships: [] })
})

/** Builds the registry; room loops run in the Layer's scope. */
export const make = Effect.gen(function* () {
  const scope = yield* Effect.scope
  const rooms = new Map<number, Room>()
  // Serialises joins and leaves so a room cannot be picked while its last member is closing it.
  const lifecycle = yield* Semaphore.make(1)
  let roomsOpened = 0

  const openRoom = (state: MatchState, isPrivate: boolean) =>
    Effect.gen(function* () {
      const room: Room = {
        id: ++roomsOpened,
        isPrivate,
        state,
        commands: new Map(),
        events: [],
        members: new Map(),
        shipsJoined: 0,
        loop: undefined,
      }
      room.loop = yield* runRoom(room).pipe(Effect.annotateLogs({ room: room.id }), Effect.forkIn(scope))
      rooms.set(room.id, room)
      return room
    })

  const quickPlayRoom = Effect.gen(function* () {
    for (const room of rooms.values()) {
      if (!room.isPrivate && room.state.ships.length < tuning.match.maxShips) return room
    }
    return yield* openRoom(yield* quickPlayMatch, false)
  })

  const leave = (room: Room, id: ShipId) =>
    Effect.gen(function* () {
      if (!room.members.delete(id)) return
      room.state = removeShip(room.state, id)
      room.commands.delete(id)
      room.events.push({ _tag: "shipLeft", tick: room.state.tick, shipId: id })
      yield* Effect.logInfo(`${id} left room ${room.id}`)
      if (room.members.size === 0) {
        rooms.delete(room.id)
        if (room.loop) yield* Fiber.interrupt(room.loop)
        yield* Effect.logInfo(`room ${room.id} closed`)
      }
    }).pipe(lifecycle.withPermit)

  const seat = (room: Room, id: ShipId): Seat => ({
    shipId: id,
    command: (change) =>
      Effect.sync(() => {
        const ship = room.state.ships.find((candidate) => candidate.id === id)
        if (!ship || !room.members.has(id)) return
        room.commands.set(id, { ...(room.commands.get(id) ?? ship.controls), ...change })
      }),
    leave: leave(room, id),
  })

  const join = Effect.fn("Rooms.join")(
    function* (request: JoinRequest, send: Send) {
      const room = request.scenario === undefined ? yield* quickPlayRoom : yield* openRoom(scenarios[request.scenario], true)
      const id = request.scenario === undefined ? shipId(`ship-${++room.shipsJoined}`) : scenarioShipId
      if (request.scenario === undefined) room.state = addShip(room.state, spawnPoint(room.state, id))
      room.members.set(id, send)
      room.events.push({ _tag: "shipJoined", tick: room.state.tick, shipId: id })
      yield* send(
        encode({
          _tag: "welcome",
          shipId: id,
          simHz: SIM_HZ,
          tick: room.state.tick,
          sea: room.state.sea,
          wind: windSnapshot(room.state),
          ships: room.state.ships.map(shipSnapshot),
        }),
      )
      yield* Effect.logInfo(`${id} joined room ${room.id} (${room.state.ships.length} ships)`)
      return seat(room, id)
    },
    (effect) => effect.pipe(lifecycle.withPermit, Effect.uninterruptible),
  )

  return Service.of({ join })
})

/** The room registry, with room loops stopped when the Layer closes. */
export const layer = Layer.effect(Service, make)
