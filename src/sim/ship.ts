import { defaultHull, type Hull } from "./hull.ts"
import { sampleOcean, type SeaState } from "./ocean.ts"
import { SIM_DT, tuning } from "./tuning.ts"
import {
  add,
  angleOfDirection,
  cross,
  directionFromAngle,
  dot,
  integrateQuat,
  quatFromAxisAngle,
  rotate,
  rotateInverse,
  scale,
  sub,
  vec3,
  zeroVec3,
  type Quat,
  type Vec3,
} from "./vector.ts"
import { angleOffWind, sailDriveFactor, sailSideFactor, sailSpeedFactor, windVelocity, type Wind } from "./wind.ts"

declare const shipIdBrand: unique symbol

/** Identifies a ship within a match. */
export type ShipId = string & { readonly [shipIdBrand]: true }

/** Brands a string as a ShipId. */
export const shipId = (id: string): ShipId =>
  // SAFETY: any string names a ship; the brand only keeps ids from mixing with other strings.
  id as ShipId

/** Helm command: −1 port, 0 centre, +1 starboard. Held; the rudder moves toward it at the rudder rate. */
export type RudderCommand = -1 | 0 | 1

/** Sail level: 0 furled, 1 half, 2 full. The crew sets canvas toward it over a few seconds. */
export type SailLevel = 0 | 1 | 2

/** What a ship's captain currently commands. */
export interface ShipControls {
  readonly rudder: RudderCommand
  readonly sail: SailLevel
}

/**
 * Where a ship is in its life. `sinking`: the hull settles and lists toward `floodSide` (+1 starboard, −1 port), then
 * buoyancy fades from the `floodEnd` (+1 bow, −1 stern) aft or forward; the ship takes no orders and cannot be hit. `sunk`: under water, out of play until `respawnAt` (sim seconds).
 */
export type ShipLife =
  | { readonly _tag: "afloat" }
  | { readonly _tag: "sinking"; readonly since: number; readonly floodEnd: 1 | -1; readonly floodSide: 1 | -1 }
  | { readonly _tag: "sunk"; readonly respawnAt: number }

const afloat: ShipLife = { _tag: "afloat" }
const intact: ReadonlyArray<number> = []

/** A TDM side. */
export type Team = "pirates" | "navy"

/**
 * One ship's rigid body and rig. Ship-local axes: +x bow, +y up, +z starboard; the origin is on the
 * centreline, midships, at the design waterline.
 */
export interface ShipState {
  readonly id: ShipId
  /** World position of the ship-local origin. */
  readonly position: Vec3
  /** Rotation from ship-local to world. */
  readonly orientation: Quat
  /** World velocity of the centre of mass, m/s. */
  readonly velocity: Vec3
  /** World angular velocity, rad/s. */
  readonly angularVelocity: Vec3
  readonly controls: ShipControls
  /** Rudder angle in radians; positive turns the bow to starboard. */
  readonly rudderAngle: number
  /** Canvas set, 0 furled … 1 full. */
  readonly sailSet: number
  /** Hull hit points, `tuning.damage.hullHp` … 0. */
  readonly hp: number
  /** Sim time, seconds, from which each side's guns may fire again. */
  readonly reloadedAt: { readonly port: number; readonly starboard: number }
  readonly life: ShipLife
  /** Times this ship has entered the match: 1 on join, +1 per respawn or restart. A change means it moved without sailing there. */
  readonly spawn: number
  /** Enemy ships this captain has sunk, and times this ship was sunk, this match. */
  readonly kills: number
  readonly deaths: number
  /**
   * Galleon parts balls knocked out since this ship spawned, in hit order (indices into its generated parts). The parts
   * that fell with them follow from the damage graph (`shipWreck`), so only this list is state and goes on the wire.
   */
  readonly removedParts: ReadonlyArray<number>
  /** Balls this ship fired, balls of them that struck an enemy for damage, and the HP they took, this match. */
  readonly shots: number
  readonly hits: number
  readonly damage: number
  /** The ship's side in TDM; undefined in FFA, where every ship fights for itself. Kept across respawns. */
  readonly team: Team | undefined
  /** The last enemy whose ball took HP from this ship since it spawned, and when; a capsize within `tuning.sinking.capsizeCreditSeconds` credits it. */
  readonly lastHitBy: { readonly shipId: ShipId; readonly time: number } | undefined
}

