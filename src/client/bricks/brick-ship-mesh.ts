import { Box3, type BufferGeometry, Color, Group, InstancedMesh, MathUtils, Matrix4, MeshStandardMaterial, type PerspectiveCamera, Sphere, Vector3 } from "three"
import type { BrickColor } from "../../sim/ship/colors.ts"
import { brickColors } from "./colors.ts"
import { metresPerLdu, type PartId, partCatalog } from "../../sim/ship/parts.ts"
import { buildFlatStudGeometry, buildPartGeometry, buildStudGeometry, flatShape, glassShade } from "./parts.ts"

/** One part of a ship: shape, colour, ship-space transform in metres, and which of its studs are covered. */
export interface BrickPlacement {
  readonly part: PartId
  readonly color: BrickColor
  readonly matrix: Matrix4
  /** Indices into the shape's `studs` that a part above covers. */
  readonly hiddenStuds?: ReadonlyArray<number>
  /** Seen from outside only through openings in the hull; far detail leaves it out. */
  readonly interior?: boolean
  /** Enclosed: not drawn until `reveal` shows it, when a hole opens onto it. */
  readonly hidden?: boolean
}

/** A dark box that fills a hull opening at far detail, where the interior behind it is left out; it goes when `owner` is removed. */
export interface BrickPlug {
  readonly owner: number
  readonly matrix: Matrix4
}

/**
 * How much of a ship is drawn. near: chamfered shapes and studs. mid: flat-faced shapes that share draws
 * by stretching, six-sided studs. far: flat shapes, no studs, interior replaced by plugs in the openings.
 */
export type BrickDetail = "near" | "mid" | "far"

// Switch points in screen pixels per metre, with ~20 % hysteresis so a ship at the boundary does not flicker.
// near→mid where the 2 cm chamfer falls under half a pixel; mid→far where a 24 cm stud falls under 2 px.
const detailBands = { midBelow: 22, nearAbove: 26, farBelow: 7.5, midAbove: 9 } as const

/** The detail level for a ship seen at `pixelsPerMetre`, keeping `current` inside the hysteresis bands; with no `current`, the bands' midpoints decide. */
export const brickDetailFor = (pixelsPerMetre: number, current?: BrickDetail): BrickDetail => {
  if (current === undefined) return pixelsPerMetre >= (detailBands.midBelow + detailBands.nearAbove) / 2 ? "near" : pixelsPerMetre >= (detailBands.farBelow + detailBands.midAbove) / 2 ? "mid" : "far"
  if (pixelsPerMetre >= detailBands.nearAbove) return "near"
  if (pixelsPerMetre < detailBands.farBelow) return "far"
  if (current === "near" && pixelsPerMetre >= detailBands.midBelow) return "near"
  if (current === "far" && pixelsPerMetre < detailBands.midAbove) return "far"
  return "mid"
}

/** Geometries and materials shared by every ship; build one per renderer. */
export interface BrickLibrary {
  readonly plastic: MeshStandardMaterial
  readonly studGeometry: BufferGeometry
  readonly flatStudGeometry: BufferGeometry
  geometry(part: PartId): BufferGeometry
  flat(part: PartId): { readonly key: string; readonly geometry: BufferGeometry; readonly scale: readonly [number, number, number] }
  dispose(): void
}

/** Create the shared part geometries (built lazily per shape) and the one ABS plastic material every part draws with. */
export const createBrickLibrary = (): BrickLibrary => {
  const geometries = new Map<PartId, BufferGeometry>()
  const flats = new Map<string, BufferGeometry>()
  const plastic = new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0 })
  plastic.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${finishVaryings}`).replace("#include <color_vertex>", finishFromColors)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${finishVaryings}`)
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, vPearl);\nmetalnessFactor = mix(metalnessFactor, 0.6, vPearl);")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${glowFragment}`)
  }
  plastic.customProgramCacheKey = () => "brick-plastic-finish"
  const studGeometry = buildStudGeometry()
  const flatStudGeometry = buildFlatStudGeometry()
  return {
    plastic,
    studGeometry,
    flatStudGeometry,
    geometry: (part) => {
      const cached = geometries.get(part)
      if (cached !== undefined) return cached
      const built = buildPartGeometry(part)
      geometries.set(part, built)
      return built
    },
    flat: (part) => {
      const shape = flatShape(part)
      const geometry = flats.get(shape.key) ?? shape.build()
      flats.set(shape.key, geometry)
      return { key: shape.key, geometry, scale: shape.scale }
    },
    dispose: () => {
      for (const geometry of [...geometries.values(), ...flats.values(), studGeometry, flatStudGeometry]) geometry.dispose()
      plastic.dispose()
    },
  }
}

