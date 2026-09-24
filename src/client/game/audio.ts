/** Seconds of the fuse sizzle; about click-to-fire at 150 ms of network delay plus the ripple. */
const sizzleSeconds = 0.45

/**
 * The game's WebAudio output, synthesized with no asset files. The context starts on the first sound, which
 * follows a click, so browsers allow it.
 */
export class GameAudio {
  #context: AudioContext | undefined
  #noise: AudioBuffer | undefined

  /** A fuse taking at the touch holes; plays locally on click so firing answers at once despite the network delay. */
  sizzle(): void {
    const context = (this.#context ??= new AudioContext())
    const noise = (this.#noise ??= whiteNoise(context))
    const now = context.currentTime
    const source = new AudioBufferSourceNode(context, { buffer: noise, playbackRate: 1 })
    const hiss = new BiquadFilterNode(context, { type: "bandpass", frequency: 5200, Q: 0.9 })
    const crackle = new BiquadFilterNode(context, { type: "highpass", frequency: 2400 })
    const gain = new GainNode(context, { gain: 0 })
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.22, now + 0.02)
    gain.gain.setValueAtTime(0.22, now + sizzleSeconds * 0.6)
    gain.gain.exponentialRampToValueAtTime(0.001, now + sizzleSeconds)
    hiss.frequency.setValueAtTime(4200, now)
    hiss.frequency.linearRampToValueAtTime(6800, now + sizzleSeconds)
    source.connect(hiss).connect(crackle).connect(gain).connect(context.destination)
    source.start(now, Math.random() * 0.5, sizzleSeconds)
  }
}

const whiteNoise = (context: AudioContext) => {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
  const data = buffer.getChannelData(0)
  // Sparse louder pops over the hiss make it crackle like burning powder.
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.004 ? 3 : 0.5)
  return buffer
}