/** Heading, pitch and heel of a ship, in radians. */
export interface ShipAttitude {
  /** Yaw angle of the bow (see `directionFromAngle`). */
  readonly heading: number
  /** Bow-up positive. */
  readonly pitch: number
  /** Starboard-down positive. */
  readonly heel: number
}

/** The water and air a ship moves through during one tick. */
export interface ShipEnvironment {
  readonly sea: SeaState
  readonly wind: Wind
  /** Sim time at the start of the tick, seconds. */
  readonly time: number
}

/** A ship at rest with the given id, position (y is ignored; it starts on the water) and heading. */
export const makeShip = (
  options: {
    readonly id: ShipId
    readonly x: number
    readonly z: number
    readonly heading: number
    readonly controls?: ShipControls
    readonly team?: Team | undefined
  },
  sea: SeaState,
  time: number,
): ShipState => ({
  id: options.id,
  position: vec3(options.x, sampleOcean(sea, options.x, options.z, time).height, options.z),
  orientation: quatFromAxisAngle(vec3(0, 1, 0), options.heading),
  velocity: zeroVec3,
  angularVelocity: zeroVec3,
  controls: options.controls ?? { rudder: 0, sail: 0 },
  rudderAngle: 0,
  sailSet: tuning.sail.setByLevel[options.controls?.sail ?? 0],
  hp: tuning.damage.hullHp,
  reloadedAt: { port: 0, starboard: 0 },
  life: afloat,
  spawn: 1,
  kills: 0,
  deaths: 0,
  removedParts: intact,
  shots: 0,
  hits: 0,
  damage: 0,
  team: options.team,
  lastHitBy: undefined,
})

/**
 * Share of a buoyancy column at ship-local (`x`, `z`) still afloat at `time`: the hull first settles, listing to the
 * flood side and trimming by the flooding end; then the flooding end loses the rest first and the far end last, so it
 * rises before the plunge.
 */
export const buoyancyKept = (life: ShipLife, x: number, z: number, time: number): number => {
  if (life._tag === "afloat") return 1
  if (life._tag === "sunk") return 0
  const { settleSeconds, settleLoss, plungeAt, floodSeconds, floodSpread } = tuning.sinking
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const t = time - life.since
  const toward = Math.max(-1, Math.min(1, (x * life.floodEnd) / (tuning.hull.hitBox.length / 2)))
  const low = clamp((1 + (z * life.floodSide) / (tuning.hull.hitBox.beam / 2)) / 2)
  const s = clamp(t / settleSeconds)
  const settled = s * (2 - s) * (settleLoss.all + settleLoss.lowSide * low + settleLoss.floodEnd * ((1 + toward) / 2))
  const flooded = clamp((t - plungeAt - ((1 - toward) / 2) * floodSpread) / floodSeconds)
  return (1 - settled) * (1 - flooded)
}

/** Applies an instantaneous world impulse (N·s) at a ship-local point, with the same added mass the body integrates with. */
export const applyImpulse = (ship: ShipState, local: Vec3, impulse: Vec3, hull: Hull = defaultHull): ShipState => {
  const q = ship.orientation
  const added = tuning.hull.addedMass
  const addedI = tuning.hull.addedInertia
  const j = rotateInverse(q, impulse)
  const dv = vec3(
    j.x / (hull.mass * (1 + added.surge)),
    j.y / (hull.mass * (1 + added.heave)),
    j.z / (hull.mass * (1 + added.sway)),
  )
  const l = cross(sub(local, hull.centerOfMass), j)
  const dw = vec3(
    l.x / (hull.inertia.x * (1 + addedI.roll)),
    l.y / (hull.inertia.y * (1 + addedI.yaw)),
    l.z / (hull.inertia.z * (1 + addedI.pitch)),
  )
  return { ...ship, velocity: add(ship.velocity, rotate(q, dv)), angularVelocity: add(ship.angularVelocity, rotate(q, dw)) }
}

