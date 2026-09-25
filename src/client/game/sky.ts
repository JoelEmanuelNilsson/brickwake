import { Color, CubeCamera, type CubeTexture, DataUtils, HalfFloatType, PMREMGenerator, Scene, type Texture, type Vector3, WebGLCubeRenderTarget, type WebGLRenderer } from "three"
import { Sky } from "three/addons/objects/Sky.js"

/** The sunset sky: the live dome, a captured cube the sea reflects, the image-based light it casts and the fog colour at its horizon. */
export interface GameSky {
  readonly dome: Sky
  /** The sky captured once at load, linear HDR; the sea reflects it and fades into its horizon. */
  readonly cube: CubeTexture
  readonly environment: Texture
  /** Mean horizon colour, linear HDR: the fog colour of everything but the sea. */
  readonly horizon: Color
  /** Keep the dome around the camera and drift its clouds to sim time `time`. */
  update(cameraPosition: Vector3, time: number): void
}

const cubeSize = 256

/** Parameters of three's Sky tuned to ref-01: a low orange sun under broken, sun-lit cloud. */
const skyParameters = {
  turbidity: 12,
  rayleigh: 4,
  mieCoefficient: 0.003,
  mieDirectionalG: 0.86,
  cloudCoverage: 0.62,
  cloudDensity: 1.0,
  cloudElevation: 0.55,
  cloudScale: 0.0004,
  cloudSpeed: 0.00004,
} as const

/** Build the sky for a sun in `sunDirection` and capture it for reflections, lighting and fog. */
export const createGameSky = (renderer: WebGLRenderer, sunDirection: Vector3): GameSky => {
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
  // three's disc is ~1e4 in HDR, which bloom would smear over a third of the screen; this keeps a bright core and a modest halo.
  // The sky runs from ~0.4 opposite the sun to over 16 beside it; it is compressed by luminance and graded toward ref-01's
  // amber, so the glow round a low sun stays orange under ACES instead of clipping to white and the far sky is not teal.
  // Clouds get a warm key light of their own: three lights them with the view ray's extinction, which leaves them the
  // colour of the sky behind them at a low sun.
  const edits: ReadonlyArray<readonly [string, string]> = [
    ["760.0 * sundisc", "25.0 * sundisc"],
    ["vec3 cloudColor = skyAmbient + sunColor * shade;", "vec3 cloudColor = skyAmbient * 0.3 + vec3(1.0, 0.45, 0.2) * 0.8 * (shade * 0.5 + silver * edge * 0.6);"],
    ["cloudColor += sunColor * silver * edge * 0.6;", ""],
    ["cloudColor *= max( dayFactor, 0.03 );", ""],
    ["vec3 cloudAerial = mix( texColor, cloudColor, Fex );", "vec3 cloudAerial = mix( texColor, cloudColor, 0.85 );"],
    [
      "gl_FragColor = vec4( texColor, 1.0 );",
      "float skyLuminance = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );\n" +
        "gl_FragColor = vec4( mix( vec3( skyLuminance ), texColor, 0.3 ) * vec3( 1.0, 0.42, 0.28 ) * 1.3 / ( 1.0 + skyLuminance / 0.7 ), 1.0 );",
    ],
  ]
  for (const [from, to] of edits) {
    if (!dome.material.fragmentShader.includes(from)) throw new Error(`three's Sky shader no longer contains: ${from}`)
    dome.material.fragmentShader = dome.material.fragmentShader.replace(from, to)
  }

  const target = new WebGLCubeRenderTarget(cubeSize, { type: HalfFloatType, generateMipmaps: true })
  const capture = new Scene()
  capture.add(dome)
  new CubeCamera(1, 10_000, target).update(renderer, capture)
  capture.remove(dome)

  // The horizon's mean colour, from the middle rows of the four side faces.
  const row = new Uint16Array(cubeSize * 4 * 3)
  const sum = [0, 0, 0]
  for (const face of [0, 1, 4, 5]) {
    renderer.readRenderTargetPixels(target, 0, cubeSize / 2 - 2, cubeSize, 3, row, face)
    for (let i = 0; i < row.length; i += 4) for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + DataUtils.fromHalfFloat(row[i + c] ?? 0)
  }
  const samples = 4 * cubeSize * 3
  const horizon = new Color((sum[0] ?? 0) / samples, (sum[1] ?? 0) / samples, (sum[2] ?? 0) / samples)

  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromCubemap(target.texture).texture
  pmrem.dispose()

  return {
    dome,
    cube: target.texture,
    environment,
    horizon,
    update: (cameraPosition, time) => {
      dome.position.copy(cameraPosition)
      const clock = uniforms.time
      if (clock !== undefined) clock.value = time
    },
  }
}
