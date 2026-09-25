import { Group, MathUtils, Matrix4, type Object3D, PointLight, Quaternion, type Scene, Vector3 } from "three"
import { gunLayout, type BroadsideSide } from "../../sim/gun-layout.ts"
import { type BrickPlacement, BrickShipMesh } from "../bricks/brick-ship-mesh.ts"
import type { GalleonModel } from "./galleon.ts"

/** Seconds to ease into and out of the port. */
const enterSeconds = 0.5
const leaveSeconds = 0.38
/** Vertical field of view at the port, degrees: a slight zoom from the chase camera's 55°. */
export const gunportFov = 40
/** Near plane at the port, metres: the recoiling breech passes a few tenths of a metre under the eye. */
export const gunportNear = 0.08
/**
 * How far the view may swing either side of straight out of the port, and down/up. The port is 0.8 × 0.96 m through a
 * 1.6 m deep frame with the barrel on its axis: past ±18° the line of sight meets the jambs, below −9° the muzzle, above +7° the lintel.
 */
const lookArc = MathUtils.degToRad(18)
const lookDown = MathUtils.degToRad(-9)
const lookUp = MathUtils.degToRad(7)
/**
 * The point mid-port the line of sight always passes through, in the gun's frame (x toward the bow on starboard, y up,
 * z out of the port) from the cannon part's origin, metres: between the barrel's top and the lintel, a little left, so the
 * barrel runs up the lower right to the target as in ref-04/05.
 */
const sightPoint = new Vector3(0.1, 0.9, -0.2)
/** How far behind the sight point the eye stands, metres: just inside the gun deck, behind the breech. */
const eyeBack = 1.35
/** How far out along the sight line the path into the port bends, metres: the camera dives in through the port. */
const approachOut = 7

/** Ship-local height of the underside of the lower gun deck's beams (plate 29 above the plate-13 waterline). */
const beamUnderside = (29 - 13) * 0.16
/** Lantern hung from the beams of the lower gun deck beside the eye, relative to the viewed gun in its frame. */
const lanternSpots = [new Vector3(0.95, 0, -1.55)] as const

/** Within this distance of the eye at the port, metres, muzzle-flash lights fade by (distance / reach)²: the gun deck's timber is a metre from the muzzle, and the flash tuned to light hulls 10 m off would white it out. */
const flashReach = 14

/** The lower-deck gun each side views from: the one nearest amidships. */
const viewedGun = (side: BroadsideSide): number => {
  let best = -1
  for (let i = 0; i < gunLayout.length; i++) {
    const gun = gunLayout[i]
    if (gun === undefined || gun.side !== side || gun.deck !== "lower") continue
    if (best < 0 || Math.abs(gun.position.x) < Math.abs(gunLayout[best]?.position.x ?? 0)) best = i
  }
  return best
}

const views = { port: viewedGun("port"), starboard: viewedGun("starboard") }
const origin = new Vector3()
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/**
 * The gunport aim view: while held, the camera eases from the chase orbit into the lower gun deck behind the
 * amidships gun on the facing side, rides the ship's motion there, and looks where the mouse points within the port's arc.
 */
export class GunportView {
  /** 0 at the chase camera, 1 at the port; eased by `blend`. */
  #amount = 0
  #held = false
  #side: BroadsideSide = "starboard"
  /** View yaw from straight out of the port, radians, positive toward the gun frame's +x; and view pitch above the deck plane. */
  yaw = 0
  pitch = 0
  readonly #guns: GalleonModel["guns"]
  readonly #local = new Matrix4()
  readonly #localQ = new Quaternion()
  readonly #v = new Vector3()
  readonly #eye = new Vector3()
  readonly #up = new Vector3(0, 1, 0)

  constructor(guns: GalleonModel["guns"]) {
    this.#guns = guns
  }

  get held(): boolean {
    return this.#held
  }

  /** The side the view looks out of. */
  get side(): BroadsideSide {
    return this.#side
  }

