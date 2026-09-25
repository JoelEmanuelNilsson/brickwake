/** Largest sample magnitude in `samples`. */
export const peakLevel = (samples: Float32Array): number => {
  let max = 0
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i] ?? 0))
  return max
}

/** Root-mean-square level of `samples`. */
export const rmsLevel = (samples: Float32Array): number => {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2
  return Math.sqrt(sum / Math.max(1, samples.length))
}

/** Seconds until the signal first reaches `fraction` of its peak: when a sound starts. */
export const onsetSeconds = (samples: Float32Array, sampleRate: number, fraction = 0.1): number => {
  const threshold = peakLevel(samples) * fraction
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i] ?? 0) >= threshold) return i / sampleRate
  return Number.NaN
}

/** Level of each `frameSeconds` window (RMS), for envelopes. */
export const envelopeFrames = (samples: Float32Array, sampleRate: number, frameSeconds: number): Float32Array => {
  const frame = Math.max(1, Math.round(frameSeconds * sampleRate))
  const out = new Float32Array(Math.floor(samples.length / frame))
  for (let f = 0; f < out.length; f++) {
    let sum = 0
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += (samples[i] ?? 0) ** 2
    out[f] = Math.sqrt(sum / frame)
  }
  return out
}

/** Seconds from the loudest 10 ms window until the envelope last sits above `db` relative to it: the audible decay. */
export const decaySeconds = (samples: Float32Array, sampleRate: number, db = -40): number => {
  const env = envelopeFrames(samples, sampleRate, 0.01)
  let peakAt = 0
  for (let f = 0; f < env.length; f++) if ((env[f] ?? 0) > (env[peakAt] ?? 0)) peakAt = f
  const floor = (env[peakAt] ?? 0) * 10 ** (db / 20)
  let last = peakAt
  for (let f = peakAt; f < env.length; f++) if ((env[f] ?? 0) > floor) last = f
  return (last - peakAt) * 0.01
}

/** Counts attacks: 10 ms windows above a fifth of the loudest that jump at least `riseDb` over the window 20 ms before, 30 ms apart at least. */
export const countAttacks = (samples: Float32Array, sampleRate: number, riseDb = 4): number => {
  const env = envelopeFrames(samples, sampleRate, 0.01)
  const peak = Math.max(...env)
  let count = 0
  let lastAt = -10
  for (let f = 2; f < env.length; f++) {
    const now = env[f] ?? 0
    const before = env[f - 2] ?? 0
    if (now > peak * 0.2 && now > before * 10 ** (riseDb / 20) && f - lastAt >= 3) {
      count++
      lastAt = f
    }
  }
  return count
}

const fftInPlace = (re: Float64Array, im: Float64Array) => {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i] ?? 0
      re[i] = re[j] ?? 0
      re[j] = tr
      const ti = im[i] ?? 0
      im[i] = im[j] ?? 0
      im[j] = ti
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k)
        const wi = Math.sin(step * k)
        const a = start + k
        const b = a + size / 2
        const xr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi
        const xi = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr
        re[b] = (re[a] ?? 0) - xr
        im[b] = (im[a] ?? 0) - xi
        re[a] = (re[a] ?? 0) + xr
        im[a] = (im[a] ?? 0) + xi
      }
    }
  }
}

/** Energy spectrum of `samples`, averaged over Hann-windowed 4096-sample frames; bin k is k·sampleRate/4096 Hz. */
export const powerSpectrum = (samples: Float32Array): Float64Array => {
  const size = 4096
  const power = new Float64Array(size / 2)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let start = 0; start + size <= Math.max(samples.length, size); start += size / 2) {
    for (let i = 0; i < size; i++) {
      re[i] = (samples[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size))
      im[i] = 0
    }
    fftInPlace(re, im)
    for (let k = 0; k < size / 2; k++) power[k] = (power[k] ?? 0) + (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2
  }
  return power
}

/** Share of the signal's energy between `fromHz` and `toHz`. */
export const bandShare = (samples: Float32Array, sampleRate: number, fromHz: number, toHz: number): number => {
  const power = powerSpectrum(samples)
  const hz = sampleRate / (power.length * 2)
  let band = 0
  let total = 0
  for (let k = 1; k < power.length; k++) {
    total += power[k] ?? 0
    if (k * hz >= fromHz && k * hz < toHz) band += power[k] ?? 0
  }
  return total === 0 ? 0 : band / total
}

/** Energy-weighted mean frequency of the signal, Hz: how bright it sounds. */
export const spectralCentroid = (samples: Float32Array, sampleRate: number): number => {
  const power = powerSpectrum(samples)
  const hz = sampleRate / (power.length * 2)
  let weighted = 0
  let total = 0
  for (let k = 1; k < power.length; k++) {
    weighted += k * hz * (power[k] ?? 0)
    total += power[k] ?? 0
  }
  return total === 0 ? 0 : weighted / total
}
