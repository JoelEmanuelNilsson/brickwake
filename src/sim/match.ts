import { decideBotControls, drawBotSkill, type Bot } from "./bots.ts"
import { collideShips } from "./collision.ts"
import { gunLayout, type BroadsideSide } from "./gun-layout.ts"
import { ballId, broadsideRefusal, fireGun, traceBall, type BallId, type BroadsideRefusal, type Cannonball } from "./gunnery.ts"
import type { SeaState } from "./ocean.ts"
import { seedRng, type RngState } from "./rng.ts"
import {
  allies,
  ffaRules,
  noTeamSinks,
  openingPhase,
  scoreLimitReached,
  scoreSink,
  teamFor,
  teams,
  winnerOf,
  type MatchPhase,
  type MatchRules,
  type TeamSinks,
} from "./rules.ts"
import { makeShip, shipId, stepShip, type ShipControls, type ShipId, type ShipState, type Team } from "./ship.ts"
import { SIM_DT, tuning } from "./tuning.ts"
import type { Vec3 } from "./vector.ts"
import { stepWind, type Wind } from "./wind.ts"

/** Everything that decides a match's outcome. Replays exactly from its seed and the inputs per tick. */
export interface MatchState {
  readonly tick: number
  readonly rules: MatchRules
  readonly phase: MatchPhase
  readonly rng: RngState
  readonly sea: SeaState
  readonly wind: Wind
  readonly ships: ReadonlyArray<ShipState>
  /** Sinks each side has scored; stays at zero in FFA. */
  readonly teamSinks: TeamSinks
  /** Balls in flight. */
  readonly balls: ReadonlyArray<Cannonball>
  /** Guns of ordered broadsides still waiting for their turn in the ripple. */
  readonly pendingShots: ReadonlyArray<PendingShot>
  /** Id the next fired ball takes. */
  readonly nextBallId: number
  /** Ships the sim captains itself; `stepMatch` decides their controls. */
  readonly bots: ReadonlyArray<Bot>
  /** Bots that have ever joined; names the next one. */
  readonly botsJoined: number
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
  /** A ship's HP reached 0 at `time`; it founders. `by` is the ship whose ball did it. */
  | { readonly _tag: "shipSunk"; readonly tick: number; readonly time: number; readonly shipId: ShipId; readonly by: ShipId | undefined }
  /** A ship re-entered the match on the spawn ring: after sinking, or at a restart. */
  | { readonly _tag: "shipRespawned"; readonly tick: number; readonly shipId: ShipId }

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
  /** The ship's TDM side; left out, the ship takes the side `joiningTeam` picks. */
  readonly team?: Team
}

/** Sim time of a match state, seconds. */
export const matchTime = (state: MatchState): number => state.tick * SIM_DT

/** The TDM side the next ship to join takes; undefined in FFA. */
export const joiningTeam = (state: MatchState): Team | undefined =>
  teamFor(state.rules, state.ships, (id) => state.bots.some((bot) => bot.id === id))

/** Adds a ship at rest on the water. */
export const addShip = (state: MatchState, spawn: ShipSpawn): MatchState => ({
  ...state,
  ships: [...state.ships, makeShip({ ...spawn, team: spawn.team ?? joiningTeam(state) }, state.sea, matchTime(state))],
})

/** Takes a ship out of the match; unknown ids leave the state unchanged. */
export const removeShip = (state: MatchState, id: ShipId): MatchState => ({
  ...state,
  ships: state.ships.filter((ship) => ship.id !== id),
  pendingShots: state.pendingShots.filter((shot) => shot.shipId !== id),
  bots: state.bots.filter((bot) => bot.id !== id).map((bot) => (bot.target === id ? { ...bot, target: undefined } : bot)),
})

/**
 * Tops the match up with bots to `fillTo` ships, or sends bots home (from the larger TDM side, foundered ones first,
 * then the newest) while there are more ships than that. Call after every human joins or leaves. Bots take the side `joiningTeam` picks.
 */
export const balanceBots = (state: MatchState, fillTo: number = tuning.bots.fillTo): MatchState => {
  let next = state
  while (next.ships.length < fillTo) {
    const id = shipId(`bot-${next.botsJoined + 1}`)
    const { skill, rng } = drawBotSkill(next.rng)
    next = addShip({ ...next, rng, bots: [...next.bots, { id, skill, target: undefined }], botsJoined: next.botsJoined + 1 }, spawnPoint(next, id))
  }
  while (next.ships.length > fillTo && next.bots.length > 0) {
    const shipOf = (bot: Bot) => next.ships.find((ship) => ship.id === bot.id)
    const sides = teams.map((team) => next.ships.filter((ship) => ship.team === team).length)
    const larger = sides[0] === sides[1] ? undefined : teams[sides[0]! > sides[1]! ? 0 : 1]
    const onLarger = next.bots.filter((bot) => larger === undefined || shipOf(bot)?.team === larger)
    const pool = onLarger.length > 0 ? onLarger : next.bots
    const leaving = pool.find((bot) => shipOf(bot)?.life._tag !== "afloat") ?? pool[pool.length - 1]!
    next = removeShip(next, leaving.id)
  }
  return next
}

