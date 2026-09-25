import { PointLight, Quaternion, Vector3, type Camera, type Scene } from "three"
import { oceanHeight, type SeaState } from "../../sim/ocean.ts"
import type { GameAudio } from "../audio/game-audio.ts"
import type { Effects } from "./effects.ts"
import type { ShipPose } from "./timeline.ts"

/** Emission per fire per second at full strength: tongues of flame, and smoke puffs near and far. */
const flameHz = { near: 30, far: 10 } as const
const smokeHz = { near: 8, far: 3 } as const
/** Metres flames stand off the planking they burn from, so the soft-particle fade against the hull does not swallow them. */
const standOff = 0.7
/** Metres from the camera past which a fire draws fewer, bigger particles, and past which it shows only smoke. */
const nearMetres = 260
const flameMetres = 900
/** Seconds a fire takes to flare up to full strength, and seconds before it burns out that it starts to die down. */
const flareSeconds = 1.2
const dieSeconds = 4
/** A fire caught longer ago than this when first drawn (a late join) catches without the whoosh. */
const freshSeconds = 1
/** Crackle sounds per second per fire (up to three fires a ship) within earshot, metres. */
const crackleHz = 1.4
const earshot = 220
/** Fire lights: the two fires nearest the camera light the hulls round them, flickering. */
const lightCount = 2
const lightPeak = 1400
const lightColor = 0xff7a2e

interface Burning {
  flameBudget: number
  smokeBudget: number
  crackleClock: number
  cursor: number
  /** Latest `since` of a fire already drawn; newer fires catch with a whoosh. */
  seen: number
}

/**
 * Draws the fires burning on every ship: tongues of flame leaning with the apparent wind, glow, embers, and a thick black
 * column of smoke that climbs and bends over downwind; a whoosh as each fire catches; crackle within earshot; and two
 * flickering lights at the fires nearest the camera. Particles are fewer and bigger for far ships; nothing allocates per frame.
 */
export class ShipFires {
  readonly #effects: Effects
  readonly #audio: GameAudio
  readonly #state = new Map<string, Burning>()
  readonly #lights: ReadonlyArray<PointLight>
  readonly #lightAt = Array.from({ length: lightCount }, () => new Vector3())
  readonly #lightStrength = new Float32Array(lightCount)
  readonly #lightDistance = new Float32Array(lightCount)
  readonly #q = new Quaternion()
  readonly #p = new Vector3()
  #time = 0