// The finish rides the instance colour's red channel (+2 pearl, +4 glow) so it survives swap-remove and
// every finish shares one material and draw; lantern glass is marked by a vertex shade above 1.
const pearlOffset = 2
const glowOffset = 4
const finishVaryings = "varying float vPearl;\nvarying float vGlow;\nvarying float vGlass;"
const finishFromColors = /* glsl */ `
#include <color_vertex>
vPearl = 0.0;
vGlow = 0.0;
vGlass = step(${(glassShade - 0.5).toFixed(1)}, color.r);
#ifdef USE_INSTANCING_COLOR
  vGlow = step(${(glowOffset - 0.5).toFixed(1)}, instanceColor.r);
  vPearl = step(${(pearlOffset - 0.5).toFixed(1)}, instanceColor.r) - vGlow;
  vColor.r *= (instanceColor.r - ${pearlOffset.toFixed(1)} * vPearl - ${glowOffset.toFixed(1)} * vGlow) / max(instanceColor.r, 1e-4);
#endif
vColor.rgb = mix(vColor.rgb, vec3(0.2, 0.1, 0.02), vGlass);
`
const glowFragment = /* glsl */ `
totalEmissiveRadiance += vGlass * vec3(9.0, 2.6, 0.3) + vGlow * diffuseColor.rgb * 0.7;
`

/** Counts for the render budget: present parts, visible studs, draw calls per colour pass, triangles drawn. */
export interface BrickShipStats {
  readonly parts: number
  readonly studs: number
  readonly draws: number
  readonly triangles: number
}

const scratchMatrix = new Matrix4()
const scratchStud = new Matrix4()
const scratchScale = new Matrix4()
const scratchPosition = new Vector3()
const linearColors = new Map<BrickColor, Color>()
/** The instance colour a part of `color` draws with: linear, finish flags on red. Shared; do not mutate. */
export const brickColorLinear = (color: BrickColor): Color => {
  const cached = linearColors.get(color)
  if (cached !== undefined) return cached
  const { srgb, finish } = brickColors[color]
  const created = new Color().setHex(srgb)
  if (finish === "pearl") created.r += pearlOffset
  if (finish === "glow") created.r += glowOffset
  linearColors.set(color, created)
  return created
}
const plugColor = brickColorLinear("black")

/** A fixed-capacity InstancedMesh whose slots are packed: removing one moves the last instance into it. */
class InstancePool {
  readonly mesh: InstancedMesh
  /** Owner key of each slot. */
  readonly owners: Int32Array

  constructor(geometry: BufferGeometry, material: MeshStandardMaterial, capacity: number) {
    this.mesh = new InstancedMesh(geometry, material, capacity)
    this.mesh.count = 0
    this.mesh.visible = false
    this.owners = new Int32Array(capacity)
  }

  add(owner: number, matrix: Matrix4, color: Color, upload: boolean): number {
    const slot = this.mesh.count++
    this.mesh.setMatrixAt(slot, matrix)
    this.mesh.setColorAt(slot, color)
    this.owners[slot] = owner
    this.mesh.visible = true
    if (upload) this.markDirty(slot)
    return slot
  }

  /** Remove the instance in `slot`; returns the owner whose instance moved into it, or -1. */
  remove(slot: number): number {
    const last = --this.mesh.count
    this.mesh.visible = last > 0
    if (slot === last) return -1
    const matrices = this.mesh.instanceMatrix.array
    matrices.copyWithin(slot * 16, last * 16, last * 16 + 16)
    const colors = this.mesh.instanceColor?.array
    colors?.copyWithin(slot * 3, last * 3, last * 3 + 3)
    const moved = this.owners[last] ?? -1
    this.owners[slot] = moved
    this.markDirty(slot)
    return moved
  }

  private markDirty(slot: number) {
    this.mesh.instanceMatrix.addUpdateRange(slot * 16, 16)
    this.mesh.instanceMatrix.needsUpdate = true
    const colors = this.mesh.instanceColor
    if (colors !== null) {
      colors.addUpdateRange(slot * 3, 3)
      colors.needsUpdate = true
    }
  }
}

/** Instances of one detail level: each owner (part, stud or plug) has at most one instance, in the pool of its shape. */
class Layer {
  readonly group = new Group()
  private readonly pools = new Map<string, InstancePool>()
  private readonly poolOf: Array<InstancePool | undefined>
  private readonly slots: Int32Array
  private readonly castShadow: boolean

