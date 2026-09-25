import {
  addChirp,
  addMode,
  Biquad,
  brownNoise,
  fadeEdges,
  mixInto,
  normalizePeak,
  saturate,
  seamlessLoop,
  seededRandom,
  whiteNoise,
  type BiquadKind,
} from "./dsp.ts"

const filtered = (source: Float32Array, sampleRate: number, kind: BiquadKind, frequency: number, q: number) =>
  new Biquad(sampleRate).set(kind, frequency, q).run(source)

/** `source` × an attack/decay envelope starting at `start` seconds (silent before), in place. */
const envelope = (source: Float32Array, sampleRate: number, start: number, attack: number, decay: number) => {
  for (let i = 0; i < source.length; i++) {
    const t = i / sampleRate - start
    source[i] = t < 0 ? 0 : (source[i] ?? 0) * (1 - Math.exp(-t / attack)) * Math.exp(-t / decay)
  }
  return source
}

/** Bursts of small resonant clicks: splinters, brick clatter and spray droplets. */
const addClicks = (
  target: Float32Array,
  sampleRate: number,
  random: () => number,
  options: { count: number; from: number; spread: number; low: number; high: number; decay: number; gain: number },
) => {
  for (let k = 0; k < options.count; k++) {
    const at = options.from + options.spread * -Math.log(1 - random() * 0.95) * 0.35
    const frequency = options.low * (options.high / options.low) ** random()
    const g = options.gain * (0.3 + 0.7 * random()) * Math.exp(-(at - options.from) / (options.spread * 0.8))
    addMode(target, sampleRate, at, frequency, options.decay * (0.5 + random()), g)
    addMode(target, sampleRate, at, frequency * (1.5 + random()), options.decay * 0.4, g * 0.5)
  }
}

/** A bubble: a short sine whose pitch rises as it closes (Minnaert resonance of a shrinking bubble). */
const addBubble = (target: Float32Array, sampleRate: number, at: number, frequency: number, decay: number, gain: number) =>
  addChirp(target, sampleRate, { start: at, from: frequency, to: frequency * 1.6, glideSeconds: decay * 3, attackSeconds: 0.002, decaySeconds: decay, gain })

/** Rolling thunder: `source` shaped by attack/decay swells starting at each of `rolls` seconds, each 0.75× the last, in place. */
const rollInto = (source: Float32Array, sampleRate: number, rolls: ReadonlyArray<number>, decay: number) => {
  for (let i = 0; i < source.length; i++) {
    const t = i / sampleRate
    let env = 0
    for (let k = 0; k < rolls.length; k++) {
      const s = t - (rolls[k] ?? 0)
      if (s > 0) env += (1 - Math.exp(-s / 0.05)) * Math.exp(-s / decay) * 0.75 ** k
    }
    source[i] = (source[i] ?? 0) * env
  }
  return source
}

/**
 * A 24-pounder heard from on deck or within ~100 m: an N-wave crack, a sub thump felt more than heard, a 115→38 Hz
 * body saturated so laptop speakers carry its harmonics, the roar of the powder, a long rumbling tail and the report
 * coming back off the water and distant hulls as rolling echoes. 5 s.
 */
