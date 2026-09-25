import {
  BufferAttribute,
  BufferGeometry,
  type Color,
  type CubeTexture,
  DataTexture,
  LinearMipmapLinearFilter,
  Mesh,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  type Texture,
  UniformsLib,
  UniformsUtils,
  type Vector3,
  Vector4,
} from "three"
import { waveAngularFrequency, type SeaState } from "../../sim/ocean.ts"
import { directionFromAngle } from "../../sim/vector.ts"

/** Most waves the ocean shader sums; `SeaState`s in play have at most four. */
export const maxOceanWaves = 8

/** Muzzle-flash lights the sea shows, at most. */
export const maxFlashes = 4

/** What the sea reflects and is lit by: the captured sky, the sun, and the colour of muzzle flashes. */
export interface OceanLighting {
  readonly sky: CubeTexture
  readonly sun: Color
  readonly sunDirection: Vector3
  readonly flashColor: Color
}

const gridSegments = 320
/** Vertex spacing at the grid centre, metres; the grid snaps by this so near vertices never swim. */
const nearSpacing = 1
/** Half-width of the grid, metres; beyond the fog. */
const gridRadius = 2000

/** Grid offset for u in −1…1: 1 m spacing at the centre, growing to ~60 m at the edge. */
const gridOffset = (u: number) => {
  const linear = (nearSpacing * gridSegments) / 2
  return Math.sign(u) * (linear * Math.abs(u) + (gridRadius - linear) * u ** 4)
}

const buildGrid = () => {
  const n = gridSegments + 1
  const positions = new Float32Array(n * n * 3)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 3
      positions[o] = gridOffset((i / gridSegments) * 2 - 1)
      positions[o + 2] = gridOffset((j / gridSegments) * 2 - 1)
    }
  }
  const indices = new Uint32Array(gridSegments * gridSegments * 6)
  let k = 0
  for (let j = 0; j < gridSegments; j++) {
    for (let i = 0; i < gridSegments; i++) {
      const a = j * n + i
      indices.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], k)
      k += 6
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

