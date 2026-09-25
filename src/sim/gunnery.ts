import { gunLayout, type BroadsideSide, type GunMount } from "./gun-layout.ts"
import { sampleOcean, type SeaState } from "./ocean.ts"
import { nextRange, type RngState } from "./rng.ts"
import { applyImpulse, shipPointToWorld, shipPointVelocity, type ShipId, type ShipState } from "./ship.ts"
import { tuning } from "./tuning.ts"
import { galleonClass, shipWreck } from "./wreck.ts"
import { add, integrateQuat, length, rotate, rotateInverse, scale, sub, vec3, type Vec3 } from "./vector.ts"

declare const ballIdBrand: unique symbol

/** Identifies a cannonball within a match. */
export type BallId = number & { readonly [ballIdBrand]: true }

/** Brands an integer as a BallId. */
export const ballId = (id: number): BallId =>
  // SAFETY: any integer names a ball; the brand only keeps ball ids from mixing with other numbers.
  id as BallId

/** One ball in flight. Its whole path follows from these fields through `ballPositionAt`. */
export interface Cannonball {
  readonly id: BallId
  readonly shooter: ShipId
  /** Index into `gunLayout` of the gun that fired it. */
  readonly gun: number
  /** World position at `firedAt`. */
  readonly origin: Vec3
  /** World velocity at `firedAt`: muzzle speed along the barrel plus the gun's own velocity. */
  readonly velocity: Vec3
  /** Sim time the ball left the muzzle, seconds; not tick-aligned, because broadsides ripple 50 ms apart. */
  readonly firedAt: number
}

/** Why a broadside order is refused. */
export type BroadsideRefusal = "reloading" | "out-of-arc" | "out-of-range"

/** A barrel's lay in its mount frame, radians: elevation above the deck plane, traverse toward the bow from straight out. */
export interface GunLay {
  readonly elevation: number
  readonly traverse: number
}

/** One gun laid on an aim point from a ship pose. */
export interface GunAim {
  /** The lay the gun takes, inside its limits. */
  readonly lay: GunLay
  /** Whether the limits cut the lay short, so the ball will not pass through the aim point. */
  readonly clamped: boolean
  /** World muzzle position and the velocity it moves with, which the ball inherits. */
  readonly muzzle: Vec3
  readonly muzzleVelocity: Vec3
  /** World unit vector along the barrel. */
  readonly barrel: Vec3
  /** Seconds from firing to the aim point; undefined when clamped. */
  readonly flightTime: number | undefined
}

const gravity = vec3(0, -tuning.physics.gravity, 0)
const drag: number = tuning.guns.airDrag

// Integrals of the drag-damped motion over τ seconds: how far a unit initial velocity carries, and the
// matching gravity term, so position = origin + velocity·carry + gravity·fall.
const flightTerms = (tau: number) => {
  if (drag === 0) return { carry: tau, fall: (tau * tau) / 2 }
  const carry = -Math.expm1(-drag * tau) / drag
  return { carry, fall: (tau - carry) / drag }
}

/** Writes `ballPositionAt(ball, t)` into `out` without allocating, for the client's per-frame ball rendering. */
export const writeBallPosition = (ball: Cannonball, t: number, out: { x: number; y: number; z: number }): void => {
  const tau = Math.max(0, t - ball.firedAt)
  const carry = drag === 0 ? tau : -Math.expm1(-drag * tau) / drag
  const fall = drag === 0 ? (tau * tau) / 2 : (tau - carry) / drag
  out.x = ball.origin.x + ball.velocity.x * carry + gravity.x * fall
  out.y = ball.origin.y + ball.velocity.y * carry + gravity.y * fall
  out.z = ball.origin.z + ball.velocity.z * carry + gravity.z * fall
}

/** World position of a ball at sim time `t` seconds (its origin before it is fired). Shared by the sim's hit sweep and client rendering. */
export const ballPositionAt = (ball: Cannonball, t: number): Vec3 => {
  const out = vec3(0, 0, 0)
  writeBallPosition(ball, t, out)
  return out
}

