import { PerspectiveCamera } from "three"
import { ballId, writeBallPosition, type Cannonball } from "../../sim/gunnery.ts"
import { shipId } from "../../sim/ship.ts"
import { ShipPose } from "../game/timeline.ts"
import { GameAudio } from "./game-audio.ts"
import { seededRandom } from "./dsp.ts"
import { bandShare, countAttacks, decaySeconds, envelopeFrames, onsetSeconds, peakLevel, rmsLevel, spectralCentroid } from "./sound-analysis.ts"

/** Numbers measured from one sound rendered offline through the game mixer. */
export interface SoundMeasure {
  readonly peak: number
  readonly rmsDb: number
  readonly onset: number
  readonly decay40: number
  readonly centroidHz: number
  readonly below150: number
  /** Right minus left energy, dB: positive when the sound sits to the right. */
  readonly rightDb: number
  readonly attacks: number
  /** Seconds of the loudest 10 ms window. */
  readonly loudestAt: number
}

/** What `window.soundTest` offers Playwright. */
export interface SoundTestHook {
  readonly analyse: () => Promise<Record<string, unknown>>
  /** Warms the sound paths and waits until every voice is free, so `fireBroadside` measures a clean start. */
  readonly prepareBroadside: () => Promise<void>
  readonly fireBroadside: () => Record<string, unknown>
}

declare global {
  interface Window {
    soundTest?: SoundTestHook
  }
}

const sampleRate = 48000
type At = (time: number, action: () => void) => void

/** The listener: 2 m up at the origin facing −z; bearing 90° is to its right (+x). */
const listenerCamera = () => {
  const camera = new PerspectiveCamera()
  camera.position.set(0, 2, 0)
  camera.updateMatrixWorld()
  return camera
}

const placeAt = (distance: number, bearingDegrees: number) => {
  const b = (bearingDegrees * Math.PI) / 180
  return { x: distance * Math.sin(b), y: 2, z: -distance * Math.cos(b) }
}

/** Twelve guns along a 20 m hull at (x, z), rippling 50 ms apart from `time`. */
const broadside = (audio: GameAudio, at: At, time: number, x: number, z: number, along: number) => {
  for (let gun = 0; gun < 12; gun++) {
    const offset = (gun - 5.5) * 1.7
    at(time, () => audio.cannon(x + Math.cos(along) * offset, 2.5, z + Math.sin(along) * offset, -gun * 0.05))
  }
}

/** A ball fired from 220 m off the listener's left that passes `miss` metres ahead of it; returns the sim time of its closest pass. */
const flyBy = (audio: GameAudio, at: At, time: number, miss: number, until: number) => {
  const ball: Cannonball = {
    id: ballId(Math.floor(Math.random() * 1e9)),
    shooter: shipId("enemy"),
    gun: 0,
    origin: { x: -220, y: 3, z: -miss },
    velocity: { x: 90, y: 12.5, z: 0 },
    firedAt: time,
  }
  const p = { x: 0, y: 0, z: 0 }
  let closest = time
  let best = Number.POSITIVE_INFINITY
  for (let t = time; t < until; t += 0.016) {
    writeBallPosition(ball, t, p)
    const d = Math.hypot(p.x, p.y - 2, p.z)
    if (d < best) {
      best = d
      closest = t
    }
    const x = p.x
    const y = p.y
    const z = p.z
    at(t, () => audio.ballFlying(ball, x, y, z, t))
  }
  return closest
}

/** An own ship under way 20 m ahead of the listener, rolling `rollDegrees` in a 7 s swell and pitching a little. */
const writeRollingShip = (pose: ShipPose, time: number, speed: number, sail: number, rollDegrees: number) => {
  const heel = ((rollDegrees * Math.PI) / 180) * Math.sin((2 * Math.PI * time) / 7)
  const pitch = 0.015 * Math.sin((2 * Math.PI * time) / 4.3)
  pose.x = 0
  pose.y = 0
  pose.z = -20
  pose.qx = Math.sin(heel / 2)
  pose.qy = 0
  pose.qz = Math.sin(pitch / 2)
  pose.qw = Math.sqrt(1 - pose.qx * pose.qx - pose.qz * pose.qz)
  pose.vx = speed
  pose.vz = 0
  pose.sailSet = sail
  pose.life = "afloat"
}

/**
 * A 12-ship battle: own ship ahead of the listener and eleven others 60–450 m off, each firing a full broadside
 * every 6–9 s, a third of the balls hitting hulls (some our own), the rest splashing, one ship sinking. Returns event counts.
 */