export const synthCannonBoom = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(5 * sampleRate)
  const out = new Float32Array(n)
  const nWave = 0.0032 * (0.85 + 0.3 * random())
  for (let i = 0; i < Math.round(2 * nWave * sampleRate); i++) out[i] = 0.9 * (1 - i / sampleRate / nWave)
  mixInto(out, envelope(filtered(whiteNoise(n, random), sampleRate, "lowpass", 7000, 0.7), sampleRate, 0, 0.0003, 0.014), 0, 0.8)
  const body = 1.05 + 0.1 * random()
  addChirp(out, sampleRate, { start: 0, from: 115 * body, to: 38 * body, glideSeconds: 0.06, attackSeconds: 0.002, decaySeconds: 0.28, gain: 1 })
  addChirp(out, sampleRate, { start: 0.004, from: 70 * body, to: 31 * body, glideSeconds: 0.1, attackSeconds: 0.01, decaySeconds: 0.5, gain: 0.55 })
  const roar = normalizePeak(filtered(whiteNoise(n, random), sampleRate, "bandpass", 450 + 250 * random(), 0.6), 1)
  mixInto(out, envelope(roar, sampleRate, 0.001, 0.002, 0.18), 0, 2.2)
  const crackle = normalizePeak(filtered(whiteNoise(n, random), sampleRate, "bandpass", 2500, 0.8), 1)
  mixInto(out, envelope(crackle, sampleRate, 0.002, 0.003, 0.05), 0, 1.2)
  const rumble = filtered(filtered(brownNoise(n, random), sampleRate, "lowpass", 160, 0.7), sampleRate, "highpass", 22, 0.7)
  const flutter = 2.5 + 2 * random()
  for (let i = 0; i < n; i++) rumble[i] = (rumble[i] ?? 0) * (1 + 0.35 * Math.sin((2 * Math.PI * flutter * i) / sampleRate))
  mixInto(out, normalizePeak(envelope(rumble, sampleRate, 0.005, 0.03, 1.2), 1), 0, 0.6)
  const tail = envelope(filtered(whiteNoise(n, random), sampleRate, "lowpass", 380, 0.6), sampleRate, 0.03, 0.12, 1.6)
  mixInto(out, tail, 0, 0.15)
  const head = filtered(out.slice(0, Math.round(0.4 * sampleRate)), sampleRate, "lowpass", 1100, 0.7)
  mixInto(out, head, Math.round((0.07 + 0.05 * random()) * sampleRate), 0.3)
  mixInto(out, head, Math.round((0.16 + 0.08 * random()) * sampleRate), 0.16)
  const echo = normalizePeak(filtered(filtered(whiteNoise(n, random), sampleRate, "lowpass", 300, 0.7), sampleRate, "highpass", 30, 0.7), 1)
  mixInto(out, rollInto(echo, sampleRate, [0.45 + 0.15 * random(), 0.9 + 0.3 * random(), 1.6 + 0.4 * random()], 0.6), 0, 0.3)
  const heavy = saturate(normalizePeak(out, 1), 1.7)
  // The sub thump goes in after the saturator so it stays a clean, round push rather than buzz.
  addChirp(heavy, sampleRate, { start: 0.002, from: 58 * body, to: 27, glideSeconds: 0.14, attackSeconds: 0.006, decaySeconds: 0.4, gain: 0.45 })
  return fadeEdges(normalizePeak(heavy, 0.95), sampleRate, 0, 0.5)
}

/**
 * A 24-pounder from a few hundred metres: the crack is gone, a dull thud and a low rolling rumble that arrives in
 * several smeared rolls, like thunder, over a sub push. 5 s.
 */
export const synthDistantBoom = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(5 * sampleRate)
  const out = new Float32Array(n)
  addChirp(out, sampleRate, { start: 0, from: 70, to: 33, glideSeconds: 0.1, attackSeconds: 0.008, decaySeconds: 0.38, gain: 1.2 })
  const thud = normalizePeak(filtered(whiteNoise(n, random), sampleRate, "lowpass", 450, 0.7), 1)
  mixInto(out, envelope(thud, sampleRate, 0, 0.004, 0.12), 0, 2.2)
  const rumble = normalizePeak(filtered(filtered(whiteNoise(n, random), sampleRate, "lowpass", 220, 0.7), sampleRate, "highpass", 30, 0.7), 1)
  mixInto(out, rollInto(rumble, sampleRate, [0, 0.12 + 0.1 * random(), 0.35 + 0.2 * random(), 0.8 + 0.3 * random(), 1.4 + 0.4 * random(), 2.2 + 0.5 * random()], 0.7), 0, 1.8)
  const heavy = saturate(normalizePeak(out, 1), 1.4)
  addChirp(heavy, sampleRate, { start: 0.004, from: 48, to: 26, glideSeconds: 0.18, attackSeconds: 0.012, decaySeconds: 0.5, gain: 0.6 })
  return fadeEdges(normalizePeak(heavy, 0.95), sampleRate, 0.002, 0.8)
}

