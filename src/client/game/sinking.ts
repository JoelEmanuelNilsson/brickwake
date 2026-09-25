import { Quaternion, Vector3 } from "three"
import { oceanHeight, type SeaState } from "../../sim/ocean.ts"
import { tuning } from "../../sim/tuning.ts"
import type { ChaseCamera } from "./chase-camera.ts"
import type { Effects } from "./effects.ts"
import type { ShipPose } from "./timeline.ts"

/** Founder effect bursts per second while a ship goes down. */
const founderHz = 14
/** Ship-local deck points the smoke and churn come from, bow to stern. */
const deckPoints = [-11, -6, -1, 4, 9].map((x) => new Vector3(x, 2.6, 0))
/** Seconds after going under that a sunk hull stops being drawn: the sea hides it well before. */
const drawnSunkSeconds = 1.5

interface Wreck {
  clock: number
  plunged: boolean
  life: ShipPose["life"]
}

/**
 * Plays a ship's foundering on top of the sim's physical sinking: smoke and churn along the deck as it settles by the
 * bow or stern, and the sea closing over it when the deck goes under. Says when a sunk hull may stop being drawn.
 */
export class SinkingShips {
  readonly #effects: Effects
  readonly #wrecks = new Map<string, Wreck>()
  readonly #q = new Quaternion()
  readonly #p = new Vector3()

  constructor(effects: Effects) {
    this.#effects = effects
  }

  /** Plays ship `id` at the render time; returns false when its hull should not be drawn. */
  update(id: string, pose: ShipPose, dt: number, renderTime: number, sea: SeaState, camera: ChaseCamera): boolean {
    if (pose.life === "afloat") {
      this.#wrecks.delete(id)
      return true
    }
    let wreck = this.#wrecks.get(id)
    if (wreck === undefined) {
      wreck = { clock: 0, plunged: false, life: pose.life }
      this.#wrecks.set(id, wreck)
      if (pose.life === "sinking") this.#breach(pose, camera)
    }
    wreck.life = pose.life
    const since = pose.life === "sinking" ? renderTime - pose.lifeTime : renderTime - (pose.lifeTime - tuning.sinking.respawnSeconds) + tuning.sinking.seconds
    this.#q.set(pose.qx, pose.qy, pose.qz, pose.qw)
    const middle = this.#world(pose, deckPoints[2]!)
    if (!wreck.plunged && middle.y < oceanHeight(sea, middle.x, middle.z, renderTime) - 0.5) {
      wreck.plunged = true
      this.#effects.plunge(middle.x, oceanHeight(sea, middle.x, middle.z, renderTime), middle.z)
      this.#shake(camera, middle, 0.45, 60)
    }
    wreck.clock -= dt
    if (!wreck.plunged && wreck.clock <= 0) {
      wreck.clock += 1 / founderHz
      const intensity = Math.min(1, 0.4 + since / tuning.sinking.seconds)
      const point = this.#world(pose, deckPoints[Math.floor(Math.random() * deckPoints.length)]!)
      this.#effects.founder(point.x, point.y, point.z, oceanHeight(sea, point.x, point.z, renderTime), intensity)
    }
    return pose.life === "sinking" || since < tuning.sinking.seconds + drawnSunkSeconds
  }

  /** The moment a ship's HP runs out: the hull splits with fire, splinters and a gout of smoke. */
  #breach(pose: ShipPose, camera: ChaseCamera) {
    this.#q.set(pose.qx, pose.qy, pose.qz, pose.qw)
    for (const local of deckPoints) {
      const point = this.#world(pose, local)
      this.#effects.hit(point.x, point.y - 1, point.z, 0, -1, 0)
    }
    this.#shake(camera, this.#world(pose, deckPoints[2]!), 0.6, 70)
  }

  #world(pose: ShipPose, local: Vector3) {
    const p = this.#p.copy(local).applyQuaternion(this.#q)
    p.x += pose.x
    p.y += pose.y
    p.z += pose.z
    return p
  }

  #shake(camera: ChaseCamera, at: Vector3, strength: number, reach: number) {
    const d = at.distanceTo(camera.camera.position)
    camera.shake(strength / (1 + (d / reach) ** 2))
  }
}
