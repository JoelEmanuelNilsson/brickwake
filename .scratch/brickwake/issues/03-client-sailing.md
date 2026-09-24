# Client: sail a grey-box ship on the ocean

Type: task
Status: resolved
Blocked by: 02

## Question

Build C1's client: WebSocket client with schema decode, snapshot interpolation at
server time − 100 ms, Gerstner ocean mesh from the same wave parameters as
`sampleOcean`, grey-box ship sitting in the drawn water, smooth chase camera with
pointer lock orbit, W/S/A/D input, readable sailing HUD (sail, rudder, speed, wind),
`?scenario=` support, read-only `window` debug hook. No per-frame allocation.
Spec: Client, Player experience, Verification loop.

## Done when

- Playwright holds W/D and the debug hook shows the heading changing; screenshot saved.
- One click from page load to sailing.
- The ship visibly rides swells and rolls in a beam sea; camera does not inherit every
  roll. Frame time measured and reported.


## Answer

Built the C1 client in `src/client/game/` (`bun run shot` passes every check; `bun test src` 54 pass; typecheck green).
- Entry: `src/client/main.ts` → `Game` (`game.ts`): joins on load (`?scenario=<name>` → private scenario room, else quick play),
  title overlay; one click hides it, enables input and asks for pointer lock (headless refuses; sailing still works).
  `?orbit=<deg>` starts the camera that far off the stern, `?dpr=` caps render scale (default 1.5).
- `timeline.ts`: `SnapshotTimeline` (render clock = estimated server time − 100 ms; offset tracks the fastest-arriving snapshot,
  so jitter only adds buffer; clock eases, snaps past 250 ms; position lerp + short-arc nlerp into a reused `ShipPose`);
  `EventQueue` (events applied when the render tick reaches their tick). `connection.ts`: `/ws` + `ServerMessageJson` decode.
- `ocean.ts` `OceanSurface`: 321² camera-following grid (1 m spacing centre → ~60 m at 2 km, snapped by 1 m), GLSL port of
  `gerstnerPoint` with analytic normals; per-wave phase at the grid origin is computed in double on the CPU so float32 stays exact.
  Evaluated at the render clock's sim time, same as the ships. Fresnel sky reflection, sun glint, ripple normal map, crest foam, fog.
- `ship-view.ts` grey box lofted from `tuning.hull.stations`; sails scale with `sailSet` and brace to the wind; rudder follows `rudderAngle`.
  `chase-camera.ts`: world-fixed yaw orbit, world up (never rolls), tight horizontal follow, slow vertical follow (heave damped).
  `controls.ts`: W/S one level per press, A/D held → `setHelm`, blur centres the rudder. `hud.ts`: sail level + set meter, rudder needle,
  speed (kn), compass with ship and wind relative to the view, point of sail, wind speed; DOM writes only on change.
- Measured (`bun run shot`, Chromium, Metal ANGLE): beam sea heel range 21.8° over 6 s, camera roll 0.000°, ship origin within
  0.36 m of the drawn surface; W W + D held 5 s turns 41° at 9.4 m/s. Frame at 2592×1676 (Joel's display, DPR 1.5): GPU 4.5 ms,
  CPU 0.27 ms; at 1280×720 GPU 1.7–2.4 ms. Shots: `.shots/c1-{title,beam-sea,waterline,turning,open-sea}.png`.
- For 05+: `game.hooks.push((frame) => …)` runs each frame after ships are posed, before render; `frame` is one reused
  `FrameContext {dt, renderTime, renderTick}`. `game.eventHandlers.push((event) => …)` gets each `ServerEvent` at its tick.
  Debug hook `window.brickwake` (`BrickwakeDebug` in `debug-hook.ts`): getters `connection, joined, sailing, shipId, latestTick,
  renderTick`; `ships()`, `ownShip()` (position, heading/pitch/heel rad, speed, rudder, sail, rudderAngle, sailSet, waterHeight),
  `camera()` (position, yaw, pitch, distance, roll), `helm()`, `frames()` (cpu/gpu/interval ms), `events()`. Aim direction =
  `ChaseCamera.yaw + π`; reticle is screen centre. Render path: EffectComposer on a 4× MSAA half-float target + OutputPass (13 adds bloom).
- Known gaps: sky dome imported from `src/client/lab/sky.ts`; ocean colours copy its constants (13 replaces both). No hull/wake foam,
  no shadows (13). MSAA half-float at full res is about half the GPU frame; 13 should weigh it against bloom. No helm lag noticed
  in automated play; Joel's feel check at 150 ms (`NET_LATENCY_MS=75`) is still open.
