import { tuning } from "./tuning.ts"
import { vec3, type Vec3 } from "./vector.ts"

/** One vertical prism of hull volume that buoyancy is sampled on. */
export interface BuoyancyColumn {
  /** Bottom centre of the column, ship-local. */
  readonly bottom: Vec3
  /** Local height of the column's watertight top. */
  readonly top: number
  /** Waterplane area in m². */
  readonly area: number
}

/** Mass properties and buoyancy columns of a hull, derived from its lines. */
export interface Hull {
  readonly columns: ReadonlyArray<BuoyancyColumn>
  /** Mass in kg: the water displaced at the design waterline. */
  readonly mass: number
  /** Centre of mass, ship-local. */
  readonly centerOfMass: Vec3
  /** Principal moments of inertia about the centre of mass, kg·m², on ship-local x, y, z (roll, yaw, pitch). */
  readonly inertia: Vec3
  /** Waterplane area in m². */
  readonly waterplaneArea: number
}

type HullLines = typeof tuning.hull

/** Derives a hull's buoyancy columns and mass properties so it floats level at its design waterline. */
export const buildHull = (lines: HullLines): Hull => {
  const columns = lines.stations.flatMap((station) =>
    lines.columnOffsets.map((offset) => ({
      bottom: vec3(station.x, -station.draft * (1 - lines.bilgeRise * offset * offset), offset * station.halfBreadth),
      top: station.top,
      area: lines.stationLength * station.halfBreadth * 0.5,
    })),
  )
  const volume = columns.reduce((sum, c) => sum + c.area * -c.bottom.y, 0)
  const buoyancyX = columns.reduce((sum, c) => sum + c.area * -c.bottom.y * c.bottom.x, 0) / volume
  const mass = volume * tuning.physics.waterDensity
  const g = lines.gyration
  return {
    columns,
    mass,
    centerOfMass: vec3(buoyancyX, lines.centerOfMassHeight, 0),
    inertia: vec3(mass * g.roll * g.roll, mass * g.yaw * g.yaw, mass * g.pitch * g.pitch),
    waterplaneArea: columns.reduce((sum, c) => sum + c.area, 0),
  }
}

/** The hull every ship uses until ship classes arrive. */
export const defaultHull: Hull = buildHull(tuning.hull)