/**
 * Where a joining ship starts: the spawn-ring slot farthest from every ship already afloat, bow
 * across the base wind so setting sail gives a beam reach at once. A TDM side spawns on its own half of the ring.
 */
export const spawnPoint = (state: MatchState, id: ShipId, team: Team | undefined = joiningTeam(state)): ShipSpawn => {
  const { radius, slots } = tuning.match.spawnRing
  const half = slots / 2
  const first = team === "navy" ? half : 0
  const count = team === undefined ? slots : half
  const clearance = (slot: number) => {
    const angle = (2 * Math.PI * slot) / slots
    const x = radius * Math.cos(angle)
    const z = radius * Math.sin(angle)
    return state.ships.reduce((nearest, ship) => Math.min(nearest, Math.hypot(ship.position.x - x, ship.position.z - z)), Infinity)
  }
  let best = first
  for (let slot = first + 1; slot < first + count; slot++) if (clearance(slot) > clearance(best)) best = slot
  const angle = (2 * Math.PI * best) / slots
  const spawn = { id, x: radius * Math.cos(angle), z: radius * Math.sin(angle), heading: state.wind.baseToward + Math.PI / 2 }
  return team === undefined ? spawn : { ...spawn, team }
}

/** A match at tick 0, in warmup or, when `rules` has none, in play. Rules default to FFA quick play. */
export const createMatch = (options: {
  readonly seed: number
  readonly rules?: MatchRules
  readonly sea: SeaState
  readonly wind: Wind
  readonly ships: ReadonlyArray<ShipSpawn>
}): MatchState =>
  options.ships.reduce(addShip, {
    tick: 0,
    rules: options.rules ?? ffaRules,
    phase: openingPhase(options.rules ?? ffaRules, 0),
    rng: seedRng(options.seed),
    sea: options.sea,
    wind: options.wind,
    ships: [],
    teamSinks: noTeamSinks,
    balls: [],
    pendingShots: [],
    nextBallId: 1,
    bots: [],
    botsJoined: 0,
  })

const noOrders: BroadsideOrders = new Map()

const gunsBySide = {
  port: gunLayout.flatMap((gun, index) => (gun.side === "port" ? [index] : [])),
  starboard: gunLayout.flatMap((gun, index) => (gun.side === "starboard" ? [index] : [])),
}

const isAfloat = (ship: ShipState) => ship.life._tag === "afloat"
const unscored = { kills: 0, deaths: 0, shots: 0, hits: 0, damage: 0 } as const
const isAbove = (ship: ShipState) => ship.life._tag !== "sunk"

/** The ship back on the spawn ring at `time`, clear of every ship still above water, keeping its side and score. */
const respawn = (state: MatchState, ships: ReadonlyArray<ShipState>, ship: ShipState, time: number): ShipState => {
  const clear = ships.filter((other) => other.id !== ship.id && isAbove(other))
  const fresh = makeShip(spawnPoint({ ...state, ships: clear }, ship.id, ship.team), state.sea, time)
  const { kills, deaths, shots, hits, damage } = ship
  return { ...fresh, spawn: ship.spawn + 1, kills, deaths, shots, hits, damage }
}

/**
 * Advances a match by one fixed 30 Hz tick (`SIM_DT`). Pure. Order: bots decide, helm and sail inputs, broadside orders, guns
 * due in the ripple fire (with recoil), ships move and push apart, balls fly and hit or splash, sinks score, sinking
 * ships go under and sunk ones respawn, the match phase advances, wind.
 */
