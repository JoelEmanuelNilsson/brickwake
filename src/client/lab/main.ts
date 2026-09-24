import {
  ACESFilmicToneMapping,
  DirectionalLight,
  FogExp2,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { type BrickShipStats, BrickShipMesh, createBrickLibrary } from "../bricks/brick-ship-mesh.ts"
import { generateShip } from "../../sim/ship/generate.ts"
import { partIds } from "../../sim/ship/parts.ts"
import { galleonSpec } from "../../sim/ship/spec.ts"
import { shipPlacements } from "../bricks/ship-placements.ts"
import { createOceanStandIn } from "./ocean.ts"
import { buildSampler, samplerSize } from "./sampler.ts"
import { createSunsetSky } from "./sky.ts"

/** Fixed sampler cameras (metres; the sampler's long side runs along z, its stern end at -z). */
export const samplerCameras = {
  sampler: { position: [-9.5, 3.2, -12.5], target: [-1.5, 1.2, -4.5], fov: 40 },
  parts: { position: [-6.2, 4.6, -7.4], target: [0.2, 1.5, -2.6], fov: 40 },
  details: { position: [-5.2, 4.4, -2.2], target: [0.6, 1.6, 3.4], fov: 40 },
  "ref-01": { position: [-6.5, 4.2, -21], target: [1.5, 2.6, 2], fov: 50 },
  "ref-02": { position: [-8.6, 1.1, -13.5], target: [-2.6, 3, 6], fov: 62 },
} as const

/** Fixed galleon cameras in sim ship space (metres; bow +x, starboard +z, stern at x ≈ -14). */
export const galleonCameras = {
  "ref-01": { position: [-25, 4.5, 17], target: [2, 2.4, -1], fov: 45 },
  "ref-02": { position: [-17.5, 1.6, 10.5], target: [4, 2.6, 4.6], fov: 55 },
  side: { position: [2, 3.5, 32], target: [1, 2.2, 0], fov: 50 },
  bow: { position: [24, 5, 14], target: [3, 2, 0], fov: 45 },
  top: { position: [0.5, 42, 0.01], target: [0.5, 0, 0], fov: 50 },
  fleet: { position: [-45, 24, 45], target: [60, 0, -26], fov: 50 },
} as const

type CameraPreset = { readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number]; readonly fov: number }

/** Read-only view of the lab for Playwright, on `window.brickLab`. */
export interface BrickLabHook {
  readonly ready: boolean
  readonly camera: string
  readonly shapeCount: number
  readonly buildMs: number
  stats(): BrickShipStats
  meshIds(): ReadonlyArray<string>
  setCamera(name: string): void
  /** Remove parts by index and report how long the removals took. */
  remove(indices: ReadonlyArray<number>): { readonly removed: number; readonly ms: number }
  /** Render `frames` frames back to back, each waited on until the GPU is done; frame times in ms. */
  measure(frames: number): { readonly median: number; readonly p90: number; readonly pipelined: number; readonly width: number; readonly height: number }
}

declare global {
  interface Window {
    brickLab?: BrickLabHook
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#scene")
const statsPanel = document.querySelector<HTMLElement>("#stats")
if (canvas === null || statsPanel === null) throw new Error("lab.html is missing #scene or #stats")

const params = new URLSearchParams(location.search)
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Number(params.get("dpr") ?? 1.5)))
renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = 0.5
renderer.shadowMap.enabled = params.get("shadows") !== "0"
renderer.shadowMap.type = PCFShadowMap

const scene = new Scene()
scene.fog = new FogExp2(0xc8784a, 0.0035)

const sunDirection = new Vector3().setFromSphericalCoords(1, MathUtils.degToRad(90 - 4), MathUtils.degToRad(-20))
const sky = createSunsetSky(sunDirection)
scene.add(sky)

const pmrem = new PMREMGenerator(renderer)
const skyOnly = new Scene()
skyOnly.add(sky.clone())
scene.environment = pmrem.fromScene(skyOnly, 0, 1, 5000).texture
pmrem.dispose()
scene.environmentIntensity = 0.3

// The refs light the hull faces the camera sees while the sun sits behind the ship, so the key light
// comes from the camera side and a weaker rim light from the visible sun.
const key = new DirectionalLight(0xffcfa0, 5)
key.position.set(-7, 12, -20)
key.castShadow = true
key.shadow.mapSize.set(4096, 4096)
key.shadow.camera.left = -16
key.shadow.camera.right = 16
key.shadow.camera.top = 16
key.shadow.camera.bottom = -16
key.shadow.camera.near = 1
key.shadow.camera.far = 60
key.shadow.bias = -0.0002
key.shadow.normalBias = 0.015
scene.add(key)
const rim = new DirectionalLight(0xff8c4a, 2.5)
rim.position.copy(sunDirection).multiplyScalar(30)
scene.add(rim)