  constructor(name: string, owners: number, castShadow: boolean) {
    this.castShadow = castShadow
    this.group.name = name
    this.poolOf = new Array<InstancePool | undefined>(owners)
    this.slots = new Int32Array(owners).fill(-1)
  }

  /** Create the pool for `key` with room for `capacity` instances. */
  pool(key: string, geometry: BufferGeometry, material: MeshStandardMaterial, capacity: number, name = `${this.group.name} ${key}`): void {
    const pool = new InstancePool(geometry, material, Math.max(capacity, 1))
    pool.mesh.castShadow = this.castShadow
    pool.mesh.receiveShadow = true
    pool.mesh.name = name
    this.pools.set(key, pool)
    this.group.add(pool.mesh)
  }

  add(owner: number, key: string, matrix: Matrix4, color: Color, upload: boolean): void {
    const pool = this.pools.get(key)
    if (pool === undefined) throw new Error(`no instance pool ${key} in ${this.group.name}`)
    this.poolOf[owner] = pool
    this.slots[owner] = pool.add(owner, matrix, color, upload)
  }

  has(owner: number): boolean {
    return (this.slots[owner] ?? -1) >= 0
  }

  remove(owner: number): boolean {
    const slot = this.slots[owner] ?? -1
    const pool = this.poolOf[owner]
    if (slot < 0 || pool === undefined) return false
    const moved = pool.remove(slot)
    if (moved >= 0) this.slots[moved] = slot
    this.slots[owner] = -1
    return true
  }

  /** Empty every pool, for refilling; call `uploadAll` after. */
  clear(): void {
    for (const pool of this.pools.values()) {
      pool.mesh.count = 0
      pool.mesh.visible = false
    }
    this.slots.fill(-1)
    this.poolOf.fill(undefined)
  }

  /** Send every pool's instances to the GPU whole. */
  uploadAll(): void {
    for (const { mesh } of this.pools.values()) {
      mesh.instanceMatrix.clearUpdateRanges()
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.clearUpdateRanges()
        mesh.instanceColor.needsUpdate = true
      }
    }
  }

  /** Bound every pool by the whole ship, so instances revealed later are never culled. */
  finish(bounds: Box3): void {
    for (const pool of this.pools.values()) pool.mesh.boundingSphere = bounds.getBoundingSphere(new Sphere())
  }

  count(): number {
    let count = 0
    for (const pool of this.pools.values()) count += pool.mesh.count
    return count
  }

  addStats(into: { draws: number; triangles: number }): void {
    for (const pool of this.pools.values()) {
      if (!pool.mesh.visible) continue
      into.draws++
      into.triangles += (pool.mesh.geometry.getAttribute("position").count / 3) * pool.mesh.count
    }
  }

  dispose(): void {
    for (const pool of this.pools.values()) pool.mesh.dispose()
  }
}

/**
 * A ship's parts as one InstancedMesh per part shape plus one for studs, all under `root`, at three levels
 * of detail (`setDetail`, or `updateDetail` from the camera). Parts are addressed by their index in the
 * placement list; removal takes them out of every level in O(1) and never rebuilds. Pools are sized for every
 * part at every level, so revealing a hidden part only writes its instances.
 */
export class BrickShipMesh {
  readonly root = new Group()
  private readonly near: Layer
  private readonly nearStuds: Layer
  private readonly flatOuter: Layer
  private readonly flatInner: Layer
  private readonly midStuds: Layer
  private readonly plugs: Layer
  private readonly plugOwners: ReadonlyArray<number>
  private readonly plugMatrices: ReadonlyArray<Matrix4>
  private readonly studStart: Int32Array
  private readonly placements: ReadonlyArray<BrickPlacement>
  private readonly flats: ReadonlyArray<{ readonly key: string; readonly scale: readonly [number, number, number] }>
  private readonly presence: Uint8Array
  private present: number
  private level: BrickDetail = "near"
  private chosen = false

