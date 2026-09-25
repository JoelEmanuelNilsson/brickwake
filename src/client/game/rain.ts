import { BufferAttribute, BufferGeometry, LineSegments, ShaderMaterial, Vector3 } from "three"

const maxDrops = 6000
/** Side of the box of rain kept around the camera, metres; drops wrap inside it, so the box follows without drops jumping. */
const boxSize = 70
const fallSpeed = 9
/** Seconds of fall one streak shows. */
const streakSeconds = 0.05

const vertexShader = /* glsl */ `
  attribute float tail;
  uniform vec3 centre;
  uniform vec3 fall;
  uniform float time;
  uniform float boxSize;
  uniform float streakSeconds;
  varying float vTail;
  void main() {
    vec3 world = centre + mod(position + fall * time - centre, boxSize) - boxSize * 0.5;
    world -= fall * streakSeconds * tail;
    vTail = tail;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float opacity;
  varying float vTail;
  void main() {
    gl_FragColor = vec4(vec3(0.62, 0.68, 0.74), opacity * (1.0 - vTail));
  }
`

/** Rain streaks falling around the camera, slanted by the wind. One draw call; drops live only in the vertex shader. */
export class Rain {
  readonly mesh: LineSegments<BufferGeometry, ShaderMaterial>
  readonly #fall = new Vector3()

  constructor() {
    const positions = new Float32Array(maxDrops * 6)
    const tails = new Float32Array(maxDrops * 2)
    for (let i = 0; i < maxDrops; i++) {
      const x = Math.random() * boxSize
      const y = Math.random() * boxSize
      const z = Math.random() * boxSize
      positions.set([x, y, z, x, y, z], i * 6)
      tails[i * 2 + 1] = 1
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new BufferAttribute(positions, 3))
    geometry.setAttribute("tail", new BufferAttribute(tails, 1))
    geometry.setDrawRange(0, 0)
    this.mesh = new LineSegments(
      geometry,
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        uniforms: {
          centre: { value: new Vector3() },
          fall: { value: this.#fall },
          time: { value: 0 },
          boxSize: { value: boxSize },
          streakSeconds: { value: streakSeconds },
          opacity: { value: 0.35 },
        },
      }),
    )
    this.mesh.frustumCulled = false
    this.mesh.name = "rain"
    this.mesh.visible = false
  }

  /** Draws `amount` (0…1) of the most drops; 0 hides the rain. */
  set amount(amount: number) {
    this.mesh.geometry.setDrawRange(0, Math.round(amount * maxDrops) * 2)
    this.mesh.visible = amount > 0
  }

  /** Centres the rain on the camera at time `time`, with wind (m/s) blowing along x and z. */
  update(time: number, camera: Vector3, windX: number, windZ: number): void {
    if (!this.mesh.visible) return
    const uniforms = this.mesh.material.uniforms
    uniforms.centre?.value.copy(camera)
    this.#fall.set(windX * 0.6, -fallSpeed, windZ * 0.6)
    if (uniforms.time !== undefined) uniforms.time.value = time % 1000
  }
}
