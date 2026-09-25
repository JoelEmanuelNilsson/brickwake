import { Matrix4, Vector3 } from "three"
import { gunLayout } from "../../sim/gun-layout.ts"
import { partCatalog } from "../../sim/ship/parts.ts"
import type { ShipAir } from "../../sim/ship/air.ts"
import type { DamageGraph } from "../../sim/ship/damage.ts"
import { gridMetres } from "../../sim/ship/generate.ts"
import { rigLayout } from "../../sim/ship/rig.ts"
import { galleonSpec } from "../../sim/ship/spec.ts"
import { galleonClass } from "../../sim/wreck.ts"
import { type BrickLibrary, type BrickPlacement, type BrickPlug, createBrickLibrary } from "../bricks/brick-ship-mesh.ts"
import { shipPlacements } from "../bricks/ship-placements.ts"
import { buildRigGeometry, type RigGeometry } from "../rig/ship-rig.ts"

/** Where one ship part is drawn: the mesh that holds it and its index there. */
export interface PartSlot {
  readonly mesh: "hull" | "moving"
  readonly index: number
}

/** One gun as drawn: its cannon part's origin and its muzzle, ship-local metres, indexed like `gunLayout`. */
export interface DrawnGun {
  readonly cannon: Vector3
  readonly muzzle: Vector3
}

/**
 * Everything every galleon in the game shares, built once at load: brick placements split into the still hull and the
 * parts that move (cannons recoil, yards brace), a cosmetic brick rudder, the rig geometry, and the drawn guns.
 */
export interface GalleonModel {
  readonly library: BrickLibrary
  readonly hull: { readonly placements: ReadonlyArray<BrickPlacement>; readonly plugs: ReadonlyArray<BrickPlug> }
  readonly moving: ReadonlyArray<BrickPlacement>
  /** Rudder parts relative to the rudder hinge (x = 0, z = 0). */
  readonly rudder: ReadonlyArray<BrickPlacement>
  /** Ship-local x of the rudder hinge on the transom at the waterline. */
  readonly rudderHinge: number
  readonly rig: RigGeometry
  /** Ship-local x of each mast's axis, the pivot its yards brace about. */
  readonly mastXs: ReadonlyArray<number>
  /** Moving parts above this height are yards; below it, cannons. */
  readonly yardFloor: number
  readonly guns: ReadonlyArray<DrawnGun>
  /** Ship part index → where it is drawn. */
  readonly slots: ReadonlyArray<PartSlot | undefined>
  /** The damage graph the server's sim uses, for deriving the parts that fall with removed ones. */
  readonly graph: DamageGraph
  /** Air around the intact ship; each view holes its own copy. */
  readonly air: ShipAir
  /** Milliseconds generation and placement took. */
  readonly buildMs: number
}

const cannonPart = "2527c01"
/** Muzzle of the cannon part in its own frame, metres: the barrel's axis height and its mouth (see `cannon` in bricks/parts.ts). */
const cannonMuzzle = new Vector3(0, 29 * 0.02, 60 * 0.02)

const rudderColor = "reddishBrown"
/** Rudder blade bottom up: part and chord in studs; each a brick tall, hung aft of the hinge. */
const rudderCourses = [
  ["3009", 6], ["3009", 6], ["3009", 6], ["3009", 6], ["3009", 6], ["3009", 6], ["3010", 4], ["3010", 4], ["3004", 2],
] as const

/** Generate the galleon and build its shared render data. Takes ~150 ms; call once at load, before the first frame. */
export const loadGalleon = (): GalleonModel => {
  const started = performance.now()
  const spec = galleonSpec
  const { ship, graph } = galleonClass()
  const built = shipPlacements(spec, ship)
  const layout = rigLayout(spec)
  const mastXs = layout.masts.map((mast) => mast.x)
  const yardFloor = Math.min(...layout.masts.flatMap((mast) => mast.yards.map((yard) => yard.bottom))) - 0.3
  const position = new Vector3()
  // Yard parts are the rig parts on the stud row forward of a mast's centre, within one of its yards' courses.
  const isYard = (placement: BrickPlacement) => {
    position.setFromMatrixPosition(placement.matrix)
    return layout.masts.some(
      (mast) =>
        Math.abs(position.x - (mast.x + gridMetres.stud / 2)) < 0.05 &&
        mast.yards.some((yard) => position.y >= yard.bottom - 0.01 && position.y < yard.top - 0.01),
    )
  }

  const hull: Array<BrickPlacement> = []
  const moving: Array<BrickPlacement> = []
  const hullIndex = new Map<number, number>()
  const slots = new Array<PartSlot | undefined>(ship.parts.length)
  built.placements.forEach((placement, i) => {
    const part = i // placements cover every part, in part order
    if (placement.part === cannonPart || isYard(placement)) {
      slots[part] = { mesh: "moving", index: moving.length }
      moving.push(placement)
      return
    }
    hullIndex.set(i, hull.length)
    slots[part] = { mesh: "hull", index: hull.length }
    hull.push(placement)
  })
  const plugs = built.plugs.flatMap((plug) => {
    const owner = hullIndex.get(plug.owner)
    return owner === undefined ? [] : [{ owner, matrix: plug.matrix }]
  })

  const guns = gunLayout.map((gun, index): DrawnGun => {
    let best: BrickPlacement | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const placement of moving) {
      if (placement.part !== cannonPart) continue
      position.setFromMatrixPosition(placement.matrix)
      const distance = Math.hypot(position.x - gun.position.x, position.z - gun.position.z)
      if (distance < bestDistance) {
        bestDistance = distance
        best = placement
      }
    }
    if (best === undefined || bestDistance > 1) throw new Error(`gun ${index} has no cannon part at its port`)
    return { cannon: new Vector3().setFromMatrixPosition(best.matrix), muzzle: cannonMuzzle.clone().applyMatrix4(best.matrix) }
  })

  const rudderHinge = (spec.transom.x - spec.midship) * gridMetres.stud
  const brick = 3 * gridMetres.plate
  const bottom = -spec.waterline * gridMetres.plate
  const rudder = rudderCourses.map(([part, chord], course): BrickPlacement => {
    const last = course === rudderCourses.length - 1
    return {
      part,
      color: rudderColor,
      matrix: new Matrix4().makeTranslation((-chord * gridMetres.stud) / 2, bottom + course * brick, 0),
      hiddenStuds: last ? [] : partCatalog[part].studs.map((_, s) => s),
    }
  })

  return {
    library: createBrickLibrary(),
    hull: { placements: hull, plugs },
    moving,
    rudder,
    rudderHinge,
    rig: buildRigGeometry(layout),
    mastXs,
    yardFloor,
    guns,
    slots,
    graph,
    air: built.air,
    buildMs: performance.now() - started,
  }
}
