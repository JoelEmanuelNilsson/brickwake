import {
  ACESFilmicToneMapping,
  DirectionalLight,
  FogExp2,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { type BrickDetail, type BrickShipStats, BrickShipMesh, createBrickLibrary } from "../bricks/brick-ship-mesh.ts"
import { nextRange, seedRng } from "../../sim/rng.ts"
import { buildDamageGraph, type DamageZone, hitDamage, ShipDamage } from "../../sim/ship/damage.ts"
import { generateShip } from "../../sim/ship/generate.ts"
import { tuning } from "../../sim/tuning.ts"
import type { Vec3 } from "../../sim/vector.ts"
import { brickColors } from "../bricks/colors.ts"
import { removeAndReveal, wholeShip } from "../bricks/ship-wreck.ts"
import { ChipLayer, chipSpawn } from "../game/debris.ts"
import { partIds } from "../../sim/ship/parts.ts"
import { rigLayout } from "../../sim/ship/rig.ts"
import { galleonSpec } from "../../sim/ship/spec.ts"
import { ffaColors, ffaLivery, navyFleurLivery, navyLionLivery, pirateLivery, type SailLivery } from "../rig/sail-livery.ts"
import { buildRigGeometry, type SailLevel, ShipRig } from "../rig/ship-rig.ts"
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
  "ref-01": { position: [-25, 4.5, 17], target: [2, 5.5, -1], fov: 45 },
  "ref-02": { position: [-17.5, 1.6, 10.5], target: [4, 4.6, 4.6], fov: 60 },
  side: { position: [2, 3.5, 32], target: [1, 2.2, 0], fov: 50 },
  bow: { position: [24, 5, 14], target: [3, 2, 0], fov: 45 },
  top: { position: [0.5, 42, 0.01], target: [0.5, 0, 0], fov: 50 },
  fleet: { position: [-25, 4.5, 17], target: [2, 2.4, -1], fov: 45 },
  stern: { position: [-26, 7, 3], target: [0, 4, 0], fov: 40 },
  guns: { position: [-7, 2.2, 9.5], target: [2, 2.4, 3.8], fov: 50 },
  rig: { position: [-34, 7, 30], target: [1.5, 9.5, 0], fov: 45 },
  "rig-bow": { position: [36, 5, 26], target: [0, 9.5, 0], fov: 45 },
  // Port quarter, the side the key light falls on, where the lab's volleys land; the low sun stays out of frame.
  damage: { position: [-15, 4.5, -19], target: [1, 2, 0], fov: 50 },
  // On the ref-01 line at the near→mid and mid→far switch distances for a 900 px tall viewport.
  "lod-mid": { position: [-35.4, 5.3, 23.9], target: [2, 2.4, -1], fov: 45 },
  "lod-far": { position: [-111, 11.2, 74.3], target: [2, 2.4, -1], fov: 45 },
} as const

/**
 * The measured fleet: ship 0 at the origin seen from the ref-01 camera, the rest at these distances (m)
 * from that camera and bearings (degrees) off its view line, with their own headings (degrees).
 */
export const fleetLayout: ReadonlyArray<readonly [distance: number, bearing: number, heading: number]> = [
  [60, 16, 40], [75, 24, -30], [90, 8, 170], [110, 30, 80], [135, -28, -120], [160, 12, 20],
  [190, 20, -60], [230, 27, 140], [280, 4, 0], [330, 15, -150], [400, 23, 60],
]

type CameraPreset = { readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number]; readonly fov: number }

