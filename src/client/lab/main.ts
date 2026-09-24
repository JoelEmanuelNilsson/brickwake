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
import { partIds } from "../bricks/parts.ts"
import { createOceanStandIn } from "./ocean.ts"
import { buildSampler, samplerSize } from "./sampler.ts"
import { createSunsetSky } from "./sky.ts"

/** Fixed lab cameras in ship space (metres; bow toward +z, stern at -z, port at -x). */
export const labCameras = {
  sampler: { position: [-9.5, 3.2, -12.5], target: [-1.5, 1.2, -4.5], fov: 40 },
  parts: { position: [-6.2, 4.6, -7.4], target: [0.2, 1.5, -2.6], fov: 40 },
  details: { position: [-5.2, 4.4, -2.2], target: [0.6, 1.6, 3.4], fov: 40 },
  "ref-01": { position: [-6.5, 4.2, -21], target: [1.5, 2.6, 2], fov: 50 },
  "ref-02": { position: [-8.6, 1.1, -13.5], target: [-2.6, 3, 6], fov: 62 },
} as const

type LabCameraName = keyof typeof labCameras

const isCameraName = (name: string | null): name is LabCameraName => name !== null && Object.hasOwn(labCameras, name)

/** Read-only view of the lab for Playwright, on `window.brickLab`. */
export interface BrickLabHook {
  readonly ready: boolean
  readonly camera: LabCameraName
  readonly shapeCount: number
  readonly buildMs: number
  stats(): BrickShipStats
  meshIds(): ReadonlyArray<string>
  setCamera(name: string): void
  /** Remove parts by index and report how long the removals took. */
  remove(indices: ReadonlyArray<number>): { readonly removed: number; readonly ms: number }
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
renderer.shadowMap.enabled = true
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
scene.environmentIntensity = 0.5

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
const placements = buildSampler()
const buildStart = performance.now()
const ship = new BrickShipMesh(library, placements)
const buildMs = performance.now() - buildStart
ship.root.position.set((-samplerSize.x * 0.4) / 2, -0.96, (-samplerSize.z * 0.4) / 2)
scene.add(ship.root)

const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
const requestedCamera = params.get("camera")
let cameraName: LabCameraName = isCameraName(requestedCamera) ? requestedCamera : "sampler"
const applyCamera = (name: LabCameraName) => {
  const preset = labCameras[name]
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
  statsPanel.textContent = `ship lab · ${cameraName}\n${partIds.length} shapes · ${parts} parts · ${studs} studs\n${draws} draws · ${(triangles / 1000).toFixed(1)}k tris · build ${buildMs.toFixed(1)} ms`
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
    if (isCameraName(name)) applyCamera(name)
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
}
