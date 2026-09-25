import { Matrix4, Vector3 } from "three"
import { gunLayout } from "../../sim/gun-layout.ts"
import { partCatalog } from "../../sim/ship/parts.ts"
import type { ShipAir } from "../../sim/ship/air.ts"
import type { DamageGraph } from "../../sim/ship/damage.ts"
import { gridMetres } from "../../sim/ship/generate.ts"
import { rigLayout } from "../../sim/ship/rig.ts"
import { galleonSpec } from "../../sim/ship/spec.ts"
import { galleonClass, type SailPlane } from "../../sim/wreck.ts"
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

/** One mast as the effects see it: where it stands and the parts that decide whether it is up. */
export interface DrawnMast {
  readonly x: number
  readonly foot: number
  readonly top: number
  /** Its highest part: while present, the mast's flags and ropes are up. */
  readonly topPart: number
  /** Round bricks low and high on the mast where it snaps when a ship founders, bottom up. */
  readonly snapParts: ReadonlyArray<number>
}

/** Height of the ship's upper surfaces (decks, castle roofs, rails) over a ship-local grid, for debris to land on. −∞ off the ship. */
export interface DeckField {
  readonly x0: number
  readonly z0: number
  readonly cell: number
  readonly nx: number
  readonly nz: number
  readonly heights: Float32Array
}

/** The deck height at ship-local (x, z), −∞ off the ship. */
export const deckHeight = (deck: DeckField, x: number, z: number): number => {
  const i = Math.floor((x - deck.x0) / deck.cell)
  const k = Math.floor((z - deck.z0) / deck.cell)
  if (i < 0 || k < 0 || i >= deck.nx || k >= deck.nz) return Number.NEGATIVE_INFINITY
  return deck.heights[k * deck.nx + i] ?? Number.NEGATIVE_INFINITY
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
  /** Ship part index → its placement, ship-local. */
  readonly placements: ReadonlyArray<BrickPlacement>
  /** Parts from this index on are the rig. */
  readonly rigFrom: number
  /** Masts in `RigLayout.masts` order. */
  readonly masts: ReadonlyArray<DrawnMast>
  /** The sim's sail planes, indexed like the rig's sails. */
  readonly sails: ReadonlyArray<SailPlane>
  readonly deck: DeckField
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
  const { ship, graph, sails } = galleonClass()
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
    if (best === undefined || bestDistance > 0.5) throw new Error(`gun ${index} has no cannon part at its port`)
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

  const { boxes } = graph
  const column = (x: number) => {
    const parts: Array<number> = []
    for (let i = ship.rigFrom; i < graph.count; i++) {
      const o = i * 6
      if (Math.abs((boxes[o]! + boxes[o + 3]!) / 2 - x) < 0.3 && Math.abs((boxes[o + 2]! + boxes[o + 5]!) / 2) < 0.3) parts.push(i)
    }
    return parts.sort((a, b) => boxes[a * 6 + 1]! - boxes[b * 6 + 1]!)
  }
  const masts = layout.masts.map((mast): DrawnMast => {
    const parts = column(mast.x)
    const round = parts.filter((i) => ship.parts[i]?.part === "3941")
    const nearest = (y: number) => round.reduce((best, i) => (Math.abs(boxes[i * 6 + 1]! - y) < Math.abs(boxes[best * 6 + 1]! - y) ? i : best), round[0] ?? -1)
    return { x: mast.x, foot: mast.foot, top: mast.top, topPart: parts[parts.length - 1] ?? -1, snapParts: [nearest(mast.foot + 2.4), nearest((mast.foot + mast.top) / 2)] }
  })
  const deck: DeckField = { x0: -15.2, z0: -6, cell: 0.2, nx: 156, nz: 60, heights: new Float32Array(156 * 60).fill(Number.NEGATIVE_INFINITY) }
  for (let i = 0; i < ship.rigFrom; i++) {
    const o = i * 6
    const top = boxes[o + 4]!
    for (let k = Math.max(0, Math.floor((boxes[o + 2]! - deck.z0) / deck.cell)); k < Math.min(deck.nz, Math.ceil((boxes[o + 5]! - deck.z0) / deck.cell)); k++)
      for (let j = Math.max(0, Math.floor((boxes[o]! - deck.x0) / deck.cell)); j < Math.min(deck.nx, Math.ceil((boxes[o + 3]! - deck.x0) / deck.cell)); j++)
        deck.heights[k * deck.nx + j] = Math.max(deck.heights[k * deck.nx + j]!, top)
  }

  return {
    placements: built.placements,
    rigFrom: ship.rigFrom,
    masts,
    sails,
    deck,
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
