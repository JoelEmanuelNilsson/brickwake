import type { WindSnapshot } from "../../protocol/messages.ts"
import type { SeaState } from "../../sim/ocean.ts"
import { stepShip, type ShipState } from "../../sim/ship.ts"
import { SIM_DT, tuning } from "../../sim/tuning.ts"
import { makeWind } from "../../sim/wind.ts"
import { shipFlooding } from "../../sim/wreck.ts"
import type { ChaseCamera } from "./chase-camera.ts"
import type { ShipView } from "./ship-view.ts"
import type { SinkingShips } from "./sinking.ts"

interface Hulk {
  readonly key: string
  readonly view: ShipView
  readonly flooding: Float64Array
  /** The hull at sim time `time`, and one tick before it. */
  from: ShipState
  to: ShipState
  time: number
}

/**
 * Hulls that sunk ships left behind as they respawned. The sim is done with them, so each sinks on here alone: the
 * same `stepShip` from the state the server handed over, in the view the ship was drawn in, until the sea hides it.
 */
export class Hulks {
  readonly #sinking: SinkingShips
  readonly #release: (view: ShipView) => void
  readonly #hulks: Array<Hulk> = []
  #made = 0

  /** `release` takes back each view once its hulk is gone. */
  constructor(sinking: SinkingShips, release: (view: ShipView) => void) {
    this.#sinking = sinking
    this.#release = release
  }

  /** Ship `id` respawned and leaves `view`, drawn foundering, as hulk `hulk` at sim time `time`. */
  add(id: string, view: ShipView, hulk: ShipState, time: number): void {
    const key = `${id} hulk ${++this.#made}`
    view.group.name = key
    this.#sinking.handOff(id, key)
    this.#hulks.push({ key, view, flooding: shipFlooding(hulk.removedParts), from: hulk, to: hulk, time })
  }

  /** Sinks every hulk on to the render time and draws it; releases those the sea has hidden. */
  update(dt: number, renderTime: number, sea: SeaState, wind: WindSnapshot, camera: ChaseCamera, viewportHeight: number): void {
    if (this.#hulks.length === 0) return
    const air = makeWind({ ...wind, gustiness: 0 })
    const windX = Math.cos(wind.toward) * wind.speed
    const windZ = -Math.sin(wind.toward) * wind.speed
    for (let i = this.#hulks.length - 1; i >= 0; i--) {
      const h = this.#hulks[i]!
      const pose = h.view.pose
      // Stepping stops soon after the hull is under, so a tab hidden for minutes costs one hulk ~400 steps, not thousands.
      const until = Math.min(renderTime, pose.lifeTime + tuning.sinking.seconds + 2)
      while (h.time < until) {
        h.from = h.to
        h.to = stepShip(h.to, { sea, wind: air, time: h.time }, undefined, h.flooding)
        h.time += SIM_DT
      }
      writePose(h, Math.min(1, Math.max(0, 1 - (h.time - renderTime) / SIM_DT)))
      h.view.update(pose, windX, windZ, dt, camera.camera, viewportHeight)
      h.view.group.visible = this.#sinking.update(h.key, h.view, dt, renderTime, sea, camera)
      if (h.view.group.visible) continue
      this.#sinking.forget(h.key)
      this.#release(h.view)
      this.#hulks.splice(i, 1)
    }
  }

  /** Releases every hulk: a new welcome starts another world. */
  clear(): void {
    for (const h of this.#hulks) {
      this.#sinking.forget(h.key)
      this.#release(h.view)
    }
    this.#hulks.length = 0
  }
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u

const writePose = (h: Hulk, u: number) => {
  const pose = h.view.pose
  const { from, to } = h
  pose.x = lerp(from.position.x, to.position.x, u)
  pose.y = lerp(from.position.y, to.position.y, u)
  pose.z = lerp(from.position.z, to.position.z, u)
  pose.vx = lerp(from.velocity.x, to.velocity.x, u)
  pose.vy = lerp(from.velocity.y, to.velocity.y, u)
  pose.vz = lerp(from.velocity.z, to.velocity.z, u)
  pose.rudderAngle = lerp(from.rudderAngle, to.rudderAngle, u)
  pose.sailSet = lerp(from.sailSet, to.sailSet, u)
  const a = from.orientation
  const b = to.orientation
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1
  const x = lerp(a.x, b.x * sign, u)
  const y = lerp(a.y, b.y * sign, u)
  const z = lerp(a.z, b.z * sign, u)
  const w = lerp(a.w, b.w * sign, u)
  const n = 1 / Math.hypot(x, y, z, w)
  pose.qx = x * n
  pose.qy = y * n
  pose.qz = z * n
  pose.qw = w * n
}
