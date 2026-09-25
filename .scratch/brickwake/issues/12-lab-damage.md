# Lab damage and breaks per hit

Type: task
Status: resolved
Blocked by: 10

## Question

Build S3 in the lab: connectivity graph from edges anchored at the keel, hit removal
within an impact radius up to a cap, flood fill, detached parts fall as debris, click
to fire at the ship. Decide the breaks per hit and cap by the spec's damage
principles, so a ship at 20 % HP looks badly holed and the ship stays recognisable
until it sinks. Spec: Damage, Damage structure.

## Done when

- Numbers chosen and justified in the Answer (parts per hit by zone, cap, hits to
  sink at 5 damage per ball).
- Screenshots at 100, 60, 20 % HP saved; the 20 % one reads as badly holed.
- Graph build and per-hit cost measured.

## Answer

- Built: pure damage rules `src/sim/ship/damage.ts` — `buildDamageGraph(spec, ship)` (ship-local boxes, zone per part, CSR adjacency from `ship.edges`, keel anchors) and `ShipDamage` (`hit(point, direction)` → `{ zone, removed, detached }`, `apply(removed)` → detached, `firstPartAlong(origin, dir, max)`, `hitDamage(zone)`). Incremental air `src/sim/ship/air.ts` `ShipAir` (replaces `exposure()`; levels 2 outside / 1 through ports / 0 enclosed; `open(gone)` floods on and returns the parts whose air rose). Client `src/client/bricks/ship-wreck.ts` `removeAndReveal(mesh, air, gone)`; `BrickShipMesh` takes every part (`hidden` placements) with pools pre-sized for all parts at every level, `reveal(i, interior)`, `isShown`. Lab: click to fire, falling debris boxes, `brickLab.fire/volley/hp`, `damage` camera.
- Rule: a ball knocks out the present parts within `radius` 0.5 m of its path over the first `depth` 0.9 m (the 2-stud shell plus margin), ordered by 2·(distance off the path) + (distance along it) so it breaks through before widening, capped by the struck part's zone: hull 12 parts / 5 HP, upper works (bottom ≥ `spec.upperWorks` 38 plates + sheer: rails, castles, rig) 6 parts / 2 HP, no brick within reach = sails, 0 parts / 1 HP. One flood from the keel drops the rest. Numbers in `tuning.damage`.
- Why: 100 HP / 5 = 20 hull hits. One hit is a ~1 m breach through the shell (small, bounded, never a crater); in play a broadside lands within ±2.6 m of its aim, so 3–4 hits in one place open a 3–5 m wound, and 16 hull hits (20 % HP) leave several such wounds on one side while castles, rig line and most of the other side stay whole. Caps 6/8 read as chips only (tried, screenshots); 16 made craters after 6 clustered hits.
- Measured (50 seeded clustered volleys, Bun): 21.9 balls to sink (20–25; 19.4 hull + 2.5 upper works), 231 parts lost by 20 % HP (~6.5 % of the 3,534 drawn), worst detached per hit 46. Graph build 1.5 ms; hit p50 0.08 ms, p99 0.87 ms. Chrome: sim ≤ 0.3 ms median, mesh + reveal 0.1 ms median, 4.1 ms once (the first hit, JIT), ≤ 1.2 ms after; frame with a hit 8.3 ms median vs 8.6 without (no hitch); steady frames damaged 4.7 vs intact 4.9 ms (DPR 1.5).
- Reveals: a hull breach floods the hold: ~390 parts appear at once, near 236k → 249k tris at 20 % HP. Studs that only face newly aired enclosed space stay hidden (~50k tris saved); studs a removed part covered are bared. Test: after a volley the incremental air equals a fresh flood of the parts left.
- Look: hull-paint parts the outside can't reach (ports sealed) are now deck timber (reddish brown, dark tan mottle), as in ref-04, so breaches show broken wood rather than black on black (generator change).
- Proof: `bun run shot:damage` → `.shots/damage-damage-hp{100,60,20}.png` (port quarter, lit side; the 20 % shot shows a wide breach amidships and a broken stern quarter, ship still reads as the galleon), `damage-lod-far-hp*.png`, stats and timings on stdout. `bun test src/sim/ship src/client/bricks`: caps, zones, sub-assembly falls whole when its support goes, 20–30 hits to sink, server/client replay agreement, air equivalence, reveal at every level, pools never rebuilt, per-hit < 1 ms.
- For 14: call `hit(point, direction)` with ship-local metres (+x bow, +z starboard, y from the waterline) and the ball's ship-local velocity; `firstPartAlong` finds the entry point and returns undefined when the ball passes through a hole. Send only `removed` in order; clients `apply(removed)` in the same order to get the same `detached`. Indices are `GeneratedShip.parts` indices, so server and clients must generate from the same spec. `hitDamage(zone)` gives the HP.
- For 11: put mast/yard joints into `GeneratedShip.edges` (strong edges or stud edges); the flood handles falls with no special case. The rig counts as upper works. Near budget after damage is 249k + rig.
- For 15: debris are coloured boxes on `ChipLayer`; detached parts drop, removed parts fly on with the ball.
- Gaps: the lab key light leaves the starboard (ref-01) side unlit, so volleys hit the port side; the first hold-flooding hit costs up to 4 ms CPU once; a near, holed ship with the rig may pass 300k tris.

