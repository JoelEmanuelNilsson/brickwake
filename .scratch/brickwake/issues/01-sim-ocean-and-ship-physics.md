# Sim: ocean and ship physics

Type: task
Status: resolved
Blocked by: none

## Question

Build the pure sim core of C1 in `src/sim/`: `sampleOcean` (Gerstner sum, height,
normal, velocity), the ship rigid body with hull buoyancy points, wind with seeded
gusts, sails with points of sail, keel, drag, rudder, heel, soft arena boundary, fixed
30 Hz `stepMatch` skeleton with seeded RNG, one tuning module, one gun-layout module,
and named scenarios (calm, beam sea, head sea). Spec: Physics and feel, Starting
tuning numbers, Simulation.

## Done when

- `bun test` proves: target speeds by point of sail and sail level, speed response,
  turn rate, heel under sail and in turns, stable floating (no jitter, no drift into
  instability) in calm/beam/head seas, boundary pushback, determinism (same seed and
  inputs → identical state).
- Motion reads as a heavy wooden ship: slow heave and roll periods, no floatiness.

## Answer

Built the pure sim core in `src/sim/` (38 tests, `bun test` + `bun run typecheck` green, 0.057 ms per ship per tick).
- Entry points: `stepMatch(state, inputs)` / `createMatch` / `addShip` (`match.ts`); `sampleOcean(sea, x, z, t)`, `gerstnerPoint`, `seas`, `swell` (`ocean.ts`);
  `stepShip`, `shipAttitude`, `shipForwardSpeed`, `shipPointToWorld`, `shipPointVelocity` (`ship.ts`); `buildHull`/`defaultHull` (`hull.ts`);
  wind + points of sail (`wind.ts`); `tuning`, `SIM_HZ`, `SIM_DT` (`tuning.ts`); `gunLayout`, `gunsOnSide`, `makeGunLayout` (`gun-layout.ts`);
  `scenarios` calm / beam-sea / head-sea / open-sea (`scenarios.ts`); seeded RNG (`rng.ts`); Vec3/Quat math (`vector.ts`).
- Measured: speeds hit targets within 3 % (full sail beam 12.0, close-hauled 2.4, running 9.6; half sail 60 %); 63 % of top speed 3.8 s from rest
  (includes 2 s to set sail); full-rudder turn peaks 12.3 °/s, stopped ship 0 °/s; steady heel 8.3° beam reach, 10.6° close-hauled, 0° running;
  a turn heels ~1° inward, then ~5° outward. Mass 316 t (derived from hull lines). Heave period ~4.8 s with no bob (0.6 m drop overshoots < 3 cm);
  roll period 8.3 s; beam sea rolls ±15° (±21° under sail), head sea pitches ±9°, open sea ±4–13° roll, ±10° pitch; no jitter (vertical
  acceleration second difference < 0.3 m/s² per tick).
- Facts for later tickets:
  - `sampleOcean` takes the `SeaState` first: seas differ per scenario and live in `MatchState.sea` (plain data, send it in the join snapshot).
    The client must displace its water mesh with `gerstnerPoint` (or a GLSL port of it) so drawn and sampled surfaces agree (tested < 5 mm).
  - `stepMatch` has no dt argument: the step is always `SIM_DT`. `MatchEvent` is `never` until 04 adds events. Inputs are a
    `ReadonlyMap<ShipId, ShipControls>`; ships without an entry keep their controls.
  - Ship-local axes: +x bow, +y up, +z starboard; origin midships on the centreline at the design waterline. Yaw angles use
    `directionFromAngle` (0 = +x, counter-clockwise from above). Heel is starboard-down positive; rudder +1 turns to starboard.
  - `ShipState.velocity` is the centre of mass's; use `shipPointVelocity` for a muzzle's velocity. Gun positions are ship-local.
  - Sail drive is `hullResistance(target speed)`, so the spec targets hold exactly; it acts in line with drag. Heel comes from a separate side force.
- Known gaps: at full speed into a head sea the encounter period matches heave, so the ship slams (origin up to 1.9 m off the surface, 0.5 g):
  real physics, tune by feel in 19. Not built here: recoil impulses (04), sinking/buoyancy fade (C3), ship–ship collision (C3).

