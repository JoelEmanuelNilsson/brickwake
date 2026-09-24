import { tuning } from "./tuning.ts"
import { directionFromAngle, normalize, vec3, type Vec3 } from "./vector.ts"

/** One Gerstner wave component. */
export interface OceanWave {
  /** Yaw angle the wave travels toward (see `directionFromAngle`). */
  readonly direction: number
  /** Crest-to-crest distance in metres; the period follows from deep-water dispersion. */
  readonly wavelength: number
  /** Crest height above mean level in metres. */
  readonly amplitude: number
  /** Horizontal orbit as a fraction of `amplitude`: 0 a pure sine, 1 a trochoid with circular orbits as in real water. Sharpens crests. */
  readonly sharpness: number
  /** Phase offset in radians. */
  readonly phase: number
}

/** The sea of one match: a sum of Gerstner waves. Plain data, sent to clients with the match. */
export interface SeaState {
  readonly waves: ReadonlyArray<OceanWave>
}

/** The water surface at one horizontal point and time. */
export interface OceanSample {
  /** Surface height (world y) in metres. */
  readonly height: number
  /** Unit surface normal. */
  readonly normal: Vec3
  /** Velocity of the water at the surface in m/s. */
  readonly velocity: Vec3
}

const waveNumber = (wave: OceanWave) => (2 * Math.PI) / wave.wavelength

/** Crest steepness Q·k·A of one wave; summed over a sea it must stay below 1 or the surface loops over. */
const steepness = (wave: OceanWave) => wave.sharpness * waveNumber(wave) * wave.amplitude

/** Builds a sea, rejecting one whose crests would loop over (a programming error). */
export const makeSea = (waves: ReadonlyArray<OceanWave>): SeaState => {
  const total = waves.reduce((sum, wave) => sum + steepness(wave), 0)
  if (!(total < 1) || waves.some((wave) => wave.sharpness < 0 || wave.sharpness > 1)) {
    throw new Error(`sea steepness sums to ${total}; it must stay below 1 with each sharpness in 0…1`)
  }
  return { waves }
}

/** Angular frequency of a wave in rad/s (deep water: ω² = g·k). */
export const waveAngularFrequency = (wave: OceanWave): number => Math.sqrt(tuning.physics.gravity * waveNumber(wave))

/**
 * Where the water particle at rest position (x0, z0) is at time t. The client displaces its water
 * mesh with this, so the drawn surface is the one `sampleOcean` reports.
 */
export const gerstnerPoint = (sea: SeaState, x0: number, z0: number, t: number): Vec3 => {
  let x = x0
  let y = 0
  let z = z0
  for (const wave of sea.waves) {
    const k = waveNumber(wave)
    const d = directionFromAngle(wave.direction)
    const theta = k * (d.x * x0 + d.z * z0) - waveAngularFrequency(wave) * t + wave.phase
    const sway = wave.sharpness * wave.amplitude * Math.sin(theta)
    x -= d.x * sway
    z -= d.z * sway
    y += wave.amplitude * Math.cos(theta)
  }
  return vec3(x, y, z)
}

const inversionIterations = 4

/** Samples the water surface above world point (x, z) at sim time t seconds. Pure; shared by sim and client. */
export const sampleOcean = (sea: SeaState, x: number, z: number, t: number): OceanSample => {
  if (sea.waves.length === 0) return { height: 0, normal: vec3(0, 1, 0), velocity: vec3(0, 0, 0) }
  // Gerstner waves move particles sideways, so find the rest position that lands on (x, z).
  // The map is a contraction because total steepness < 1; a few fixed-point steps converge.
  let x0 = x
  let z0 = z
  for (let i = 0; i < inversionIterations; i++) {
    const p = gerstnerPoint(sea, x0, z0, t)
    x0 += x - p.x
    z0 += z - p.z
  }
  let height = 0
  let vx = 0
  let vy = 0
  let vz = 0
  let dxx = 1
  let dxy = 0
  let dxz = 0
  let dzx = 0
  let dzy = 0
  let dzz = 1
  for (const wave of sea.waves) {
    const k = waveNumber(wave)
    const omega = waveAngularFrequency(wave)
    const d = directionFromAngle(wave.direction)
    const theta = k * (d.x * x0 + d.z * z0) - omega * t + wave.phase
    const sin = Math.sin(theta)
    const cos = Math.cos(theta)
    const a = wave.amplitude
    const s = steepness(wave)
    const orbit = wave.sharpness * a * omega * cos
    height += a * cos
    vy += a * omega * sin
    vx += d.x * orbit
    vz += d.z * orbit
    dxx -= s * d.x * d.x * cos
    dxy -= a * k * d.x * sin
    dxz -= s * d.x * d.z * cos
    dzx -= s * d.x * d.z * cos
    dzy -= a * k * d.z * sin
    dzz -= s * d.z * d.z * cos
  }
  const normal = normalize(vec3(dzy * dxz - dzz * dxy, dzz * dxx - dzx * dxz, dzx * dxy - dzy * dxx))
  return { height, normal, velocity: vec3(vx, vy, vz) }
}

/** Named seas. `open` is the match sea: heavy swell sized for the reference images. */
export const seas = {
  calm: makeSea([]),
  open: makeSea([
    { direction: 0, wavelength: 96, amplitude: 1.5, sharpness: 1, phase: 0 },
    { direction: 0.45, wavelength: 61, amplitude: 0.6, sharpness: 1, phase: 1.7 },
    { direction: -0.6, wavelength: 37, amplitude: 0.25, sharpness: 1, phase: 4.1 },
    { direction: 1.2, wavelength: 19, amplitude: 0.08, sharpness: 1, phase: 2.6 },
  ]),
} as const satisfies Record<string, SeaState>

/** A long swell travelling toward `direction` with a smaller cross sea, for the beam and head-sea scenarios. */
export const swell = (direction: number): SeaState =>
  makeSea([
    { direction, wavelength: 90, amplitude: 1.5, sharpness: 1, phase: 0 },
    { direction: direction + 0.35, wavelength: 52, amplitude: 0.4, sharpness: 1, phase: 2.2 },
  ])
