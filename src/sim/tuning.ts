/** Sim ticks per second. */
export const SIM_HZ = 30

/** Seconds per sim tick. */
export const SIM_DT = 1 / SIM_HZ

const degrees = Math.PI / 180

/**
 * Every tunable constant of the sim. Ship-local axes: +x bow, +y up, +z starboard; origin on the
 * centreline, midships, at the design waterline.
 */
export const tuning = {
  physics: {
    gravity: 9.81,
    waterDensity: 1025,
    /** Rigid-body substeps per tick (120 Hz). */
    substeps: 4,
  },
  hull: {
    /** Hit box, ship-local. */
    hitBox: { length: 28, beam: 8, bottom: -2, top: 5 },
    /**
     * Hull lines as stations from stern to bow: x, half-breadth, keel depth below the waterline,
     * and the height up to which the hull keeps water out. Buoyancy and mass derive from these.
     */
    stations: [
      { x: -12.25, halfBreadth: 3.5, draft: 1.8, top: 4.2 },
      { x: -8.75, halfBreadth: 3.9, draft: 2.0, top: 3.2 },
      { x: -5.25, halfBreadth: 4.0, draft: 2.0, top: 2.8 },
      { x: -1.75, halfBreadth: 4.0, draft: 2.0, top: 2.6 },
      { x: 1.75, halfBreadth: 4.0, draft: 2.0, top: 2.6 },
      { x: 5.25, halfBreadth: 3.8, draft: 1.9, top: 2.8 },
      { x: 8.75, halfBreadth: 3.1, draft: 1.6, top: 3.2 },
      { x: 12.25, halfBreadth: 1.8, draft: 1.1, top: 3.8 },
    ],
    stationLength: 3.5,
    /** Buoyancy columns across each station, as fractions of half-breadth, port to starboard. */
    columnOffsets: [-0.75, -0.25, 0.25, 0.75],
    /** How much shallower the hull is at the turn of the bilge (1 = flat-bottomed box). */
    bilgeRise: 0.5,
    /** Centre of mass above the design waterline, metres. Sets stability (GM) and roll period. */
    centerOfMassHeight: 0.35,
    /** Radii of gyration in metres (roll, yaw, pitch). */
    gyration: { roll: 4.0, yaw: 7.4, pitch: 7.2 },
    /** Added mass of entrained water as a fraction of ship mass, per ship-local axis. */
    addedMass: { surge: 0.05, heave: 0.9, sway: 0.7 },
    /** Added moment of inertia as a fraction, per ship-local axis. */
    addedInertia: { roll: 0.3, yaw: 0.5, pitch: 0.8 },
    /** Damping of each buoyancy column by its speed through the water surface, as a fraction of critical heave damping. */
    columnDampingRatio: 0.15,
    /** Further heave damping at the centre of mass (wave radiation), same unit; roll stays lightly damped. */
    heaveDampingRatio: 0.55,
    /** Roll damping beyond the columns' (bilge keels, hull form), N·m per rad/s. */
    rollDamping: 3.5e6,
    /** Pitch damping beyond the columns' (wave radiation), N·m per rad/s. */
    pitchDamping: 4.5e7,
  },
  resistance: {
    /** Forward drag N per m/s and per (m/s)². */
    surgeLinear: 4.0e4,
    surgeQuadratic: 5.0e3,
    /** Height forward drag and sail drive act at, ship-local. */
    dragHeight: -0.5,
    /** Keel: sideways drag, far above forward drag, so sail force becomes drive with little leeway. */
    swayLinear: 4.0e5,
    swayQuadratic: 6.0e4,
    /** Where the keel's lateral force acts, ship-local. Below the centre of mass, so turns heel outward. */
    lateralCenter: { x: -3, y: -0.3 },
    /** Yaw damping, N·m per rad/s and per (rad/s)². */
    yawLinear: 2.1e7,
    yawQuadratic: 3.0e7,
  },
  sail: {
    /** Top speed at full sail on a beam reach in reference wind, m/s. */
    maxSpeed: 12,
    /** Speed fraction by sail set (0 furled, 0.5 half, 1 full), interpolated. */
    speedBySet: [
      { set: 0, speed: 0 },
      { set: 0.5, speed: 0.6 },
      { set: 1, speed: 1 },
    ],
    /** Sail set per sail level (0 furled, 1 half, 2 full). */
    setByLevel: [0, 0.5, 1],
    /** Sail set change per second while the crew works the sails. */
    setRate: 0.5,
    /** Drive (speed fraction) by angle off the wind, 0 = head to wind, interpolated. */
    driveByAngle: [
      { angle: 0, factor: 0.2 },
      { angle: 45 * degrees, factor: 0.2 },
      { angle: 90 * degrees, factor: 1 },
      { angle: 115 * degrees, factor: 1 },
      { angle: 180 * degrees, factor: 0.8 },
    ],
    /** Heeling side force at full sail in reference wind, N, and its share by angle off the wind. */
    sideForce: 7.5e4,
    sideByAngle: [
      { angle: 0, factor: 0.3 },
      { angle: 50 * degrees, factor: 1 },
      { angle: 90 * degrees, factor: 0.75 },
      { angle: 140 * degrees, factor: 0.3 },
      { angle: 180 * degrees, factor: 0 },
    ],
    /**
     * Centre of effort of the heeling side force, ship-local; level with the keel's centre so the ship
     * holds a course with the helm centred. Drive acts in line with hull resistance: game speed needs
     * several times a real galleon's sail force, which at mast height would bury the bow.
     */
    centerOfEffort: { x: -3, y: 11 },
  },
  rudder: {
    maxAngle: 35 * degrees,
    /** Rudder turn rate, rad/s. */
    rate: 30 * degrees,
    /** Side force per rad of rudder per m/s of water past it, N. */
    liftPerSpeed: 1.0e5,
    /** Drag per rad of rudder per (m/s)², N; turning costs speed. */
    dragPerSpeedSquared: 1.6e3,
    position: { x: -14, y: 0 },
  },
  wind: {
    /** Wind speed the sail targets are tuned for, m/s. */
    referenceSpeed: 14,
    /** Gusts: seconds per gust, how far speed and direction wander, and how fast they follow. */
    gustSeconds: { min: 8, max: 20 },
    gustSpeedRange: 0.18,
    gustAngleRange: 7 * degrees,
    gustResponseSeconds: 4,
  },
  guns: {
    /** Seconds between guns in a ripple broadside. */
    rippleInterval: 0.05,
  },
  arena: {
    radius: 700,
    /** The boundary starts pushing here and pushes harder than full sail by `radius`. */
    softRadius: 640,
    /** Push at `radius` as a multiple of full-sail drive. */
    pushAtRadius: 2,
  },
} as const