/** Read-only view of the lab for Playwright, on `window.brickLab`. */
export interface BrickLabHook {
  readonly ready: boolean
  readonly camera: string
  readonly shapeCount: number
  readonly buildMs: number
  /** Hull and rig counts together at `detail`. */
  stats(detail?: BrickDetail): BrickShipStats
  /** The cosmetic rig's own share of `stats`. */
  rigStats(detail?: BrickDetail): { readonly draws: number; readonly triangles: number }
  setSailLevel(level: SailLevel): void
  /** Fly `pirate`, `navy-lion`, `navy-fleur` or `ffa-<n>` on every ship. */
  setLivery(name: string): void
  /** World wind velocity in m/s. */
  setWind(x: number, z: number): void
  /** Detail level and distance from the camera of every ship in the scene. */
  fleet(): ReadonlyArray<{ readonly detail: BrickDetail; readonly distance: number; readonly triangles: number; readonly draws: number }>
  meshIds(): ReadonlyArray<string>
  setCamera(name: string): void
  /** Remove parts by index and report how long the removals took. */
  remove(indices: ReadonlyArray<number>): { readonly removed: number; readonly ms: number }
  /** Hull HP of the lab galleon after the hits so far. */
  readonly hp: number
  /** Fire one ball at the ship along the camera ray through normalised device coordinates; the zone struck, if any. */
  fire(ndcX: number, ndcY: number): DamageZone | undefined
  /**
   * Fire seeded groups of balls at the port side from the beam, as broadsides land, until HP is at or below
   * `hp`; per-hit costs in ms for the damage rules (`sim`) and the mesh update with reveals (`view`).
   */
  volley(hp: number, seed: number): LabVolley
  /** Render `frames` frames back to back, each waited on until the GPU is done; frame times in ms. */
  measure(frames: number): { readonly median: number; readonly p90: number; readonly pipelined: number; readonly width: number; readonly height: number }
}