  constructor(library: BrickLibrary, placements: ReadonlyArray<BrickPlacement>, plugs: ReadonlyArray<BrickPlug> = []) {
    this.placements = placements
    this.studStart = new Int32Array(placements.length + 1)
    placements.forEach((placement, i) => {
      this.studStart[i + 1] = (this.studStart[i] ?? 0) + partCatalog[placement.part].studs.length
    })
    const studCount = this.studStart[placements.length] ?? 0
    this.near = new Layer("near", placements.length, true)
    this.nearStuds = new Layer("near studs", studCount, false)
    this.flatOuter = new Layer("flat", placements.length, true)
    this.flatInner = new Layer("flat interior", placements.length, true)
    // Studs are too small to matter in the shadow map, and skipping them halves their draw cost.
    this.midStuds = new Layer("flat studs", studCount, false)
    this.plugs = new Layer("plugs", plugs.length, true)
    this.plugOwners = plugs.map((plug) => plug.owner)

    const nearCount = new Map<PartId, number>()
    const flatCount = new Map<string, number>()
    const innerCount = new Map<string, number>()
    const flatGeometry = new Map<string, BufferGeometry>()
    this.flats = placements.map((placement) => {
      nearCount.set(placement.part, (nearCount.get(placement.part) ?? 0) + 1)
      const flat = library.flat(placement.part)
      flatGeometry.set(flat.key, flat.geometry)
      flatCount.set(flat.key, (flatCount.get(flat.key) ?? 0) + 1)
      if (placement.interior === true || placement.hidden === true) innerCount.set(flat.key, (innerCount.get(flat.key) ?? 0) + 1)
      return flat
    })
    for (const [part, capacity] of nearCount) this.near.pool(part, library.geometry(part), library.plastic, capacity, `part ${part}`)
    for (const [layer, counts] of [[this.flatOuter, flatCount], [this.flatInner, innerCount]] as const)
      for (const [key, capacity] of counts) {
        const geometry = flatGeometry.get(key)
        if (geometry !== undefined) layer.pool(key, geometry, library.plastic, capacity)
      }
    this.nearStuds.pool("studs", library.studGeometry, library.plastic, studCount, "studs")
    this.midStuds.pool("studs", library.flatStudGeometry, library.plastic, studCount)
    this.plugs.pool("plug", library.flat("3005").geometry, library.plastic, plugs.length)

    const bounds = new Box3()
    for (const placement of placements) bounds.expandByPoint(scratchPosition.setFromMatrixPosition(placement.matrix))
    this.plugMatrices = plugs.map((plug) => plug.matrix)
    this.presence = new Uint8Array(placements.length)
    this.present = 0
    this.fill()
    // Part origins sit on a corner or face; a metre covers the rest of the largest part.
    bounds.expandByScalar(1)
    for (const layer of this.layers()) {
      layer.finish(bounds)
      this.root.add(layer.group)
    }
    this.setDetail("near")
  }

  /** Number of parts not yet removed, drawn or hidden. */
  get partCount(): number {
    return this.present
  }

  /** The placements this mesh was built from, indexed like `remove`. */
  get parts(): ReadonlyArray<BrickPlacement> {
    return this.placements
  }

  get detail(): BrickDetail {
    return this.level
  }

  setDetail(detail: BrickDetail): void {
    this.level = detail
    this.near.group.visible = detail === "near"
    this.nearStuds.group.visible = detail === "near"
    this.flatOuter.group.visible = detail !== "near"
    this.flatInner.group.visible = detail === "mid"
    this.midStuds.group.visible = detail === "mid"
    this.plugs.group.visible = detail === "far"
  }

