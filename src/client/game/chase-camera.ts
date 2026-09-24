import { PerspectiveCamera, Vector3 } from "three"

/** Radians of orbit per pixel of mouse movement. */
const sensitivity = 0.0022
const minPitch = -0.08
const maxPitch = 1.25
const minDistance = 16
const maxDistance = 110
/** Point the camera orbits, above the ship's waterline origin, metres. */
const focusHeight = 5
/** Per-second follow rates: horizontal follow is tight; vertical is slow so swell heave is felt but not copied. */
const followRate = 10
const heaveRate = 0.6

/**
 * Chase camera orbiting the own ship. Yaw is world-fixed and the camera's up is always world up, so it
 * never inherits the ship's roll or pitch; mouse orbit is the aim direction.
 */
export class ChaseCamera {
  readonly camera: PerspectiveCamera
  /** Yaw of the camera's offset from the ship (see `directionFromAngle`); the view looks the opposite way. */
  yaw = 0
  /** Elevation of the camera above the focus, radians. */
  pitch = 0.28
  distance = 42
  readonly #focus = new Vector3()
  readonly #minHeight: number
  #following = false

  /** `minHeight` keeps the camera above the highest crest the sea can raise. */
  constructor(minHeight: number) {
    this.camera = new PerspectiveCamera(55, 1, 0.5, 6000)
    this.#minHeight = minHeight
  }

  /** Orbits by a mouse movement in pixels. */
  look(dx: number, dy: number): void {
    this.yaw -= dx * sensitivity
    this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch + dy * sensitivity))
  }

  /** Zooms by a wheel delta. */
  zoom(deltaY: number): void {
    this.distance = Math.max(minDistance, Math.min(maxDistance, this.distance * Math.exp(deltaY * 0.001)))
  }

  /** Places the camera behind a ship heading `heading`, without easing. */
  placeBehind(heading: number): void {
    this.yaw = heading + Math.PI
    this.#following = false
  }

  /** Follows the ship origin at (x, y, z), `dt` seconds after the previous call. */
  follow(x: number, y: number, z: number, dt: number): void {
    if (!this.#following) {
      this.#focus.set(x, y + focusHeight, z)
      this.#following = true
    } else {
      const horizontal = 1 - Math.exp(-dt * followRate)
      const vertical = 1 - Math.exp(-dt * heaveRate)
      this.#focus.x += (x - this.#focus.x) * horizontal
      this.#focus.z += (z - this.#focus.z) * horizontal
      this.#focus.y += (y + focusHeight - this.#focus.y) * vertical
    }
    const flat = Math.cos(this.pitch) * this.distance
    this.camera.position.set(
      this.#focus.x + Math.cos(this.yaw) * flat,
      Math.max(this.#minHeight, this.#focus.y + Math.sin(this.pitch) * this.distance),
      this.#focus.z - Math.sin(this.yaw) * flat,
    )
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.#focus)
  }
}
