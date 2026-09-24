import { gunLayout, type BroadsideSide } from "./gun-layout.ts"
import { ballId, broadsideRefusal, fireGun, traceBall, type BallId, type BroadsideRefusal, type Cannonball } from "./gunnery.ts"
import type { SeaState } from "./ocean.ts"
import { seedRng, type RngState } from "./rng.ts"
import { makeShip, stepShip, type ShipControls, type ShipId, type ShipState } from "./ship.ts"
import { SIM_DT, tuning } from "./tuning.ts"
import type { Vec3 } from "./vector.ts"
import { stepWind, type Wind } from "./wind.ts"

/** Everything that decides a match's outcome. Replays exactly from its seed and the inputs per tick. */
export interface MatchState {
  readonly tick: number
  readonly rng: RngState
  readonly sea: SeaState
  readonly wind: Wind
  readonly ships: ReadonlyArray<ShipState>
  /** Balls in flight. */
  readonly balls: ReadonlyArray<Cannonball>
  /** Guns of ordered broadsides still waiting for their turn in the ripple. */
  readonly pendingShots: ReadonlyArray<PendingShot>
  /** Id the next fired ball takes. */
  readonly nextBallId: number
}

/** One gun of an ordered broadside, due to fire at sim time `at`. */
export interface PendingShot {
  readonly shipId: ShipId
  /** Index into `gunLayout`. */
  readonly gun: number
  readonly aimPoint: Vec3
  readonly at: number
}

/** A captain's order to fire one side's broadside at a world point on the sea. */
export interface BroadsideOrder {
  readonly side: BroadsideSide
  readonly aimPoint: Vec3
}

/** Broadside orders received this tick, by ship. */
export type BroadsideOrders = ReadonlyMap<ShipId, BroadsideOrder>

/**
 * Something that happened during a tick, for clients to present. `tick` is the tick being stepped (the state it
 * started from); `time` is the exact sim time in seconds, inside that tick.
 */
export type MatchEvent =
  | { readonly _tag: "cannonFired"; readonly tick: number; readonly ball: Cannonball }
  | {
      readonly _tag: "broadsideRefused"
      readonly tick: number
      readonly shipId: ShipId
      readonly side: BroadsideSide
      readonly reason: BroadsideRefusal
    }
  | {
      readonly _tag: "ballHit"
      readonly tick: number
      readonly time: number
      readonly ballId: BallId
      readonly shooter: ShipId
      readonly target: ShipId
      /** Where the ball struck, world and target-local. */
      readonly point: Vec3
      readonly localPoint: Vec3
      /** HP the hit took and the target's HP after it. */
      readonly damage: number
      readonly hp: number
    }
  | { readonly _tag: "ballSplash"; readonly tick: number; readonly time: number; readonly ballId: BallId; readonly point: Vec3 }

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

/** Takes a ship out of the match; unknown ids leave the state unchanged. */
export const removeShip = (state: MatchState, id: ShipId): MatchState => ({
  ...state,
  ships: state.ships.filter((ship) => ship.id !== id),
  pendingShots: state.pendingShots.filter((shot) => shot.shipId !== id),
})

/**
 * Where a joining ship starts: the spawn-ring slot farthest from every ship already afloat, bow
 * across the base wind so setting sail gives a beam reach at once.
 */
export const spawnPoint = (state: MatchState, id: ShipId): ShipSpawn => {
  const { radius, slots } = tuning.match.spawnRing
  const clearance = (slot: number) => {
    const angle = (2 * Math.PI * slot) / slots
    const x = radius * Math.cos(angle)
    const z = radius * Math.sin(angle)
    return state.ships.reduce((nearest, ship) => Math.min(nearest, Math.hypot(ship.position.x - x, ship.position.z - z)), Infinity)
  }
  let best = 0
  for (let slot = 1; slot < slots; slot++) if (clearance(slot) > clearance(best)) best = slot
  const angle = (2 * Math.PI * best) / slots
  return { id, x: radius * Math.cos(angle), z: radius * Math.sin(angle), heading: state.wind.baseToward + Math.PI / 2 }
}