/** World velocity of a ball at sim time `t` seconds. */
export const ballVelocityAt = (ball: Cannonball, t: number): Vec3 => {
  const tau = Math.max(0, t - ball.firedAt)
  const decay = Math.exp(-drag * tau)
  return add(scale(ball.velocity, decay), scale(gravity, drag === 0 ? tau : -Math.expm1(-drag * tau) / drag))
}

const scanStep = 1 / 60
const bisections = 50

/**
 * The low-arc launch that carries a ball from `origin`, moving with `carried`, through `target`: the unit barrel
 * direction and the flight time. Undefined when the target is beyond ballistic reach.
 */
export const solveLaunch = (
  origin: Vec3,
  carried: Vec3,
  target: Vec3,
): { readonly direction: Vec3; readonly flightTime: number } | undefined => {
  const offset = sub(target, origin)
  // What the muzzle-speed part must cover in T seconds, and how far it can.
  const needed = (tau: number) => {
    const { carry, fall } = flightTerms(tau)
    return sub(offset, add(scale(carried, carry), scale(gravity, fall)))
  }
  const gap = (tau: number) => length(needed(tau)) - tuning.guns.muzzleSpeed * flightTerms(tau).carry
  let low = 0
  let high = scanStep
  while (gap(high) > 0) {
    low = high
    high += scanStep
    if (high > tuning.guns.maxFlightSeconds) return undefined
  }
  for (let i = 0; i < bisections; i++) {
    const mid = (low + high) / 2
    if (gap(mid) > 0) low = mid
    else high = mid
  }
  const need = needed(high)
  const reach = length(need)
  return reach === 0 ? undefined : { direction: scale(need, 1 / reach), flightTime: high }
}

const layOf = (ship: ShipState, gun: GunMount, world: Vec3): GunLay => {
  const local = rotateInverse(ship.orientation, world)
  const out = gun.outward.z
  return {
    elevation: Math.asin(Math.max(-1, Math.min(1, local.y))),
    traverse: Math.atan2(local.x, out * local.z),
  }
}

