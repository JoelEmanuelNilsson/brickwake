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
  options: { readonly id: ShipId; readonly x: number; readonly z: number; readonly heading: number; readonly controls?: ShipControls },
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
})

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

const bodyStep = (ship: ShipState, env: ShipEnvironment, hull: Hull, time: number, h: number): ShipState => {
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
  for (const column of hull.columns) {
    const bottom = toWorld(column.bottom)
    const water = sampleOcean(env.sea, bottom.x, bottom.z, time)
    const submerged = Math.max(0, Math.min(water.height - bottom.y, column.top - column.bottom.y))
    if (submerged > 0) {
      const center = toWorld(vec3(column.bottom.x, column.bottom.y + submerged / 2, column.bottom.z))
      const relativeRise = velocityAt(center).y - water.velocity.y
      // Damping fades in over the first half metre so a column touching the surface cannot chatter.
      const wet = Math.min(1, submerged / 0.5)
      applyAt(center, vec3(0, column.area * (waterDensity * gravity * submerged - dampingPerArea * relativeRise * wet), 0))
      wetArea += column.area * wet
      waterRise += column.area * wet * water.velocity.y
    }
  }
  if (wetArea > 0) {
    const heaveDamping = (tuning.hull.heaveDampingRatio * criticalHeaveDamping * wetArea) / hull.waterplaneArea
    applyAt(com, vec3(0, -heaveDamping * (ship.velocity.y - waterRise / wetArea), 0))
  }

  const water = sampleOcean(env.sea, ship.position.x, ship.position.z, time).velocity
  const localFlow = (local: Vec3) => rotateInverse(q, sub(velocityAt(toWorld(local)), water))
  const r = tuning.resistance

  const hullPoint = vec3(hull.centerOfMass.x, r.dragHeight, 0)
  const surge = localFlow(hullPoint).x
  applyAt(toWorld(hullPoint), rotate(q, vec3(-hullResistance(surge), 0, 0)))

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
    const drive = hullResistance(sailTargetSpeed(ship.sailSet, angleOff, env.wind))
    const side = tuning.sail.sideForce * ship.sailSet * windRatio * windRatio * sailSideFactor(angleOff) * leeward
    const ce = tuning.sail.centerOfEffort
    applyAt(toWorld(hullPoint), rotate(q, vec3(drive, 0, 0)))
    applyAt(toWorld(vec3(ce.x, ce.y, 0)), rotate(q, vec3(0, 0, side)))
  }

  const arena = tuning.arena
  const radius = Math.hypot(com.x, com.z)
  if (radius > arena.softRadius) {
    const push =
      (hullResistance(tuning.sail.maxSpeed) * arena.pushAtRadius * (radius - arena.softRadius)) / (arena.radius - arena.softRadius)
    applyAt(com, vec3((-com.x / radius) * push, 0, (-com.z / radius) * push))
  }

  const bodyOmega = rotateInverse(q, ship.angularVelocity)
  const bodyTorque = add(
    rotateInverse(q, torque),
    vec3(
      -tuning.hull.rollDamping * bodyOmega.x,
      -(r.yawLinear * bodyOmega.y + r.yawQuadratic * bodyOmega.y * Math.abs(bodyOmega.y)),
      -tuning.hull.pitchDamping * bodyOmega.z,
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

/** Advances one ship by one sim tick: helm and sails move toward their commands, then the body integrates. */
export const stepShip = (ship: ShipState, env: ShipEnvironment, hull: Hull = defaultHull): ShipState => {
  let next: ShipState = {
    ...ship,
    rudderAngle: approach(ship.rudderAngle, ship.controls.rudder * tuning.rudder.maxAngle, tuning.rudder.rate * SIM_DT),
    sailSet: approach(ship.sailSet, tuning.sail.setByLevel[ship.controls.sail], tuning.sail.setRate * SIM_DT),
  }
  const substeps = tuning.physics.substeps
  const h = SIM_DT / substeps
  for (let i = 0; i < substeps; i++) next = bodyStep(next, env, hull, env.time + i * h, h)
  return next
}