/** A tiling normal map of small ripples, from waves with whole-number wave vectors so it repeats seamlessly. */
const buildRippleTexture = () => {
  const size = 256
  const ripples = Array.from({ length: 24 }, (_, i) => {
    const angle = i * 2.399963
    const frequency = 2 + (i % 7) * 1.3 + i * 0.35
    return { kx: Math.round(Math.cos(angle) * frequency), ky: Math.round(Math.sin(angle) * frequency), amplitude: 1 / (1 + frequency), phase: i * 1.7 }
  })
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0
      let dy = 0
      for (const r of ripples) {
        const slope = Math.cos(((r.kx * x + r.ky * y) / size) * Math.PI * 2 + r.phase) * r.amplitude
        dx += slope * r.kx
        dy += slope * r.ky
      }
      const o = (y * size + x) * 4
      data[o] = Math.max(0, Math.min(255, (0.5 - dx * 0.04) * 255))
      data[o + 1] = Math.max(0, Math.min(255, (0.5 - dy * 0.04) * 255))
      data[o + 2] = 255
      data[o + 3] = 255
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

const vertexShader = /* glsl */ `
  #define MAX_WAVES ${maxOceanWaves}
  uniform vec4 waveA[MAX_WAVES]; // direction x, direction z, wave number k, amplitude
  uniform vec4 waveB[MAX_WAVES]; // sharpness * amplitude, phase at the grid origin and now
  uniform int waveCount;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vJacobian;
  varying float vHeight;
  #include <fog_pars_vertex>
  void main() {
    // Same sum as gerstnerPoint and sampleOcean in src/sim/ocean.ts, in coordinates relative to the grid origin.
    vec3 p = vec3(position.x, 0.0, position.z);
    float dxx = 1.0, dxy = 0.0, dxz = 0.0, dzx = 0.0, dzy = 0.0, dzz = 1.0;
    for (int i = 0; i < MAX_WAVES; i++) {
      if (i >= waveCount) break;
      vec4 a = waveA[i];
      vec4 b = waveB[i];
      float theta = a.z * (a.x * position.x + a.y * position.z) + b.y;
      float s = sin(theta);
      float c = cos(theta);
      float sway = b.x * s;
      p.x -= a.x * sway;
      p.z -= a.y * sway;
      p.y += a.w * c;
      float steep = b.x * a.z;
      float slope = a.w * a.z * s;
      dxx -= steep * a.x * a.x * c;
      dxy -= slope * a.x;
      dxz -= steep * a.x * a.y * c;
      dzx -= steep * a.x * a.y * c;
      dzy -= slope * a.y;
      dzz -= steep * a.y * a.y * c;
    }
    vNormal = normalize(vec3(dzy * dxz - dzz * dxy, dzz * dxx - dzx * dxz, dzx * dxy - dzy * dxx));
    vJacobian = dxx * dzz - dxz * dzx;
    vHeight = p.y;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  #define FLASHES ${maxFlashes}
  uniform sampler2D ripples;
  uniform samplerCube skyCube;
  uniform sampler2D wake;
  uniform float wakePeriod;
  uniform float rippleTime;
  uniform float waveHeight;
  uniform float waveSteepness;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  uniform vec4 flashes[FLASHES]; // position, intensity (cd)
  uniform vec3 flashColor;
  uniform float fogDensity;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vJacobian;
  varying float vHeight;
  void main() {
    vec3 toCamera = cameraPosition - vWorld;
    float distance = length(toCamera);
    vec3 view = toCamera / distance;
    vec2 r1 = texture2D(ripples, vWorld.xz / 23.0 + vec2(rippleTime * 0.013, rippleTime * 0.007)).xy * 2.0 - 1.0;
    vec2 r2 = texture2D(ripples, vWorld.xz / 9.0 - vec2(rippleTime * 0.011, -rippleTime * 0.017)).xy * 2.0 - 1.0;
    // Ripples fade with distance: past ~300 m they would only alias into sparkle noise.
    float rippleStrength = 0.3 * (1.0 - smoothstep(40.0, 260.0, distance));
    vec2 ripple = (r1 + r2 * 0.6) * rippleStrength;
    vec3 normal = normalize(vNormal + vec3(ripple.x, 0.0, ripple.y));

    float facing = max(dot(normal, view), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
    vec3 reflected = reflect(-view, normal);
    reflected.y = max(reflected.y, 0.005);
    float toSun = max(dot(normalize(reflected), sunDirection), 0.0);
    // The sky is graded amber; away from the sun's path the sea reflects it cooled, keeping ref-01's dark teal water.
    vec3 sky = textureCube(skyCube, reflected).rgb * mix(vec3(0.45, 1.2, 2.2), vec3(1.0), pow(toSun, 6.0));
    vec3 glint = vec3(9.0, 6.5, 4.0) * pow(toSun, 900.0) * (1.0 - smoothstep(400.0, 1400.0, distance));

    float crest = clamp(vHeight / max(waveHeight, 0.01) * 0.5 + 0.5, 0.0, 1.0);
    vec3 deep = vec3(0.004, 0.028, 0.034);
    vec3 shallow = vec3(0.02, 0.16, 0.15);
    // Light through the thin tops of swells facing away from the sun reads as teal.
    float scatter = crest * crest * (0.35 + 0.65 * max(dot(-view, sunDirection), 0.0)) * max(dot(vNormal, vec3(0.0, 1.0, 0.0)), 0.0);
    vec3 water = mix(deep, shallow, scatter) + sunColor * 0.012 * max(dot(normal, sunDirection), 0.0);

    float foamNoise = texture2D(ripples, vWorld.xz / 5.0 + rippleTime * 0.02).x;
    // Folding is measured against the sea's own steepness, so the sharpest crests of any sea state foam.
    float fold = (1.0 - vJacobian) / max(waveSteepness, 0.001);
    float foamMask = smoothstep(0.44, 1.09, fold) * smoothstep(0.55, 0.9, crest);
    float crestFoam = smoothstep(0.45, 0.75, foamMask * (0.35 + foamNoise)) * (1.0 - smoothstep(250.0, 900.0, distance));
    // Hull and wake foam: dense where fresh, breaking into lace as it thins.
    float laid = texture2D(wake, vWorld.xz / wakePeriod).r * (1.0 - smoothstep(260.0, 420.0, distance));
    float lace = texture2D(ripples, vWorld.xz / 3.1 - rippleTime * 0.01).y;
    // As foam thins it covers less of the water: the pattern's threshold rises, leaving streaks and lace, not a grey sheet.
    float cover = clamp(laid, 0.0, 1.0);
    float pattern = foamNoise * 0.55 + lace * 0.45;
    float wakeFoam = smoothstep(1.0 - cover, 1.15 - cover, pattern) * min(1.0, laid * 4.0);
    float foam = max(crestFoam, wakeFoam);

    vec3 flash = vec3(0.0);
    for (int i = 0; i < FLASHES; i++) {
      vec3 toLight = flashes[i].xyz - vWorld;
      float d2 = max(dot(toLight, toLight), 1.0);
      vec3 l = toLight * inversesqrt(d2);
      float lit = flashes[i].w / d2;
      flash += lit * (0.03 * max(dot(normal, l), 0.0) + 0.6 * fresnel * pow(max(dot(reflected, l), 0.0), 40.0));
    }
    flash *= flashColor;

    vec3 color = mix(water, sky, fresnel) + glint + flash;
    color = mix(color, vec3(0.9, 0.85, 0.8) * (0.35 + 0.65 * max(dot(normal, sunDirection), 0.2)) + flash * 25.0, foam * 0.85);
    // Fog toward the sky's own horizon in this direction, so the sea meets the sky without a seam.
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * distance * distance);
    vec3 horizon = textureCube(skyCube, normalize(vec3(-view.x, 0.02, -view.z))).rgb;
    gl_FragColor = vec4(mix(color, horizon, fogFactor), 1.0);
  }
`

/**
 * The drawn sea: a camera-following grid displaced on the GPU by the same Gerstner sum as
 * `sampleOcean`, evaluated at the render clock's sim time so ships sit in the water they are drawn in.
 */
export class OceanSurface {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>
  readonly sea: SeaState
  readonly #waveA: Array<Vector4>
  readonly #waveB: Array<Vector4>
  /** Muzzle-flash lights on the sea: position and intensity (cd); the game copies them in each frame. */
  readonly flashes: Array<Vector4> = Array.from({ length: maxFlashes }, () => new Vector4())

  constructor(sea: SeaState, lighting: OceanLighting, wakePeriod: number) {
    if (sea.waves.length > maxOceanWaves) throw new Error(`the ocean shader sums at most ${maxOceanWaves} waves`)
    this.sea = sea
    this.#waveA = Array.from({ length: maxOceanWaves }, () => new Vector4())
    this.#waveB = Array.from({ length: maxOceanWaves }, () => new Vector4())
    sea.waves.forEach((wave, i) => {
      const d = directionFromAngle(wave.direction)
      this.#waveA[i]?.set(d.x, d.z, (2 * Math.PI) / wave.wavelength, wave.amplitude)
      this.#waveB[i]?.set(wave.sharpness * wave.amplitude, 0, 0, 0)
    })
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      fog: true,
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          waveCount: { value: sea.waves.length },
          rippleTime: { value: 0 },
          waveHeight: { value: sea.waves.reduce((sum, wave) => sum + wave.amplitude, 0) },
          waveSteepness: { value: sea.waves.reduce((sum, wave) => sum + (wave.sharpness * 2 * Math.PI * wave.amplitude) / wave.wavelength, 0) },
          sunColor: { value: lighting.sun },
          sunDirection: { value: lighting.sunDirection },
          flashColor: { value: lighting.flashColor },
          wakePeriod: { value: wakePeriod },
        },
      ]),
    })
    // Arrays and the texture are assigned after the merge, which would otherwise clone them per material.
    material.uniforms.waveA = { value: this.#waveA }
    material.uniforms.waveB = { value: this.#waveB }
    material.uniforms.ripples = { value: buildRippleTexture() }
    material.uniforms.skyCube = { value: lighting.sky }
    material.uniforms.wake = { value: null }
    material.uniforms.flashes = { value: this.flashes }
    this.mesh = new Mesh(buildGrid(), material)
    this.mesh.frustumCulled = false
    this.mesh.name = "ocean"
  }

  /** Poses the sea at sim time `time` seconds, with the grid centred under the camera at (x, z), showing the foam in `wake`. */
  update(time: number, cameraX: number, cameraZ: number, wake: Texture): void {
    const wakeUniform = this.mesh.material.uniforms.wake
    if (wakeUniform !== undefined) wakeUniform.value = wake
    const originX = Math.round(cameraX / nearSpacing) * nearSpacing
    const originZ = Math.round(cameraZ / nearSpacing) * nearSpacing
    this.mesh.position.set(originX, 0, originZ)
    const waves = this.sea.waves
    for (let i = 0; i < waves.length; i++) {
      const wave = waves[i]
      const a = this.#waveA[i]
      const b = this.#waveB[i]
      if (wave === undefined || a === undefined || b === undefined) continue
      // Phase at the grid origin in double precision; the shader adds only small offsets, so float32 stays exact at any time or place.
      const phase = a.z * (a.x * originX + a.y * originZ) - waveAngularFrequency(wave) * time + wave.phase
      b.y = phase - 2 * Math.PI * Math.floor(phase / (2 * Math.PI))
    }
    const rippleTime = this.mesh.material.uniforms.rippleTime
    if (rippleTime !== undefined) rippleTime.value = time % 10_000
  }
}