/** A ball striking the sea: slap, cavity bloop, spray hiss, the column falling back and scattered droplets. 1.8 s. */
export const synthSplash = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(1.8 * sampleRate)
  const out = new Float32Array(n)
  mixInto(out, envelope(filtered(whiteNoise(n, random), sampleRate, "highpass", 600, 0.7), sampleRate, 0, 0.0002, 0.008), 0, 0.9)
  addChirp(out, sampleRate, { start: 0, from: 90, to: 55, glideSeconds: 0.03, attackSeconds: 0.002, decaySeconds: 0.06, gain: 0.7 })
  addChirp(out, sampleRate, { start: 0.012, from: 380 + 80 * random(), to: 120, glideSeconds: 0.05, attackSeconds: 0.003, decaySeconds: 0.08, gain: 0.35 })
  mixInto(out, envelope(filtered(whiteNoise(n, random), sampleRate, "bandpass", 2400, 0.6), sampleRate, 0.005, 0.02, 0.25), 0, 0.55)
  const fall = filtered(whiteNoise(n, random), sampleRate, "bandpass", 1200, 0.5)
  const rough = filtered(whiteNoise(n, random), sampleRate, "lowpass", 30, 0.7)
  const centre = 0.6 + 0.15 * random()
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    fall[i] = (fall[i] ?? 0) * Math.exp(-(((t - centre) / 0.28) ** 2)) * (0.6 + 4 * Math.abs(rough[i] ?? 0))
  }
  mixInto(out, fall, 0, 0.4)
  addClicks(out, sampleRate, random, { count: 70, from: 0.3, spread: 1.1, low: 1400, high: 5500, decay: 0.004, gain: 0.12 })
  return fadeEdges(normalizePeak(out, 0.9), sampleRate, 0, 0.2)
}

/** A ball smashing into the brick-and-timber hull: snap, struck-wood modes, a thud, the grinding crunch of timber and brick giving way, and splinter crackles. 0.9 s. */
export const synthHullCrack = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(0.9 * sampleRate)
  const out = new Float32Array(n)
  mixInto(out, envelope(filtered(whiteNoise(n, random), sampleRate, "highpass", 1500, 0.7), sampleRate, 0, 0.0002, 0.009), 0, 1)
  const modes = [
    [160, 0.08, 0.9],
    [380, 0.05, 0.75],
    [820, 0.03, 0.55],
    [1700, 0.018, 0.4],
    [3400, 0.01, 0.25],
  ] as const
  for (const [f, decay, g] of modes) addMode(out, sampleRate, 0.0005, f * (0.9 + 0.2 * random()), decay, g)
  addChirp(out, sampleRate, { start: 0, from: 95, to: 60, glideSeconds: 0.04, attackSeconds: 0.001, decaySeconds: 0.07, gain: 0.8 })
  const crunch = normalizePeak(filtered(whiteNoise(n, random), sampleRate, "bandpass", 650 + 250 * random(), 0.7), 1)
  const grains = new Float32Array(n)
  for (let k = 0; k < 90; k++) {
    const at = 0.16 * random() ** 1.6
    const g = (0.4 + 0.6 * random()) * Math.exp(-at / 0.07)
    for (let i = Math.round(at * sampleRate), end = Math.min(n, i + Math.round(0.012 * sampleRate)), start = i; i < end; i++) grains[i] = (grains[i] ?? 0) + g * Math.exp(-(i - start) / (0.003 * sampleRate))
  }
  for (let i = 0; i < n; i++) crunch[i] = (crunch[i] ?? 0) * Math.min(1.5, grains[i] ?? 0)
  mixInto(out, crunch, 0, 0.9)
  addClicks(out, sampleRate, random, { count: 45, from: 0.004, spread: 0.35, low: 900, high: 5200, decay: 0.004, gain: 0.35 })
  return fadeEdges(normalizePeak(saturate(normalizePeak(out, 1), 1.2), 0.95), sampleRate, 0, 0.1)
}

/** Loose bricks and splinters: bright plastic clicks flying off, then clattering onto the deck and plopping into the sea. 1.4 s. */
export const synthSplinters = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(1.4 * sampleRate)
  const out = new Float32Array(n)
  addClicks(out, sampleRate, random, { count: 30, from: 0.02, spread: 0.3, low: 2200, high: 6500, decay: 0.006, gain: 0.5 })
  addClicks(out, sampleRate, random, { count: 45, from: 0.3, spread: 0.9, low: 1600, high: 5000, decay: 0.01, gain: 0.35 })
  for (let k = 0; k < 8; k++) addBubble(out, sampleRate, 0.5 + 0.8 * random(), 500 + 500 * random(), 0.025, 0.15)
  return fadeEdges(normalizePeak(out, 0.8), sampleRate, 0.001, 0.1)
}