const battle = (audio: GameAudio, at: At, camera: PerspectiveCamera, seconds: number) => {
  const random = seededRandom(1234)
  const ships = [{ x: 0, z: -20 }]
  for (let i = 0; i < 11; i++) ships.push(placeAt(60 + 390 * random(), 360 * random() - 180))
  const pose = new ShipPose()
  const counts = { cannon: 0, splash: 0, hit: 0, ownHit: 0 }
  for (let t = 0.05; t < seconds; t += 0.1) {
    at(t, () => {
      writeRollingShip(pose, t, 9, 1, 6)
      audio.update(0.1, camera, pose, 14, "playing")
    })
  }
  ships.forEach((ship, index) => {
    const period = 6 + 3 * random()
    for (let t = 0.3 + 5 * random(); t < seconds - 3; t += period) {
      broadside(audio, at, t, ship.x, ship.z, random() * Math.PI)
      counts.cannon += 12
      const targetIndex = (index + 1 + Math.floor(random() * 11)) % ships.length
      const target = ships[targetIndex] ?? ship
      const flight = Math.hypot(target.x - ship.x, target.z - ship.z) / 80
      for (let gun = 0; gun < 12; gun++) {
        const land = t + gun * 0.05 + flight * (0.9 + 0.2 * random())
        if (random() < 0.35) {
          const own = targetIndex === 0
          at(land, () => audio.hullHit(target.x + 8 * (random() - 0.5), 2, target.z + 3 * (random() - 0.5), own))
          if (own) counts.ownHit++
          else counts.hit++
        } else {
          at(land, () => audio.splash(target.x + 30 * (random() - 0.5), 0, target.z + 30 * (random() - 0.5), 70))
          counts.splash++
        }
      }
    }
  })
  const sinker = ships[3] ?? { x: 0, z: -100 }
  at(12, () => audio.sinking(sinker.x, 1, sinker.z))
  at(15.5, () => audio.plunge(sinker.x, 0, sinker.z))
  return counts
}

const render = async (seconds: number, ambienceVolume: number, setup: (audio: GameAudio, at: At, camera: PerspectiveCamera) => void) => {
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(seconds * sampleRate), sampleRate })
  const audio = new GameAudio({ context, ambienceVolume })
  await audio.ready
  const camera = listenerCamera()
  audio.update(0, camera, undefined, 0, "playing")
  const quanta = new Map<number, Array<() => void>>()
  setup(audio, (time, action) => {
    const q = Math.max(1, Math.round((time * sampleRate) / 128))
    const list = quanta.get(q)
    if (list === undefined) quanta.set(q, [action])
    else list.push(action)
  }, camera)
  for (const [q, actions] of quanta) {
    if (q * 128 >= context.length) continue
    void context.suspend((q * 128) / sampleRate).then(() => {
      for (const action of actions) action()
      void context.resume()
    })
  }
  const rendered = await context.startRendering()
  return { left: rendered.getChannelData(0), right: rendered.getChannelData(1), stats: audio.stats() }
}

const measure = (left: Float32Array, right: Float32Array): SoundMeasure => {
  const mono = new Float32Array(left.length)
  for (let i = 0; i < mono.length; i++) mono[i] = ((left[i] ?? 0) + (right[i] ?? 0)) / 2
  const env = envelopeFrames(mono, sampleRate, 0.01)
  let loudest = 0
  for (let f = 0; f < env.length; f++) if ((env[f] ?? 0) > (env[loudest] ?? 0)) loudest = f
  const round = (x: number, digits = 3) => Number(x.toFixed(digits))
  return {
    peak: round(Math.max(peakLevel(left), peakLevel(right))),
    rmsDb: round(20 * Math.log10(rmsLevel(mono)), 1),
    onset: round(onsetSeconds(mono, sampleRate)),
    decay40: round(decaySeconds(mono, sampleRate)),
    centroidHz: Math.round(spectralCentroid(mono, sampleRate)),
    below150: round(bandShare(mono, sampleRate, 0, 150)),
    rightDb: round(20 * Math.log10(rmsLevel(right) / rmsLevel(left)), 1),
    attacks: countAttacks(mono, sampleRate),
    loudestAt: round(loudest * 0.01, 2),
  }
}

