import { Group, MathUtils, MeshDepthMaterial, MeshStandardMaterial, type PerspectiveCamera, RGBADepthPacking, Vector3, Vector4, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three"
import { type BrickDetail, brickDetailFor, BrickShipMesh } from "../bricks/brick-ship-mesh.ts"
import { pirateLivery } from "../rig/sail-livery.ts"
import { ShipRig } from "../rig/ship-rig.ts"
import type { GalleonModel } from "./galleon.ts"
import { ShipPose } from "./timeline.ts"

/** Yards brace this share of the apparent wind's angle off the stern, up to `maxBrace` (sharp up), swinging at `braceRate`. */
const braceGain = 0.5
const maxBrace = 0.65
const braceRate = 0.35

/** How far a cannon has run in from its port `t` seconds after firing, metres: kick, settle, load, run out before the 6 s reload ends. */
export const recoilAt = (t: number): number => {
  if (t < 0 || t >= 4.6) return 0
  if (t < 0.09) return 0.72 * Math.sin((t / 0.09) * (Math.PI / 2))
  if (t < 0.45) return 0.72 - 0.1 * MathUtils.smoothstep(t, 0.09, 0.45)
  if (t < 2.8) return 0.62
  return 0.62 * (1 - MathUtils.smoothstep(t, 2.8, 4.6))
}

const movingChunk = (guns: number, masts: number) => /* glsl */ `
uniform vec4 uGuns[${guns}];
uniform float uMastX[${masts}];
uniform float uBrace;
uniform float uYardFloor;
// Moving parts are told apart by where their instance sits: yards stand above uYardFloor and swing about the nearest mast;
// below it each part is a cannon and runs in along its barrel by its gun's recoil.
mat4 moveInstance(mat4 m) {
  vec3 t = m[3].xyz;
  if (t.y > uYardFloor) {
    float pivot = uMastX[0];
    for (int i = 1; i < ${masts}; i++) if (abs(t.x - uMastX[i]) < abs(t.x - pivot)) pivot = uMastX[i];
    float c = cos(uBrace);
    float s = sin(uBrace);
    mat4 swing = mat4(c, 0.0, -s, 0.0, 0.0, 1.0, 0.0, 0.0, s, 0.0, c, 0.0, pivot - pivot * c, 0.0, pivot * s, 1.0);
    return swing * m;
  }
  float recoil = 0.0;
  float best = 1e9;
  for (int i = 0; i < ${guns}; i++) {
    vec3 d = uGuns[i].xyz - t;
    float e = dot(d, d);
    if (e < best) { best = e; recoil = uGuns[i].w; }
  }
  m[3].xyz -= normalize(m[2].xyz) * recoil;
  return m;
}
`

type MovingUniforms = { readonly uGuns: { value: Array<Vector4> }; readonly uMastX: { value: Array<number> }; readonly uBrace: { value: number }; readonly uYardFloor: { value: number } }

const moveVertices = (chunk: string, uniforms: MovingUniforms, shader: WebGLProgramParametersWithUniforms) => {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${chunk}`)
    .replace("void main() {", "void main() {\n  mat4 movedInstance = moveInstance(instanceMatrix);\n  #define instanceMatrix movedInstance")
}

/** The galleon as one ship in the game: brick hull, recoiling cannons, bracing yards, turning rudder, sails that set; posed each frame. */
export class ShipView {
  readonly group = new Group()
  /** Where the ship is drawn this frame; the game samples the timeline into it. */
  readonly pose = new ShipPose()
  readonly rig: ShipRig
  readonly #model: GalleonModel
  readonly #hull: BrickShipMesh
  readonly #moving: BrickShipMesh
  readonly #rudderMesh: BrickShipMesh
  readonly #rudder = new Group()
  readonly #uniforms: MovingUniforms
  readonly #materials: ReadonlyArray<MeshStandardMaterial | MeshDepthMaterial>
  /** Seconds since each gun last fired. */
  readonly #sinceFired: Float64Array
  #brace = 0
  #detail: BrickDetail | undefined

  constructor(name: string, model: GalleonModel) {
    this.#model = model
    this.group.name = `ship ${name}`
    this.#hull = new BrickShipMesh(model.library, model.hull.placements, model.hull.plugs)
    this.#uniforms = {
      uGuns: { value: model.guns.map((gun) => new Vector4(gun.cannon.x, gun.cannon.y, gun.cannon.z, 0)) },
      uMastX: { value: [...model.mastXs] },
      uBrace: { value: 0 },
      uYardFloor: { value: model.yardFloor },
    }
    const chunk = movingChunk(model.guns.length, model.mastXs.length)
    const plastic = model.library.plastic
    const moved = new MeshStandardMaterial({ vertexColors: true, roughness: plastic.roughness, metalness: plastic.metalness })
    moved.onBeforeCompile = (shader, renderer: WebGLRenderer) => {
      plastic.onBeforeCompile(shader, renderer)
      moveVertices(chunk, this.#uniforms, shader)
    }
    moved.customProgramCacheKey = () => `brick-moving-${model.guns.length}-${model.mastXs.length}`
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
    depth.onBeforeCompile = (shader) => moveVertices(chunk, this.#uniforms, shader)
    depth.customProgramCacheKey = () => `brick-moving-depth-${model.guns.length}-${model.mastXs.length}`
    this.#materials = [moved, depth]
    this.#moving = new BrickShipMesh({ ...model.library, plastic: moved }, model.moving)
    this.#moving.root.traverse((object) => {
      object.customDepthMaterial = depth
    })
    this.#rudderMesh = new BrickShipMesh(model.library, model.rudder)
    this.#rudder.position.x = model.rudderHinge
    this.#rudder.add(this.#rudderMesh.root)
    this.rig = new ShipRig(model.rig, pirateLivery)
    this.group.add(this.#hull.root, this.#moving.root, this.#rudder, this.rig.root)
    this.#sinceFired = new Float64Array(model.guns.length).fill(Number.POSITIVE_INFINITY)
  }

  get detail(): BrickDetail {
    return this.#detail ?? "near"
  }

  /** Run gun `gun` (a `gunLayout` index) in from its port, as the ball leaves. */
  fire(gun: number): void {
    if (gun >= 0 && gun < this.#sinceFired.length) this.#sinceFired[gun] = 0
  }

  /** World position of gun `gun`'s muzzle at the drawn pose, into `out`. */
  muzzle(gun: number, out: Vector3): Vector3 {
    const drawn = this.#model.guns[gun]
    if (drawn === undefined) return out.set(this.pose.x, this.pose.y, this.pose.z)
    return out.copy(drawn.muzzle).applyQuaternion(this.group.quaternion).add(this.group.position)
  }

  /** Take ship part `part` (an index into the generated ship's parts) off the drawn ship; false if it was not drawn. */
  removePart(part: number): boolean {
    const slot = this.#model.slots[part]
    if (slot === undefined) return false
    return (slot.mesh === "hull" ? this.#hull : this.#moving).remove(slot.index)
  }

  /**
   * Poses the ship for this frame: `windX`/`windZ` is the true wind velocity (m/s), the camera and the drawing buffer's
   * height pick the level of detail.
   */
  update(pose: ShipPose, windX: number, windZ: number, dt: number, camera: PerspectiveCamera, viewportHeight: number): void {
    this.group.position.set(pose.x, pose.y, pose.z)
    this.group.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw)
    this.#rudder.rotation.y = pose.rudderAngle

    const guns = this.#uniforms.uGuns.value
    for (let i = 0; i < this.#sinceFired.length; i++) {
      const since = (this.#sinceFired[i] ?? Number.POSITIVE_INFINITY) + dt
      this.#sinceFired[i] = since
      const gun = guns[i]
      if (gun !== undefined) gun.w = recoilAt(since)
    }

    const apparentX = windX - pose.vx
    const apparentZ = windZ - pose.vz
    const forwardX = 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz)
    const forwardZ = 2 * (pose.qx * pose.qz - pose.qw * pose.qy)
    const relative = Math.atan2(-apparentZ, apparentX) - Math.atan2(-forwardZ, forwardX)
    const target = MathUtils.clamp(Math.atan2(Math.sin(relative), Math.cos(relative)) * braceGain, -maxBrace, maxBrace)
    const step = braceRate * dt
    this.#brace += MathUtils.clamp(target - this.#brace, -step, step)
    this.#uniforms.uBrace.value = this.#brace
    this.rig.setBrace(this.#brace)
    this.rig.setSailLevel(pose.sail)
    this.rig.update(dt, apparentX, apparentZ)

    const distance = Math.max(camera.position.distanceTo(this.group.position), 1e-3)
    const pixelsPerMetre = viewportHeight / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) * distance) / camera.zoom
    const detail = brickDetailFor(pixelsPerMetre, this.#detail)
    if (detail !== this.#detail) {
      this.#detail = detail
      this.#hull.setDetail(detail)
      this.#moving.setDetail(detail)
      this.#rudderMesh.setDetail(detail)
      this.rig.setDetail(detail)
    }
  }

  /** Free this ship's instance buffers and materials; the model's shared geometry stays. */
  dispose(): void {
    this.#hull.dispose()
    this.#moving.dispose()
    this.#rudderMesh.dispose()
    this.rig.dispose()
    for (const material of this.#materials) material.dispose()
    this.group.removeFromParent()
  }
}