/** A ball striking the listener's own hull: the whole ship booms like a drum under the crack. 1.2 s. */
export const synthHullThud = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(1.2 * sampleRate)
  const out = new Float32Array(n)
  addMode(out, sampleRate, 0, 48 * (0.95 + 0.1 * random()), 0.3, 1)
  addMode(out, sampleRate, 0, 76 * (0.95 + 0.1 * random()), 0.2, 0.7)
  addMode(out, sampleRate, 0, 118 * (0.95 + 0.1 * random()), 0.12, 0.5)
  mixInto(out, envelope(filtered(whiteNoise(n, random), sampleRate, "lowpass", 900, 0.7), sampleRate, 0, 0.0005, 0.03), 0, 0.6)
  return fadeEdges(normalizePeak(saturate(normalizePeak(out, 1), 1.8), 0.95), sampleRate, 0.001, 0.2)
}

/** Seconds into `synthWhistle` at which the ball passes closest. */
export const whistlePeakSeconds = 0.8

/** A round shot passing close: a rushing whirr that drops in pitch as it goes by (Doppler), loudest at `whistlePeakSeconds`. 1.6 s. */
export const synthWhistle = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(1.6 * sampleRate)
  const out = new Float32Array(n)
  const noise = whiteNoise(n, random)
  const band = new Biquad(sampleRate)
  const whoosh = new Biquad(sampleRate).set("lowpass", 500, 0.7)
  const centre = 650 + 150 * random()
  const tumble = 18 + 10 * random()
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate - whistlePeakSeconds
    const doppler = 1 + 0.2 * Math.tanh(-t * 5)
    if (i % 32 === 0) band.set("bandpass", centre * doppler, 5)
    phase += (2 * Math.PI * centre * 2 * doppler) / sampleRate
    const env = 1 / (1 + (t / 0.14) ** 2)
    const tone = Math.sin(phase) * (0.7 + 0.3 * Math.sin((2 * Math.PI * tumble * i) / sampleRate))
    const n0 = noise[i] ?? 0
    out[i] = env * (band.step(n0) * 1.6 + tone * 0.18 + whoosh.step(n0) * 0.8 * env)
  }
  return fadeEdges(normalizePeak(out, 0.9), sampleRate, 0.05, 0.1)
}

/** Stick-slip friction: an irregular pulse train gliding in rate, rung through wood resonances. The base of creaks and groans. */
const stickSlip = (
  sampleRate: number,
  random: () => number,
  options: { seconds: number; rateFrom: number; rateTo: number; modes: ReadonlyArray<readonly [number, number]> },
) => {
  const n = Math.round(options.seconds * sampleRate)
  const pulses = new Float32Array(n)
  let t = 0.01
  while (t < options.seconds) {
    const u = t / options.seconds
    const rate = options.rateFrom + (options.rateTo - options.rateFrom) * Math.sin(u * Math.PI * 0.8)
    pulses[Math.round(t * sampleRate)] = 0.6 + 0.8 * random()
    t += (1 / rate) * (0.8 + 0.4 * random())
  }
  const out = new Float32Array(n)
  for (const [f, q] of options.modes) mixInto(out, filtered(pulses.slice(), sampleRate, "bandpass", f * (0.85 + 0.3 * random()), q), 0, 1)
  for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) * Math.sin((Math.PI * i) / n) ** 0.7
  return out
}

/** Timber working against timber in a seaway. 0.5–1.3 s. */
export const synthCreak = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const out = stickSlip(sampleRate, random, {
    seconds: 0.5 + 0.8 * random(),
    rateFrom: 25 + 35 * random(),
    rateTo: 60 + 100 * random(),
    modes: [
      [240, 25],
      [530, 20],
      [1150, 15],
      [2400, 10],
    ],
  })
  return fadeEdges(normalizePeak(out, 0.8), sampleRate, 0.01, 0.05)
}

