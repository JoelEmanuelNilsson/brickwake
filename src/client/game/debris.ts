import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from "three"
import { oceanHeight, type SeaState } from "../../sim/ocean.ts"

/** A chip to throw. Callers fill one reused object and pass it to `ChipLayer.throw`. */
export interface ChipSpawn {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Box dimensions, metres. */
  sx: number
  sy: number
  sz: number
  /** Linear-space colour. */
  color: Color
  /** Seconds the chip lives, floating included. */
  life: number
}

/** A reusable chip record. */
export const chipSpawn = (): ChipSpawn => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, sx: 0.4, sy: 0.24, sz: 0.4, color: new Color(), life: 5 })

const gravity = 9.81
/** Seconds a chip spends shrinking away at the end of its life. */
const shrinkSeconds = 0.6

/**
 * Tumbling chips of brick and splinters of wood knocked off a hull: ballistic until they meet the water, where
 * they bob on the surface and then sink away. One instanced draw; nothing allocates after construction.
 */
export class ChipLayer {
  readonly mesh: InstancedMesh
  readonly #capacity: number
  readonly #pos: Float32Array
  readonly #vel: Float32Array
  readonly #quat: Float32Array
  readonly #spinAxis: Float32Array
  readonly #spin: Float32Array
  readonly #dims: Float32Array
  readonly #age: Float32Array
  readonly #life: Float32Array
  readonly #floating: Uint8Array
  readonly #colors: Array<Color>
  readonly #matrix = new Matrix4()
  readonly #q = new Quaternion()
  readonly #dq = new Quaternion()
  readonly #p = new Vector3()
  readonly #s = new Vector3()
  readonly #axis = new Vector3()
  #count = 0
  /** Called once when a chip first meets the water, with where; for a small splash. */
  onWater: (x: number, y: number, z: number, speed: number) => void = () => undefined

  constructor(capacity: number) {
    this.#capacity = capacity
    this.#pos = new Float32Array(capacity * 3)
    this.#vel = new Float32Array(capacity * 3)
    this.#quat = new Float32Array(capacity * 4)
    this.#spinAxis = new Float32Array(capacity * 3)
    this.#spin = new Float32Array(capacity)
    this.#dims = new Float32Array(capacity * 3)
    this.#age = new Float32Array(capacity)
    this.#life = new Float32Array(capacity)
    this.#floating = new Uint8Array(capacity)
    this.#colors = Array.from({ length: capacity }, () => new Color())
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ roughness: 0.55, metalness: 0 }), capacity)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.setColorAt(0, new Color())
    this.mesh.count = 0
    this.mesh.frustumCulled = false
  }

  /** Live chips. */
  get count(): number {
    return this.#count
  }

  /** Throws one chip with a random tumble; dropped when the layer is full. */
  throw(c: ChipSpawn): void {
    if (this.#count >= this.#capacity) return
    const i = this.#count++
    this.#pos[i * 3] = c.x
    this.#pos[i * 3 + 1] = c.y
    this.#pos[i * 3 + 2] = c.z
    this.#vel[i * 3] = c.vx
    this.#vel[i * 3 + 1] = c.vy
    this.#vel[i * 3 + 2] = c.vz
    this.#axis.randomDirection()
    this.#spinAxis[i * 3] = this.#axis.x
    this.#spinAxis[i * 3 + 1] = this.#axis.y
    this.#spinAxis[i * 3 + 2] = this.#axis.z
    this.#spin[i] = 6 + Math.random() * 14
    this.#q.random()
    this.#quat[i * 4] = this.#q.x
    this.#quat[i * 4 + 1] = this.#q.y
    this.#quat[i * 4 + 2] = this.#q.z
    this.#quat[i * 4 + 3] = this.#q.w
    this.#dims[i * 3] = c.sx
    this.#dims[i * 3 + 1] = c.sy
    this.#dims[i * 3 + 2] = c.sz
    this.#age[i] = 0
    this.#life[i] = c.life
    this.#floating[i] = 0
    this.#colors[i]?.copy(c.color)
  }

  /** Moves every chip and uploads the instances. `time` is the sim time the sea is drawn at. */
  update(dt: number, time: number, sea: SeaState | undefined): void {
    const pos = this.#pos
    const vel = this.#vel
    for (let i = 0; i < this.#count; ) {
      const age = this.#age[i]! + dt
      if (age >= this.#life[i]!) {
        this.#remove(i)
        continue
      }
      this.#age[i] = age
      const j = i * 3
      const surface = sea === undefined ? 0 : oceanHeight(sea, pos[j]!, pos[j + 2]!, time)
      if (this.#floating[i] === 0) {
        vel[j + 1] = vel[j + 1]! - gravity * dt
        if (pos[j + 1]! < surface && vel[j + 1]! < 0) {
          this.#floating[i] = 1
          this.onWater(pos[j]!, surface, pos[j + 2]!, Math.hypot(vel[j]!, vel[j + 1]!, vel[j + 2]!))
          vel[j] = vel[j]! * 0.2
          vel[j + 1] = 0
          vel[j + 2] = vel[j + 2]! * 0.2
          this.#spin[i] = this.#spin[i]! * 0.15
        }
      } else {
        const damp = Math.exp(-1.5 * dt)
        vel[j] = vel[j]! * damp
        vel[j + 2] = vel[j + 2]! * damp
        vel[j + 1] = 0
        pos[j + 1] = surface - 0.05
      }
      pos[j] = pos[j]! + vel[j]! * dt
      pos[j + 1] = pos[j + 1]! + vel[j + 1]! * dt
      pos[j + 2] = pos[j + 2]! + vel[j + 2]! * dt
      this.#q.fromArray(this.#quat, i * 4)
      this.#axis.fromArray(this.#spinAxis, j)
      this.#dq.setFromAxisAngle(this.#axis, this.#spin[i]! * dt)
      this.#q.premultiply(this.#dq).toArray(this.#quat, i * 4)
      i++
    }
    for (let i = 0; i < this.#count; i++) {
      const left = this.#life[i]! - this.#age[i]!
      const scale = Math.min(1, left / shrinkSeconds)
      this.#p.fromArray(pos, i * 3)
      this.#q.fromArray(this.#quat, i * 4)
      this.#s.fromArray(this.#dims, i * 3).multiplyScalar(scale)
      this.mesh.setMatrixAt(i, this.#matrix.compose(this.#p, this.#q, this.#s))
      const color = this.#colors[i]
      if (color !== undefined) this.mesh.setColorAt(i, color)
    }
    this.mesh.count = this.#count
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true
  }

  #remove(i: number) {
    const last = --this.#count
    if (i === last) return
    this.#pos.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.#vel.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.#spinAxis.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.#dims.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.#quat.copyWithin(i * 4, last * 4, last * 4 + 4)
    this.#spin[i] = this.#spin[last]!
    this.#age[i] = this.#age[last]!
    this.#life[i] = this.#life[last]!
    this.#floating[i] = this.#floating[last]!
    this.#colors[i]?.copy(this.#colors[last] ?? this.#colors[i])
  }
}
