import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  type Camera,
  type Texture,
} from "three"
import { oceanHeight, type SeaState } from "../../sim/ocean.ts"

/** How a particle's quad faces: toward the camera, flat on the water, or stretched along its velocity. */
export const ParticleShape = { billboard: 0, flat: 1, streak: 2 } as const

/** A particle to emit. Callers fill one reused object and pass it to `ParticleLayer.emit`, so emitting allocates nothing. */
export interface ParticleSpawn {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Quad size at birth and at death, metres. */
  size: number
  endSize: number
  /** Seconds. */
  life: number
  r: number
  g: number
  b: number
  alpha: number
  /** Per-second rate at which velocity relaxes to the air's (wind × `windShare`). */
  drag: number
  /** Downward acceleration, m/s²; negative rises. */
  gravity: number
  /** Share of the wind the particle is carried by at full drag, 0…1. */
  windShare: number
  rotation: number
  spin: number
  shape: (typeof ParticleShape)[keyof typeof ParticleShape]
}

/** A reusable spawn record with neutral values. */
export const particleSpawn = (): ParticleSpawn => ({
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  size: 1,
  endSize: 1,
  life: 1,
  r: 1,
  g: 1,
  b: 1,
  alpha: 1,
  drag: 0,
  gravity: 0,
  windShare: 0,
  rotation: 0,
  spin: 0,
  shape: ParticleShape.billboard,
})

/** What a layer does with particles that reach the water. */
export type WaterContact = "ignore" | "vanish" | "ride"

/** Fixed look and behaviour shared by every particle of one layer. */
export interface ParticleLayerOptions {
  readonly capacity: number
  readonly texture: Texture
  readonly blending: "additive" | "alpha"
  /** Shade each quad as a sunlit sphere of smoke or spray. */
  readonly lit: boolean
  /** Draw far to near; alpha layers that overlap need it. */
  readonly sorted: boolean
  /** Fraction of life spent fading in. */
  readonly fadeIn: number
  /** Exponent of the fade-out over life; higher holds opacity longer. */
  readonly fadeOut: number
  /** Light a lit layer gets on its side away from the sun; spray is brighter in shade than smoke. */
  readonly shade: readonly [number, number, number]
  /** Colour multiplier reached at the end of life (fire cooling to embers). */
  readonly endTint: readonly [number, number, number]
  /** Seconds of velocity a streak is stretched by. */
  readonly streak: number
  readonly water: WaterContact
  /** Metres over which a quad fades out as it nears whatever stands behind it (soft particles). */
  readonly soft: number
  /** Metres a quad counts as nearer than it is when tested against the scene, for quads lying on the water. */
  readonly softLift?: number
}