const analyse = async () => {
  const one = async (seconds: number, play: (audio: GameAudio, at: At) => void) => {
    const { left, right } = await render(seconds, 0, (audio, at) => play(audio, at))
    return measure(left, right)
  }
  const p20 = placeAt(20, 30)
  const p300 = placeAt(300, 0)
  const pLeft = placeAt(30, -90)
  const p60 = placeAt(60, 20)
  const p80 = placeAt(80, -30)
  let closest = 0
  const report: Record<string, unknown> = {
    cannon20m: await one(4, (a, at) => at(0.1, () => a.cannon(p20.x, p20.y, p20.z, 0))),
    cannon300m: await one(6, (a, at) => at(0.1, () => a.cannon(p300.x, p300.y, p300.z, 0))),
    cannon30mLeft: await one(4, (a, at) => at(0.1, () => a.cannon(pLeft.x, pLeft.y, pLeft.z, 0))),
    broadside40m: await one(5, (a, at) => broadside(a, at, 0.1, 40, 0, Math.PI / 2)),
    splash60m: await one(3, (a, at) => at(0.1, () => a.splash(p60.x, 0, p60.z, 80))),
    hullHit40m: await one(2, (a, at) => at(0.1, () => a.hullHit(p60.x * 0.66, 2, p60.z * 0.66, false))),
    ownHullHit6m: await one(2, (a, at) => at(0.1, () => a.hullHit(0, 1, -6, true))),
    whistle8m: await one(5, (a, at) => {
      closest = flyBy(a, at, 0.1, 8, 4.5)
    }),
    fuse: await one(1, (a, at) => at(0.1, () => a.sizzle())),
    sinking80m: await one(7, (a, at) => at(0.1, () => a.sinking(p80.x, 1, p80.z))),
    plunge80m: await one(5, (a, at) => at(0.1, () => a.plunge(p80.x, 0, p80.z))),
    bell2: await one(4, (a, at) => at(0.1, () => a.bell(2))),
  }
  report.whistleClosestPass = Number(closest.toFixed(3))
  const ambience = async (wind: number, sail: number, speed: number, roll: number) => {
    const { left, right, stats } = await render(12, 1, (audio, at, camera) => {
      const pose = new ShipPose()
      for (let t = 0.02; t < 12; t += 0.02) {
        at(t, () => {
          writeRollingShip(pose, t, speed, sail, roll)
          audio.update(0.02, camera, pose, wind, "playing")
        })
      }
    })
    // The first 3 s are the ambience gliding in from silence.
    const from = 3 * sampleRate
    return { ...measure(left.subarray(from), right.subarray(from)), creaks: stats.played }
  }
  report.ambienceCalm = await ambience(3, 0, 0, 1)
  report.ambienceGale = await ambience(20, 1, 12, 10)
  let counts = {}
  const renderStarted = performance.now()
  const fight = await render(25, 1, (audio, at, camera) => {
    counts = battle(audio, at, camera, 25)
  })
  const over = (limit: number) => {
    let n = 0
    for (const channel of [fight.left, fight.right]) for (let i = 0; i < channel.length; i++) if (Math.abs(channel[i] ?? 0) > limit) n++
    return n / (fight.left.length * 2)
  }
  report.battle = { ...measure(fight.left, fight.right), events: counts, renderMs: Math.round(performance.now() - renderStarted), over0_8: over(0.8), over0_95: over(0.95), stats: fight.stats }
  return report
}

const fleet = Array.from({ length: 12 }, (_, i) => placeAt(20 + i * 35, i * 30 - 165))

const prepareBroadside = async () => {
  live.start()
  await live.ready
  // Warm the code paths with one ship's broadside, then let every voice fall free before measuring twelve.
  for (let gun = 0; gun < 12; gun++) live.cannon(0, 2.5, -40, -gun * 0.05)
  live.splash(0, 0, -40, 75)
  live.hullHit(0, 2, -40, false)
  await new Promise((resolve) => setTimeout(resolve, 5500))
}

/** Twelve ships fire full broadsides in one frame (144 guns), then all 144 balls land in the next: the worst frames of a battle. */
const fireBroadside = () => {
  const audio = live
  let sources = 0
  let buffers = 0
  const proto = BaseAudioContext.prototype
  const createSource = proto.createBufferSource
  const createBuffer = proto.createBuffer
  proto.createBufferSource = function (this: BaseAudioContext) {
    sources++
    return createSource.call(this)
  }
  proto.createBuffer = function (this: BaseAudioContext, channels: number, length: number, rate: number) {
    buffers++
    return createBuffer.call(this, channels, length, rate)
  }
  const fire = () => {
    for (const ship of fleet) for (let gun = 0; gun < 12; gun++) audio.cannon(ship.x + gun * 1.7, 2.5, ship.z, -gun * 0.05)
  }
  const land = () => {
    for (const ship of fleet) {
      for (let gun = 0; gun < 12; gun++) {
        if (gun % 3 === 0) audio.hullHit(ship.x, 2, ship.z, false)
        else audio.splash(ship.x + gun, 0, ship.z, 75)
      }
    }
  }
  const t0 = performance.now()
  fire()
  const t1 = performance.now()
  land()
  const t2 = performance.now()
  proto.createBufferSource = createSource
  proto.createBuffer = createBuffer
  const stats = audio.stats()
  return {
    calls: { cannon: 144, landings: 144 },
    fireMs: Number((t1 - t0).toFixed(2)),
    landMs: Number((t2 - t1).toFixed(2)),
    sourcesCreated: sources,
    buffersCreated: buffers,
    state: audio.context?.state,
    stats,
  }
}