export const stepMatch = (
  state: MatchState,
  inputs: ShipInputs,
  orders: BroadsideOrders = noOrders,
): { readonly state: MatchState; readonly events: ReadonlyArray<MatchEvent> } => {
  const start = matchTime(state)
  const end = start + SIM_DT
  const events: Array<MatchEvent> = []
  let pending: Array<PendingShot> = [...state.pendingShots]
  let teamSinks = state.teamSinks
  const gunsManned = state.phase._tag !== "ended"
  const helms = new Map(inputs)
  const broadsides = new Map(orders)
  const bots = state.bots.map((bot) => {
    const decision = decideBotControls(state, bot.id)
    if (!decision) return bot
    helms.set(bot.id, decision.controls)
    if (decision.order) broadsides.set(bot.id, decision.order)
    else broadsides.delete(bot.id)
    return { ...bot, target: decision.target }
  })

  let ships = state.ships.map((ship): ShipState => {
    if (!isAfloat(ship)) return ship
    const controlled = { ...ship, controls: helms.get(ship.id) ?? ship.controls }
    const order = gunsManned ? broadsides.get(ship.id) : undefined
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
    ships = ships.with(index, { ...fired.ship, shots: fired.ship.shots + 1 })
    balls.push(fired.ball)
    events.push({ _tag: "cannonFired", tick: state.tick, ball: fired.ball })
  }
  pending = pending.filter((shot) => shot.at >= end)

  const env = { sea: state.sea, wind: state.wind, time: start }
  // Sunk hulls keep falling through the water until they respawn, so a ship never stops mid-plunge on screen.
  let moved = collideShips(
    ships.map((ship) => stepShip(ship, env)),
    isAbove,
  )
  // A foundering hull still stops balls (they strike it for no damage); a sunk one is under the sea.
  const pairs = ships.flatMap((ship, index) => (isAbove(ship) ? [[ship, moved[index]!] as const] : []))
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
    const shooter = moved.findIndex((ship) => ship.id === ball.shooter)
    const friendly = shooter >= 0 && allies(moved[shooter]!, target)
    const hp = isAfloat(target) && !friendly ? Math.max(0, target.hp - tuning.damage.perBall) : target.hp
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
    if (shooter >= 0 && hp < target.hp) {
      const credited = moved[shooter]!
      moved = moved.with(shooter, { ...credited, hits: credited.hits + 1, damage: credited.damage + target.hp - hp })
    }
    if (hp > 0 || !isAfloat(target)) {
      moved = moved.with(index, { ...target, hp })
      continue
    }
    // The end the killing ball struck floods first, so the ship goes down by the bow or the stern.
    const floodEnd = outcome.localPoint.x >= 0 ? 1 : -1
    moved = moved.with(index, { ...target, hp, life: { _tag: "sinking", since: outcome.time, floodEnd }, controls: { rudder: 0, sail: 0 } })
    pending = pending.filter((shot) => shot.shipId !== target.id)
    const by = moved.some((ship) => ship.id === ball.shooter) ? ball.shooter : undefined
    events.push({ _tag: "shipSunk", tick: state.tick, time: outcome.time, shipId: target.id, by })
    if (state.phase._tag === "playing") ({ ships: moved, teamSinks } = scoreSink(state.rules, { ships: moved, teamSinks }, target.id, by))
  }

  const { seconds: sinkSeconds, respawnSeconds } = tuning.sinking
  moved = moved.map((ship) =>
    ship.life._tag === "sinking" && end >= ship.life.since + sinkSeconds
      ? { ...ship, life: { _tag: "sunk", respawnAt: ship.life.since + sinkSeconds + respawnSeconds } }
      : ship,
  )
  for (let index = 0; index < moved.length; index++) {
    const ship = moved[index]!
    if (ship.life._tag !== "sunk" || end < ship.life.respawnAt) continue
    moved = moved.with(index, respawn(state, moved, ship, end))
    events.push({ _tag: "shipRespawned", tick: state.tick, shipId: ship.id })
  }

  let phase = state.phase
  let live = flying
  switch (phase._tag) {
    case "warmup":
      if (end < phase.endsAt) break
      phase = { _tag: "playing", endsAt: end + state.rules.timeLimit }
      moved = moved.map((ship) => ({ ...ship, ...unscored, hp: isAfloat(ship) ? tuning.damage.hullHp : ship.hp }))
      teamSinks = noTeamSinks
      break
    case "playing":
      if (end < phase.endsAt && !scoreLimitReached(state.rules, { ships: moved, teamSinks })) break
      phase = { _tag: "ended", restartAt: end + state.rules.endedSeconds, winner: winnerOf(state.rules, { ships: moved, teamSinks }) }
      break
    case "ended": {
      if (end < phase.restartAt) break
      phase = openingPhase(state.rules, end)
      const placed: Array<ShipState> = []
      for (const ship of moved) {
        placed.push({ ...respawn(state, placed, ship, end), ...unscored })
        events.push({ _tag: "shipRespawned", tick: state.tick, shipId: ship.id })
      }
      moved = placed
      teamSinks = noTeamSinks
      live = []
      pending = []
      break
    }
  }

  const { wind, rng: windRng } = stepWind(state.wind, rng)
  return {
    state: {
      tick: state.tick + 1,
      rules: state.rules,
      phase,
      rng: windRng,
      sea: state.sea,
      wind,
      ships: moved,
      teamSinks,
      balls: live,
      pendingShots: pending,
      nextBallId,
      bots,
      botsJoined: state.botsJoined,
    },
    events,
  }
}