  constructor(scene: Scene, effects: Effects, audio: GameAudio) {
    this.#effects = effects
    this.#audio = audio
    this.#lights = Array.from({ length: lightCount }, () => {
      const light = new PointLight(lightColor, 0, 0, 2)
      scene.add(light)
      return light
    })
  }

  /** Starts a frame: forgets last frame's nearest fires. */
  begin(dt: number): void {
    this.#time += dt
    this.#lightStrength.fill(0)
    this.#lightDistance.fill(Number.POSITIVE_INFINITY)
  }

  /** Draws ship `id`'s fires for this frame from its pose; wind in m/s. */
  update(id: string, pose: ShipPose, dt: number, renderTime: number, sea: SeaState, camera: Camera, windX: number, windZ: number): void {
    const fires = pose.fires
    let state = this.#state.get(id)
    if (fires.length === 0 || pose.life === "sunk") {
      if (state !== undefined) state.seen = Math.max(state.seen, fires.at(-1)?.since ?? state.seen)
      return
    }
    if (state === undefined) {
      state = { flameBudget: 0, smokeBudget: 0, crackleClock: 0, cursor: 0, seen: Number.NEGATIVE_INFINITY }
      this.#state.set(id, state)
    }
    const effects = this.#effects
    const e = camera.matrixWorld.elements
    const cx = e[12]!
    const cy = e[13]!
    const cz = e[14]!
    const distance = Math.hypot(pose.x - cx, pose.y - cy, pose.z - cz)
    const near = distance < nearMetres
    this.#q.set(pose.qx, pose.qy, pose.qz, pose.qw)
    // Flames lean into the air moving past them: the wind, less the ship's own way through it.
    const airX = windX * 0.35 - pose.vx * 0.6
    const airZ = windZ * 0.35 - pose.vz * 0.6
    const lean = -Math.atan2(airX * e[0]! + airZ * e[2]!, 6)

    for (let i = 0; i < fires.length; i++) {
      const fire = fires[i]!
      if (fire.since <= state.seen) continue
      state.seen = fire.since
      if (renderTime - fire.since > freshSeconds) continue
      const at = this.#world(pose, fire.at)
      effects.ignite(at.x, at.y, at.z, pose.vx, pose.vy, pose.vz)
      this.#audio.ignite(at.x, at.y, at.z)
    }

    state.flameBudget += dt * fires.length * (near ? flameHz.near : flameHz.far)
    state.smokeBudget += dt * fires.length * (near ? smokeHz.near : smokeHz.far)
    const flames = distance < flameMetres
    while (state.flameBudget >= 1 || state.smokeBudget >= 1) {
      const fire = fires[state.cursor++ % fires.length]!
      const k = Math.max(0.15, Math.min(1, (renderTime - fire.since) / flareSeconds)) * Math.max(0, Math.min(1, (fire.endsAt - renderTime) / dieSeconds))
      const at = this.#world(pose, fire.at, standOff)
      const drowned = at.y < oceanHeight(sea, at.x, at.z, renderTime) + 0.2
      if (state.flameBudget >= 1) {
        state.flameBudget -= 1
        if (flames && !drowned && Math.random() < 0.3 + 0.7 * k) effects.flame(at.x, at.y, at.z, pose.vx, pose.vy, pose.vz, lean, k)
      }
      if (state.smokeBudget >= 1) {
        state.smokeBudget -= 1
        if (!drowned && k > 0.05) effects.fireSmoke(at.x, at.y, at.z, pose.vx, pose.vz, k, near ? 1 : 1.6)
      }
      if (!drowned) this.#offerLight(at, Math.hypot(at.x - cx, at.y - cy, at.z - cz), k)
    }

    if (distance > earshot) return
    state.crackleClock -= dt * crackleHz * Math.min(3, fires.length)
    if (state.crackleClock > 0) return
    state.crackleClock += -Math.log(1 - Math.random() * 0.95)
    const fire = fires[Math.floor(Math.random() * fires.length)]!
    const at = this.#world(pose, fire.at)
    this.#audio.fireCrackle(at.x, at.y, at.z)
  }

  /** Ends a frame: the lights go to the nearest fires and flicker. */
  end(): void {
    const t = this.#time
    for (let i = 0; i < lightCount; i++) {
      const light = this.#lights[i]!
      const strength = this.#lightStrength[i]!
      if (strength <= 0) {
        light.intensity = 0
        continue
      }
      light.position.copy(this.#lightAt[i]!)
      const flicker = 0.72 + 0.16 * Math.sin(t * 23 + i * 2.1) + 0.12 * Math.sin(t * 57.3 + i) * Math.sin(t * 7.7)
      light.intensity = lightPeak * strength * flicker
    }
  }

  /** Drops the state of a ship no longer in the world. */
  forget(id: string): void {
    this.#state.delete(id)
  }

  /** Keeps the nearest fires to the camera for the lights, one slot per ship-fire sample seen this frame. */
  #offerLight(at: Vector3, distance: number, k: number) {
    const slots = this.#lightDistance
    let worst = 0
    for (let i = 1; i < lightCount; i++) if (slots[i]! > slots[worst]!) worst = i
    // A fire within a few metres of a lit one shares its light.
    for (let i = 0; i < lightCount; i++) {
      if (slots[i] !== Number.POSITIVE_INFINITY && this.#lightAt[i]!.distanceToSquared(at) < 36) {
        this.#lightStrength[i] = Math.max(this.#lightStrength[i]!, k)
        return
      }
    }
    if (distance >= slots[worst]!) return
    slots[worst] = distance
    this.#lightAt[worst]!.set(at.x, at.y + 1.2, at.z)
    this.#lightStrength[worst] = k
  }

  /** World point of a ship-local fire, `out` metres further outboard. */
  #world(pose: ShipPose, local: readonly [number, number, number], out = 0) {
    const p = this.#p.set(local[0], local[1], local[2] + Math.sign(local[2]) * out).applyQuaternion(this.#q)
    p.x += pose.x
    p.y += pose.y
    p.z += pose.z
    return p
  }
}
