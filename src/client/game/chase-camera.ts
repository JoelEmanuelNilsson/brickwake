import { Euler, MathUtils, Matrix4, type Object3D, PerspectiveCamera, Quaternion, Vector3 } from "three"
import type { GalleonModel } from "./galleon.ts"
import { gunportFov, gunportNear, GunportView } from "./gunport-view.ts"

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
/** Largest shake of the view at the gunport, radians, at full trauma: the eye is on the ship, so shake turns it rather than moving a target. */
const portShake = 0.018
/** Farthest the chase ray is followed to the sea when the gunport view picks its side and aim, metres. */
const portAimReach = 600

/**
 * Chase camera orbiting the own ship. Yaw is world-fixed and the camera's up is always world up, so it
 * never inherits the ship's roll or pitch; mouse orbit is the aim direction. Held, the gunport view takes the
 * camera onto the ship's gun deck, where it rides the ship's roll and pitch.
 */
export class ChaseCamera {
  readonly camera: PerspectiveCamera
  /** Yaw of the camera's offset from the ship (see `directionFromAngle`); the view looks the opposite way. */
  yaw = 0
  /** Elevation of the camera above the focus, radians. */
  pitch = 0.28
  distance = 42
  /** Mouse look speed as a multiple of the default (the sensitivity setting). */
  sensitivity = 1
  /** The unshaken centre ray the reticle aims along: from the camera toward the focus. */
  readonly aimOrigin = new Vector3()
  readonly aimDirection = new Vector3(1, 0, 0)
  readonly #focus = new Vector3()
  readonly #target = new Vector3()
  #trauma = 0
  #clock = 0
  readonly #minHeight: number
  #following = false
  readonly gunport: GunportView
  #ship: Object3D | undefined
  readonly #chaseQ = new Quaternion()
  readonly #portQ = new Quaternion()
  readonly #eye = new Vector3()
  readonly #approach = new Vector3()
  readonly #v = new Vector3()
  readonly #shakeQ = new Quaternion()
  readonly #shakeEuler = new Euler()
  readonly #shaken = new Quaternion()
  readonly #m = new Matrix4()

  /** `minHeight` keeps the camera above the highest crest the sea can raise; `guns` places the gunport view. */
  constructor(minHeight: number, guns: GalleonModel["guns"]) {
    this.camera = new PerspectiveCamera(chaseFov, 1, chaseNear, 6000)
    this.#minHeight = minHeight
    this.gunport = new GunportView(guns)
  }

  /** Holds (right mouse down) or releases the gunport view; it holds only while an own ship is afloat. */
  holdGunport(held: boolean): void {
    if (!held) return this.gunport.leave()
    const ship = this.#ship
    if (ship === undefined) return
    const origin = this.aimOrigin
    const direction = this.aimDirection
    const reach = direction.y < 0 ? Math.min(portAimReach, (ship.position.y - origin.y) / direction.y) : portAimReach
    this.gunport.enter(ship, this.#v.copy(direction).multiplyScalar(reach).add(origin))
  }

  /** Orbits by a mouse movement in pixels; at the gunport, turns the view within the port's arc. */
  look(dx: number, dy: number): void {
    const perPixel = radiansPerPixel * this.sensitivity
    if (this.gunport.held) return this.gunport.look(dx, dy, perPixel)
    this.yaw -= dx * perPixel
    this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch + dy * perPixel))
  }

  /** Zooms by a wheel delta. */
  zoom(deltaY: number): void {
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
   * Follows the ship origin at (x, y, z), `dt` seconds after the previous call; `ship` is the own ship as drawn, for the
   * gunport view, undefined when it cannot man its guns.
   */
  follow(x: number, y: number, z: number, dt: number, ship?: Object3D): void {
    this.#ship = ship
    if (ship === undefined) this.gunport.leave()
    this.gunport.step(dt)
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
    this.aimOrigin.copy(this.camera.position)
    this.aimDirection.subVectors(this.#focus, this.camera.position).normalize()
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
    this.#ridePort(ship)
  }

  #ridePort(ship: Object3D | undefined) {
    const port = this.gunport
    const t = ship === undefined ? 0 : port.blend
    const near = t > 0 ? gunportNear : chaseNear
    const fov = MathUtils.lerp(chaseFov, gunportFov, t)
    if (near !== this.camera.near || fov !== this.camera.fov) {
      this.camera.near = near
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    if (ship === undefined || t === 0) return
    const camera = this.camera
    port.pose(ship, this.#eye, this.#portQ, this.#approach)
    // Unshaken chase orientation, so the aim ray blends between two steady rays.
    this.#chaseQ.setFromRotationMatrix(this.#m.lookAt(this.aimOrigin, this.#focus, camera.up))
    const chase = this.aimOrigin
    const u = 1 - t
    // A quadratic path whose last leg comes in along the port's outward line: the camera enters through the port.
    camera.position.set(
      u * u * chase.x + 2 * u * t * this.#approach.x + t * t * this.#eye.x,
      u * u * chase.y + 2 * u * t * this.#approach.y + t * t * this.#eye.y,
      u * u * chase.z + 2 * u * t * this.#approach.z + t * t * this.#eye.z,
    )
    this.#shaken.copy(camera.quaternion)
    camera.quaternion.copy(this.#chaseQ).slerp(this.#portQ, t)
    this.aimOrigin.copy(camera.position)
    this.aimDirection.set(0, 0, -1).applyQuaternion(camera.quaternion)
    if (port.held && t === 1) {
      const d = this.aimDirection
      this.yaw = Math.atan2(-d.z, d.x) + Math.PI
    }
    const reach = this.#trauma * this.#trauma * portShake
    const k = this.#clock
    this.#shakeEuler.set(reach * (Math.sin(k * 47.3) + 0.5 * Math.sin(k * 91.7)), reach * (Math.sin(k * 53.1 + 2.1) + 0.5 * Math.sin(k * 83.9)), 0)
    camera.quaternion.copy(this.#shaken).slerp(this.#portQ, t).multiply(this.#shakeQ.setFromEuler(this.#shakeEuler))
  }
}
