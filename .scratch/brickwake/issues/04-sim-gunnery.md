# Sim: gunnery and hits

Type: task
Status: open
Blocked by: 01

## Question

Build C2's sim half: the pure aim solve (world aim point → per-gun elevation and
traverse, clamped), two-deck broadside with 50 ms ripple, per-side reload, recoil
impulses, closed-form `ballPositionAt`, splash where the arc crosses the wave
surface, swept hits against the posed hull box in ship-local space, HP, a drifting
target dummy scenario. Events carry ticks. Spec: Simulation, Firing, tuning table.

## Done when

- `bun test` proves: landing point equals aim point within spread; no tunneling at
  muzzle speed; no self-hits; out-of-arc and out-of-range are refused with a reason;
  a broadside visibly rocks the ship (recoil changes roll).

