# Sim: gunnery and hits

Type: task
Status: resolved
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


## Answer

Built C2's sim half in `src/sim/gunnery.ts` + `match.ts`, forwarded through the server (`bun test src` 58 pass: 9 new sim, 1 new real-WebSocket; typecheck green).
- Entry points: `aimGun(ship, gunMount, aimPoint) → GunAim {lay{elevation,traverse}, clamped, muzzle, muzzleVelocity, barrel, flightTime}` (the one aim
  solve for player, bots, gunport view); `broadsideRefusal(ship, side, aimPoint, time) → "reloading"|"out-of-arc"|"out-of-range"|undefined`;
  `solveLaunch`, `ballPositionAt(ball, t)` / `ballVelocityAt` (t = absolute sim seconds), `segmentBoxEntry`, `traceBall`, `fireGun`; `applyImpulse` (`ship.ts`).
  `stepMatch(state, inputs, orders?)`: third arg `BroadsideOrders = Map<ShipId, {side, aimPoint}>`. Scenario `target-dummy` (`dummyShipId` 150 m off starboard, drifting ~1.4 m/s).
- Model: ball inherits the muzzle's velocity; linear air drag 0.04/s (closed form, checked against numeric integration < 1 cm). The solve finds the low arc
  through the aim point (landing = aim within 1 mm unperturbed, from a moving, heeled, turning ship), then clamps to −4…+12° / ±25° in the deck frame, so heel
  toward the target shortens reach. Arc/range refusal is judged from the battery's mean gun position; each gun lays itself and clamps. Too-close aims clamp at
  −4° (not refused). Max range ≈ 300 m in calm. Spread: uniform cone of 1° half-angle from the match RNG; at 220 m that is ±4 m across and up to ±18 m in range.
- Ripple: each gun of `gunLayout` fires at order time + `rippleDelay` (sub-tick, exact `firedAt`), re-laid from the ship's pose extrapolated to that moment.
  Reload 6 s from the order (`ShipState.reloadedAt.{port,starboard}`). Recoil 7000 N·s per gun (≈4× real, stated in tuning): broadside heels ~0.85° away, then back.
- Hits: each tick the ball chord is swept in every other ship's frame (start pose → end pose) against the 28×8×(−2…5) box, slab test, so no tunnelling (proven with a
  0.1 m plank vs 3 m steps); earlier of hull entry and wave-surface crossing (bisection on `sampleOcean`) ends the ball. Own ship is skipped. 5 HP per hit, `ShipState.hp` floors at 0.
- Events (`MatchEvent`, `tick` = tick being stepped, `time` exact): `cannonFired {ball}`, `broadsideRefused {shipId, side, reason}`, `ballHit {time, ballId, shooter,
  target, point, localPoint, damage, hp}`, `ballSplash {time, ballId, point}`.
- Wire: client `fireBroadside {side, aimPoint:[x,y,z]}` (Seat.fire; last order per tick wins). `ServerEvent` gains the four events (`cannonFired` flattens the ball:
  `ballId, shooter, gun (gunLayout index), origin, velocity, firedAt`; `ballFromWire(event)` rebuilds a `Cannonball`). `ShipSnapshot` gains `hp`, `reloadedAt [port, starboard]`.
- Measured: 12 ships with 144 balls in flight 0.92 ms/tick; `broadsideRefusal` 5.7 µs (bots/reticle can call it every frame).
- For 05: aim point is a world point on the sea; with swell the ball splashes where it meets the surface at arrival, which can be short of/over the aim point.
  Aiming at an enemy's waterline lands about half the spread short: aim at the far side. For 07: use `broadsideRefusal` then `aimGun` flightTime to lead.
- Known gaps: HP 0 does nothing yet (sinking is 06); balls under a hull's waterline part splash first (no underwater hits); no ricochet.