const barrelOf = (ship: ShipState, gun: GunMount, lay: GunLay): Vec3 => {
  const flat = Math.cos(lay.elevation)
  return rotate(ship.orientation, vec3(flat * Math.sin(lay.traverse), Math.sin(lay.elevation), gun.outward.z * flat * Math.cos(lay.traverse)))
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/**
 * Lays one gun on a world aim point: solves the arc from the gun's current pose and velocity, then clamps to the
 * elevation and traverse limits. Out of reach, the gun takes full elevation on the aim bearing. Player, bots and
 * the gunport view all use this.
 */
export const aimGun = (ship: ShipState, gun: GunMount, aimPoint: Vec3): GunAim => {
  const muzzle = shipPointToWorld(ship, gun.position)
  const muzzleVelocity = shipPointVelocity(ship, gun.position)
  const solution = solveLaunch(muzzle, muzzleVelocity, aimPoint)
  const { elevation: limits, traverse: arc } = tuning.guns
  const wanted = solution
    ? layOf(ship, gun, solution.direction)
    : { ...layOf(ship, gun, sub(aimPoint, muzzle)), elevation: limits.max }
  const lay = { elevation: clamp(wanted.elevation, limits.min, limits.max), traverse: clamp(wanted.traverse, -arc, arc) }
  const clamped = !solution || lay.elevation !== wanted.elevation || lay.traverse !== wanted.traverse
  return {
    lay,
    clamped,
    muzzle,
    muzzleVelocity,
    barrel: solution && !clamped ? solution.direction : barrelOf(ship, gun, lay),
    flightTime: clamped ? undefined : solution?.flightTime,
  }
}

const batteryCentre = (side: BroadsideSide): GunMount => {
  const guns = gunLayout.filter((gun) => gun.side === side)
  const mean = scale(guns.reduce((sum, gun) => add(sum, gun.position), vec3(0, 0, 0)), 1 / guns.length)
  return { ...guns[0]!, position: mean, rippleDelay: 0 }
}

const batteries = { port: batteryCentre("port"), starboard: batteryCentre("starboard") }

/**
 * Why `ship` cannot fire its `side` broadside at `aimPoint` at sim time `time`, or undefined when it can. Arc and
 * range are judged from the middle of the battery; each gun then lays itself. The sim, client reticle and bots share it.
 */
export const broadsideRefusal = (
  ship: ShipState,
  side: BroadsideSide,
  aimPoint: Vec3,
  time: number,
): BroadsideRefusal | undefined => {
  if (time < ship.reloadedAt[side]) return "reloading"
  const centre = batteries[side]
  const muzzle = shipPointToWorld(ship, centre.position)
  const solution = solveLaunch(muzzle, shipPointVelocity(ship, centre.position), aimPoint)
  const lay = layOf(ship, centre, solution ? solution.direction : sub(aimPoint, muzzle))
  if (Math.abs(lay.traverse) > tuning.guns.traverse) return "out-of-arc"
  if (!solution || lay.elevation > tuning.guns.elevation.max) return "out-of-range"
  return undefined
}

/** A ship's pose `dt` seconds on, extrapolated from its velocities; for events between ticks. */
export const extrapolateShip = (ship: ShipState, dt: number): ShipState =>
  dt === 0
    ? ship
    : {
        ...ship,
        position: add(ship.position, scale(ship.velocity, dt)),
        orientation: integrateQuat(ship.orientation, ship.angularVelocity, dt),
      }

/**
 * Fires one gun at sim time `at`: lays it from the ship's pose then, adds spread from the match RNG, and pushes the
 * ship back with the recoil. `ship` is the state at `shipTime` (the tick start).
 */
export const fireGun = (options: {
  readonly ship: ShipState
  readonly shipTime: number
  readonly gun: number
  readonly aimPoint: Vec3
  readonly at: number
  readonly id: BallId
  readonly rng: RngState
}): { readonly ball: Cannonball; readonly ship: ShipState; readonly rng: RngState } => {
  const mount = gunLayout[options.gun]!
  const pose = extrapolateShip(options.ship, options.at - options.shipTime)
  const aim = aimGun(pose, mount, options.aimPoint)
  const spread = tuning.guns.spread
  const [bearing, rng1] = nextRange(options.rng, 0, 2 * Math.PI)
  const [area, rng] = nextRange(rng1, 0, 1)
  const error = spread * Math.sqrt(area)
  const barrel = barrelOf(pose, mount, {
    elevation: aim.lay.elevation + error * Math.sin(bearing),
    traverse: aim.lay.traverse + error * Math.cos(bearing),
  })
  const ball: Cannonball = {
    id: options.id,
    shooter: options.ship.id,
    gun: options.gun,
    origin: aim.muzzle,
    velocity: add(aim.muzzleVelocity, scale(barrel, tuning.guns.muzzleSpeed)),
    firedAt: options.at,
  }
  const ship = applyImpulse(options.ship, mount.position, scale(barrel, -tuning.guns.recoilImpulse))
  return { ball, ship, rng }
}

/** Fraction 0…1 along segment a→b where it first enters the box [min, max], or undefined when it misses. */
export const segmentBoxEntry = (a: Vec3, b: Vec3, min: Vec3, max: Vec3): number | undefined => {
  let enter = 0
  let exit = 1
  for (const axis of ["x", "y", "z"] as const) {
    const d = b[axis] - a[axis]
    if (d === 0) {
      if (a[axis] < min[axis] || a[axis] > max[axis]) return undefined
      continue
    }
    const t0 = (min[axis] - a[axis]) / d
    const t1 = (max[axis] - a[axis]) / d
    enter = Math.max(enter, Math.min(t0, t1))
    exit = Math.min(exit, Math.max(t0, t1))
    if (enter > exit) return undefined
  }
  return enter
}

/** How a ball's flight ended. `direction` is the ball's ship-local unit direction into the target. */
export type BallOutcome =
  | {
      readonly _tag: "hit"
      readonly time: number
      readonly target: ShipId
      readonly point: Vec3
      readonly localPoint: Vec3
      readonly direction: Vec3
    }
  | { readonly _tag: "splash"; readonly time: number; readonly point: Vec3 }

/** A ball passing through one of `target`'s set sails at `time`; it flies on. */
export interface SailStrike {
  readonly time: number
  readonly target: ShipId
  readonly point: Vec3
  readonly localPoint: Vec3
}

/** Where one tick of a ball's flight went: sails it passed through, in time order, and how it ended, if it did. */
export interface BallTrace {
  readonly sails: ReadonlyArray<SailStrike>
  readonly end: BallOutcome | undefined
}

const toLocal = (ship: ShipState, world: Vec3) => rotateInverse(ship.orientation, sub(world, ship.position))

const splashBisections = 24

/**
 * Follows a ball from `from` to `to` sim seconds. Each other ship is swept in its own frame, from its pose at the
 * start (extrapolated if the ball was fired mid-tick) to its pose at the end, so fast balls and moving hulls cannot
 * tunnel. A box around the ship's parts and sails is the broad phase; the parts still on the ship (`removedParts`)
 * decide the hit, so a ball flies on through a hole or over a shot-away rail. Set sails it crosses are struck and
 * passed through. The earlier of a part hit and the wave-surface crossing ends the flight.
 */
export const traceBall = (options: {
  readonly ball: Cannonball
  readonly sea: SeaState
  readonly from: number
  readonly to: number
  /** Every ship at the tick start and at its end, same order; the end state carries its current damage. */
  readonly ships: ReadonlyArray<readonly [start: ShipState, end: ShipState]>
  readonly tickStart: number
}): BallTrace => {
  const { ball, sea, from, to } = options
  const a = ballPositionAt(ball, from)
  const b = ballPositionAt(ball, to)
  const hull = galleonClass()
  let hit: Extract<BallOutcome, { _tag: "hit" }> | undefined
  const sails: Array<SailStrike> = []
  for (const [start, end] of options.ships) {
    if (start.id === ball.shooter) continue
    const localA = toLocal(extrapolateShip(start, from - options.tickStart), a)
    const localB = toLocal(end, b)
    if (segmentBoxEntry(localA, localB, hull.min, hull.max) === undefined) continue
    const chord = sub(localB, localA)
    const span = length(chord)
    if (span === 0) continue
    const direction = scale(chord, 1 / span)
    const wreck = shipWreck(end.removedParts)
    const along = wreck.firstPartAlong(localA, direction, span)
    if (along !== undefined) {
      const time = from + (along / span) * (to - from)
      if (!hit || time < hit.time)
        hit = { _tag: "hit", time, target: start.id, point: ballPositionAt(ball, time), localPoint: add(localA, scale(direction, along)), direction }
    }
    if (end.sailSet <= 0) continue
    for (const sail of hull.sails) {
      const before = localA.x - sail.x
      const after = localB.x - sail.x
      if (before < 0 === after < 0 || (sail.yardPart >= 0 && !wreck.isPresent(sail.yardPart))) continue
      const f = before / (before - after)
      const at = add(localA, scale(chord, f))
      const foot = sail.top - (sail.top - sail.foot) * Math.min(1, end.sailSet)
      if (at.y < foot || at.y > sail.top) continue
      const half = sail.footHalf + ((sail.topHalf - sail.footHalf) * (at.y - sail.foot)) / (sail.top - sail.foot)
      if (Math.abs(at.z) > half) continue
      const time = from + f * (to - from)
      sails.push({ time, target: start.id, point: ballPositionAt(ball, time), localPoint: at })
    }
  }
  const above = (t: number) => {
    const p = ballPositionAt(ball, t)
    return p.y - sampleOcean(sea, p.x, p.z, t).height
  }
  let ended: BallOutcome | undefined = hit
  if (above(to) < 0) {
    let low = from
    let high = to
    if (above(from) < 0) high = from
    else
      for (let i = 0; i < splashBisections; i++) {
        const mid = (low + high) / 2
        if (above(mid) >= 0) low = mid
        else high = mid
      }
    if (!hit || hit.time > high) ended = { _tag: "splash", time: high, point: ballPositionAt(ball, high) }
  }
  const endTime = ended?.time ?? Infinity
  return { sails: sails.filter((sail) => sail.time < endTime).sort((p, q) => p.time - q.time), end: ended }
}
