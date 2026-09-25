import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  RedFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  type Texture,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three"
import { tuning } from "../../sim/tuning.ts"

/** Texels per side of the foam field. */
const size = 2048
/** Metres the field spans before it repeats; the sea shows its foam only well inside half of this, so repeats are never seen. */
export const wakePeriod = 1024
const maxShips = 16
/** Seconds for foam to fall to 1/e. */
const foamLife = 6
/** Spread of old foam, m²/s: a wake widens as it ages. */
const diffusion = 0.45
const texel = wakePeriod / size

const fullScreen = () => {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  return geometry
}

const fadeMaterial = () =>
  new ShaderMaterial({
    uniforms: { previous: { value: null }, keep: { value: 1 }, spread: { value: 0 }, step: { value: 1 / size } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D previous;
      uniform float keep;
      uniform float spread;
      uniform float step;
      varying vec2 vUv;
      void main() {
        float centre = texture2D(previous, vUv).r;
        float around = texture2D(previous, vUv + vec2(step, 0.0)).r + texture2D(previous, vUv - vec2(step, 0.0)).r
          + texture2D(previous, vUv + vec2(0.0, step)).r + texture2D(previous, vUv - vec2(0.0, step)).r;
        gl_FragColor = vec4((centre + spread * (around - 4.0 * centre)) * keep, 0.0, 0.0, 1.0);
      }
    `,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  })

const stations = tuning.hull.stations
const sternX = stations[0]?.x ?? -12
const stemX = (stations[stations.length - 1]?.x ?? 12) + 1

// Foam a hull lays per second, in ship-local metres: a band hugging the waterline (strongest at the bow), a bow
// wave ahead of the stem and churned water under the counter. `uStations` are the sim's hull lines, x and half-breadth.
const stampMaterial = () =>
  new ShaderMaterial({
    uniforms: { uStations: { value: stations.map((s) => [s.x, s.halfBreadth]).flat() } },
    vertexShader: /* glsl */ `
      attribute vec2 corner;
      attribute vec4 aShip; // x, z inside the field (m), heading (rad), foam per second
      attribute vec2 aSpeed; // speed through the water (m/s), spare
      varying vec2 vLocal;
      varying float vRate;
      varying float vSpeed;
      void main() {
        vec2 local = vec2(mix(${(sternX - 16).toFixed(1)}, ${(stemX + 4).toFixed(1)}, corner.x * 0.5 + 0.5), corner.y * 11.0);
        float c = cos(aShip.z);
        float s = sin(aShip.z);
        // Ship-local (x forward, z starboard) to world xz, heading measured as in directionFromAngle.
        vec2 world = aShip.xy + vec2(local.x * c + local.y * s, -local.x * s + local.y * c);
        vLocal = local;
        vRate = aShip.w;
        vSpeed = aSpeed.x;
        gl_Position = vec4(world / ${wakePeriod.toFixed(1)} * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uStations[${stations.length * 2}];
      varying vec2 vLocal;
      varying float vRate;
      varying float vSpeed;
      float halfBreadth(float x) {
        float hb = uStations[1];
        for (int i = 0; i < ${stations.length - 1}; i++) {
          float x0 = uStations[i * 2];
          float x1 = uStations[i * 2 + 2];
          if (x >= x0) hb = mix(uStations[i * 2 + 1], uStations[i * 2 + 3], clamp((x - x0) / (x1 - x0), 0.0, 1.0));
        }
        return x > ${stemX.toFixed(2)} - 1.0 ? hb * clamp((${stemX.toFixed(2)} - x), 0.0, 1.0) : hb;
      }
      void main() {
        float x = vLocal.x;
        float z = abs(vLocal.y);
        float pace = clamp(vSpeed / 9.0, 0.0, 1.4);
        float hb = halfBreadth(clamp(x, ${sternX.toFixed(2)}, ${stemX.toFixed(2)}));
        float inside = step(${sternX.toFixed(2)}, x) * step(x, ${stemX.toFixed(2)});
        float off = z - hb;
        float band = inside * exp(-max(off, 0.0) / (0.5 + 0.9 * pace)) * smoothstep(-0.6, 0.0, off);
        float bow = smoothstep(-6.0, ${stemX.toFixed(2)}, x);
        float hull = band * (0.2 + (0.2 + 0.6 * bow) * pace);
        float ahead = x - ${stemX.toFixed(2)};
        float bowWave = exp(-(ahead * ahead) / 3.0 - z * z / 4.0) * pace * 1.0;
        float astern = ${sternX.toFixed(2)} - x;
        float width = ${(stations[0]?.halfBreadth ?? 3.5).toFixed(2)} * (0.8 + astern * 0.08);
        float wash = step(0.0, astern) * exp(-astern / 7.0) * smoothstep(width, width * 0.3, z) * (0.1 + 0.9 * pace);
        gl_FragColor = vec4((hull + bowWave + wash) * vRate, 0.0, 0.0, 1.0);
      }
    `,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  })

/**
 * Foam laid on the sea by every hull, kept in a world-anchored texture that repeats every `wakePeriod` metres.
 * Each frame the old foam fades and spreads and each ship stamps new foam where it sails, so a wake trails the
 * ship's actual path and widens as it ages. The ocean shader reads `texture`.
 */
export class WakeField {
  #current: WebGLRenderTarget
  #other: WebGLRenderTarget
  readonly #fade = fadeMaterial()
  readonly #fadeScene = new Scene()
  readonly #stampScene = new Scene()
  readonly #camera = new OrthographicCamera()
  readonly #ships: Float32Array
  readonly #speeds: Float32Array
  readonly #shipAttribute: InstancedBufferAttribute
  readonly #speedAttribute: InstancedBufferAttribute
  readonly #geometry: InstancedBufferGeometry
  #count = 0

  constructor() {
    const target = () => {
      const t = new WebGLRenderTarget(size, size, { type: HalfFloatType, format: RedFormat, depthBuffer: false, magFilter: LinearFilter, minFilter: LinearFilter, generateMipmaps: false })
      t.texture.wrapS = RepeatWrapping
      t.texture.wrapT = RepeatWrapping
      return t
    }
    this.#current = target()
    this.#other = target()
    const fade = new Mesh(fullScreen(), this.#fade)
    fade.frustumCulled = false
    this.#fadeScene.add(fade)
    this.#ships = new Float32Array(maxShips * 4 * 4)
    this.#speeds = new Float32Array(maxShips * 4 * 2)
    this.#geometry = new InstancedBufferGeometry()
    this.#geometry.setAttribute("corner", new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2))
    this.#geometry.setAttribute("position", new BufferAttribute(new Float32Array(12), 3))
    this.#geometry.setIndex([0, 1, 2, 0, 2, 3])
    this.#shipAttribute = new InstancedBufferAttribute(this.#ships, 4)
    this.#speedAttribute = new InstancedBufferAttribute(this.#speeds, 2)
    this.#geometry.setAttribute("aShip", this.#shipAttribute)
    this.#geometry.setAttribute("aSpeed", this.#speedAttribute)
    const stamps = new Mesh(this.#geometry, stampMaterial())
    stamps.frustumCulled = false
    this.#stampScene.add(stamps)
  }

  /** The foam field; sample at world xz / `wakePeriod` with repeat wrapping. */
  get texture(): Texture {
    return this.#current.texture
  }

  /** Start a frame's stamps. */
  begin(): void {
    this.#count = 0
  }

  /** Lay this frame's foam for a hull at world (x, z) heading `heading` (see `directionFromAngle`), moving at `speed` m/s. */
  stamp(x: number, z: number, heading: number, speed: number): void {
    if (this.#count + 4 > maxShips * 4) return
    const fx = x - wakePeriod * Math.floor(x / wakePeriod)
    const fz = z - wakePeriod * Math.floor(z / wakePeriod)
    const reach = 30
    const ox = fx < reach ? wakePeriod : fx > wakePeriod - reach ? -wakePeriod : 0
    const oz = fz < reach ? wakePeriod : fz > wakePeriod - reach ? -wakePeriod : 0
    // Copies across the field's edges so a hull near one keeps its foam whole; a copy that would repeat the first lays none.
    for (let copy = 0; copy < 4; copy++) {
      const dx = copy & 1 ? ox : 0
      const dz = copy & 2 ? oz : 0
      const used = (copy & 1 ? ox !== 0 : true) && (copy & 2 ? oz !== 0 : true)
      const i = this.#count++
      this.#ships[i * 4] = fx + dx
      this.#ships[i * 4 + 1] = fz + dz
      this.#ships[i * 4 + 2] = heading
      this.#ships[i * 4 + 3] = used ? 1 : 0
      this.#speeds[i * 2] = speed
    }
  }

  /** Fade and spread the old foam by `dt` seconds, then add the stamps laid since `begin`. */
  render(renderer: WebGLRenderer, dt: number): void {
    const previous = this.#current
    const next = this.#other
    this.#current = next
    this.#other = previous
    const uniforms = this.#fade.uniforms
    if (uniforms.previous !== undefined) uniforms.previous.value = previous.texture
    if (uniforms.keep !== undefined) uniforms.keep.value = Math.exp(-dt / foamLife)
    if (uniforms.spread !== undefined) uniforms.spread.value = Math.min(0.2, (diffusion * dt) / (texel * texel))
    const scale = this.#ships
    for (let i = 0; i < this.#count; i++) scale[i * 4 + 3] = (scale[i * 4 + 3] ?? 0) * dt
    this.#shipAttribute.needsUpdate = true
    this.#speedAttribute.needsUpdate = true
    this.#geometry.instanceCount = this.#count
    const autoClear = renderer.autoClear
    const target = renderer.getRenderTarget()
    renderer.autoClear = false
    renderer.setRenderTarget(next)
    renderer.render(this.#fadeScene, this.#camera)
    if (this.#count > 0) renderer.render(this.#stampScene, this.#camera)
    renderer.setRenderTarget(target)
    renderer.autoClear = autoClear
  }
}
