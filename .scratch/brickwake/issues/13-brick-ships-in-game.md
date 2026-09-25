# Brick ships in the game and the premium scene

Type: task
Status: resolved
Blocked by: 07, 11

## Question

Build C5: replace grey boxes with the galleon (sails follow sail level, rudder and
cannons animate: recoil and run-out), sky shader with low sunset sun, fog, ACES tone
mapping, bloom, premium ocean (fresnel, glint, crest foam, hull foam and wakes), render
resolution cap. Spec: Client, C5 row.

## Done when

- `bun run shot` next to ref-01 reads as the same kind of scene.
- 12 ships at ≥ 120 fps measured in Chromium; never below 60.


## Answer

Resolved. The galleon replaces the boxes; the scene is `RenderPipeline` + `sky.ts` + `ocean.ts` + `wake.ts`.

- **Ships**: `loadGalleon()` (galleon.ts) generates once at load (~175 ms, before play), splits the placements into still hull, moving parts (24 cannons, yards) and a brick rudder. Geometry is shared. 12 `ShipView`s are pre-built into a pool and shaders are compiled at load, so there is no first-frame hitch. The hull matches the sim box (28 m, 8 m beam, −2…+5 m); cannons sit at `gunLayout` x/z, with the muzzle at `model.guns[i].muzzle` (1.2 m outboard).
- **Animation**: moving parts use a per-ship vertex shader. Cannons recoil 0.72 m in 0.09 s and run out between 2.8 and 4.6 s, per gun, on `cannonFired`. Yards brace to 0.5 × the apparent-wind angle (±0.65 rad), and the sails and lift lines follow via `rig.setBrace`. The rudder turns; sails use `rig.setSailLevel`.
- **Scene**: three `Sky` with a 5° sunset sun, captured once to a cube that feeds the sea reflection, the PMREM environment and the fog colour. ACES tone mapping. Bloom (0.28/0.45, threshold 2.0) on lanterns, flashes and glint. The ocean has fresnel, glint, crest foam and 4 muzzle-flash lights. `WakeField` is a 2048² ping-pong foam texture (1024 m wrapped): hull band, bow wave, stern wash, with the foam fading over 6 s.
- **Post chain, chosen by measurement**: the scene renders to MSAA4 half-float with a depth texture. Smoke and spray render at half resolution with a hand-coded soft depth test, which removes the hard line against hulls. Fire and sparks render at full resolution, then bloom, then OutputPass. No MSAA saves ~2 ms but the look is worse. Bloom costs 0.8 ms and shadows 0.3 ms. URL flags `msaa=`, `bloom=0`, `shadows=0`.
- **Perf**: Chromium at 2592×1675, DPR 1.5, `armada` scenario (12 ships, bots), c5:
  - Pipelined: median 5.26 ms, slowest run 5.62 ms (~178 fps).
  - Each frame waited on alone: median 9.0 ms, worst 12.0 ms (never below 60 fps).
  - c2 inside the smoke bank: GPU 9.7 ms, down from 11.9 ms at full resolution.
- **Fixed from 11**: the jib head's zero tangent gave NaN normals, which bloom spread into black rectangles.
- **For later tickets**:
  - 14: `ShipView.removePart(part)` via `galleon.slots`. Views are pooled and reused, so damage must be restored, or the view rebuilt, on return.
  - 15: `effects.flashLights`; soft particles (`soft`, `softLift`); alpha layers are `particleLayer` (half resolution), additive ones `glowLayer`.
  - 17: muzzles are at `model.guns[i].muzzle`.
  - 18: livery through `view.rig.setLivery`.
- **Gaps**: the sky near the sun is creamy white and the clouds are faint; ropes other than the lifts do not follow the brace; the lab still uses its own `sky.ts`.
