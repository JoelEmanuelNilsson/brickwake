import type { Camera } from "three"
import type { MatchPhaseSnapshot } from "../../protocol/messages.ts"
import type { Cannonball } from "../../sim/gunnery.ts"
import { tuning } from "../../sim/tuning.ts"
import type { ShipPose } from "../game/timeline.ts"
import type { AmbienceLoopName, OneShotName, SoundBank } from "./sound-bank.ts"
import { whistlePeakSeconds } from "./sound-recipes.ts"

/** Metres per second; a boom 300 m off arrives 0.87 s after its flash. */
const speedOfSound = 343
/** Most one-shots sounding at once; past this the quietest remaining voice is cut for a louder new sound. */
const voiceCount = 64
const stealFadeSeconds = 0.005
/** Seconds between ambience retargets; each glides with `ambienceGlideSeconds`, so the rate is inaudible. */
const ambienceStepSeconds = 0.1
const ambienceGlideSeconds = 0.4
/** Balls passing closer than this to the listener whistle, metres. */
const whistleRange = 35
const ambienceBusGain = 0.55
const defaultVolume = 0.8
/** Share of the master gain left while the pause menu is up: the battle goes on, heard from further off. */
const pausedShare = 0.3

/**
 * Loudness of each sound at the source (`level`, before the master) and the distance at which it has fallen to half
 * (`reach`, metres). Tuned so an own-ship broadside, a 12-ship battle and the sea sit together under the limiter.
 */
const mix = {
  cannon: { level: 1, reach: 25 },
  splash: { level: 0.55, reach: 30 },
  hullCrack: { level: 0.85, reach: 25 },
  splinters: { level: 0.45, reach: 15 },
  hullThud: { level: 0.9, reach: 10 },
  whistle: { level: 0.8, reach: Number.POSITIVE_INFINITY },
  creak: { level: 0.22, reach: 10 },
  sinking: { level: 1, reach: 45 },
  plunge: { level: 1, reach: 45 },
  fuse: { level: 0.3, reach: 10 },
  bell: { level: 0.35, reach: Number.POSITIVE_INFINITY },
} as const

/** Share of each sound sent to both ears unpanned: a hard-panned sound still reaches the far ear, as it does outdoors. */
const centreShare = 0.3
/** Low-pass cutoff for air absorption: highs die with distance (12 kHz at 20 m, 2.7 kHz at 300 m). */
const airCutoff = (distance: number) => 16000 / (1 + distance / 60)
/** Reverb send: far sounds are mostly reflection off the water and other hulls. */
const reverbSend = (distance: number) => 0.12 + (0.6 * distance) / (distance + 150)
const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

interface Voice {
  readonly gain: GainNode
  readonly filter: BiquadFilterNode
  readonly panner: PannerNode
  readonly send: GainNode
  source: AudioBufferSourceNode | undefined
  endsAt: number
  level: number
  seconds: number
}

/** Counters for the debug hook and the sound test page. */
export interface AudioStats {
  readonly ready: boolean
  readonly state: string
  readonly voicesBusy: number
  readonly played: number
  readonly dropped: number
  readonly stolen: number
  /** Wall-clock milliseconds the worker took to synthesize the sound bank. */
  readonly bankMs: number
}

type Buffers = { readonly [Name in OneShotName]: ReadonlyArray<AudioBuffer> }

/** The running audio graph: master chain, voices, buffers and ambience, built once a context and the bank exist. */
interface SoundGraph {
  readonly context: BaseAudioContext
  readonly master: GainNode
  readonly ambienceBus: GainNode
  readonly output: AudioNode
  readonly voices: ReadonlyArray<Voice>
  readonly buffers: Buffers
  readonly ambience: ReadonlyMap<AmbienceLoopName, { readonly gain: GainNode; readonly filter: BiquadFilterNode | undefined }>
}

/** The sample rate the bank is rendered at before the play click; most desktop outputs run at it. */
const likelySampleRate = 48000

/**
 * The game's sound: every sound synthesized in code (a worker renders the bank at load; no asset files), played
 * positionally with distance loss, air absorption, speed-of-sound delay and an open-sea reverb, under an ambience of
 * sea, wind, rigging, hull wash and canvas that follows the wind, sail and speed. No AudioContext exists until
 * `start()` (the play click), per browser autoplay rules. A played sound allocates one AudioBufferSourceNode and nothing else.
 */
