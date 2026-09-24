import { nextRange, type RngState } from "./rng.ts"
import { SIM_DT, tuning } from "./tuning.ts"
import { directionFromAngle, wrapAngle, type Vec3 } from "./vector.ts"

/** The match wind. Gusts wander speed and direction around the base values, driven by the match RNG. */
export interface Wind {
  /** Yaw angle the wind blows toward (see `directionFromAngle`). */
  readonly toward: number
  /** Current wind speed, m/s. */
  readonly speed: number
  readonly baseToward: number
  readonly baseSpeed: number
  /** Gust strength 0…1; 0 holds the wind steady. */
  readonly gustiness: number
  /** The gust being eased toward, and ticks until the next one is drawn. */
  readonly gust: { readonly speed: number; readonly toward: number; readonly ticksLeft: number }
}

/** A wind blowing toward `toward` at `speed` m/s. */
export const makeWind = (options: { readonly toward: number; readonly speed: number; readonly gustiness: number }): Wind => ({
  toward: options.toward,
  speed: options.speed,
  baseToward: options.toward,
  baseSpeed: options.speed,
  gustiness: options.gustiness,
  gust: { speed: options.speed, toward: options.toward, ticksLeft: 0 },
})

/** Horizontal velocity of the air, m/s. */
export const windVelocity = (wind: Wind): Vec3 => {
  const d = directionFromAngle(wind.toward)
  return { x: d.x * wind.speed, y: 0, z: d.z * wind.speed }
}

/** Advances the wind one tick. */
export const stepWind = (wind: Wind, rng: RngState): { readonly wind: Wind; readonly rng: RngState } => {
  let gust = wind.gust
  if (gust.ticksLeft <= 0) {
    const t = tuning.wind
    const [seconds, r1] = nextRange(rng, t.gustSeconds.min, t.gustSeconds.max)
    const [speed, r2] = nextRange(r1, -t.gustSpeedRange, t.gustSpeedRange)
    const [angle, r3] = nextRange(r2, -t.gustAngleRange, t.gustAngleRange)
    rng = r3
    gust = {
      speed: wind.baseSpeed * (1 + speed * wind.gustiness),
      toward: wind.baseToward + angle * wind.gustiness,
      ticksLeft: Math.round(seconds / SIM_DT),
    }
  }
  const follow = SIM_DT / tuning.wind.gustResponseSeconds
  return {
    wind: {
      ...wind,
      speed: wind.speed + (gust.speed - wind.speed) * follow,
      toward: wind.toward + wrapAngle(gust.toward - wind.toward) * follow,
      gust: { ...gust, ticksLeft: gust.ticksLeft - 1 },
    },
    rng,
  }
}

/** Angle between a heading and the direction the wind comes from: 0 head to wind, π running. */
export const angleOffWind = (heading: number, wind: Wind): number => Math.abs(wrapAngle(heading - (wind.toward + Math.PI)))

const interpolate = <K extends string, V extends string>(
  table: ReadonlyArray<{ readonly [key in K | V]: number }>,
  key: K,
  value: V,
  at: number,
): number => {
  const first = table[0]
  if (first === undefined) return 0
  if (at <= first[key]) return first[value]
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1]
    const b = table[i]
    if (a !== undefined && b !== undefined && at <= b[key]) {
      const u = (at - a[key]) / (b[key] - a[key])
      const smooth = u * u * (3 - 2 * u)
      return a[value] + (b[value] - a[value]) * smooth
    }
  }
  return table[table.length - 1]?.[value] ?? 0
}

/** Drive factor by point of sail: ~0.2 close to the wind, 1 on a beam reach, 0.8 running. */
export const sailDriveFactor = (angleOff: number): number => interpolate(tuning.sail.driveByAngle, "angle", "factor", angleOff)

/** Heeling side-force share by point of sail: largest close-hauled, none running. */
export const sailSideFactor = (angleOff: number): number => interpolate(tuning.sail.sideByAngle, "angle", "factor", angleOff)

/** Speed fraction a sail set (0…1) is tuned to reach. */
export const sailSpeedFactor = (set: number): number => interpolate(tuning.sail.speedBySet, "set", "speed", set)
