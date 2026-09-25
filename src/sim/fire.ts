import { nextRandom, nextRange, type RngState } from "./rng.ts"
import type { ShipId } from "./ship.ts"
import { tuning } from "./tuning.ts"
import { vec3, type Vec3 } from "./vector.ts"

/** A fire burning on a ship: where (ship-local), when it caught and burns out (sim seconds), and whose ball started it. */
export interface ShipFire {
  readonly localPoint: Vec3
  readonly since: number
  readonly endsAt: number
  /** Credited with the HP it burns and with the sink when it burns the ship to 0. */
  readonly by: ShipId
}

/** Chance a ball that took `damage` HP after flying `range` metres sets its target alight (see `tuning.fire`). */
export const igniteChance = (damage: number, range: number): number => {
  const { perHp, referenceRange, rangeFactor } = tuning.fire
  const closeness = Math.max(rangeFactor.min, Math.min(rangeFactor.max, referenceRange / Math.max(1, range)))
  return perHp * damage * closeness
}

/** A fire catching at ship-local `at` at sim time `time`, started by `by`. */
export const catchFire = (at: Vec3, by: ShipId, time: number): ShipFire => {
  const halfLength = tuning.hull.hitBox.length / 2 - 2
  return {
    localPoint: vec3(Math.max(-halfLength, Math.min(halfLength, at.x)), Math.max(tuning.fire.minHeight, at.y), at.z),
    since: time,
    endsAt: time + tuning.fire.seconds,
    by,
  }
}

/**
 * A ball struck a ship's hull or upper works for `damage` HP at ship-local `at`: it may set a fire there, if the ship
 * has room for another. Draws from `rng` only when it could.
 */
export const igniteFromHit = (
  fires: ReadonlyArray<ShipFire>,
  hit: { readonly at: Vec3; readonly damage: number; readonly range: number; readonly by: ShipId; readonly time: number },
  rng: RngState,
): { readonly fires: ReadonlyArray<ShipFire>; readonly rng: RngState } => {
  if (hit.damage <= 0 || fires.length >= tuning.fire.maxPerShip) return { fires, rng }
  const [u, next] = nextRandom(rng)
  return u < igniteChance(hit.damage, hit.range) ? { fires: [...fires, catchFire(hit.at, hit.by, hit.time)], rng: next } : { fires, rng: next }
}

/**
 * A ship's fires over the tick from `start` to `end`: `burns` are the fires that took `tuning.fire.hpPerBurn` HP in it
 * (one per `burnInterval` of each fire's life), `fires` those still alight after it, with any spread this tick.
 */
export const burnFires = (
  fires: ReadonlyArray<ShipFire>,
  start: number,
  end: number,
  rng: RngState,
): { readonly burns: ReadonlyArray<ShipFire>; readonly fires: ReadonlyArray<ShipFire>; readonly rng: RngState } => {
  if (fires.length === 0) return { burns: fires, fires, rng }
  const { burnInterval, spreadAfter, spreadPerSecond, spreadDistance, maxPerShip } = tuning.fire
  const burns: Array<ShipFire> = []
  const alight: Array<ShipFire> = []
  let next = rng
  for (const fire of fires) {
    const upTo = Math.min(end, fire.endsAt)
    if (Math.floor((upTo - fire.since) / burnInterval) > Math.floor((start - fire.since) / burnInterval) && upTo > start) burns.push(fire)
    if (fire.endsAt > end) alight.push(fire)
  }
  const spreading = alight.length
  for (let i = 0; i < spreading && alight.length < maxPerShip; i++) {
    const fire = alight[i]!
    if (end - fire.since < spreadAfter) continue
    const [u, afterChance] = nextRandom(next)
    next = afterChance
    if (u >= spreadPerSecond * (end - start)) continue
    const [along, afterAlong] = nextRange(next, -spreadDistance.max, spreadDistance.max)
    next = afterAlong
    const step = Math.sign(along) * Math.max(spreadDistance.min, Math.abs(along))
    alight.push(catchFire(vec3(fire.localPoint.x + step, fire.localPoint.y, fire.localPoint.z), fire.by, end))
  }
  return { burns, fires: alight, rng: next }
}
