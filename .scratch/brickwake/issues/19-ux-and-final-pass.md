# UX pass, tuning and final proof

Type: task
Status: resolved
Blocked by: 21, 22

## Question

Build C9: first-run controls hint, persisted settings (sensitivity, volume, graphics
quality) with sliders for sensitivity and the audio mix, Esc pause menu, the gunport
view in the menu's controls strip, TDM auto-balance when a human leaves with no bots
left, a performance audit at 12 ships. Then run
the full proof: all tests, typecheck, `bun run shot` set next to ref-01 and ref-04.

## Done when

- All checks green; a short play guide for Joel in the Answer (how to start, what to
  try, known gaps).

## Answer

Resolved. `bun run typecheck` is clean and `bun test` passes 158 of 158. Each `bun run shot` check was run on its own, and all pass: c1–c9 and fx, plus `shot:galleon`, `shot:damage` and `shot:audio`. The new check `bun run shot c9` covers settings, the first-run hint, pause and the hull reticle.
- **Settings** (`client/game/settings.ts`, `menus.ts`, markup in `index.html` `#settings`): mouse sensitivity 0.25–3×, volume, sea & wind, and graphics Low/Medium/High.
  - Stored in `localStorage["brickwake.settings"]` and parsed field by field with Schema, so one bad value keeps its default.
  - Every change applies at once, including the MSAA/shadow switch (`RenderPipeline.samples`). URL `dpr/msaa/bloom/shadows` still override for measurements.
  - Settings opens from the title screen (a link under the mode cards) and from the pause menu. GameAudio no longer stores the volume itself.
- **Esc pause** (`#pause`): Esc, or the browser taking back pointer lock, pauses this view.
  - Input stops, the rudder centres and the gunport view ends. Sound drops to 30 % (`audio.paused`).
  - The card says the battle goes on and the ship still holds course and can be hit. The server kept stepping: 36 ticks in 1.2 s while paused.
  - Buttons: Back to the helm, Settings, Choose battle (back to the title and its mode cards). Esc or a click on the backdrop resumes.
- **First-run hint** (`controls-hint.ts`, `#hint`): W raise sail → A/D steer → Click fire → Right gunport. One pill at a time above the HUD.
  - Each step fades 0.5 s after it is done. The fire step waits until a broadside can bear. The gunport step leaves after 9 s.
  - Quick play only, shown once (`brickwake.hints`), and hidden while paused.
- **Controls strip**: adds `Right` for the gunport view and `Esc` for pause and settings, on the title screen and in the pause menu.
- **Reticle on hulls** (`Game.#hullAlong` → `Gunnery.#pickAim`): the aim ray is tested against each other afloat ship's remaining parts (`ShipDamage.firstPartAlong`, the same test balls use). The nearer of hull and sea wins, and the spread ring hides on a hull.
  - The server already solved any world point. New sim test: a hull aim lands within 1 m in height.
  - In c9, aiming at 4.27 m on the hull gave 7 hits with a mean height of 4.12 m.
- **Capsize credit**: `ShipState.lastHitBy` is set by any ball that takes HP. A capsize within `tuning.sinking.capsizeCreditSeconds` (20 s) is that ship's sink.
- **TDM balance**: a ship that respawns on a side two or more ships larger crosses to the other side (`respawnTeam` in `match.ts`), with the banner "Sides evened · You now sail with the …". Bots still fill both sides first.
- **Fixed**: `audio.start()` had been commented out in `Game.#setSail` since ticket 16, so the game had no sound. It is live again, and c2's reload check still passes.
- **Performance at 12 ships**:
  - c5: pipelined 5.07 ms, slowest run 5.26 ms, waited-on worst 12.3 ms.
  - fx exchange: CPU p50 3.3 ms, p99 5.9 ms, 0 hitches. Debris peaks at 1021 bodies, 0.94 ms.
  - c7: 4.54 ms. Fleet of 12 in `shot:galleon`: 4.13 ms pipelined.
  - Server (`.scratch/brickwake/probe-19.ts`, armada, 120 s): median 1.0 ms/tick, p99 2–8 ms under shared-core load, against a 33 ms budget.

### Play guide for Joel
- **Start**: `bun install`, then `bun dev`, then open http://localhost:5173/. Click a card (Free for all, or Pirates vs Navy) or anywhere to set sail against 5 bots.
- **Controls**:
  - `W`/`S`: sail up/down
  - `A`/`D`: rudder
  - mouse: look and aim (the reticle is where the ball lands; lead moving ships)
  - click: fire the broadside facing the camera
  - hold right mouse: gunport view
  - wheel: zoom
  - `Tab`: scoreboard
  - `Esc`: pause and settings
- **Try first**:
  1. Raise full sail on a beam reach.
  2. Close to about 150 m and put the reticle on an enemy's hull at the waterline.
  3. Fire, then watch bricks fly and the hull hole.
  4. Try the gunport view for a long shot.
  5. Sink one, and watch its masts snap and the plunge.
  6. Then play a TDM round.
- **Settings**: Esc → Settings, or the link on the title screen. Drop to Medium or Low if frames stutter.
- **Known gaps**, worst first:
  1. The sound mix is set from measurements only; your ears should judge the levels.
  2. Chrome refuses to re-lock the mouse for about 1 s after Esc, so a fast "Back to the helm" needs one more click on the sea.
  3. There is no client-side prediction, and helm lag was not measured.
  4. While paused, your ship can still be sunk.
  5. Uneven TDM sides even out only when a ship on the larger side sinks.
  6. Bots never shorten sail, and they wear instead of tacking.
  7. Changing shadows on or off costs a one-time shader-compile hitch.
  8. The oblique ref-04 gunport angle was never built.
