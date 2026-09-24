# Sim: ocean and ship physics

Type: task
Status: open
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

