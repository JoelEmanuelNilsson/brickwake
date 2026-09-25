import { Euler, MathUtils, type Object3D, PerspectiveCamera, Quaternion, Vector3 } from "three"
import { AimView } from "./aim-view.ts"

/** Radians of orbit per pixel of mouse movement at sensitivity 1. */
const radiansPerPixel = 0.0022
const minPitch = -0.08
const maxPitch = 1.25
const minDistance = 16
const maxDistance = 110
/** Point the camera orbits, above the ship's waterline origin, metres. */
const focusHeight = 5
/** Per-second follow rates: horizontal follow is tight; vertical is slow so swell heave is felt but not copied. */
const followRate = 10
const heaveRate = 0.6
/** Largest shake offset of the look target, metres, at full trauma; and how fast trauma drains per second. */
const shakeReach = 1.1
const shakeDrain = 1.6
const chaseFov = 55
const chaseNear = 0.5
/** Largest shake of the aim view, radians, at full trauma: the eye rides the ship, so shake turns it rather than moving a target. */
const aimShake = 0.012
/** Nearest and farthest aim, metres: the far end is past the guns' ~300 m reach, so "out of range" shows. */
const minRange = 20
const maxRange = 360
/** How high the swing between the chase and aim views lifts the camera at its middle, metres: over the rig, not through it. */
const swingLift = 14

/** Aim range for an orbit pitch: level looks far, steep looks near, spaced evenly in log range so each pixel moves the aim a similar share. */
export const rangeAtPitch = (pitch: number): number =>
  maxRange * (minRange / maxRange) ** MathUtils.clamp((pitch - minPitch) / (maxPitch - minPitch), 0, 1)

/**
 * Chase camera orbiting the own ship. Yaw is world-fixed and the camera's up is always world up, so it never inherits
 * the ship's roll or pitch. The orbit is also the aim: the view's bearing is the aim bearing and the orbit pitch sets the
 * range (`rangeAtPitch`), so the same mouse motion aims in the chase and aim views, on either side. Held, the aim view
 * swings the camera over the shoulder of the facing broadside.
 */
export class ChaseCamera {
  readonly camera: PerspectiveCamera
  /** Yaw of the camera's offset from the ship (see `directionFromAngle`); the view and the aim bear the opposite way. */
  yaw = 0
  /** Elevation of the camera above the focus, radians; also sets the aim range. */
  pitch = 0.28
  distance = 42
  /** Mouse look speed as a multiple of the default (the sensitivity setting). */
  sensitivity = 1
  /** The flat-sea point the guns aim at: `range` metres from the ship along the view's bearing, at sea level. */
  readonly aimTarget = new Vector3()
  readonly aimView = new AimView()
  readonly #focus = new Vector3()
  readonly #target = new Vector3()
  #trauma = 0
  #clock = 0
  /** Lowest the camera goes: above the highest crest the joined sea can raise. */
  minHeight: number
  #following = false
  #heading = 0
  readonly #aimQ = new Quaternion()
  readonly #eye = new Vector3()
  readonly #forward = new Vector3()
  readonly #shakeQ = new Quaternion()
  readonly #shakeEuler = new Euler()

  constructor(minHeight: number) {
    this.camera = new PerspectiveCamera(chaseFov, 1, chaseNear, 6000)
    this.minHeight = minHeight
  }

  /** Horizontal distance from the ship to the aim, metres. */
  get range(): number {
    return rangeAtPitch(this.pitch)
  }

