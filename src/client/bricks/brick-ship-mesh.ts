import { type BufferGeometry, Color, Group, InstancedMesh, type Material, Matrix4, MeshStandardMaterial } from "three"
import type { BrickColor } from "../../sim/ship/colors.ts"
import { brickColors } from "./colors.ts"
import { metresPerLdu, type PartId, partCatalog } from "../../sim/ship/parts.ts"
import { buildPartGeometry, buildStudGeometry } from "./parts.ts"

/** One part of a ship: shape, colour, ship-space transform in metres, and which of its studs are covered. */
export interface BrickPlacement {
  readonly part: PartId
  readonly color: BrickColor
  readonly matrix: Matrix4
  /** Indices into the shape's `studs` that a part above covers. */
  readonly hiddenStuds?: ReadonlyArray<number>
}

/** Geometries and materials shared by every ship; build one per renderer. */
export interface BrickLibrary {
  readonly plastic: MeshStandardMaterial
  readonly glow: MeshStandardMaterial
  readonly studGeometry: BufferGeometry
  geometry(part: PartId): BufferGeometry
  dispose(): void
}

/** Create the shared part geometries (built lazily per shape) and the ABS plastic and lantern-glass materials. */
export const createBrickLibrary = (): BrickLibrary => {
  const geometries = new Map<PartId, BufferGeometry>()
  const plastic = new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0 })
  plastic.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vFinish;")
      .replace("#include <color_vertex>", pearlFromInstanceColor)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFinish;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.34, vFinish);\nmetalnessFactor = mix(metalnessFactor, 0.45, vFinish);")
  }
  plastic.customProgramCacheKey = () => "brick-plastic-pearl"
  const glow = new MeshStandardMaterial({ color: 0x331a05, emissive: 0xff9433, emissiveIntensity: 9, roughness: 0.15 })
  const studGeometry = buildStudGeometry()
  return {
    plastic,
    glow,
    studGeometry,
    geometry: (part) => {
      const cached = geometries.get(part)
      if (cached !== undefined) return cached
      const built = buildPartGeometry(part)
      geometries.set(part, built)
      return built
    },
    dispose: () => {
      for (const geometry of geometries.values()) geometry.dispose()
      studGeometry.dispose()
      plastic.dispose()
      glow.dispose()
    },
  }
}

