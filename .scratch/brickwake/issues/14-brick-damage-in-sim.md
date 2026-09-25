# Brick damage in the sim and network

Type: task
Status: resolved
Blocked by: 12, 13

## Question

Build C6's damage half: the removed-brick set in sim state (from the 12 rules, hit
point in ship-local space), reset on respawn, sent in the join snapshot; clients
derive the detached set from the same graph and render it. Hull hits, upper works and
sail holes differ as the spec says. Decide whether below-waterline holes (listing,
flooding) fit now; record the call. Spec: Damage, Damage structure.

## Done when

- A late-joiner Playwright test sees the same damaged ships.
- Sim tests: same hits → same removed set; per-hit cost within the tick budget.

## Answer

Resolved (`bun test src` 135 pass; typecheck green; `bun run shot c6` passes; c2, c3 still pass).
- Sim: `src/sim/wreck.ts` — `galleonClass()` generates the galleon once (server does it at startup: 4,518 parts, ~170 ms) with its `DamageGraph`, a broad-phase box round every part and sail (x −14…14.4, y −2.1…20.3, z ±5.6) and 8 `SailPlane`s; `shipWreck(removedParts)` (memoised `ShipDamage` per list), `strikeWreck(list, point, dir)` → `{hit, removedParts}`, `shipFlooding(list)`. `ShipState.removedParts` = ordered removed indices (the only damage state); `makeShip` starts it empty, so respawn resets it; warmup→playing repairs afloat ships (HP and bricks) with a `shipRepaired` event.
- Hits (`traceBall` → `BallTrace {sails, end}`): the swept box is the broad phase, `firstPartAlong` on the target's present parts decides the hit, so balls fly through holes, gunports and over lost rails (a test holes one line through the hull in 4 balls; the 5th passes). HP = `hitDamage(zone)`: hull 5, upper works 2. Set sails are planes at their yard's x (reefed by `sailSet`, gone when the yard part is): a crossing is a `sailHit` for 1 HP and the ball flies on. Sinking ships still take bricks, not HP. Same hits → same list (test), and a client applying each `ballHit.removed` in order, or the whole list at once, has the same parts present (test).
- Flooding (decided: in): each hull part gone whose bottom was below 0.5 m costs its nearest buoyancy column 8 % of lift (max 70 %), afloat only (`tuning.damage.flooding`). Static, derived from the list, no new state. One-side volleys: 1.3° list at 60 HP, 3.5° at 30 HP. Holes strictly below the waterline almost never happen (balls splash first).
- Wire: `ballHit` gains `zone`, `removed`; new `sailHit`, `shipRepaired`; welcome gains `wrecks: [{shipId, removed}]` (damaged ships only). Snapshots unchanged (257 B/ship). ballHit ≈ 246 B (+~70 B); late welcome 1.3 KB with 99 removed parts (12 wrecked ships ≈ 15 KB once).
- Client: `wrecks.ts` `Wrecks` replays welcome + `ballHit.removed` at event tick (`gone` = removed + detached in order; a new life is a new `Wreck` object). `ShipView.showWreck(wreck)` removes only new parts and reveals through a per-view `ShipAir` (`removeAndReveal` now takes a part locator, `wholeShip(mesh)` for the lab); a different wreck restores first (`BrickShipMesh.restore()` ~1 ms, `ShipAir.clone()` 0.15 ms vs 40 ms fresh), so pooled views reuse cleanly. `ShipView.removePart` is gone. Debug: `brickwake.wreck(id)` → `{gone (sorted), drawnParts}`.
- Measured (Bun, M-series): 12 ships + 144 balls rippling in: 2.2 ms/tick mean, worst 6.4 ms (armada with no balls 2.0 ms: bots dominate); strike p50 0.21 ms, p99 0.28 ms; `firstPartAlong` 15 µs.
- Proof: `bun run shot c6` — A holes the dummy in a `target-dummy` room; a late joiner crews the dummy (second seat in named rooms) and draws both ships with identical gone sets at join and after a live volley. `.shots/c6-late-joiner{,-after}.png` (after: HP 30, breach amidships at the waterline, hold timber showing, debris).
- For 15: hook `ballHit.removed` + `Wreck.gone` tail for debris (detached parts are the `gone` entries after each hit's `removed`); `sailHit.localPoint` for hole punches (sail holes are not state: late joiners do not see them); sinking ships keep their wreck until `shipRespawned`.
- Gaps: sails are unbraced planes (brace/billow ignored); flooding is instant, not progressive; the hull corners at the waterline read dark against the sunset, so small holes on the shadow side are hard to see.