  /** How far into the port the camera is, 0…1, eased. */
  get blend(): number {
    return smootherstep(this.#amount)
  }

  /** Enters the port on the side facing `target` (world point the chase camera aims at), keeping that point under the reticle. */
  enter(ship: Object3D, target: Vector3): void {
    if (this.#held) return
    this.#held = true
    const local = this.#v.copy(target).sub(ship.position).applyQuaternion(this.#localQ.copy(ship.quaternion).invert())
    const side: BroadsideSide = local.z >= 0 ? "starboard" : "port"
    // Re-entering while still easing out keeps the side, so the camera does not cross the ship.
    if (this.#amount === 0) this.#side = side
    const s = this.#sign
    local.sub(this.gunFrame(sightPoint, this.#eye))
    this.yaw = MathUtils.clamp(Math.atan2(local.x * s, local.z * s), -lookArc, lookArc)
    this.pitch = MathUtils.clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), lookDown, lookUp)
  }

  /** Lets go: the camera eases back out to the chase orbit. */
  leave(): void {
    this.#held = false
  }

  /** Turns the view by a mouse movement in pixels at `sensitivity` radians per pixel. */
  look(dx: number, dy: number, sensitivity: number): void {
    const scale = sensitivity * (gunportFov / 55)
    this.yaw = MathUtils.clamp(this.yaw - this.#sign * dx * scale, -lookArc, lookArc)
    this.pitch = MathUtils.clamp(this.pitch - dy * scale, lookDown, lookUp)
  }

  /** Advances the ease by `dt` seconds. */
  step(dt: number): void {
    this.#amount = this.#held ? Math.min(1, this.#amount + dt / enterSeconds) : Math.max(0, this.#amount - dt / leaveSeconds)
  }

  /**
   * The eye and the view's orientation, world space, on `ship` as drawn; and the bend of the path in. The eye swings
   * about the sight point as the view turns, so the line of sight always passes through the port.
   */
  pose(ship: Object3D, eye: Vector3, orientation: Quaternion, approach: Vector3): void {
    const s = this.#sign
    const sight = this.gunFrame(sightPoint, this.#eye)
    const cp = Math.cos(this.pitch)
    const look = this.#v.set(s * Math.sin(this.yaw) * cp, Math.sin(this.pitch), s * Math.cos(this.yaw) * cp)
    eye.copy(look).multiplyScalar(-eyeBack).add(sight)
    // Matrix4.lookAt builds a camera basis that looks down −z toward the target: the sight point is on the line of sight.
    this.#local.lookAt(eye, sight, this.#up)
    orientation.setFromRotationMatrix(this.#local).premultiply(ship.quaternion)
    approach.copy(look).multiplyScalar(approachOut).add(sight).applyQuaternion(ship.quaternion).add(ship.position)
    eye.applyQuaternion(ship.quaternion).add(ship.position)
  }

  /** The viewed gun's frame in ship space: origin at its cannon part, x toward the bow on starboard (stern on port), z out of the port. */
  gunFrame(offset: Vector3, out: Vector3): Vector3 {
    const s = this.#sign
    const cannon = this.#guns[views[this.#side]]?.cannon
    return out.set(s * offset.x, offset.y, s * offset.z).add(cannon ?? origin)
  }

  get #sign(): number {
    return this.#side === "starboard" ? 1 : -1
  }
}

/**
 * A brick lantern hung from the lower gun deck's beams beside the eye, with a warm point light, shown only while the
 * gunport view is in use. The light is left out of the scene's light count otherwise, so the chase view pays nothing for it.
 */
export class GunDeckLanterns {
  readonly #root = new Group()
  readonly #lights: ReadonlyArray<PointLight>
  readonly #spots: ReadonlyArray<Group>
  readonly #v = new Vector3()

  constructor(scene: Scene, model: GalleonModel) {
    this.#root.name = "gun deck lanterns"
    const placements: Array<BrickPlacement> = [
      { part: "37776", color: "black", matrix: new Matrix4().makeTranslation(0, -0.84, 0) },
      { part: "6141", color: "pearlGold", matrix: new Matrix4().makeTranslation(0, -0.16, 0) },
    ]
    this.#spots = lanternSpots.map(() => {
      const spot = new Group()
      const lantern = new BrickShipMesh(model.library, placements)
      lantern.setDetail("near")
      spot.add(lantern.root)
      this.#root.add(spot)
      return spot
    })
    this.#lights = lanternSpots.map(() => {
      const light = new PointLight(0xff9a45, 6, 9, 1.6)
      light.visible = false
      scene.add(light)
      return light
    })
    this.#root.visible = false
    scene.add(this.#root)
  }

  /** Runs `compile` with the lantern light counted, so the shaders the gunport view needs are built at load, not on first use. */
  compileLit(compile: () => void): void {
    for (const light of this.#lights) light.visible = true
    compile()
    for (const light of this.#lights) light.visible = false
  }

  /** Hangs the lanterns in `ship` as drawn beside the viewed gun, lit by the view's `blend`. */
  update(ship: Object3D | undefined, view: GunportView): void {
    const blend = view.blend
    this.#root.visible = ship !== undefined && blend > 0
    for (const light of this.#lights) {
      light.visible = this.#root.visible
      light.intensity = 6 * blend
    }
    if (ship === undefined || !this.#root.visible) return
    this.#root.position.copy(ship.position)
    this.#root.quaternion.copy(ship.quaternion)
    lanternSpots.forEach((spot, i) => {
      view.gunFrame(spot, this.#v)
      this.#spots[i]?.position.set(this.#v.x, beamUnderside, this.#v.z)
      this.#lights[i]?.position.set(this.#v.x, beamUnderside - 0.5, this.#v.z).applyQuaternion(ship.quaternion).add(ship.position)
    })
  }

  /** Dims the muzzle-flash `lights` near `eye` by how far into the port the view is; call after the effects set them. */
  dimFlashes(lights: ReadonlyArray<PointLight>, eye: Vector3, view: GunportView): void {
    const blend = view.blend
    if (blend === 0) return
    for (const light of lights) {
      const near = Math.min(1, light.position.distanceToSquared(eye) / (flashReach * flashReach))
      light.intensity *= 1 - blend * (1 - near)
    }
  }
}