const vertexShader = /* glsl */ `
  attribute vec2 corner;
  attribute vec4 aCentre;
  attribute vec4 aColor;
  attribute vec4 aMotion;
  attribute float aShape;
  uniform float uStreak;
  varying vec2 vUv;
  varying vec2 vCorner;
  varying vec4 vColor;
  varying float vNear;
  varying float vViewDepth;
  #include <fog_pars_vertex>
  void main() {
    float size = aCentre.w;
    float c = cos(aMotion.w);
    float s = sin(aMotion.w);
    vec2 turned = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
    vec4 mvPosition;
    if (aShape < 0.5) {
      mvPosition = viewMatrix * vec4(aCentre.xyz, 1.0);
      mvPosition.xy += turned * size * 0.5;
    } else if (aShape < 1.5) {
      mvPosition = viewMatrix * vec4(aCentre.xyz + vec3(turned.x, 0.0, turned.y) * size * 0.5, 1.0);
    } else {
      mvPosition = viewMatrix * vec4(aCentre.xyz, 1.0);
      vec2 flow = (viewMatrix * vec4(aMotion.xyz, 0.0)).xy;
      float speed = length(flow);
      vec2 along = speed > 1e-4 ? flow / speed : vec2(1.0, 0.0);
      vec2 across = vec2(-along.y, along.x);
      mvPosition.xy += along * corner.x * (size * 0.5 + speed * uStreak) + across * corner.y * size * 0.5;
    }
    gl_Position = projectionMatrix * mvPosition;
    vViewDepth = -mvPosition.z;
    vUv = corner * 0.5 + 0.5;
    vCorner = turned;
    vColor = aColor;
    // Quads fade as the camera nears their plane, so flying through smoke never shows a flat wall.
    vNear = smoothstep(0.5, 4.0 + size * 0.5, -mvPosition.z);
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float uLit;
  uniform float uAdditive;
  uniform vec3 uSunView;
  uniform vec3 uLightColor;
  uniform vec3 uShadeColor;
  varying vec2 vUv;
  varying vec2 vCorner;
  varying vec4 vColor;
  varying float vNear;
  varying float vViewDepth;
  uniform sampler2D uSceneDepth;
  uniform vec2 uNearFar;
  uniform float uDepthScale;
  uniform float uSoft;
  uniform float uSoftLift;
  #include <fog_pars_fragment>
  void main() {
    // Particles draw after the scene, tested against its depth by hand: hidden behind it, fading as they near it.
    float depth = texelFetch(uSceneDepth, ivec2(gl_FragCoord.xy * uDepthScale), 0).r;
    float sceneDepth = uNearFar.x * uNearFar.y / (uNearFar.y - depth * (uNearFar.y - uNearFar.x));
    float soft = clamp((sceneDepth - vViewDepth + uSoftLift) / uSoft, 0.0, 1.0);
    if (soft <= 0.0) discard;
    vec4 tex = texture2D(map, vUv);
    vec3 color = vColor.rgb * tex.rgb;
    if (uLit > 0.5) {
      float r2 = dot(vCorner, vCorner);
      vec3 normal = normalize(vec3(vCorner, sqrt(max(0.0, 1.0 - r2)) + 0.35));
      float light = clamp(dot(normal, uSunView) * 0.5 + 0.5, 0.0, 1.0);
      color *= mix(uShadeColor, uLightColor, light * light);
      // Thin edges of smoke between the eye and a low sun glow with forward scattering.
      float toward = pow(max(0.0, -uSunView.z), 3.0);
      color += uLightColor * vColor.rgb * toward * (1.0 - tex.a) * 0.9;
    }
    // A round mask keeps bright additive quads from showing their square edge.
    float alpha = tex.a * vColor.a * smoothstep(1.0, 0.75, length(vUv * 2.0 - 1.0)) * vNear * soft;
    #ifdef USE_FOG
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      if (uAdditive > 0.5) alpha *= 1.0 - fogFactor;
      else color = mix(color, fogColor, fogFactor);
    #endif
    gl_FragColor = vec4(color, alpha);
  }
`

/** Camera layer of alpha-blended particles: drawn after the scene, at half resolution, tested against the scene's depth. */
export const particleLayer = 1
/** Camera layer of additive particles (fire, sparks): drawn at full resolution, where their thin bright shapes need it. */
export const glowLayer = 2

/**
 * The scene depth every particle layer is tested against, the camera's near and far planes, and scene-depth texels per
 * particle pixel (2 when particles draw at half resolution); the render pipeline sets them each frame.
 */
export const particleScene = { depth: { value: null as Texture | null }, nearFar: { value: new Vector2(0.5, 6000) }, depthScale: { value: 1 } }

/** Sunlit colour for lit layers, linear. */
const sunlight = new Color(1.35, 1.0, 0.72)

/**
 * A pool of camera-facing quads simulated on the CPU and drawn in one instanced call. Fixed capacity; nothing
 * allocates after construction.
 */
export class ParticleLayer {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>
  readonly #options: ParticleLayerOptions
  readonly #pos: Float32Array
  readonly #vel: Float32Array
  readonly #age: Float32Array
  readonly #life: Float32Array
  readonly #size: Float32Array
  readonly #endSize: Float32Array
  readonly #rgba: Float32Array
  readonly #drag: Float32Array
  readonly #gravity: Float32Array
  readonly #windShare: Float32Array
  readonly #rotation: Float32Array
  readonly #spin: Float32Array
  readonly #shape: Uint8Array
  readonly #order: Float64Array
  readonly #centre: InstancedBufferAttribute
  readonly #color: InstancedBufferAttribute
  readonly #motion: InstancedBufferAttribute
  readonly #shapeAttribute: InstancedBufferAttribute
  readonly #attributes: ReadonlyArray<InstancedBufferAttribute>
  readonly #sun = new Vector3()
  #count = 0
  #recycle = 0