// Pearl parts carry +2 in the instance colour's red channel, so the finish rides the colour through
// swap-remove and shares one material and draw with plastic parts; the shader strips it back out.
const pearlOffset = 2
const pearlFromInstanceColor = /* glsl */ `
#include <color_vertex>
vFinish = 0.0;
#ifdef USE_INSTANCING_COLOR
  vFinish = step(1.5, instanceColor.r);
  vColor.r *= (instanceColor.r - ${pearlOffset.toFixed(1)} * vFinish) / max(instanceColor.r, 1e-4);
#endif
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
const linearColors = new Map<BrickColor, Color>()
const linear = (color: BrickColor) => {
  const cached = linearColors.get(color)
  if (cached !== undefined) return cached
  const { srgb, finish } = brickColors[color]
  const created = new Color().setHex(srgb)
  if (finish === "pearl") created.r += pearlOffset
  linearColors.set(color, created)
  return created
}

/** A fixed-capacity InstancedMesh whose slots are packed: removing one moves the last instance into it. */
class InstancePool {
  readonly mesh: InstancedMesh
  /** Owner key of each slot. */
  readonly owners: Int32Array

  constructor(geometry: BufferGeometry, material: Material | Array<Material>, capacity: number) {
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

/**
 * A ship's parts as one InstancedMesh per part shape plus one for studs, all under `root`.
 * Parts are addressed by their index in the placement list; removal is O(1) and never rebuilds.
 */
export class BrickShipMesh {
  readonly root = new Group()
  private readonly pools = new Map<PartId, InstancePool>()
  private readonly studs: InstancePool
  private readonly partSlot: Int32Array
  private readonly studStart: Int32Array
  private readonly studSlot: Int32Array
  private readonly placements: ReadonlyArray<BrickPlacement>
  private present: number

  constructor(library: BrickLibrary, placements: ReadonlyArray<BrickPlacement>) {
    this.placements = placements
    const perShape = new Map<PartId, number>()
    this.studStart = new Int32Array(placements.length + 1)
    placements.forEach((placement, i) => {
      perShape.set(placement.part, (perShape.get(placement.part) ?? 0) + 1)
      this.studStart[i + 1] = (this.studStart[i] ?? 0) + partCatalog[placement.part].studs.length
    })
    const studCount = this.studStart[placements.length] ?? 0
    for (const [part, capacity] of perShape) {
      const geometry = library.geometry(part)
      const pool = new InstancePool(geometry, geometry.groups.length > 1 ? [library.plastic, library.glow] : library.plastic, capacity)
      pool.mesh.castShadow = true
      pool.mesh.receiveShadow = true
      pool.mesh.name = `part ${part}`
      this.pools.set(part, pool)
      this.root.add(pool.mesh)
    }
    this.studs = new InstancePool(library.studGeometry, library.plastic, Math.max(studCount, 1))
    // Studs are too small to matter in the shadow map, and skipping them halves their draw cost.
    this.studs.mesh.castShadow = false
    this.studs.mesh.receiveShadow = true
    this.studs.mesh.name = "studs"
    this.root.add(this.studs.mesh)

    this.partSlot = new Int32Array(placements.length)
    this.studSlot = new Int32Array(studCount).fill(-1)
    placements.forEach((placement, i) => {
      this.partSlot[i] = this.poolOf(placement.part).add(i, placement.matrix, linear(placement.color), false)
      const hidden = placement.hiddenStuds ?? []
      const count = partCatalog[placement.part].studs.length
      for (let s = 0; s < count; s++) if (!hidden.includes(s)) this.showStud(i, s, false)
    })
    this.present = placements.length
    for (const pool of [...this.pools.values(), this.studs]) pool.mesh.computeBoundingSphere()
  }

  /** Number of parts not yet removed. */
  get partCount(): number {
    return this.present
  }

  /** The placements this mesh was built from, indexed like `remove`. */
  get parts(): ReadonlyArray<BrickPlacement> {
    return this.placements
  }

  isPresent(index: number): boolean {
    return (this.partSlot[index] ?? -1) >= 0
  }

  /** Remove a part and its studs; returns false if it was already gone. */
  remove(index: number): boolean {
    const placement = this.placements[index]
    const slot = this.partSlot[index] ?? -1
    if (placement === undefined || slot < 0) return false
    const start = this.studStart[index] ?? 0
    const end = this.studStart[index + 1] ?? start
    for (let key = start; key < end; key++) this.hideStudKey(key)
    const moved = this.poolOf(placement.part).remove(slot)
    if (moved >= 0) this.partSlot[moved] = slot
    this.partSlot[index] = -1
    this.present--
    return true
  }

  /** Show or hide one stud of a present part, e.g. when the part covering it falls off. */
  setStudVisible(index: number, stud: number, visible: boolean): void {
    if (!this.isPresent(index)) return
    const key = (this.studStart[index] ?? 0) + stud
    if (key >= (this.studStart[index + 1] ?? 0)) return
    if (visible && (this.studSlot[key] ?? -1) < 0) this.showStud(index, stud, true)
    if (!visible) this.hideStudKey(key)
  }

  stats(): BrickShipStats {
    let draws = 0
    let triangles = 0
    for (const pool of [...this.pools.values(), this.studs]) {
      if (!pool.mesh.visible) continue
      const geometry = pool.mesh.geometry
      draws += Math.max(geometry.groups.length, 1)
      triangles += (geometry.getAttribute("position").count / 3) * pool.mesh.count
    }
    return { parts: this.present, studs: this.studs.mesh.count, draws, triangles }
  }

  /** Free the per-ship instance buffers; the library's shared geometry and materials stay. */
  dispose(): void {
    for (const pool of [...this.pools.values(), this.studs]) pool.mesh.dispose()
    this.root.removeFromParent()
  }

  private poolOf(part: PartId): InstancePool {
    const pool = this.pools.get(part)
    if (pool === undefined) throw new Error(`no instance pool for part ${part}`)
    return pool
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
    this.studSlot[key] = this.studs.add(key, scratchMatrix, linear(placement.color), upload)
  }

  private hideStudKey(key: number) {
    const slot = this.studSlot[key] ?? -1
    if (slot < 0) return
    const moved = this.studs.remove(slot)
    if (moved >= 0) this.studSlot[moved] = slot
    this.studSlot[key] = -1
  }
}