scene.add(createOceanStandIn())

const library = createBrickLibrary()
const galleon = params.get("ship") === "galleon"
const cameras: Readonly<Record<string, CameraPreset>> = galleon ? galleonCameras : samplerCameras
const fleet = galleon ? Math.max(1, Number(params.get("fleet") ?? 1)) : 1
const generateStart = performance.now()
const placements = galleon ? shipPlacements(galleonSpec, generateShip(galleonSpec)).placements : buildSampler()
const generateMs = performance.now() - generateStart
const buildStart = performance.now()
const ship = new BrickShipMesh(library, placements)
const buildMs = performance.now() - buildStart
if (galleon) {
  // A fleet in three columns of four, 40 m apart along x and 26 m across, each yawed a little.
  for (let i = 0; i < fleet; i++) {
    const copy = i === 0 ? ship : new BrickShipMesh(library, placements)
    copy.root.position.set((i % 4) * 40, 0, Math.floor(i / 4) * -26)
    copy.root.rotation.y = i === 0 ? 0 : ((i * 37) % 11) * 0.05 - 0.25
    scene.add(copy.root)
  }
  if (fleet > 1) {
    key.shadow.camera.left = -110
    key.shadow.camera.right = 110
    key.shadow.camera.top = 110
    key.shadow.camera.bottom = -110
    key.shadow.camera.far = 200
    key.position.set(40, 40, -86)
    key.target.position.set(60, 0, -26)
    scene.add(key.target)
  }
} else {
  ship.root.position.set((-samplerSize.x * 0.4) / 2, -0.96, (-samplerSize.z * 0.4) / 2)
  scene.add(ship.root)
}

const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
const requestedCamera = params.get("camera") ?? ""
let cameraName = Object.hasOwn(cameras, requestedCamera) ? requestedCamera : (Object.keys(cameras)[0] ?? "")
const applyCamera = (name: string) => {
  const preset = cameras[name]
  if (preset === undefined) return
  cameraName = name
  camera.fov = preset.fov
  camera.position.fromArray(preset.position)
  camera.lookAt(new Vector3().fromArray(preset.target))
  camera.updateProjectionMatrix()
}

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.22, 0.4, 2.2)
if (params.get("bloom") !== "0") composer.addPass(bloom)
composer.addPass(new OutputPass())

const resize = () => {
  const width = window.innerWidth
  const height = window.innerHeight
  renderer.setSize(width, height, false)
  composer.setPixelRatio(renderer.getPixelRatio())
  composer.setSize(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}
window.addEventListener("resize", resize)
resize()
applyCamera(cameraName)

const showStats = () => {
  const { parts, studs, draws, triangles } = ship.stats()
  statsPanel.textContent = `ship lab · ${cameraName}${fleet > 1 ? ` · ${fleet} ships` : ""}\n${partIds.length} shapes · ${parts} parts · ${studs} studs\n${draws} draws · ${(triangles / 1000).toFixed(1)}k tris · generate ${generateMs.toFixed(1)} ms · build ${buildMs.toFixed(1)} ms`
}
showStats()

let frames = 0
renderer.setAnimationLoop(() => {
  composer.render()
  frames++
})

window.brickLab = {
  get ready() {
    return frames > 1
  },
  get camera() {
    return cameraName
  },
  shapeCount: partIds.length,
  buildMs,
  stats: () => ship.stats(),
  meshIds: () => ship.root.children.map((child) => child.uuid),
  setCamera: (name) => {
    applyCamera(name)
    showStats()
  },
  remove: (indices) => {
    const start = performance.now()
    let removed = 0
    for (const index of indices) if (ship.remove(index)) removed++
    const ms = performance.now() - start
    showStats()
    return { removed, ms }
  },
  measure: (count) => {
    renderer.setAnimationLoop(null)
    const gl = renderer.getContext()
    const pixel = new Uint8Array(4)
    const times: Array<number> = []
    for (let i = 0; i < count; i++) {
      const start = performance.now()
      composer.render()
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      times.push(performance.now() - start)
    }
    // Back to back with one wait at the end: CPU and GPU overlap as they do in the browser's frame loop.
    const pipelineStart = performance.now()
    for (let i = 0; i < count; i++) composer.render()
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    const pipelined = (performance.now() - pipelineStart) / count
    renderer.setAnimationLoop(() => composer.render())
    times.sort((a, b) => a - b)
    return { median: times[Math.floor(count / 2)] ?? 0, p90: times[Math.floor(count * 0.9)] ?? 0, pipelined, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight }
  },
}