/** What a scripted volley did to the lab galleon. */
export interface LabVolley {
  readonly hits: number
  readonly zones: Readonly<Record<DamageZone, number>>
  readonly removed: number
  readonly detached: number
  readonly revealed: number
  readonly maxLoss: number
  readonly sim: { readonly median: number; readonly max: number }
  readonly view: { readonly median: number; readonly max: number }
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
key.shadow.camera.left = -24
key.shadow.camera.right = 24
key.shadow.camera.top = 24
key.shadow.camera.bottom = -24
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
const generated = galleon ? generateShip(galleonSpec) : undefined
const built = generated === undefined ? { placements: buildSampler(), plugs: [], air: undefined } : shipPlacements(galleonSpec, generated)
const generateMs = performance.now() - generateStart
const graphStart = performance.now()
const damage = generated === undefined ? undefined : new ShipDamage(buildDamageGraph(galleonSpec, generated))
const graphMs = performance.now() - graphStart
let hp: number = tuning.damage.hullHp
const buildStart = performance.now()
const ship = new BrickShipMesh(library, built.placements, built.plugs)
const buildMs = performance.now() - buildStart
const ships: Array<BrickShipMesh> = [ship]
const rigGeometry = galleon ? buildRigGeometry(rigLayout(galleonSpec)) : undefined
const liveries: ReadonlyArray<SailLivery> = [pirateLivery, navyLionLivery, navyFleurLivery, ...ffaColors.map(ffaLivery)]
const liveryNamed = (name: string) => liveries.find((l) => l.name === name) ?? (name.startsWith("ffa-") ? ffaLivery(ffaColors[Number(name.slice(4)) % ffaColors.length] ?? "#b3170c") : undefined)
const startLivery = liveryNamed(params.get("livery") ?? "pirate") ?? pirateLivery
const rigs = new Map<BrickShipMesh, ShipRig>()
const rig = (s: BrickShipMesh) => {
  if (rigGeometry === undefined) return
  const r = new ShipRig(rigGeometry, startLivery)
  s.root.add(r.root)
  rigs.set(s, r)
}
rig(ship)
const wind = { x: Number(params.get("windX") ?? 9), z: Number(params.get("windZ") ?? 4) }
const sailParam = Number(params.get("sail") ?? 2)
const startLevel: SailLevel = sailParam === 0 || sailParam === 1 ? sailParam : 2
for (const r of rigs.values()) r.setSailLevel(startLevel)
const forcedDetail = params.get("detail")
const fixedDetail: BrickDetail | undefined = forcedDetail === "near" || forcedDetail === "mid" || forcedDetail === "far" ? forcedDetail : undefined
if (galleon) {
  scene.add(ship.root)
  const eye = new Vector3().fromArray(galleonCameras.fleet.position)
  const look = new Vector3().fromArray(galleonCameras.fleet.target).sub(eye).setY(0).normalize()
  for (const [distance, bearing, heading] of fleetLayout.slice(0, fleet - 1)) {
    const copy = new BrickShipMesh(library, built.placements, built.plugs)
    rig(copy)
    const along = look.clone().applyAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(-bearing))
    copy.root.position.copy(eye).addScaledVector(along, distance).setY(0)
    copy.root.rotation.y = MathUtils.degToRad(heading)
    ships.push(copy)
    scene.add(copy.root)
  }
  if (fleet > 1) {
    // Shadows cover the water near the camera, where they can be seen; far ships fall outside the shadow frustum.
    key.shadow.camera.left = -70
    key.shadow.camera.right = 70
    key.shadow.camera.top = 70
    key.shadow.camera.bottom = -70
    key.shadow.camera.far = 200
    key.target.position.copy(eye).addScaledVector(look, 50).setY(0)
    key.position.copy(key.target.position).add(new Vector3(-7, 12, -20).normalize().multiplyScalar(90))
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

const updateDetail = () => {
  for (const s of ships) {
    if (fixedDetail === undefined) s.updateDetail(camera, renderer.domElement.height)
    else s.setDetail(fixedDetail)
    rigs.get(s)?.setDetail(s.detail)
  }
}

const fullStats = (s: BrickShipMesh, detail: BrickDetail = s.detail): BrickShipStats => {
  const hull = s.stats(detail)
  const r = rigs.get(s)?.stats(detail) ?? { draws: 0, triangles: 0 }
  return { ...hull, draws: hull.draws + r.draws, triangles: hull.triangles + r.triangles }
}

// Knocked-out parts fly on with the ball; parts cut off from the keel drop. Ticket 15 replaces these boxes.
const debris = new ChipLayer(2048)
scene.add(debris.mesh)
const spawn = chipSpawn()
const throwParts = (parts: ReadonlyArray<number>, direction: Vec3, speed: number) => {
  const boxes = damage?.graph.boxes
  if (boxes === undefined) return
  for (const i of parts) {
    const placement = ship.parts[i]
    if (placement === undefined) continue
    const o = i * 6
    const [x0, y0, z0, x1, y1, z1] = [boxes[o] ?? 0, boxes[o + 1] ?? 0, boxes[o + 2] ?? 0, boxes[o + 3] ?? 0, boxes[o + 4] ?? 0, boxes[o + 5] ?? 0]
    Object.assign(spawn, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, sx: x1 - x0, sy: y1 - y0, sz: z1 - z0, life: 4 })
    const scatter = speed * 0.35
    spawn.vx = direction.x * speed + (Math.random() - 0.5) * scatter
    spawn.vy = direction.y * speed + Math.random() * scatter
    spawn.vz = direction.z * speed + (Math.random() - 0.5) * scatter
    spawn.color.setHex(brickColors[placement.color].srgb)
    debris.throw(spawn)
  }
}

/** Fire one ball along a ship-local ray: the damage rules pick the parts, the mesh drops them and shows what they uncover. */
const fireRay = (origin: Vec3, direction: Vec3) => {
  if (damage === undefined || built.air === undefined) return undefined
  const distance = damage.firstPartAlong(origin, direction, 500)
  if (distance === undefined) return undefined
  const point = { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance }
  const simStart = performance.now()
  const hit = damage.hit(point, direction)
  const sim = performance.now() - simStart
  const viewStart = performance.now()
  const revealed = removeAndReveal(wholeShip(ship), built.air, [...hit.removed, ...hit.detached])
  const view = performance.now() - viewStart
  hp = Math.max(0, hp - hitDamage(hit.zone))
  throwParts(hit.removed, direction, 7)
  throwParts(hit.detached, direction, 1.5)
  return { hit, revealed, sim, view }
}

const showStats = () => {
  updateDetail()
  const { parts, studs, draws, triangles } = fullStats(ship)
  const total = ships.reduce((sum, s) => sum + fullStats(s).triangles, 0)
  statsPanel.textContent = `ship lab · ${cameraName}${fleet > 1 ? ` · ${fleet} ships, ${(total / 1e6).toFixed(2)}M tris` : ""}\n${partIds.length} shapes · ${parts} parts · ${studs} studs · ${ship.detail}\n${draws} draws · ${(triangles / 1000).toFixed(1)}k tris · generate ${generateMs.toFixed(1)} ms · build ${buildMs.toFixed(1)} ms${damage === undefined ? "" : `\nHP ${hp} · graph ${graphMs.toFixed(1)} ms · click to fire`}`
}
showStats()

let last = performance.now()
const render = () => {
  const now = performance.now()
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  for (const r of rigs.values()) r.update(dt, wind.x, wind.z)
  debris.update(Math.min(dt, 0.05), now / 1000, undefined)
  updateDetail()
  composer.render()
}

const raycaster = new Raycaster()
const fireAt = (ndcX: number, ndcY: number) => {
  raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera)
  const zone = fireRay(raycaster.ray.origin, raycaster.ray.direction)?.hit.zone
  showStats()
  return zone
}
canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect()
  fireAt(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
})