/** A hull breaking up as it founders: slow deep groaning timbers, rumble, splitting cracks and rising bubbles. 5 s. */
export const synthSinkingGroan = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const out = stickSlip(sampleRate, random, {
    seconds: 5,
    rateFrom: 12,
    rateTo: 32,
    modes: [
      [95, 30],
      [180, 25],
      [410, 18],
      [760, 12],
    ],
  })
  normalizePeak(out, 1)
  const n = out.length
  const rumble = normalizePeak(envelope(filtered(brownNoise(n, random), sampleRate, "lowpass", 90, 0.7), sampleRate, 0, 1.2, 3), 1)
  mixInto(out, rumble, 0, 0.6)
  for (let k = 0; k < 4; k++) {
    const at = 0.4 + 3.6 * random()
    for (const [f, decay] of [
      [140, 0.1],
      [330, 0.06],
      [900, 0.03],
    ] as const)
      addMode(out, sampleRate, at, f * (0.9 + 0.2 * random()), decay, 0.5)
    addClicks(out, sampleRate, random, { count: 12, from: at, spread: 0.2, low: 700, high: 3500, decay: 0.005, gain: 0.25 })
  }
  for (let k = 0; k < 80; k++) addBubble(out, sampleRate, 1.5 + 3.3 * random() ** 0.7, 150 + 700 * random(), 0.02 + 0.04 * random(), 0.12)
  return fadeEdges(normalizePeak(saturate(normalizePeak(out, 1), 1.3), 0.9), sampleRate, 0.05, 0.6)
}

/** The sea closing over a foundered hull: a heavy whoosh, deep gulping bubbles and the air escaping. 3.5 s. */
export const synthPlunge = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(3.5 * sampleRate)
  const out = new Float32Array(n)
  mixInto(out, envelope(filtered(whiteNoise(n, random), sampleRate, "bandpass", 420, 0.7), sampleRate, 0, 0.25, 0.8), 0, 0.7)
  mixInto(out, normalizePeak(envelope(filtered(brownNoise(n, random), sampleRate, "lowpass", 150, 0.7), sampleRate, 0, 0.1, 1.2), 1), 0, 0.8)
  for (let k = 0; k < 25; k++) addBubble(out, sampleRate, 0.3 + 2.7 * random(), 60 + 190 * random(), 0.06 + 0.09 * random(), 0.35)
  for (let k = 0; k < 40; k++) addBubble(out, sampleRate, 0.5 + 2.8 * random(), 300 + 700 * random(), 0.02 + 0.03 * random(), 0.1)
  return fadeEdges(normalizePeak(saturate(normalizePeak(out, 1), 1.2), 0.9), sampleRate, 0.005, 0.5)
}

/** A fuse taking at the touch holes: bright hiss rising in pitch with crackling pops of burning powder. 0.45 s. */
export const synthFuse = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const seconds = 0.45
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  const hiss = new Biquad(sampleRate)
  const high = new Biquad(sampleRate).set("highpass", 2400, 0.7)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    if (i % 32 === 0) hiss.set("bandpass", 4200 + (2600 * t) / seconds, 0.9)
    const x = (random() * 2 - 1) * (random() < 0.004 ? 3 : 0.5)
    const env = Math.min(1, t / 0.02) * (t < seconds * 0.6 ? 1 : Math.exp((-(t - seconds * 0.6) / (seconds * 0.4)) * 6.9))
    out[i] = high.step(hiss.step(x)) * env
  }
  return fadeEdges(normalizePeak(out, 0.9), sampleRate, 0, 0.01)
}

/** One strike of a ship's bell: inharmonic bronze partials, the hum ringing longest. 3 s. */
export const synthBell = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(3 * sampleRate)
  const out = new Float32Array(n)
  const f = 740
  const partials = [
    [0.5, 2.4, 0.35],
    [1, 1.6, 1],
    [1.19, 1.2, 0.5],
    [1.5, 0.9, 0.45],
    [2, 0.7, 0.4],
    [2.51, 0.5, 0.3],
    [2.66, 0.45, 0.25],
    [3.01, 0.35, 0.2],
    [4.1, 0.2, 0.12],
  ] as const
  for (const [ratio, decay, g] of partials) {
    addMode(out, sampleRate, 0, f * ratio, decay, g)
    addMode(out, sampleRate, 0, f * ratio * 1.003, decay, g * 0.5)
  }
  mixInto(out, envelope(filtered(whiteNoise(n, random), sampleRate, "bandpass", 3000, 1), sampleRate, 0, 0.0003, 0.006), 0, 0.5)
  return fadeEdges(normalizePeak(out, 0.8), sampleRate, 0, 0.3)
}