  /** Holds (right mouse or Space down) or releases the aim view; it holds only while an own ship is afloat. */
  holdAim(held: boolean): void {
    this.aimView.hold(held && this.#following, this.yaw + Math.PI, this.#heading)
  }

  /** Orbits by a mouse movement in pixels: right turns the aim right, up aims farther. Finer in the narrower aim view. */
  look(dx: number, dy: number): void {
    const perPixel = radiansPerPixel * this.sensitivity * MathUtils.lerp(1, this.aimView.fov / chaseFov, this.aimView.blend)
    this.yaw -= dx * perPixel
    this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch + dy * perPixel))
  }

  /** Zooms by a wheel delta: the orbit distance in the chase view, the magnification in the aim view. */
  zoom(deltaY: number): void {
    if (this.aimView.held) return this.aimView.magnify(Math.exp(-deltaY * 0.001))
    this.distance = Math.max(minDistance, Math.min(maxDistance, this.distance * Math.exp(deltaY * 0.001)))
  }

  /** Adds shake, 0…1; overlapping shakes saturate at 1. Felt as trauma², so small knocks stay subtle. */
  shake(amount: number): void {
    this.#trauma = Math.min(1, this.#trauma + amount)
  }

  /** Current shake, 0…1. */
  get trauma(): number {
    return this.#trauma
  }

  /** Places the camera behind a ship heading `heading`, without easing. */
  placeBehind(heading: number): void {
    this.yaw = heading + Math.PI
    this.#following = false
  }

  /**
   * Follows the ship origin at (x, y, z), `dt` seconds after the previous call; `ship` is the own ship as drawn, undefined
   * when it cannot man its guns, which ends the aim view.
   */
  follow(x: number, y: number, z: number, dt: number, ship?: Object3D): void {
    if (ship === undefined) this.aimView.hold(false, 0, 0)
    else {
      const forward = this.#forward.set(1, 0, 0).applyQuaternion(ship.quaternion)
      this.#heading = Math.atan2(-forward.z, forward.x)
    }
    const aim = this.aimView
    aim.step(dt)
    if (aim.held) this.yaw = aim.clampBearing(this.yaw + Math.PI, this.#heading) - Math.PI
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
    const range = this.range
    this.aimTarget.set(x - Math.cos(this.yaw) * range, 0, z + Math.sin(this.yaw) * range)
    const flat = Math.cos(this.pitch) * this.distance
    this.camera.position.set(
      this.#focus.x + Math.cos(this.yaw) * flat,
      Math.max(this.minHeight, this.#focus.y + Math.sin(this.pitch) * this.distance),
      this.#focus.z - Math.sin(this.yaw) * flat,
    )
    this.camera.up.set(0, 1, 0)
    // Shake moves the look target, never the up vector, so the horizon still never rolls.
    this.#clock += dt
    this.#trauma = Math.max(0, this.#trauma - shakeDrain * dt)
    const reach = this.#trauma * this.#trauma * shakeReach * (this.distance / 42)
    const t = this.#clock
    this.#target.set(
      this.#focus.x + reach * (Math.sin(t * 47.3) + 0.5 * Math.sin(t * 91.7 + 1.3)),
      this.#focus.y + reach * (Math.sin(t * 53.1 + 2.1) + 0.5 * Math.sin(t * 83.9 + 0.7)),
      this.#focus.z + reach * (Math.sin(t * 43.7 + 4.2) + 0.5 * Math.sin(t * 97.3 + 2.9)),
    )
    this.camera.lookAt(this.#target)
    this.#swingToAim(x, z)
  }

  #swingToAim(x: number, z: number) {
    const aim = this.aimView
    const t = aim.blend
    const fov = MathUtils.lerp(chaseFov, aim.fov, t)
    if (fov !== this.camera.fov) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    if (t === 0) return
    const camera = this.camera
    aim.pose(x, this.#focus.y - focusHeight, z, this.#heading, this.aimTarget, this.#eye, this.#aimQ)
    camera.position.lerp(this.#eye, t)
    camera.position.y += swingLift * Math.sin(Math.PI * t)
    const reach = this.#trauma * this.#trauma * aimShake * t
    const k = this.#clock
    this.#shakeEuler.set(reach * (Math.sin(k * 47.3) + 0.5 * Math.sin(k * 91.7)), reach * (Math.sin(k * 53.1 + 2.1) + 0.5 * Math.sin(k * 83.9)), 0)
    camera.quaternion.slerp(this.#aimQ, t).multiply(this.#shakeQ.setFromEuler(this.#shakeEuler))
  }
}