export class GameAudio {
  /** Resolves once the audio graph runs: after `start()` for the game, at once after the bank for a given context. */
  readonly ready: Promise<void>
  #markReady: () => void = () => undefined
  #bank: Promise<SoundBank>
  #graph: SoundGraph | undefined
  #context: BaseAudioContext | undefined
  readonly #whistled: Array<number> = Array.from({ length: 64 }, () => -1)
  #whistledNext = 0
  #volume = defaultVolume
  #paused = false
  #ambienceVolume = 1
  #lx = 0
  #ly = 0
  #lz = 0
  #fx = 0
  #fz = -1
  #ownX: number | undefined
  #ownY = 0
  #ownZ = 0
  #heel = Number.NaN
  #pitch = Number.NaN
  #ambienceClock = 0
  #phase: MatchPhaseSnapshot["_tag"] | undefined
  #played = 0
  #dropped = 0
  #stolen = 0
  #bankMs = 0

  /** `context` (an OfflineAudioContext, for analysis) is used as given and needs no `start()`. */
  constructor(options: { readonly context?: BaseAudioContext; readonly ambienceVolume?: number } = {}) {
    this.#ambienceVolume = options.ambienceVolume ?? 1
    this.ready = new Promise((resolve) => {
      this.#markReady = resolve
    })
    const started = performance.now()
    this.#bank = renderInWorker(options.context?.sampleRate ?? likelySampleRate)
    void this.#bank.then(() => {
      this.#bankMs = performance.now() - started
    })
    if (options.context !== undefined) this.#connect(options.context)
  }

  /** Creates and runs the AudioContext; call from the play click (autoplay policy). Later calls resume it. */
  start(): void {
    if (this.#context instanceof AudioContext) {
      void this.#context.resume()
      return
    }
    if (this.#context !== undefined) return
    const context = new AudioContext({ latencyHint: "interactive" })
    void context.resume()
    this.#connect(context)
  }

  /** The audio context once `start()` made it (or the one given), for meters and tests. */
  get context(): BaseAudioContext | undefined {
    return this.#context
  }

  /** Final mix after the limiter once running; the destination is connected, meters may tap it too. */
  get output(): AudioNode | undefined {
    return this.#graph?.output
  }

  #connect(context: BaseAudioContext) {
    this.#context = context
    // A device at another rate gets its own render rather than resampled buffers.
    if (context.sampleRate !== likelySampleRate) this.#bank = renderInWorker(context.sampleRate)
    void this.#bank.then((bank) => {
      this.#graph = buildSoundGraph(context, bank, this.#masterGain(), ambienceBusGain * this.#ambienceVolume)
      this.#markReady()
    })
  }

  /** Master volume 0–1 (perceptual: the gain is its square). */
  get volume(): number {
    return this.#volume
  }

  set volume(value: number) {
    this.#volume = Math.min(1, Math.max(0, value))
    this.#applyMaster(0.02)
  }

  /** True while the game is paused: the mix drops to `pausedShare` of the master. */
  get paused(): boolean {
    return this.#paused
  }

  set paused(value: boolean) {
    this.#paused = value
    this.#applyMaster(0.15)
  }

  #masterGain() {
    return this.#volume ** 2 * (this.#paused ? pausedShare : 1)
  }

  #applyMaster(glideSeconds: number) {
    const graph = this.#graph
    graph?.master.gain.setTargetAtTime(this.#masterGain(), graph.context.currentTime, glideSeconds)
  }

  /** Ambience (sea, wind, rigging, wash, canvas) volume 0–1 relative to the effects. */
  get ambienceVolume(): number {
    return this.#ambienceVolume
  }

  set ambienceVolume(value: number) {
    this.#ambienceVolume = Math.min(1, Math.max(0, value))
    const graph = this.#graph
    graph?.ambienceBus.gain.setTargetAtTime(ambienceBusGain * this.#ambienceVolume, graph.context.currentTime, 0.1)
  }

  /** Counters for the debug hook. */
  stats(): AudioStats {
    const graph = this.#graph
    const now = graph?.context.currentTime ?? 0
    let busy = 0
    for (const voice of graph?.voices ?? []) if (voice.endsAt > now) busy++
    return {
      ready: graph !== undefined,
      state: this.#context?.state ?? "not started",
      voicesBusy: busy,
      played: this.#played,
      dropped: this.#dropped,
      stolen: this.#stolen,
      bankMs: this.#bankMs,
    }
  }

  /** Per frame: the listener follows `camera`, the ambience follows wind, sail and speed, the hull creaks as it works, the bell marks phase changes. */
  update(dt: number, camera: Camera, own: ShipPose | undefined, windSpeed: number, phase: MatchPhaseSnapshot["_tag"]): void {
    const graph = this.#graph
    if (graph === undefined) return
    this.#listen(graph.context.listener, camera)
    const afloat = own !== undefined && own.life === "afloat" ? own : undefined
    this.#ownX = own?.x
    this.#ownY = own?.y ?? 0
    this.#ownZ = own?.z ?? 0
    this.#ambienceClock -= dt
    if (this.#ambienceClock <= 0) {
      this.#ambienceClock = ambienceStepSeconds
      this.#setAmbience(windSpeed, afloat)
    }
    if (afloat !== undefined && dt > 0) this.#creak(afloat, dt)
    else this.#heel = Number.NaN
    if (this.#phase !== undefined && phase !== this.#phase && (phase === "playing" || phase === "ended")) this.bell(phase === "playing" ? 2 : 4)
    this.#phase = phase
  }

  /**
   * A gun fired at (x, y, z) `lateSeconds` ago (negative: that far ahead): heard after the distance over the speed of
   * sound, darker and more reverberant far off. Passing the lateness keeps a ripple broadside's 50 ms spacing exact
   * although guns are noticed once per frame.
   */
  cannon(x: number, y: number, z: number, lateSeconds: number): void {
    const d = Math.hypot(x - this.#lx, y - this.#ly, z - this.#lz)
    const after = Math.max(-d / speedOfSound, -lateSeconds)
    this.#play(Math.random() < smoothstep(70, 260, d) ? "distantBoom" : "cannonBoom", x, y, z, mix.cannon.level, mix.cannon.reach, 0.94 + 0.12 * Math.random(), after, 0)
  }

  /** A ball meets the sea at `speed` m/s; faster balls throw bigger, deeper splashes. */
  splash(x: number, y: number, z: number, speed: number): void {
    const size = Math.min(1.3, Math.max(0.4, speed / 80))
    this.#play("splash", x, y, z, mix.splash.level * size, mix.splash.reach, 1.15 - 0.2 * size + 0.08 * Math.random(), 0, 0)
  }

  /** A ball smashes into a hull; on the listener's own hull the whole ship booms under it. */
  hullHit(x: number, y: number, z: number, ownHull: boolean): void {
    this.#play("hullCrack", x, y, z, mix.hullCrack.level, mix.hullCrack.reach, 0.92 + 0.16 * Math.random(), 0, 0)
    this.#play("splinters", x, y, z, mix.splinters.level, mix.splinters.reach, 0.9 + 0.2 * Math.random(), 0.02, 0)
    if (ownHull) this.#play("hullThud", x, y, z, mix.hullThud.level, mix.hullThud.reach, 0.95 + 0.1 * Math.random(), 0, 0)
  }

  /** A ball drawn at (x, y, z) at sim `time`; whistles once, timed to its closest pass, if it will pass near the listener. */
  ballFlying(ball: Cannonball, x: number, y: number, z: number, time: number): void {
    if (this.#graph === undefined || this.#whistled.includes(ball.id)) return
    const drag = tuning.guns.airDrag
    const decay = Math.exp(-drag * Math.max(0, time - ball.firedAt))
    const vx = ball.velocity.x * decay
    const vy = ball.velocity.y * decay - (tuning.physics.gravity * (1 - decay)) / drag
    const vz = ball.velocity.z * decay
    const rx = x - this.#lx
    const ry = y - this.#ly
    const rz = z - this.#lz
    const closestIn = -(rx * vx + ry * vy + rz * vz) / (vx * vx + vy * vy + vz * vz)
    if (!(closestIn >= 0 && closestIn <= whistlePeakSeconds)) return
    this.#whistled[this.#whistledNext] = ball.id
    this.#whistledNext = (this.#whistledNext + 1) % this.#whistled.length
    const px = rx + vx * closestIn
    const py = ry + vy * closestIn
    const pz = rz + vz * closestIn
    const miss = Math.hypot(px, py, pz)
    if (miss > whistleRange) return
    this.#play("whistle", this.#lx + px, this.#ly + py, this.#lz + pz, (mix.whistle.level * 10) / (10 + miss), mix.whistle.reach, 0.9 + 0.2 * Math.random(), 0, whistlePeakSeconds - closestIn)
  }

  /** A fuse taking at the own ship's touch holes; plays on the click so firing answers at once despite the network delay. */
  sizzle(): void {
    const x = this.#ownX ?? this.#lx + this.#fx
    this.#play("fuse", x, this.#ownX === undefined ? this.#ly : this.#ownY + 2, this.#ownX === undefined ? this.#lz + this.#fz : this.#ownZ, mix.fuse.level, mix.fuse.reach, 0.95 + 0.1 * Math.random(), 0, 0)
  }

  /** A ship's hull gives way at (x, y, z): a splitting crack, then the long groan of timbers as it founders. */
  sinking(x: number, y: number, z: number): void {
    this.#play("hullCrack", x, y, z, mix.sinking.level, mix.sinking.reach, 0.8, 0, 0)
    this.#play("splinters", x, y, z, mix.sinking.level * 0.6, mix.sinking.reach, 0.85, 0.03, 0)
    this.#play("sinkingGroan", x, y, z, mix.sinking.level, mix.sinking.reach, 0.9 + 0.2 * Math.random(), 0.15, 0)
  }

  /** The sea closes over a foundered hull at (x, y, z). */
  plunge(x: number, y: number, z: number): void {
    this.#play("plunge", x, y, z, mix.plunge.level, mix.plunge.reach, 0.9 + 0.2 * Math.random(), 0, 0)
  }

  /** The ship's bell struck `strikes` times in pairs, as on watch: marks battle start and end. */
  bell(strikes: number): void {
    for (let i = 0; i < strikes; i++) {
      const after = Math.floor(i / 2) * 0.9 + (i % 2) * 0.32
      this.#play("bell", this.#lx + this.#fx, this.#ly, this.#lz + this.#fz, mix.bell.level, mix.bell.reach, 1, after, 0)
    }
  }

  #play(name: OneShotName, x: number, y: number, z: number, level: number, reach: number, rate: number, after: number, offset: number) {
    const graph = this.#graph
    if (graph === undefined || graph.context.state === "closed") return
    const buffers = graph.buffers[name]
    const d = Math.hypot(x - this.#lx, y - this.#ly, z - this.#lz)
    const gain = level / (1 + d / reach)
    const now = graph.context.currentTime
    const buffer = buffers[Math.floor(Math.random() * buffers.length)]
    const voice = voiceFor(graph.voices, gain, now)
    if (voice === undefined || buffer === undefined) {
      this.#dropped++
      return
    }
    let when = now + after + d / speedOfSound
    const fader = voice.gain.gain
    fader.cancelScheduledValues(now)
    if (voice.source !== undefined && voice.endsAt > now) {
      // A stolen voice fades its old sound out over 5 ms rather than cutting it, which would click.
      fader.setValueAtTime(fader.value, now)
      fader.linearRampToValueAtTime(0, now + stealFadeSeconds)
      voice.source.stop(now + stealFadeSeconds)
      when = Math.max(when, now + stealFadeSeconds)
      this.#stolen++
    }
    fader.setValueAtTime(gain, when)
    voice.filter.frequency.value = airCutoff(d)
    voice.send.gain.value = reverbSend(d)
    voice.panner.positionX.value = x
    voice.panner.positionY.value = y
    voice.panner.positionZ.value = z
    const source = graph.context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.connect(voice.gain)
    source.start(when, offset * rate)
    voice.source = source
    voice.seconds = (buffer.duration - offset * rate) / rate
    voice.endsAt = when + voice.seconds
    voice.level = gain
    this.#played++
  }

  #listen(listener: AudioListener, camera: Camera) {
    const e = camera.matrixWorld.elements
    this.#lx = e[12] ?? 0
    this.#ly = e[13] ?? 0
    this.#lz = e[14] ?? 0
    this.#fx = -(e[8] ?? 0)
    this.#fz = -(e[10] ?? 0)
    const fy = -(e[9] ?? 0)
    if (listener.positionX === undefined) {
      // Firefox has only the deprecated setters.
      listener.setPosition(this.#lx, this.#ly, this.#lz)
      listener.setOrientation(this.#fx, fy, this.#fz, e[4] ?? 0, e[5] ?? 1, e[6] ?? 0)
      return
    }
    listener.positionX.value = this.#lx
    listener.positionY.value = this.#ly
    listener.positionZ.value = this.#lz
    listener.forwardX.value = this.#fx
    listener.forwardY.value = fy
    listener.forwardZ.value = this.#fz
    listener.upX.value = e[4] ?? 0
    listener.upY.value = e[5] ?? 1
    listener.upZ.value = e[6] ?? 0
  }

  #setAmbience(windSpeed: number, own: ShipPose | undefined) {
    const w = Math.min(1.5, windSpeed / tuning.wind.referenceSpeed)
    const sail = own?.sailSet ?? 0
    const speed = own === undefined ? 0 : Math.hypot(own.vx, own.vz)
    const graph = this.#graph
    if (graph === undefined) return
    const now = graph.context.currentTime
    const set = (name: AmbienceLoopName, level: number) => graph.ambience.get(name)?.gain.gain.setTargetAtTime(level, now, ambienceGlideSeconds)
    set("ocean", 0.45 * (0.8 + 0.3 * w))
    set("wind", 0.08 + 0.3 * w ** 1.5)
    graph.ambience.get("wind")?.filter?.frequency.setTargetAtTime(500 + 2500 * w, now, ambienceGlideSeconds)
    set("rigging", 0.22 * w * w * (0.35 + 0.65 * sail))
    set("hullWash", 0.5 * Math.min(1, speed / 12) ** 1.3)
    set("sails", 0.3 * sail * w)
  }

  /** Creaks come as a random (Poisson) stream, faster as the hull rolls, pitches and answers the helm. */
  #creak(own: ShipPose, dt: number) {
    const heel = 2 * (own.qy * own.qz - own.qw * own.qx)
    const pitch = 2 * (own.qx * own.qy + own.qw * own.qz)
    const heelRate = Number.isNaN(this.#heel) ? 0 : Math.abs(heel - this.#heel) / dt
    const pitchRate = Number.isNaN(this.#pitch) ? 0 : Math.abs(pitch - this.#pitch) / dt
    this.#heel = heel
    this.#pitch = pitch
    const perSecond = 0.1 + 5 * heelRate + 5 * pitchRate + 0.4 * Math.abs(own.rudderAngle)
    if (Math.random() >= perSecond * dt) return
    const x = own.x + (Math.random() - 0.5) * 16
    const z = own.z + (Math.random() - 0.5) * 16
    this.#play("creak", x, own.y + 1, z, mix.creak.level * (0.6 + 0.8 * Math.random()), mix.creak.reach, 0.85 + 0.35 * Math.random(), 0, 0)
  }
}

/** A free voice, else the one with the least sound left if that is quieter than `gain`. */
const voiceFor = (voices: ReadonlyArray<Voice>, gain: number, now: number): Voice | undefined => {
  let best: Voice | undefined
  let bestLeft = gain
  for (let i = 0; i < voices.length; i++) {
    const voice = voices[i]
    if (voice === undefined) continue
    if (voice.endsAt <= now) return voice
    const left = voice.level * Math.min(1, (voice.endsAt - now) / voice.seconds)
    if (left < bestLeft) {
      bestLeft = left
      best = voice
    }
  }
  return best
}

/** Builds the master chain (glue compressor, limiter, soft clip), the voices, the reverb and the running ambience beds. */
const buildSoundGraph = (c: BaseAudioContext, bank: SoundBank, masterGain: number, ambienceGain: number): SoundGraph => {
  const master = new GainNode(c, { gain: masterGain })
  const glue = new DynamicsCompressorNode(c, { threshold: -20, knee: 10, ratio: 3, attack: 0.006, release: 0.3 })
  const limiter = new DynamicsCompressorNode(c, { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.12 })
  const clipper = new WaveShaperNode(c, { curve: softClipCurve(), oversample: "2x" })
  master.connect(glue).connect(limiter).connect(clipper).connect(c.destination)
  const sfx = new GainNode(c, { gain: 0.8 })
  sfx.connect(master)
  const ambienceBus = new GainNode(c, { gain: ambienceGain })
  ambienceBus.connect(master)
  // Mono into the two-channel impulse response: every sound's reflections arrive from both sides.
  const reverbIn = new GainNode(c, { gain: 1, channelCount: 1, channelCountMode: "explicit" })
  const voices: Array<Voice> = []
  for (let i = 0; i < voiceCount; i++) {
    const gain = new GainNode(c, { gain: 0 })
    const filter = new BiquadFilterNode(c, { type: "lowpass", frequency: 16000, Q: 0.7 })
    const panner = new PannerNode(c, { panningModel: "equalpower", distanceModel: "linear", rolloffFactor: 0 })
    const send = new GainNode(c, { gain: 0 })
    gain.connect(filter).connect(panner).connect(sfx)
    filter.connect(new GainNode(c, { gain: centreShare, channelCount: 1, channelCountMode: "explicit" })).connect(sfx)
    panner.connect(send).connect(reverbIn)
    voices.push({ gain, filter, panner, send, source: undefined, endsAt: 0, level: 0, seconds: 1 })
  }
  const toBuffer = (samples: Float32Array) => {
    const buffer = c.createBuffer(1, samples.length, bank.sampleRate)
    buffer.getChannelData(0).set(samples)
    return buffer
  }
  const one = bank.oneShots
  const buffers: Buffers = {
    cannonBoom: one.cannonBoom.map(toBuffer),
    distantBoom: one.distantBoom.map(toBuffer),
    splash: one.splash.map(toBuffer),
    hullCrack: one.hullCrack.map(toBuffer),
    splinters: one.splinters.map(toBuffer),
    hullThud: one.hullThud.map(toBuffer),
    whistle: one.whistle.map(toBuffer),
    creak: one.creak.map(toBuffer),
    sinkingGroan: one.sinkingGroan.map(toBuffer),
    plunge: one.plunge.map(toBuffer),
    fuse: one.fuse.map(toBuffer),
    bell: one.bell.map(toBuffer),
  }
  const reverb = c.createBuffer(2, bank.reverb[0].length, bank.sampleRate)
  reverb.getChannelData(0).set(bank.reverb[0])
  reverb.getChannelData(1).set(bank.reverb[1])
  reverbIn.connect(new ConvolverNode(c, { buffer: reverb })).connect(new GainNode(c, { gain: 0.4 })).connect(master)
  const ambience = new Map<AmbienceLoopName, { readonly gain: GainNode; readonly filter: BiquadFilterNode | undefined }>()
  for (const name of ["ocean", "wind", "rigging", "hullWash", "sails"] as const) {
    const buffer = toBuffer(bank.loops[name])
    const merger = new ChannelMergerNode(c, { numberOfInputs: 2 })
    // The same loop half a loop apart in each ear decorrelates the channels: a wide bed from mono samples.
    for (let ear = 0; ear < 2; ear++) {
      const source = new AudioBufferSourceNode(c, { buffer, loop: true })
      source.connect(merger, 0, ear)
      source.start(0, ear * buffer.duration * 0.5)
    }
    const filter = name === "wind" ? new BiquadFilterNode(c, { type: "lowpass", frequency: 1500, Q: 0.5 }) : undefined
    const gain = new GainNode(c, { gain: 0 })
    if (filter === undefined) merger.connect(gain)
    else merger.connect(filter).connect(gain)
    gain.connect(ambienceBus)
    ambience.set(name, { gain, filter })
  }
  return { context: c, master, ambienceBus, output: clipper, voices, buffers, ambience }
}

const renderInWorker = (sampleRate: number) =>
  new Promise<SoundBank>((resolve, reject) => {
    const worker = new Worker(new URL("./sound-bank-worker.ts", import.meta.url), { type: "module" })
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      worker.terminate()
      // SAFETY: our own worker posts exactly one `renderSoundBank` result.
      resolve(event.data as SoundBank)
    })
    worker.addEventListener("error", (event) => {
      worker.terminate()
      reject(new Error(`sound bank worker failed: ${event.message}`))
    })
    worker.postMessage(sampleRate)
  })

/** Identity to ±0.8, then a tanh knee to ±0.98: a last guard behind the limiter so an overshoot bends instead of clipping. */
const softClipCurve = () => {
  const curve = new Float32Array(4097)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    const a = Math.abs(x)
    curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18))
  }
  return curve
}