const loopCrossfadeSeconds = 1

/** Seconds of each ambience loop. Two sources, offset half a loop, make the stereo pair. */
export const ambienceLoopSeconds = 12

const periodicSwell = (sampleRate: number, random: () => number, n: number, count: number, minSeconds: number, maxSeconds: number) => {
  const swell = new Float32Array(n)
  for (let k = 0; k < count; k++) {
    const start = Math.floor(random() * n)
    const length = Math.round((minSeconds + (maxSeconds - minSeconds) * random()) * sampleRate)
    const g = 0.5 + 0.5 * random()
    for (let i = 0; i < length; i++) {
      const u = i / length
      // Waves wash in fast and drain slowly.
      const shape = u < 0.35 ? Math.sin((u / 0.35) * (Math.PI / 2)) : Math.cos(((u - 0.35) / 0.65) * (Math.PI / 2)) ** 2
      const j = (start + i) % n
      swell[j] = (swell[j] ?? 0) + shape * g
    }
  }
  return swell
}

/** The open sea around the ship: low surf, waves washing in and draining with foam fizz. A seamless 12 s loop. */
export const synthOceanLoop = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(ambienceLoopSeconds * sampleRate)
  const m = n + Math.round(loopCrossfadeSeconds * sampleRate)
  const swell = periodicSwell(sampleRate, random, n, 7, 2.2, 4.2)
  const surf = normalizePeak(filtered(brownNoise(m, random), sampleRate, "lowpass", 300, 0.7), 1)
  const wash = filtered(filtered(whiteNoise(m, random), sampleRate, "bandpass", 900, 0.5), sampleRate, "lowpass", 3500, 0.7)
  const fizz = filtered(whiteNoise(m, random), sampleRate, "highpass", 3000, 0.7)
  const out = new Float32Array(m)
  const fizzLag = Math.round(0.5 * sampleRate)
  for (let i = 0; i < m; i++) {
    const s = swell[i % n] ?? 0
    const late = swell[(i + n - fizzLag) % n] ?? 0
    out[i] = (surf[i] ?? 0) * (0.5 + 0.3 * s) + (wash[i] ?? 0) * (0.15 + 0.6 * s) + (fizz[i] ?? 0) * 0.12 * late * late
  }
  return normalizePeak(seamlessLoop(out, n, Math.round(loopCrossfadeSeconds * sampleRate)), 0.9)
}

/** Wind across open water in gusts, the band wandering with the gusts. A seamless 12 s loop. */
export const synthWindLoop = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(ambienceLoopSeconds * sampleRate)
  const m = n + Math.round(loopCrossfadeSeconds * sampleRate)
  const gust = periodicSwell(sampleRate, random, n, 6, 2.5, 5)
  const noise = whiteNoise(m, random)
  const band = new Biquad(sampleRate)
  const low = new Biquad(sampleRate).set("lowpass", 160, 0.7)
  const out = new Float32Array(m)
  for (let i = 0; i < m; i++) {
    const g = gust[i % n] ?? 0
    if (i % 64 === 0) band.set("bandpass", 320 + 420 * Math.min(1, g), 0.9)
    const x = noise[i] ?? 0
    out[i] = band.step(x) * (0.35 + 0.65 * g) + low.step(x) * 1.2
  }
  return normalizePeak(seamlessLoop(out, n, Math.round(loopCrossfadeSeconds * sampleRate)), 0.9)
}

/** Wind singing in the shrouds and stays: narrow wandering tones that swell with the gusts. A seamless 12 s loop. */
export const synthRiggingLoop = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(ambienceLoopSeconds * sampleRate)
  const m = n + Math.round(loopCrossfadeSeconds * sampleRate)
  const gust = periodicSwell(sampleRate, random, n, 5, 2, 4.5)
  const noise = whiteNoise(m, random)
  const tones = [880, 1320, 2050].map((f) => ({ f: f * (0.95 + 0.1 * random()), filter: new Biquad(sampleRate), rate: 0.07 + 0.1 * random() }))
  const out = new Float32Array(m)
  for (let i = 0; i < m; i++) {
    const g = gust[i % n] ?? 0
    const x = noise[i] ?? 0
    let y = 0
    for (const tone of tones) {
      if (i % 64 === 0) tone.filter.set("bandpass", tone.f * (1 + 0.04 * g + 0.02 * Math.sin((2 * Math.PI * tone.rate * i) / sampleRate)), 45)
      y += tone.filter.step(x)
    }
    out[i] = y * g * g
  }
  return normalizePeak(seamlessLoop(out, n, Math.round(loopCrossfadeSeconds * sampleRate)), 0.9)
}

