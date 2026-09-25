import { Color, CubeCamera, type CubeTexture, DataUtils, HalfFloatType, PMREMGenerator, Scene, type Texture, Vector3, WebGLCubeRenderTarget, type WebGLRenderer } from "three"
import { Sky } from "three/addons/objects/Sky.js"

/** The live sky: the dome, a captured cube the sea reflects, the image-based light it casts and the fog colour at its horizon. */
export interface GameSky {
  readonly dome: Sky
  /** The sky as last captured, linear HDR; the sea reflects it and fades into its horizon. */
  readonly cube: CubeTexture
  /** Image-based light from the last capture; replaced by each `restyle`. */
  readonly environment: Texture
  /** Mean horizon colour, linear HDR: the fog colour of everything but the sea. Updated in place by `restyle`. */
  readonly horizon: Color
  /** Redraws the sky as `look` and captures it again. */
  restyle(look: SkyLook): void
  /** Keep the dome around the camera and drift its clouds to sim time `time`. */
  update(cameraPosition: Vector3, time: number): void
}

/** What a weather changes in the sky. Colours are linear multipliers. */
export interface SkyLook {
  readonly turbidity: number
  readonly rayleigh: number
  /** Above 1 closes even three's thinnest regions of cloud. */
  readonly cloudCoverage: number
  readonly cloudDensity: number
  /** HDR brightness of the sun disc; 0 hides it. */
  readonly sunDisc: number
  /** Cloud self-shadowing: 1 as three draws it, 0 flat. */
  readonly cloudShade: number
  /** Colour the sun lights cloud with. */
  readonly cloudLight: readonly [number, number, number]
  /** 0 grey … 1 the sky's own colour. */
  readonly saturation: number
  /** Colour the compressed sky is graded by. */
  readonly grade: readonly [number, number, number]
}

const cubeSize = 256

/** Parameters of three's Sky that every weather shares. */
const skyParameters = {
  mieCoefficient: 0.003,
  mieDirectionalG: 0.86,
  cloudElevation: 0.55,
  cloudScale: 0.0004,
  cloudSpeed: 0.00004,
} as const

/** Build the sky for a sun in `sunDirection` as `look` and capture it for reflections, lighting and fog. */
export const createGameSky = (renderer: WebGLRenderer, sunDirection: Vector3, look: SkyLook): GameSky => {
  const dome = new Sky()
  dome.name = "sky"
  dome.scale.setScalar(5000)
  dome.frustumCulled = false
  const uniforms = dome.material.uniforms
  for (const [name, value] of Object.entries(skyParameters)) {
    const uniform = uniforms[name]
    if (uniform !== undefined) uniform.value = value
  }
  uniforms.sunPosition?.value.copy(sunDirection)
  uniforms.sunDisc = { value: 0 }
  uniforms.cloudShade = { value: 1 }
  uniforms.cloudLight = { value: new Vector3() }
  uniforms.skySaturation = { value: 0 }
  uniforms.skyGrade = { value: new Vector3() }
  // three's disc is ~1e4 in HDR, which bloom would smear over a third of the screen; this keeps a bright core and a modest halo.
  // The sky runs from ~0.4 opposite the sun to over 16 beside it; it is compressed by luminance and graded (clear: toward
  // ref-01's amber), so the glow round a low sun stays orange under ACES instead of clipping to white and the far sky is not teal.
  // Clouds get a warm key light of their own: three lights them with the view ray's extinction, which leaves them the
  // colour of the sky behind them at a low sun.
  const edits: ReadonlyArray<readonly [string, string]> = [
    ["uniform float showSunDisc;", "uniform float showSunDisc;\nuniform float sunDisc;\nuniform float cloudShade;\nuniform vec3 cloudLight;\nuniform float skySaturation;\nuniform vec3 skyGrade;"],
    ["760.0 * sundisc", "sunDisc * sundisc"],
    ["vec3 cloudColor = skyAmbient + sunColor * shade;", "vec3 cloudColor = skyAmbient * 0.3 + cloudLight * (mix(1.0, shade, cloudShade) * 0.5 + silver * edge * 0.6);"],
    ["cloudColor += sunColor * silver * edge * 0.6;", ""],
    ["cloudColor *= max( dayFactor, 0.03 );", ""],
    ["vec3 cloudAerial = mix( texColor, cloudColor, Fex );", "vec3 cloudAerial = mix( texColor, cloudColor, 0.85 );"],
    [
      "gl_FragColor = vec4( texColor, 1.0 );",
      "float skyLuminance = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );\n" +
        "gl_FragColor = vec4( mix( vec3( skyLuminance ), texColor, skySaturation ) * skyGrade / ( 1.0 + skyLuminance / 0.7 ), 1.0 );",
    ],
  ]
  for (const [from, to] of edits) {
    if (!dome.material.fragmentShader.includes(from)) throw new Error(`three's Sky shader no longer contains: ${from}`)
    dome.material.fragmentShader = dome.material.fragmentShader.replace(from, to)
  }

  const target = new WebGLCubeRenderTarget(cubeSize, { type: HalfFloatType, generateMipmaps: true })
  const cubeCamera = new CubeCamera(1, 10_000, target)
  const capture = new Scene()
  const row = new Uint16Array(cubeSize * 4 * 3)
  const pmrem = new PMREMGenerator(renderer)
  const horizon = new Color()

  const paint = (look: SkyLook) => {
    const set = (name: string, value: number) => {
      const uniform = uniforms[name]
      if (uniform !== undefined) uniform.value = value
    }
    set("turbidity", look.turbidity)
    set("rayleigh", look.rayleigh)
    set("cloudCoverage", look.cloudCoverage)
    set("cloudDensity", look.cloudDensity)
    set("sunDisc", look.sunDisc)
    set("cloudShade", look.cloudShade)
    set("skySaturation", look.saturation)
    uniforms.cloudLight?.value.set(...look.cloudLight)
    uniforms.skyGrade?.value.set(...look.grade)

    const parent = dome.parent
    capture.add(dome)
    cubeCamera.update(renderer, capture)
    parent?.add(dome)

    // The horizon's mean colour, from the middle rows of the four side faces.
    const sum = [0, 0, 0]
    for (const face of [0, 1, 4, 5]) {
      renderer.readRenderTargetPixels(target, 0, cubeSize / 2 - 2, cubeSize, 3, row, face)
      for (let i = 0; i < row.length; i += 4) for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + DataUtils.fromHalfFloat(row[i + c] ?? 0)
    }
    const samples = 4 * cubeSize * 3
    horizon.setRGB((sum[0] ?? 0) / samples, (sum[1] ?? 0) / samples, (sum[2] ?? 0) / samples)
  }
  paint(look)
  let environment = pmrem.fromCubemap(target.texture).texture

  return {
    dome,
    cube: target.texture,
    get environment() {
      return environment
    },
    horizon,
    restyle: (next) => {
      paint(next)
      environment.dispose()
      environment = pmrem.fromCubemap(target.texture).texture
    },
    update: (cameraPosition, time) => {
      dome.position.copy(cameraPosition)
      const clock = uniforms.time
      if (clock !== undefined) clock.value = time
    },
  }
}
