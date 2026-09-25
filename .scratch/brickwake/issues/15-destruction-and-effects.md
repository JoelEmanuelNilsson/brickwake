# Destruction, gun effects and sinking sequence

Type: task
Status: resolved
Blocked by: 14

## Question

Build the premium effects: brick debris and detached chunks that tumble, splash, float
and sink (choose Rapier or a small custom solver by look and cost), full muzzle flash
and smoke, splinters and brick bursts on hits, sail hole punches, and a large sinking
sequence. Quality bar: ref-01 and ref-05. Spec: Gun effects, Physics and feel.

## Done when

- Screenshots of a broadside, a hit, and a sinking saved and matching the bar.
- No frame hitches during a full broadside exchange of 12 ships (frame times measured).


## Answer

Built. Debris physics is a **custom solver**, not Rapier: bricks need only rigid bodies with ≤16 contact points, a deck heightfield (`GalleonModel.deck`, `deckHeight()`), per-point buoyancy on `sampleOcean` and impulse contacts (restitution 0.38, friction 0.45). That costs ≈1 ms for ~1000 bodies and adds no WASM load or world sync. Removed parts fly as single bricks (55% spall back toward the gun, the rest carried on with the ball's velocity). Each connected group of detached parts is one rigid body. A chunk (≥10 pieces) that carries a mast top gets a pooled ghost `ShipRig`, so its sails, flags and ropes come down with it. Chunks call `effects.splash` + `audio.splash` on entering water and `audio.hullHit` + `effects.dust` on a deck crash. Bodies float (`floatLeft`), waterlog and sink. `warm()` compiles every debris mesh and ghost rig at load, which removed a ~100 ms first-use hitch.

Hits: brick spall, splinters, dust and an ember `flash()`. A `sailHit` punches a scorched hole in the nearest sail (`ShipRig.punchSail`, cut in the fragment shader, up to 24 per rig). Guns: flame cone, sparks, burning wadding, and smoke banks that live 16–26 s and drift with the wind. Splashes have a column and a foam ring. Sinking (`sinking.ts`): list by bow or stern following the sim, founder smoke, bubbles, masts snapping at 0.9 s and 2.2 s, bricks shed over the low side, air bursts at 1.6, 2.8 and 3.6 s, and a plunge with 28 flotsam bricks and a 4 s foam vortex. `hullHit`, `splash`, `sinking` and `plunge` fire at those moments. `ShipView.#syncRig` hides the rig of a sail whose yard or mast is gone, which closes ticket 11's gap.

Files: `src/client/game/brick-debris.ts` (+test), `effects.ts`, `sinking.ts`, `game.ts`, `ship-view.ts`, `galleon.ts`, `balls.ts` (`find`), `wrecks.ts` (`onStrike`), `frame-stats.ts` (`spread`), `debug-hook.ts`, `src/client/rig/ship-rig.ts` (`mast` attribute, `setMastShown`, `setHullRigShown`, `punchSail`, `mend`, `copyFrom`), `src/client/bricks/brick-ship-mesh.ts`, `src/sim/scenarios.ts` (`line-of-battle`), `scripts/shot.ts` (check `fx`).

Measured with `bun run shot fx` at 2592×1675 on `line-of-battle`: 12 ships exchanging broadsides for 20 s (1204 frames). CPU p50 3.4–4.3 ms, p99 4.4–6.0 ms, max 8.4 ms. Frame interval p50/p99 16.7/16.8 ms with **0 hitches**; the only 100 ms gaps came from Playwright screenshots. Pipelined frame median 5.4–6.1 ms. Debris at peak: ~1000 bodies / 1740 bricks, update mean 1.1 ms, worst 2.7 ms. Unit test: 600 bricks in well under 2 ms.

For 19:
- Tuning knobs: restitution and friction and the capacities (1024 bodies / 6144 pieces, evicting the body nearest the end of its life) in `brick-debris.ts`; `snapChance` in `sinking.ts`; spray brightness in `effects.ts`. The spray whites run hot.
- The ghost-rig livery comes from `view.rig.livery`, so 18's liveries carry over.
- Debris bodies keep a reference to the view they came from, so a pooled view reused for another ship gives the wrong deck.
- Bots sink ~16 ships a minute in `line-of-battle`.

Known gaps:
- Sail holes are client-only, reset on `mend`, and do not show in shadows.
- A sail on a yard that falls without its mast top just vanishes.
- Loose bricks can take up to ~6 s to settle on a deck.
- Sail holes were not confirmed by eye in a screenshot.