/** A match at tick 0. */
export const createMatch = (options: {
  readonly seed: number
  readonly sea: SeaState
  readonly wind: Wind
  readonly ships: ReadonlyArray<ShipSpawn>
}): MatchState =>
  options.ships.reduce(addShip, {
    tick: 0,
    rng: seedRng(options.seed),
    sea: options.sea,
    wind: options.wind,
    ships: [],
    balls: [],
    pendingShots: [],
    nextBallId: 1,
  })

const noOrders: BroadsideOrders = new Map()

const gunsBySide = {
  port: gunLayout.flatMap((gun, index) => (gun.side === "port" ? [index] : [])),
  starboard: gunLayout.flatMap((gun, index) => (gun.side === "starboard" ? [index] : [])),
}

/**
 * Advances a match by one fixed 30 Hz tick (`SIM_DT`). Pure. Order: helm and sail inputs, broadside orders, guns
 * due in the ripple fire (with recoil), ships move, balls fly and hit or splash, wind.
 */
export const stepMatch = (
  state: MatchState,
  inputs: ShipInputs,
  orders: BroadsideOrders = noOrders,
): { readonly state: MatchState; readonly events: ReadonlyArray<MatchEvent> } => {
  const start = matchTime(state)
  const end = start + SIM_DT
  const events: Array<MatchEvent> = []
  const pending: Array<PendingShot> = [...state.pendingShots]

  let ships = state.ships.map((ship): ShipState => {
    const controlled = { ...ship, controls: inputs.get(ship.id) ?? ship.controls }
    const order = orders.get(ship.id)
    if (!order) return controlled
    const reason = broadsideRefusal(controlled, order.side, order.aimPoint, start)
    if (reason) {
      events.push({ _tag: "broadsideRefused", tick: state.tick, shipId: ship.id, side: order.side, reason })
      return controlled
    }
    for (const gun of gunsBySide[order.side])
      pending.push({ shipId: ship.id, gun, aimPoint: order.aimPoint, at: start + gunLayout[gun]!.rippleDelay })
    return { ...controlled, reloadedAt: { ...controlled.reloadedAt, [order.side]: start + tuning.guns.reload } }
  })

  let rng = state.rng
  let nextBallId = state.nextBallId
  const balls: Array<Cannonball> = [...state.balls]
  const due = pending.filter((shot) => shot.at < end).sort((a, b) => a.at - b.at)
  for (const shot of due) {
    const index = ships.findIndex((ship) => ship.id === shot.shipId)
    const ship = ships[index]
    if (!ship) continue
    const fired = fireGun({ ship, shipTime: start, gun: shot.gun, aimPoint: shot.aimPoint, at: shot.at, id: ballId(nextBallId++), rng })
    rng = fired.rng
    ships = ships.with(index, fired.ship)
    balls.push(fired.ball)
    events.push({ _tag: "cannonFired", tick: state.tick, ball: fired.ball })
  }

  const env = { sea: state.sea, wind: state.wind, time: start }
  const moved = ships.map((ship) => stepShip(ship, env))
  const pairs = ships.map((ship, index) => [ship, moved[index]!] as const)
  const flying: Array<Cannonball> = []
  for (const ball of balls) {
    const outcome = traceBall({ ball, sea: state.sea, from: Math.max(start, ball.firedAt), to: end, ships: pairs, tickStart: start })
    if (!outcome) {
      if (end - ball.firedAt < tuning.guns.maxFlightSeconds) flying.push(ball)
      continue
    }
    if (outcome._tag === "splash") {
      events.push({ _tag: "ballSplash", tick: state.tick, time: outcome.time, ballId: ball.id, point: outcome.point })
      continue
    }
    const index = moved.findIndex((ship) => ship.id === outcome.target)
    const target = moved[index]!
    const hp = Math.max(0, target.hp - tuning.damage.perBall)
    moved[index] = { ...target, hp }
    events.push({
      _tag: "ballHit",
      tick: state.tick,
      time: outcome.time,
      ballId: ball.id,
      shooter: ball.shooter,
      target: outcome.target,
      point: outcome.point,
      localPoint: outcome.localPoint,
      damage: target.hp - hp,
      hp,
    })
  }

  const { wind, rng: windRng } = stepWind(state.wind, rng)
  return {
    state: {
      tick: state.tick + 1,
      rng: windRng,
      sea: state.sea,
      wind,
      ships: moved,
      balls: flying,
      pendingShots: pending.filter((shot) => shot.at >= end),
      nextBallId,
    },
    events,
  }
}
