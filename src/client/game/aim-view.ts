import { MathUtils, Matrix4, Quaternion, Vector3 } from "three"
import type { BroadsideSide } from "../../sim/gun-layout.ts"
import { tuning } from "../../sim/tuning.ts"

/** Seconds to swing into and back out of the aim view. */
const enterSeconds = 0.35
const leaveSeconds = 0.3
/** Vertical field of view in the aim view at zoom 1, degrees; zoom divides it. */
export const aimFov = 42
const minZoom = 1
const maxZoom = 3
/**
 * The eye in the heading frame (x toward the bow, y up from the waterline, z out of the facing side), metres: raised
 * above the rail and outboard of the 8 m beam, so nothing of the own ship stands between the eye and the fall of shot.
 */
const eyeOffset = new Vector3(-4, 11, 9)
/** Bearings the aim may take either side of the beam: inside the guns' traverse, less a margin for the battery's spread along the hull. */
const bearingArc = tuning.guns.traverse - MathUtils.degToRad(3)

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

/**
 * The broadside aim view: held, the camera swings over the shoulder of the side the aim bears on, outboard and above
 * the rail, and looks at the aim point. The aim bearing is held inside that broadside's arc while the view is held.
 * Bearings and headings are yaw angles (direction `(cos a, 0, −sin a)`).
 */
export class AimView {
  #amount = 0
  #held = false
  #side: BroadsideSide = "starboard"
  /** Magnification, 1…3. */
  zoom = 1
  readonly #m = new Matrix4()
  readonly #up = new Vector3(0, 1, 0)

  get held(): boolean {
    return this.#held
  }

  /** The broadside the view looks out over. */
  get side(): BroadsideSide {
    return this.#side
  }

  /** How far into the aim view the camera is, 0…1, eased. */
  get blend(): number {
    return smootherstep(this.#amount)
  }

  /** Vertical field of view at full blend, degrees. */
  get fov(): number {
    return aimFov / this.zoom
  }

  /** Holds the view over the side that `bearing` faces from a ship heading `heading`, or lets it go. */
  hold(held: boolean, bearing: number, heading: number): void {
    if (held && !this.#held && this.#amount === 0) this.#side = broadsideFacing(bearing, heading)
    this.#held = held
  }

  /** Multiplies the magnification by `factor`, within its limits. */
  magnify(factor: number): void {
    this.zoom = MathUtils.clamp(this.zoom * factor, minZoom, maxZoom)
  }

  /** `bearing` held inside the viewed broadside's arc from a ship heading `heading`. */
  clampBearing(bearing: number, heading: number): number {
    const beam = heading - this.#sign * (Math.PI / 2)
    return beam + MathUtils.clamp(wrap(bearing - beam), -bearingArc, bearingArc)
  }

  /** Advances the ease by `dt` seconds. */
  step(dt: number): void {
    this.#amount = this.#held ? Math.min(1, this.#amount + dt / enterSeconds) : Math.max(0, this.#amount - dt / leaveSeconds)
  }

  /** The eye and orientation, world space, for a ship at (x, waterline, z) heading `heading`, looking at `target`. */
  pose(x: number, waterline: number, z: number, heading: number, target: Vector3, eye: Vector3, orientation: Quaternion): void {
    const s = this.#sign
    const c = Math.cos(heading)
    const n = Math.sin(heading)
    // Heading frame to world: x → (cos h, 0, −sin h), z → (sin h, 0, cos h).
    const ex = eyeOffset.x
    const ez = s * eyeOffset.z
    eye.set(x + ex * c + ez * n, waterline + eyeOffset.y, z - ex * n + ez * c)
    orientation.setFromRotationMatrix(this.#m.lookAt(eye, target, this.#up))
  }

  get #sign(): number {
    return this.#side === "starboard" ? 1 : -1
  }
}

/** The broadside a bearing faces from a ship heading `heading`: starboard lies at heading − 90°. */
export const broadsideFacing = (bearing: number, heading: number): BroadsideSide => (wrap(bearing - heading) < 0 ? "starboard" : "port")