  constructor(options: ParticleLayerOptions, sunDirection: Vector3) {
    this.#options = options
    const n = options.capacity
    this.#pos = new Float32Array(n * 3)
    this.#vel = new Float32Array(n * 3)
    this.#age = new Float32Array(n)
    this.#life = new Float32Array(n)
    this.#size = new Float32Array(n)
    this.#endSize = new Float32Array(n)
    this.#rgba = new Float32Array(n * 4)
    this.#drag = new Float32Array(n)
    this.#gravity = new Float32Array(n)
    this.#windShare = new Float32Array(n)
    this.#rotation = new Float32Array(n)
    this.#spin = new Float32Array(n)
    this.#shape = new Uint8Array(n)
    this.#order = new Float64Array(n)
    this.#sun.copy(sunDirection)

    const geometry = new InstancedBufferGeometry()
    geometry.setAttribute("corner", new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    // `position` is unused by the shader but three reads its count to size the draw.
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(12), 3))
    const instanced = (size: number) => new InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(DynamicDrawUsage)
    this.#centre = instanced(4)
    this.#color = instanced(4)
    this.#motion = instanced(4)
    this.#shapeAttribute = instanced(1)
    geometry.setAttribute("aCentre", this.#centre)
    geometry.setAttribute("aColor", this.#color)
    geometry.setAttribute("aMotion", this.#motion)
    geometry.setAttribute("aShape", this.#shapeAttribute)
    geometry.instanceCount = 0
    this.#attributes = [this.#centre, this.#color, this.#motion, this.#shapeAttribute]

    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          map: { value: null },
          uStreak: { value: options.streak },
          uLit: { value: options.lit ? 1 : 0 },
          uAdditive: { value: options.blending === "additive" ? 1 : 0 },
          uSunView: { value: new Vector3() },
          uLightColor: { value: sunlight },
          uShadeColor: { value: new Color(...options.shade) },
          uSoft: { value: options.soft },
          uSoftLift: { value: options.softLift ?? 0 },
        },
      ]),
      transparent: true,
      depthWrite: false,
      blending: options.blending === "additive" ? AdditiveBlending : NormalBlending,
      fog: true,
    })
    const uniforms = material.uniforms
    if (uniforms.map !== undefined) uniforms.map.value = options.texture
    uniforms.uSceneDepth = particleScene.depth
    uniforms.uNearFar = particleScene.nearFar
    uniforms.uDepthScale = particleScene.depthScale
    this.mesh = new Mesh(geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.layers.set(options.blending === "additive" ? glowLayer : particleLayer)
    this.mesh.renderOrder = options.blending === "additive" ? 3 : 2
  }

  /** Live particles. */
  get count(): number {
    return this.#count
  }

  /** Adds one particle; a full layer overwrites a live one, so new effects never go missing. */
  emit(p: ParticleSpawn): void {
    const full = this.#count >= this.#options.capacity
    // Swap-remove scrambles the pool, so a stride through it replaces a spread of ages rather than always the newest.
    const i = full ? (this.#recycle = (this.#recycle + 997) % this.#options.capacity) : this.#count++
    this.#pos[i * 3] = p.x
    this.#pos[i * 3 + 1] = p.y
    this.#pos[i * 3 + 2] = p.z
    this.#vel[i * 3] = p.vx
    this.#vel[i * 3 + 1] = p.vy
    this.#vel[i * 3 + 2] = p.vz
    this.#age[i] = 0
    this.#life[i] = p.life
    this.#size[i] = p.size
    this.#endSize[i] = p.endSize
    this.#rgba[i * 4] = p.r
    this.#rgba[i * 4 + 1] = p.g
    this.#rgba[i * 4 + 2] = p.b
    this.#rgba[i * 4 + 3] = p.alpha
    this.#drag[i] = p.drag
    this.#gravity[i] = p.gravity
    this.#windShare[i] = p.windShare
    this.#rotation[i] = p.rotation
    this.#spin[i] = p.spin
    this.#shape[i] = p.shape
  }

  /** Ages, moves and uploads every particle. `time` is the sim time the sea is drawn at. */
  update(dt: number, time: number, windX: number, windZ: number, sea: SeaState | undefined, camera: Camera): void {
    const o = this.#options
    const pos = this.#pos
    const vel = this.#vel
    for (let i = 0; i < this.#count; ) {
      const age = this.#age[i]! + dt
      if (age >= this.#life[i]!) {
        this.#remove(i)
        continue
      }
      this.#age[i] = age
      const relax = 1 - Math.exp(-this.#drag[i]! * dt)
      const share = this.#windShare[i]!
      const j = i * 3
      vel[j] = vel[j]! + (windX * share - vel[j]!) * relax
      vel[j + 1] = vel[j + 1]! - vel[j + 1]! * relax - this.#gravity[i]! * dt
      vel[j + 2] = vel[j + 2]! + (windZ * share - vel[j + 2]!) * relax
      pos[j] = pos[j]! + vel[j]! * dt
      pos[j + 1] = pos[j + 1]! + vel[j + 1]! * dt
      pos[j + 2] = pos[j + 2]! + vel[j + 2]! * dt
      this.#rotation[i] = this.#rotation[i]! + this.#spin[i]! * dt
      if (o.water !== "ignore" && sea !== undefined) {
        const surface = oceanHeight(sea, pos[j]!, pos[j + 2]!, time)
        if (o.water === "ride") pos[j + 1] = surface + 0.12
        else if (pos[j + 1]! < surface && vel[j + 1]! < 0) {
          this.#remove(i)
          continue
        }
      }
      i++
    }
    this.#upload(camera)
  }

  #remove(i: number) {
    const last = --this.#count
    if (i === last) return
    this.#pos.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.#vel.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.#rgba.copyWithin(i * 4, last * 4, last * 4 + 4)
    this.#age[i] = this.#age[last]!
    this.#life[i] = this.#life[last]!
    this.#size[i] = this.#size[last]!
    this.#endSize[i] = this.#endSize[last]!
    this.#drag[i] = this.#drag[last]!
    this.#gravity[i] = this.#gravity[last]!
    this.#windShare[i] = this.#windShare[last]!
    this.#rotation[i] = this.#rotation[last]!
    this.#spin[i] = this.#spin[last]!
    this.#shape[i] = this.#shape[last]!
  }

  #upload(camera: Camera) {
    const o = this.#options
    const n = this.#count
    const order = this.#order
    const e = camera.matrixWorld.elements
    if (o.sorted) {
      // Depth along the view axis packed above the index, so a native typed-array sort orders far to near without a comparator.
      const cx = e[12]!
      const cy = e[13]!
      const cz = e[14]!
      const fx = -e[8]!
      const fy = -e[9]!
      const fz = -e[10]!
      for (let i = 0; i < n; i++) {
        const depth = (this.#pos[i * 3]! - cx) * fx + (this.#pos[i * 3 + 1]! - cy) * fy + (this.#pos[i * 3 + 2]! - cz) * fz
        order[i] = Math.floor(Math.max(0, 8000 - depth) * 64) * 8192 + i
      }
      order.subarray(0, n).sort()
    }
    const centre = this.#centre.array
    const color = this.#color.array
    const motion = this.#motion.array
    const shape = this.#shapeAttribute.array
    const [tr, tg, tb] = o.endTint
    for (let k = 0; k < n; k++) {
      const i = o.sorted ? order[k]! % 8192 : k
      const u = this.#age[i]! / this.#life[i]!
      const grow = 1 - (1 - u) * (1 - u)
      const fade = Math.min(1, u / Math.max(o.fadeIn, 1e-3)) * Math.pow(1 - u, o.fadeOut)
      centre[k * 4] = this.#pos[i * 3]!
      centre[k * 4 + 1] = this.#pos[i * 3 + 1]!
      centre[k * 4 + 2] = this.#pos[i * 3 + 2]!
      centre[k * 4 + 3] = this.#size[i]! + (this.#endSize[i]! - this.#size[i]!) * grow
      color[k * 4] = this.#rgba[i * 4]! * (1 + (tr - 1) * u)
      color[k * 4 + 1] = this.#rgba[i * 4 + 1]! * (1 + (tg - 1) * u)
      color[k * 4 + 2] = this.#rgba[i * 4 + 2]! * (1 + (tb - 1) * u)
      color[k * 4 + 3] = this.#rgba[i * 4 + 3]! * fade
      motion[k * 4] = this.#vel[i * 3]!
      motion[k * 4 + 1] = this.#vel[i * 3 + 1]!
      motion[k * 4 + 2] = this.#vel[i * 3 + 2]!
      motion[k * 4 + 3] = this.#rotation[i]!
      shape[k] = this.#shape[i]!
    }
    this.mesh.geometry.instanceCount = n
    this.mesh.visible = n > 0
    for (const attribute of this.#attributes) {
      attribute.clearUpdateRanges()
      attribute.addUpdateRange(0, n * attribute.itemSize)
      attribute.needsUpdate = true
    }
    const sunView = this.mesh.material.uniforms.uSunView?.value
    if (sunView instanceof Vector3) sunView.copy(this.#sun).transformDirection(camera.matrixWorldInverse)
  }
}