const live = new GameAudio()
const camera = listenerCamera()
const input = (id: string) => {
  const element = document.querySelector<HTMLInputElement>(`#${id}`)
  if (element === null) throw new Error(`sound.html is missing #${id}`)
  const output = document.querySelector<HTMLOutputElement>(`output[for="${id}"]`)
  const show = () => output?.replaceChildren(element.value)
  element.addEventListener("input", show)
  show()
  return element
}
const distance = input("distance")
const bearing = input("bearing")
const volume = input("volume")
const wind = input("wind")
const sail = input("sail")
const speed = input("speed")
const roll = input("roll")
volume.value = String(Math.round(live.volume * 100))
volume.dispatchEvent(new Event("input"))
volume.addEventListener("input", () => {
  live.volume = Number(volume.value) / 100
})
const where = () => placeAt(Number(distance.value), Number(bearing.value))
/** Runs `action` `time` seconds from now. */
const liveAt: At = (time, action) => {
  setTimeout(action, time * 1000)
}

let atSea = false
const seaButton = document.querySelector<HTMLButtonElement>("#at-sea")
if (seaButton === null) throw new Error("sound.html is missing #at-sea")

const shots: ReadonlyArray<readonly [string, () => void]> = [
  ["Cannon", () => { const p = where(); live.cannon(p.x, p.y, p.z, 0) }],
  ["Broadside", () => { const p = where(); broadside(live, liveAt, 0, p.x, p.z, Math.PI / 2) }],
  ["Splash", () => { const p = where(); live.splash(p.x, 0, p.z, 80) }],
  ["Hull hit", () => { const p = where(); live.hullHit(p.x, 2, p.z, false) }],
  ["Hit on own hull", () => live.hullHit(0, 1, -6, true)],
  ["Near miss (8 m)", () => { flyBy(live, liveAt, 0, 8, 4) }],
  ["Fuse", () => live.sizzle()],
  ["Sinking", () => { const p = where(); live.sinking(p.x, 1, p.z) }],
  ["Plunge", () => { const p = where(); live.plunge(p.x, 0, p.z) }],
  ["Bell: battle begins", () => live.bell(2)],
  ["Bell: battle ends", () => live.bell(4)],
  ["12-ship battle (25 s)", () => { atSea = true; seaButton.setAttribute("aria-pressed", "true"); battle(live, liveAt, camera, 25) }],
]
const shotsSection = document.querySelector("#shots")
for (const [label, play] of shots) {
  const button = document.createElement("button")
  button.textContent = label
  button.addEventListener("click", () => {
    live.start()
    play()
  })
  shotsSection?.append(button)
}

seaButton.addEventListener("click", () => {
  live.start()
  atSea = !atSea
  seaButton.setAttribute("aria-pressed", String(atSea))
})

let meter: AnalyserNode | undefined
void live.ready.then(() => {
  const context = live.context
  if (context === undefined) return
  meter = new AnalyserNode(context, { fftSize: 2048 })
  live.output?.connect(meter)
})
const samples = new Float32Array(2048)
const bar = document.querySelector<HTMLElement>("#meter div")
const statsText = document.querySelector<HTMLElement>("#stats")
const pose = new ShipPose()
let last = performance.now()
let hold = 0
const frame = (now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  writeRollingShip(pose, now / 1000, Number(speed.value), Number(sail.value) / 100, Number(roll.value))
  if (live.ambienceVolume !== (atSea ? 1 : 0)) live.ambienceVolume = atSea ? 1 : 0
  live.update(dt, camera, atSea ? pose : undefined, Number(wind.value), "playing")
  meter?.getFloatTimeDomainData(samples)
  hold = Math.max(meter === undefined ? 0 : peakLevel(samples), hold * 0.95)
  if (bar !== null) bar.style.width = `${Math.min(100, hold * 100)}%`
  const s = live.stats()
  statsText?.replaceChildren(`peak ${hold.toFixed(2)}  voices ${s.voicesBusy}  played ${s.played}  dropped ${s.dropped}  stolen ${s.stolen}  bank ${s.bankMs.toFixed(0)} ms  ${s.state}`)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

window.soundTest = { analyse, prepareBroadside, fireBroadside }