/** World position of a ship-local point. */
export const shipPointToWorld = (ship: ShipState, local: Vec3): Vec3 => add(ship.position, rotate(ship.orientation, local))

/** World velocity of a ship-local point. */
export const shipPointVelocity = (ship: ShipState, local: Vec3, hull: Hull = defaultHull): Vec3 =>
  add(ship.velocity, cross(ship.angularVelocity, rotate(ship.orientation, sub(local, hull.centerOfMass))))

/** Heading, pitch and heel of a ship. */
export const shipAttitude = (ship: ShipState): ShipAttitude => {
  const forward = rotate(ship.orientation, vec3(1, 0, 0))
  const starboard = rotate(ship.orientation, vec3(0, 0, 1))
  return {
    heading: angleOfDirection(forward.x, forward.z),
    pitch: Math.asin(Math.max(-1, Math.min(1, forward.y))),
    heel: Math.asin(Math.max(-1, Math.min(1, -starboard.y))),
  }
}

/** Speed over ground along the ship's heading, m/s (negative when making sternway). */
export const shipForwardSpeed = (ship: ShipState): number =>
  dot(ship.velocity, directionFromAngle(shipAttitude(ship).heading))

/** Forward hull resistance in N at a water speed in m/s; sail drive is tuned against it. */
export const hullResistance = (speed: number): number =>
  tuning.resistance.surgeLinear * speed + tuning.resistance.surgeQuadratic * speed * Math.abs(speed)

/** Speed the sails drive toward for this set, point of sail and wind, m/s. */
export const sailTargetSpeed = (sailSet: number, angleOff: number, wind: Wind): number =>
  tuning.sail.maxSpeed * sailSpeedFactor(sailSet) * sailDriveFactor(angleOff) * (wind.speed / tuning.wind.referenceSpeed)

const approach = (value: number, target: number, maxStep: number) =>
  value + Math.max(-maxStep, Math.min(maxStep, target - value))

/**
 * The arena edge is an inward current rather than a push on the hull: a ship heading out still has water past its
 * rudder, so it can always turn back, where a force balancing its drive pinned it at zero speed with no steerage.
 */
const arenaCurrent = (at: Vec3): Vec3 => {
  const arena = tuning.arena
  const radius = Math.hypot(at.x, at.z)
  if (radius <= arena.softRadius) return zeroVec3
  const speed = (tuning.sail.maxSpeed * arena.currentAtRadius * (radius - arena.softRadius)) / (arena.radius - arena.softRadius)
  return vec3((-at.x / radius) * speed, 0, (-at.z / radius) * speed)
}

