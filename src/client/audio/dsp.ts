/** Returns a seeded uniform random source in [0, 1) (mulberry32), so every rendered sound is reproducible. */
export const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Response shapes of `Biquad` (RBJ audio-EQ cookbook). `bandpass` has 0 dB gain at its centre. */
export type BiquadKind = "lowpass" | "highpass" | "bandpass"

/** A second-order IIR filter run one sample at a time, so its frequency can sweep inside a sound. */
export class Biquad {
  #b0 = 1
  #b1 = 0
  #b2 = 0
  #a1 = 0
  #a2 = 0
  #z1 = 0
  #z2 = 0

  readonly sampleRate: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  /** Sets the response; keeps the filter state, so a sweep does not click. */
  set(kind: BiquadKind, frequency: number, q: number): this {
    const w = (2 * Math.PI * Math.min(frequency, this.sampleRate * 0.49)) / this.sampleRate
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    const [b0, b1, b2] =
      kind === "lowpass" ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : kind === "highpass" ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [alpha, 0, -alpha]
    this.#b0 = b0 / a0
    this.#b1 = b1 / a0
    this.#b2 = b2 / a0
    this.#a1 = (-2 * cos) / a0
    this.#a2 = (1 - alpha) / a0
    return this
  }

  step(x: number): number {
    const y = this.#b0 * x + this.#z1
    this.#z1 = this.#b1 * x - this.#a1 * y + this.#z2
    this.#z2 = this.#b2 * x - this.#a2 * y
    return y
  }

  /** Filters `buffer` in place. */
  run(buffer: Float32Array): Float32Array {
    for (let i = 0; i < buffer.length; i++) buffer[i] = this.step(buffer[i] ?? 0)
    return buffer
  }
}

/** White noise in [-1, 1). */
export const whiteNoise = (length: number, random: () => number): Float32Array => {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = random() * 2 - 1
  return out
}

/** Brown (integrated) noise, leaky so it stays centred, scaled to about unit peak. */
export const brownNoise = (length: number, random: () => number): Float32Array => {
  const out = new Float32Array(length)
  let v = 0
  for (let i = 0; i < length; i++) {
    v = v * 0.998 + (random() * 2 - 1) * 0.06
    out[i] = v
  }
  return out
}

/** Adds `source × gain` into `target` from sample `offset`, clipped to the target's length. */
export const mixInto = (target: Float32Array, source: Float32Array, offset: number, gain: number): void => {
  const start = Math.max(0, offset)
  const end = Math.min(target.length, offset + source.length)
  for (let i = start; i < end; i++) target[i] = (target[i] ?? 0) + (source[i - offset] ?? 0) * gain
}

/** Scales `buffer` in place so its largest magnitude is `peak`. */
export const normalizePeak = (buffer: Float32Array, peak: number): Float32Array => {
  let max = 0
  for (let i = 0; i < buffer.length; i++) max = Math.max(max, Math.abs(buffer[i] ?? 0))
  if (max === 0) return buffer
  const k = peak / max
  for (let i = 0; i < buffer.length; i++) buffer[i] = (buffer[i] ?? 0) * k
  return buffer
}

/** Soft-saturates in place with tanh at `drive`, keeping unit peak at unit: adds the harmonics small speakers need to carry a low body. */
export const saturate = (buffer: Float32Array, drive: number): Float32Array => {
  const k = 1 / Math.tanh(drive)
  for (let i = 0; i < buffer.length; i++) buffer[i] = Math.tanh((buffer[i] ?? 0) * drive) * k
  return buffer
}

/** Fades the first and last `seconds` of `buffer` in place, so a one-shot starts and ends without a click. */
export const fadeEdges = (buffer: Float32Array, sampleRate: number, inSeconds: number, outSeconds: number): Float32Array => {
  const fadeIn = Math.min(buffer.length, Math.round(inSeconds * sampleRate))
  const fadeOut = Math.min(buffer.length, Math.round(outSeconds * sampleRate))
  for (let i = 0; i < fadeIn; i++) buffer[i] = (buffer[i] ?? 0) * (i / fadeIn)
  for (let i = 0; i < fadeOut; i++) {
    const j = buffer.length - 1 - i
    buffer[j] = (buffer[j] ?? 0) * (i / fadeOut)
  }
  return buffer
}

/**
 * Makes a seamless loop of `length` samples from `source` (at least `length + crossfade` long): the part past `length`
 * is crossfaded, equal power, over the start, so the loop point has no seam in level or waveform.
 */
export const seamlessLoop = (source: Float32Array, length: number, crossfade: number): Float32Array => {
  const out = source.slice(0, length)
  for (let i = 0; i < crossfade; i++) {
    const t = i / crossfade
    out[i] = (source[i] ?? 0) * Math.sin((t * Math.PI) / 2) + (source[length + i] ?? 0) * Math.cos((t * Math.PI) / 2)
  }
  return out
}

/** A decaying sine (one struck mode) added into `target` from `start` seconds. */
export const addMode = (
  target: Float32Array,
  sampleRate: number,
  start: number,
  frequency: number,
  decaySeconds: number,
  gain: number,
): void => {
  const offset = Math.round(start * sampleRate)
  const length = Math.min(target.length - offset, Math.round(decaySeconds * 7 * sampleRate))
  const w = (2 * Math.PI * frequency) / sampleRate
  const d = Math.exp(-1 / (decaySeconds * sampleRate))
  let env = gain
  for (let i = 0; i < length; i++) {
    target[offset + i] = (target[offset + i] ?? 0) + Math.sin(w * i) * env
    env *= d
  }
}

/** A sine whose frequency glides from `from` to `to` with time constant `glideSeconds`, under an attack/decay envelope, added into `target`. */
export const addChirp = (
  target: Float32Array,
  sampleRate: number,
  options: { start: number; from: number; to: number; glideSeconds: number; attackSeconds: number; decaySeconds: number; gain: number },
): void => {
  const offset = Math.round(options.start * sampleRate)
  const length = Math.min(target.length - offset, Math.round(options.decaySeconds * 7 * sampleRate))
  let phase = 0
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const f = options.to + (options.from - options.to) * Math.exp(-t / options.glideSeconds)
    phase += (2 * Math.PI * f) / sampleRate
    const env = (1 - Math.exp(-t / options.attackSeconds)) * Math.exp(-t / options.decaySeconds)
    target[offset + i] = (target[offset + i] ?? 0) + Math.sin(phase) * env * options.gain
  }
}
