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
    /** Hull box, ship-local: the extent the sinking flood and ship views measure against. Balls strike the brick parts (`wreck.ts`). */
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
    heaveDampingRatio: 0.8,
    /** Roll damping beyond the columns' (bilge keels, hull form), N·m per rad/s. */
    rollDamping: 3.5e6,
    /** Pitch damping beyond the columns' (wave radiation), N·m per rad/s. */
    pitchDamping: 7e7,
    /** Share of the power heave and pitch damping take that is paid from forward motion (added resistance in waves). */
    waveResistanceShare: 1,
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
    /** Seconds from a broadside order until that side may fire again. */
    reload: 6,
    /** Ball speed relative to the muzzle, m/s. */
    muzzleSpeed: 90,
    /**
     * Linear air drag rate, 1/s. A 24-pounder's quadratic drag at muzzle speed decelerates it about 4 % per second;
     * the linear form keeps `ballPositionAt` closed-form.
     */
    airDrag: 0.04,
    /** Barrel elevation above the deck plane, radians. */
    elevation: { min: -4 * degrees, max: 12 * degrees },
    /** Barrel traverse either side of straight out of the port, radians. */
    traverse: 25 * degrees,
    /**
     * Per-gun random error: the barrel points uniformly within an ellipse of these half-angles about its lay, radians.
     * A shallow arc turns elevation error into about four times as much range error as the same traverse error makes
     * across, so elevation is held tighter: the balls land in a round patch about the reticle (±4 m across, ±5 m along
     * at 220 m) instead of a long streak whose short half splashes before a waterline aim.
     */
    spread: { traverse: 1 * degrees, elevation: 0.25 * degrees },
    /**
     * Recoil impulse each gun gives the ship, N·s. About four times a real 24-pounder's ball-plus-powder momentum,
     * so a broadside visibly rocks the ship (about 1° of roll).
     */
    recoilImpulse: 7000,
    /** A guard: balls always meet the sea long before this, seconds. */
    maxFlightSeconds: 20,
  },
  damage: {
    /** Hull HP a ship starts with. */
    hullHp: 225,
    /** HP one ball takes off the hull it hits. */
    perBall: 5,
    /** HP a ball takes when it strikes the upper works (rails, castles, rig), and when it meets no brick (the sails). */
    upperWorksPerBall: 2,
    sailsPerBall: 1,
    /** Bricks a ball knocks out: those within `radius` m of its path over the first `depth` m from the impact, nearest first, at most the cap of the zone it struck. */
    bricks: { radius: 0.5, depth: 0.9, hullCap: 8, upperWorksCap: 4 },
    /**
     * Holes at the waterline let the sea in as the ship rolls and heaves: each hull part gone whose bottom was below
     * `height` m costs the nearest buoyancy column `perPart` of its lift, at most `maxPerColumn`, so a ship holed on
     * one side lists to it.
     */
    flooding: { height: 0.5, perPart: 0.055, maxPerColumn: 0.7 },
  },
  sinking: {
    /** Seconds from HP 0 until the ship is under and out of play; it takes no orders and cannot be hit meanwhile. */
    seconds: 12,
    /** Heel or pitch past which a ship capsizes and founders, radians. */
    capsizeHeel: 75 * degrees,
    /** A capsize this soon after an enemy ball took HP is that enemy's sink, seconds: the broadside that knocked the ship down wins it. */
    capsizeCreditSeconds: 20,
    /** Seconds a sunk ship waits before it respawns. */
    respawnSeconds: 5,
    /**
     * First the hull settles over `settleSeconds`, each column losing `all` of its lift, plus up to `lowSide` on the
     * flood side and `floodEnd` at the flooding end, so it lists and trims before it goes.
     */
    settleSeconds: 7,
    settleLoss: { all: 0.3, lowSide: 0.22, floodEnd: 0.25 },
    /** From `plungeAt` s the flooding end's columns lose the rest over `floodSeconds` each, the far end `floodSpread` s later: it lifts, then plunges. */
    plungeAt: 6.5,
    floodSeconds: 1.5,
    floodSpread: 3.0,
    /** Quadratic drag on a flooded hull's vertical speed through the water, N per (m/s)²: ~200 m² of hull plan at drag coefficient 1. */
    drag: 1.0e5,
  },
  collision: {
    /** Each hull's footprint for ship–ship contact: a capsule along the keel, x from −half to +half, this radius. */
    halfLength: 10,
    radius: 4,
    /** Share of closing speed that bounces back; wooden hulls barely do. */
    restitution: 0.2,
  },
  match: {
    /** Ships a room holds, humans and bots together. */
    maxShips: 12,
    /** FFA: first to `scoreLimit` sinks or the most after `timeLimit` seconds. Warmup before, results after. */
    ffa: { scoreLimit: 5, timeLimit: 10 * 60, warmupSeconds: 10, endedSeconds: 12 },
    /** TDM, Pirates vs Navy: first side to `scoreLimit` sinks or the side with the most after `timeLimit` seconds. */
    tdm: { scoreLimit: 8, timeLimit: 12 * 60, warmupSeconds: 10, endedSeconds: 15 },
    /** Joining ships start on this ring about the arena centre, in the free slot farthest from others. */
    spawnRing: { radius: 260, slots: 12 },
  },
  bots: {
    /** Quick-play rooms are topped up with bots to this many ships; bots leave as humans join. */
    fillTo: 6,
    /** Seconds ahead a bot judges each candidate heading by, and the turn rate it expects of its ship. */
    lookahead: 10,
    turnRate: 10 * degrees,
    /** Within this far beyond its standoff range a bot starts turning its broadside to the target, metres. */
    engageBand: 200,
    /** Bots never steer closer to the wind than this; nearer, the sails barely drive and the rudder loses its grip. */
    ironsAngle: 55 * degrees,
    /** Within this of dead upwind the bow is already stalled, so a bot may bear away to either side. */
    headToWind: 20 * degrees,
    /** Bots steer back inside this radius, well before the arena's push. */
    edgeRadius: 420,
    /** How much sooner bots keep off the arena edge the wind blows toward, metres. */
    downwindMargin: 250,
    /** Bots keep this far from other hulls, metres, judged this many seconds ahead. */
    clearance: 80,
    clearanceChecks: [2, 5, 10],
    /** Target choice: metres added per other bot already fighting a ship, and taken off the current target. */
    crowdingPenalty: 120,
    targetLoyalty: 80,
    /** Height above the sea the bots aim at, metres: the hull between waterline and rail. */
    aimHeight: 1,
    /** Helm: seconds of turn rate the helm allows for, and the heading error it ignores. */
    helmLead: 1.2,
    helmDeadband: 3 * degrees,
    /** A chosen turn this large or more is fully committed to: reversing it costs the whole `reverse` weight. */
    commitTurn: 60 * degrees,
    /** Heading costs, relative. */
    weights: { turn: 0.15, reverse: 6, wind: 0.3, edge: 8, range: 0.5, tooClose: 2, beam: 2, clearance: 4 },
    /** Each bot's skill is drawn uniformly from these ranges. */
    skill: {
      standoff: { min: 110, max: 170 },
      fireRange: { min: 180, max: 260 },
      lead: { min: 0.85, max: 1.05 },
      aimError: { min: 0.1, max: 0.2 },
    },
  },
  arena: {
    radius: 700,
    /** An inward current starts here and outruns full sail well before `radius`. */
    softRadius: 640,
    /** Current speed at `radius` as a multiple of full-sail top speed. */
    currentAtRadius: 2,
  },
} as const