const bodyStep = (ship: ShipState, env: ShipEnvironment, hull: Hull, time: number, h: number, flooded: ArrayLike<number> | undefined): ShipState => {
  const { gravity, waterDensity } = tuning.physics
  const q = ship.orientation
  const com = add(ship.position, rotate(q, hull.centerOfMass))
  const toWorld = (local: Vec3) => add(ship.position, rotate(q, local))
  const velocityAt = (world: Vec3) => add(ship.velocity, cross(ship.angularVelocity, sub(world, com)))
  let force = vec3(0, -hull.mass * gravity, 0)
  let torque = zeroVec3
  const applyAt = (world: Vec3, f: Vec3) => {
    force = add(force, f)
    torque = add(torque, cross(sub(world, com), f))
  }

  const heaveMass = hull.mass * (1 + tuning.hull.addedMass.heave)
  const criticalHeaveDamping = 2 * Math.sqrt(waterDensity * gravity * hull.waterplaneArea * heaveMass)
  const dampingPerArea = (tuning.hull.columnDampingRatio * criticalHeaveDamping) / hull.waterplaneArea
  let wetArea = 0
  let waterRise = 0
  let radiated = 0
  // Flooded hull moves with the water it holds, so it loses the surface's damping along with its buoyancy.
  let keptArea = 0
  for (let c = 0; c < hull.columns.length; c++) {
    const column = hull.columns[c]!
    const bottom = toWorld(column.bottom)
    const water = sampleOcean(env.sea, bottom.x, bottom.z, time)
    const submerged = Math.max(0, Math.min(water.height - bottom.y, column.top - column.bottom.y))
    if (submerged > 0) {
      const center = toWorld(vec3(column.bottom.x, column.bottom.y + submerged / 2, column.bottom.z))
      const relativeRise = velocityAt(center).y - water.velocity.y
      // Damping fades in over the first half metre so a column touching the surface cannot chatter.
      const kept = buoyancyKept(ship.life, column.bottom.x, column.bottom.z, time)
      const wet = Math.min(1, submerged / 0.5) * kept
      const lift = waterDensity * gravity * submerged * kept * (1 - (flooded?.[c] ?? 0))
      applyAt(center, vec3(0, column.area * (lift - dampingPerArea * relativeRise * wet), 0))
      radiated += column.area * dampingPerArea * wet * relativeRise * relativeRise
      wetArea += column.area * wet
      waterRise += column.area * wet * water.velocity.y
    }
  }
  if (wetArea > 0) {
    const heaveDamping = (tuning.hull.heaveDampingRatio * criticalHeaveDamping * wetArea) / hull.waterplaneArea
    const rise = ship.velocity.y - waterRise / wetArea
    applyAt(com, vec3(0, -heaveDamping * rise, 0))
    radiated += heaveDamping * rise * rise
  }

  for (const column of hull.columns) keptArea += column.area * buoyancyKept(ship.life, column.bottom.x, column.bottom.z, time)

  const water = add(sampleOcean(env.sea, ship.position.x, ship.position.z, time).velocity, arenaCurrent(com))
  const surfaceShare = keptArea / hull.waterplaneArea
  if (surfaceShare < 1) {
    const sink = ship.velocity.y - water.y
    applyAt(com, vec3(0, -tuning.sinking.drag * (1 - surfaceShare) * sink * Math.abs(sink), 0))
  }
  const localFlow = (local: Vec3) => rotateInverse(q, sub(velocityAt(toWorld(local)), water))
  const r = tuning.resistance

  const hullPoint = vec3(hull.centerOfMass.x, r.dragHeight, 0)
  const surge = localFlow(hullPoint).x
  const pitchRate = rotateInverse(q, ship.angularVelocity).z
  radiated += tuning.hull.pitchDamping * pitchRate * pitchRate
  // Added resistance in waves: the energy the hull's heave and pitch pour into the sea comes out of its way, so a ship
  // driven hard into a head sea slows until it rides the swell instead of leaping from crest to crest.
  const waveResistance = Math.min(tuning.hull.waveResistanceShare * radiated / Math.max(1, Math.abs(surge)), hullResistance(Math.abs(surge)))
  applyAt(toWorld(hullPoint), rotate(q, vec3(-hullResistance(surge) - Math.sign(surge) * waveResistance, 0, 0)))

  const keelPoint = vec3(r.lateralCenter.x, r.lateralCenter.y, 0)
  const sway = localFlow(keelPoint).z
  applyAt(toWorld(keelPoint), rotate(q, vec3(0, 0, -(r.swayLinear * sway + r.swayQuadratic * sway * Math.abs(sway)))))

  const rudderPoint = vec3(tuning.rudder.position.x, tuning.rudder.position.y, 0)
  const past = localFlow(rudderPoint).x
  const rudderLift = -tuning.rudder.liftPerSpeed * ship.rudderAngle * past
  const rudderDrag = -tuning.rudder.dragPerSpeedSquared * Math.abs(ship.rudderAngle) * past * Math.abs(past)
  applyAt(toWorld(rudderPoint), rotate(q, vec3(rudderDrag, 0, rudderLift)))

  if (ship.sailSet > 0) {
    const forward = rotate(q, vec3(1, 0, 0))
    const angleOff = angleOffWind(angleOfDirection(forward.x, forward.z), env.wind)
    const leeward = Math.sign(dot(windVelocity(env.wind), rotate(q, vec3(0, 0, 1))))
    const windRatio = env.wind.speed / tuning.wind.referenceSpeed
    // A heeled sail presents cos(heel) of its area to the wind, which meets it at cos(heel): a knocked-down ship spills
    // its wind instead of being driven on over, the way real square-riggers survived a gust.
    const upright = Math.max(0, rotate(q, vec3(0, 1, 0)).y) ** 2
    const drive = upright * hullResistance(sailTargetSpeed(ship.sailSet, angleOff, env.wind))
    const side = upright * tuning.sail.sideForce * ship.sailSet * windRatio * windRatio * sailSideFactor(angleOff) * leeward
    const ce = tuning.sail.centerOfEffort
    applyAt(toWorld(hullPoint), rotate(q, vec3(drive, 0, 0)))
    applyAt(toWorld(vec3(ce.x, ce.y, 0)), rotate(q, vec3(0, 0, side)))
  }

  const bodyOmega = rotateInverse(q, ship.angularVelocity)
  const bodyTorque = add(
    rotateInverse(q, torque),
    vec3(
      -tuning.hull.rollDamping * surfaceShare * bodyOmega.x,
      -(r.yawLinear * bodyOmega.y + r.yawQuadratic * bodyOmega.y * Math.abs(bodyOmega.y)),
      -tuning.hull.pitchDamping * surfaceShare * bodyOmega.z,
    ),
  )

  const added = tuning.hull.addedMass
  const localForce = rotateInverse(q, force)
  const acceleration = rotate(
    q,
    vec3(
      localForce.x / (hull.mass * (1 + added.surge)),
      localForce.y / heaveMass,
      localForce.z / (hull.mass * (1 + added.sway)),
    ),
  )
  const addedI = tuning.hull.addedInertia
  const inertia = vec3(hull.inertia.x * (1 + addedI.roll), hull.inertia.y * (1 + addedI.yaw), hull.inertia.z * (1 + addedI.pitch))
  const gyroscopic = cross(bodyOmega, vec3(inertia.x * bodyOmega.x, inertia.y * bodyOmega.y, inertia.z * bodyOmega.z))
  const angularAcceleration = vec3(
    (bodyTorque.x - gyroscopic.x) / inertia.x,
    (bodyTorque.y - gyroscopic.y) / inertia.y,
    (bodyTorque.z - gyroscopic.z) / inertia.z,
  )

  const velocity = add(ship.velocity, scale(acceleration, h))
  const angularVelocity = add(ship.angularVelocity, scale(rotate(q, angularAcceleration), h))
  const orientation = integrateQuat(q, angularVelocity, h)
  const nextCom = add(com, scale(velocity, h))
  return {
    ...ship,
    position: sub(nextCom, rotate(orientation, hull.centerOfMass)),
    orientation,
    velocity,
    angularVelocity,
  }
}

/**
 * Advances one ship by one sim tick: helm and sails move toward their commands, then the body integrates. `flooded` is
 * the share of each hull column's buoyancy lost to holes below the waterline, indexed like `hull.columns`.
 */
export const stepShip = (ship: ShipState, env: ShipEnvironment, hull: Hull = defaultHull, flooded?: ArrayLike<number>): ShipState => {
  let next: ShipState = {
    ...ship,
    rudderAngle: approach(ship.rudderAngle, ship.controls.rudder * tuning.rudder.maxAngle, tuning.rudder.rate * SIM_DT),
    sailSet: approach(ship.sailSet, tuning.sail.setByLevel[ship.controls.sail], tuning.sail.setRate * SIM_DT),
  }
  const substeps = tuning.physics.substeps
  const h = SIM_DT / substeps
  for (let i = 0; i < substeps; i++) next = bodyStep(next, env, hull, env.time + i * h, h, flooded)
  return next
}