let frames = 0
renderer.setAnimationLoop(() => {
  render()
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
  stats: (detail) => fullStats(ship, detail),
  rigStats: (detail) => rigs.get(ship)?.stats(detail) ?? { draws: 0, triangles: 0 },
  setSailLevel: (level) => {
    for (const r of rigs.values()) r.setSailLevel(level)
  },
  setLivery: (name) => {
    const livery = liveryNamed(name)
    if (livery !== undefined) for (const r of rigs.values()) r.setLivery(livery)
  },
  setWind: (x, z) => {
    wind.x = x
    wind.z = z
  },
  fleet: () => ships.map((s) => ({ detail: s.detail, distance: camera.position.distanceTo(s.root.position), ...fullStats(s) })),
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
  get hp() {
    return hp
  },
  fire: fireAt,
  volley: (target, seed) => {
    let rng = seedRng(seed)
    const zones: Record<DamageZone, number> = { hull: 0, upperWorks: 0, sails: 0 }
    const sims: Array<number> = []
    const views: Array<number> = []
    let [removed, detached, revealed, maxLoss] = [0, 0, 0, 0]
    let aim = { x: 0, y: 0, slant: 0 }
    for (let tries = 0; hp > target && tries < 1000; tries++) {
      // Four-ball groups aimed at a point on the port side from off the beam, a little fore or aft; each ball lands
      // within the 1° spread cone around the aim, ±2.6 m at 150 m.
      if (tries % 4 === 0) {
        const [x, afterX] = nextRange(rng, -11, 11)
        const [y, afterY] = nextRange(afterX, 0.8, 4.5)
        const [slant, next] = nextRange(afterY, -0.25, 0.25)
        aim = { x, y, slant }
        rng = next
      }
      const [dx, afterDx] = nextRange(rng, -2.6, 2.6)
      const [dy, next] = nextRange(afterDx, -1.3, 1.3)
      rng = next
      const length = Math.hypot(aim.slant, 0.03, 1)
      const result = fireRay({ x: aim.x + dx - aim.slant * 30, y: aim.y + dy + 0.03 * 30, z: -30 }, { x: aim.slant / length, y: -0.03 / length, z: 1 / length })
      if (result === undefined) continue
      zones[result.hit.zone]++
      removed += result.hit.removed.length
      detached += result.hit.detached.length
      revealed += result.revealed
      maxLoss = Math.max(maxLoss, result.hit.removed.length + result.hit.detached.length)
      sims.push(result.sim)
      views.push(result.view)
    }
    showStats()
    const summary = (values: Array<number>) => {
      values.sort((a, b) => a - b)
      return { median: values[values.length >> 1] ?? 0, max: values[values.length - 1] ?? 0 }
    }
    return { hits: sims.length, zones, removed, detached, revealed, maxLoss, sim: summary(sims), view: summary(views) }
  },
  measure: (count) => {
    renderer.setAnimationLoop(null)
    const gl = renderer.getContext()
    const pixel = new Uint8Array(4)
    const times: Array<number> = []
    for (let i = 0; i < count; i++) {
      const start = performance.now()
      render()
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      times.push(performance.now() - start)
    }
    // Back to back with one wait at the end: CPU and GPU overlap as they do in the browser's frame loop.
    const pipelineStart = performance.now()
    for (let i = 0; i < count; i++) render()
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    const pipelined = (performance.now() - pipelineStart) / count
    renderer.setAnimationLoop(render)
    times.sort((a, b) => a - b)
    return { median: times[Math.floor(count / 2)] ?? 0, p90: times[Math.floor(count * 0.9)] ?? 0, pipelined, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight }
  },
}