  /** Pick the detail level from how large the ship appears: pixels per metre at its origin for a viewport `viewportHeight` pixels tall. */
  updateDetail(camera: PerspectiveCamera, viewportHeight: number): BrickDetail {
    const distance = Math.max(camera.getWorldPosition(scratchPosition).distanceTo(this.root.getWorldPosition(new Vector3())), 1e-3)
    const pixelsPerMetre = viewportHeight / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) * distance) / camera.zoom
    const detail = brickDetailFor(pixelsPerMetre, this.chosen ? this.level : undefined)
    this.chosen = true
    if (detail !== this.level) this.setDetail(detail)
    return detail
  }

  isPresent(index: number): boolean {
    return this.presence[index] === 1
  }

  /** Whether a present part is drawn: false while it is still `hidden`. */
  isShown(index: number): boolean {
    return this.near.has(index)
  }

  /** Draw a present part from now on: `interior` keeps it out of far detail. Moves an interior part outside; never back. */
  reveal(index: number, interior: boolean): void {
    if (!this.isPresent(index)) return
    if (!this.near.has(index)) this.showPart(index, interior, true)
    else if (!interior && this.flatInner.has(index)) {
      this.flatInner.remove(index)
      this.addFlat(this.flatOuter, index, true)
    }
  }

  /** Remove a part, its studs and any plug it owns; returns false if it was already gone. */
  remove(index: number): boolean {
    if (!this.isPresent(index)) return false
    this.presence[index] = 0
    this.near.remove(index)
    this.flatOuter.remove(index)
    this.flatInner.remove(index)
    const start = this.studStart[index] ?? 0
    const end = this.studStart[index + 1] ?? start
    for (let key = start; key < end; key++) this.hideStudKey(key)
    this.plugOwners.forEach((owner, plug) => {
      if (owner === index) this.plugs.remove(plug)
    })
    this.present--
    return true
  }

  /** Show or hide one stud of a drawn part, e.g. when the part covering it falls off. */
  setStudVisible(index: number, stud: number, visible: boolean): void {
    if (!this.isShown(index)) return
    const key = (this.studStart[index] ?? 0) + stud
    if (key >= (this.studStart[index + 1] ?? 0)) return
    if (visible && !this.nearStuds.has(key)) this.showStud(index, stud, true)
    if (!visible) this.hideStudKey(key)
  }

  /** Budget counts at `detail` (the current level when omitted). */
  stats(detail: BrickDetail = this.level): BrickShipStats {
    const into = { draws: 0, triangles: 0 }
    const layers = detail === "near" ? [this.near, this.nearStuds] : detail === "mid" ? [this.flatOuter, this.flatInner, this.midStuds] : [this.flatOuter, this.plugs]
    for (const layer of layers) layer.addStats(into)
    const parts = detail === "far" ? this.flatOuter.count() : this.near.count()
    const studs = detail === "near" ? this.nearStuds.count() : detail === "mid" ? this.midStuds.count() : 0
    return { parts, studs, ...into }
  }

  /** Put every part back as built, hidden ones still hidden: a pooled ship made whole for reuse. Never reallocates. */
  restore(): void {
    for (const layer of this.layers()) layer.clear()
    this.fill()
    for (const layer of this.layers()) layer.uploadAll()
  }

  /** Free the per-ship instance buffers; the library's shared geometry and materials stay. */
  dispose(): void {
    for (const layer of this.layers()) layer.dispose()
    this.root.removeFromParent()
  }

  private layers(): ReadonlyArray<Layer> {
    return [this.near, this.nearStuds, this.flatOuter, this.flatInner, this.midStuds, this.plugs]
  }

  private fill() {
    this.placements.forEach((placement, i) => {
      if (placement.hidden === true) return
      this.showPart(i, placement.interior === true, false)
      const hidden = placement.hiddenStuds ?? []
      const count = partCatalog[placement.part].studs.length
      for (let s = 0; s < count; s++) if (!hidden.includes(s)) this.showStud(i, s, false)
    })
    this.plugMatrices.forEach((matrix, i) => this.plugs.add(i, "plug", matrix, plugColor, false))
    this.presence.fill(1)
    this.present = this.placements.length
  }

  private showPart(index: number, interior: boolean, upload: boolean) {
    const placement = this.placements[index]
    if (placement === undefined) return
    this.near.add(index, placement.part, placement.matrix, brickColorLinear(placement.color), upload)
    this.addFlat(interior ? this.flatInner : this.flatOuter, index, upload)
  }

  private addFlat(layer: Layer, index: number, upload: boolean) {
    const placement = this.placements[index]
    const flat = this.flats[index]
    if (placement === undefined || flat === undefined) return
    const [sx, sy, sz] = flat.scale
    scratchMatrix.multiplyMatrices(placement.matrix, scratchScale.makeScale(sx, sy, sz))
    layer.add(index, flat.key, scratchMatrix, brickColorLinear(placement.color), upload)
  }

  private showStud(index: number, stud: number, upload: boolean) {
    const placement = this.placements[index]
    if (placement === undefined) return
    const offset = partCatalog[placement.part].studs[stud]
    if (offset === undefined) return
    const [x, y, z] = offset
    scratchStud.makeTranslation(x * metresPerLdu, y * metresPerLdu, z * metresPerLdu)
    scratchMatrix.multiplyMatrices(placement.matrix, scratchStud)
    const key = (this.studStart[index] ?? 0) + stud
    const color = brickColorLinear(placement.color)
    this.nearStuds.add(key, "studs", scratchMatrix, color, upload)
    this.midStuds.add(key, "studs", scratchMatrix, color, upload)
  }

  private hideStudKey(key: number) {
    this.nearStuds.remove(key)
    this.midStuds.remove(key)
  }
}
