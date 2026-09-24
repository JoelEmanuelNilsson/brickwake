# Client: firing, ball arcs and first-pass effects

Type: task
Status: resolved
Blocked by: 03, 04

## Question

Wire C2 end to end: `fireBroadside` message and fire/hit/splash events, event queue
applied at render tick, reticle that is the landing point with reload and can't-fire
reasons, local fuse sizzle on click, rendered balls from `ballPositionAt`, first-pass
muzzle flash with light, lingering wind-drifted smoke, splash sized by impact, hit
chips, hit marker, camera shake by distance. Spec: Player experience, Gun effects.

## Done when

- Playwright aims at the target dummy, fires, and the debug hook shows HP lowered;
  screenshots of a broadside and of splashes saved.
- Firing feels weighty in the screenshots: flash, smoke and splashes are visible and
  sized for a heavy gun, not placeholder dots.


## Answer

Built C2's client half in `src/client/game/` (`bun run shot` c1+c2 pass; `bun test src` 68 pass; typecheck green).
- `gunnery.ts` `Gunnery`: the reticle aim point is the camera's unshaken centre ray (`ChaseCamera.aimOrigin/aimDirection`) marched and bisected against
  `oceanHeight` at the render time (new in `sim/ocean.ts`: `sampleOcean`'s height with no allocation, same inversion code, tested equal). Facing side = sign of
  the aim point's bearing in the ship's starboard axis. `broadsideRefusal` runs every frame on a reused ShipState built from the pose (angular velocity 0), with
  the reload taken as max(snapshot `reloadedAt`, local order + 6 s), so the reload ring starts on click. Left click (pointer locked, `Controls`) → `fire()`:
  refused locally → reticle shake, nothing sent; else `fireBroadside`, fuse sparks at the side's touch holes and a WebAudio sizzle (`audio.ts` `GameAudio`, 16 extends it).
- `balls.ts` `Cannonballs`: balls from `ballFromWire`, drawn with new `writeBallPosition` (allocation-free twin of `ballPositionAt`); fire and impact play when
  the render clock passes `firedAt` / the event's `time`, not at event arrival, so the ripple ripples. Moments go to `BallMoments` (fired/flying/ended).
- `effects.ts` `Effects` (on `game.effects`, for 15): pooled layers `smoke` 4096 (lit, sorted), `spray` 1024, `droplets` 2048, `fire` 512, `sparks` 1024, `foam` 256
  (rides the waves), `chips` 512 (`debris.ts` `ChipLayer`: tumbling Lego-coloured chips and splinters that plop, float and shrink), 4 pooled PointLights (muzzle flash).
  Recipes: `muzzle`, `fuse`, `splash(speed)`, `hit(direction)`, `trail`. `particles.ts` `ParticleLayer`: CPU sim in typed arrays, one instanced draw, billboard/flat/
  streak shapes, sun-shaded + forward-scatter smoke, manual exp² fog, typed-array depth sort; relaxes to wind × `windShare` (smoke 0.45 of the match wind).
  A full layer overwrites a spread of live particles. Canvas-drawn textures (puff, spray streaks, flash, foam ring).
- Camera shake: `ChaseCamera.shake(amount)` trauma², moves the look target only (camera roll still 0.000°). Fire 0.1–0.14, splash 0.35, hit 0.7, × 1/(1+(d/reach)²).
- Reticle (`reticle.ts`, `#reticle` in index.html): side label, reload ring, range or reason (Reloading n s / Out of arc / Out of range / No target), hit marker on
  own `ballHit`, shake on refusal; world aim ring on the water sized to the spread (1° across, 18/220 along), gold/red/white by state.
- Debug hook adds: `DebugShip.hp`, `.reloadedAt`; `aim()`, `effects()` (particle counts, balls in flight, shake), test controls `fire()`, `fireAt([x,y,z])`,
  `orbit(viewYaw, pitch, distance?)`. `ShipPose` gains `hp`, `reloadPort`, `reloadStarboard`. `bun run shot c2` runs only this ticket's check.
- Measured (`bun run shot`): reticle aimed at the 150 m dummy lands at 149.9 m; one broadside at its centre hits 4–9 of 12 (range spread); HP 100 → 55–80.
  Frame at 1280×720 with effects: CPU 0.5 ms, GPU 1–4 ms; camera inside a broadside's smoke bank at 2592×1676: GPU 6–8 ms, about 1.5 ms over the open-sea frame
  measured in the same run (timings vary ±2 ms with other agents on the cores). Shots: `.shots/c2-{aim,broadside-1..4,impact,smoke,splashes,smoke-bank}.png`.
- For 06: all 12 guns converge on one aim point, so a miss is one tight group of splashes; enemy hits on own ship only shake the camera (no direction indicator yet).
  For 15: extend `Effects`; soft particles are missing (smoke is cut hard where it meets a hull); the flash light does not reach the custom ocean shader; chips are plain boxes.
- Known gaps: `broadsideRefusal`'s solver still allocates each frame (small young-gen garbage); no boom (16); gun recoil/run-out animation waits for real guns (10/13).