/** Water rushing along the hull and churning at the bow and stern while under way. A seamless 12 s loop. */
export const synthHullWashLoop = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(ambienceLoopSeconds * sampleRate)
  const m = n + Math.round(loopCrossfadeSeconds * sampleRate)
  const slaps = periodicSwell(sampleRate, random, n, 18, 0.4, 1.1)
  const rush = filtered(whiteNoise(m, random), sampleRate, "bandpass", 700, 0.7)
  const fizz = filtered(filtered(whiteNoise(m, random), sampleRate, "highpass", 2200, 0.7), sampleRate, "lowpass", 7000, 0.7)
  const churn = filtered(whiteNoise(m, random), sampleRate, "lowpass", 9, 0.7)
  normalizePeak(churn, 1)
  const out = new Float32Array(m)
  for (let i = 0; i < m; i++) {
    const s = slaps[i % n] ?? 0
    const c = 0.6 + 0.4 * (churn[i] ?? 0)
    out[i] = (rush[i] ?? 0) * c * (0.6 + 0.5 * s) + (fizz[i] ?? 0) * 0.15 * c * (0.3 + s)
  }
  return normalizePeak(seamlessLoop(out, n, Math.round(loopCrossfadeSeconds * sampleRate)), 0.9)
}

/** Canvas working in the wind: irregular flutter and the thump of a sail filling. A seamless 12 s loop. */
export const synthSailLoop = (sampleRate: number, seed: number): Float32Array => {
  const random = seededRandom(seed)
  const n = Math.round(ambienceLoopSeconds * sampleRate)
  const m = n + Math.round(loopCrossfadeSeconds * sampleRate)
  const cloth = filtered(filtered(whiteNoise(m, random), sampleRate, "lowpass", 1100, 0.7), sampleRate, "highpass", 120, 0.7)
  const gust = periodicSwell(sampleRate, random, n, 5, 2, 5)
  const out = new Float32Array(m)
  let phase = 0
  for (let i = 0; i < m; i++) {
    const g = gust[i % n] ?? 0
    phase += (2 * Math.PI * (4 + 3 * g)) / sampleRate
    const flap = Math.max(0, Math.sin(phase + 0.8 * Math.sin(phase * 0.37))) ** 3
    out[i] = (cloth[i] ?? 0) * (0.15 + 0.85 * flap) * (0.3 + 0.7 * g)
  }
  for (let k = 0; k < 6; k++) addMode(out, sampleRate, random() * (ambienceLoopSeconds - 0.5), 85 + 30 * random(), 0.06, 0.5)
  return normalizePeak(seamlessLoop(out, n, Math.round(loopCrossfadeSeconds * sampleRate)), 0.9)
}

/**
 * An outdoor impulse response for the reverb send: one reflection off the water, then a diffuse tail that darkens
 * as it decays (air takes the highs first). 2.2 s, one channel per ear.
 */
export const synthOpenSeaReverb = (sampleRate: number, seed: number): readonly [Float32Array, Float32Array] => {
  const make = (s: number) => {
    const random = seededRandom(s)
    const n = Math.round(2.2 * sampleRate)
    const noise = whiteNoise(n, random)
    const out = new Float32Array(n)
    const lp = new Biquad(sampleRate)
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate
      if (i % 64 === 0) lp.set("lowpass", 7000 * Math.exp(-t / 0.5) + 400, 0.7)
      out[i] = lp.step(noise[i] ?? 0) * (1 - Math.exp(-t / 0.02)) * Math.exp(-t / 0.45)
    }
    out[Math.round((0.012 + 0.006 * random()) * sampleRate)] = 0.8
    return normalizePeak(out, 1)
  }
  return [make(seed), make(seed + 1)]
}
