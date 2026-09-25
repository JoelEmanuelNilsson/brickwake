# Brickwake — game design and architecture

Working title. A browser multiplayer naval combat game in the spirit of Blackwake,
with brick-built (LEGO-style) ships. One human per ship. Modes: free-for-all
deathmatch (FFA) and team deathmatch (TDM). No characters walking on decks.

Visual target: `reference/ref-01.png` … `ref-05.png` — sunset, orange sky, dark teal
sea with white foam, black/red/gold brick pirate hull, black sail with white skull,
glowing lanterns, cannon flash and smoke, splashes. Navy ships: white/red sails with a
black lion, blue/white sails with a gold fleur-de-lis. Rock spires and a fortress in
the distance. `ref-04`/`ref-05` show the gun-deck view through a gunport.

## Decisions

- Goal: a really good game Joel plays for a long time. The quality bar is high. The
  focus is player experience, how the ships are built in Lego, and damage that feels
  right. Other players come later, when relevant.
- Target: Chrome on Joel's M4 Pro MacBook Pro (3456×2234, 120 Hz). Aim for 120 fps
  with 12 ships, never below 60, with render resolution capped below DPR 2 (12 ships
  with shadows measured 9.3 ms at DPR 2, over the 8.33 ms frame). Chrome because
  Playwright tests run Chromium (we test what Joel plays) and Chrome renders at
  120 Hz.
- Local first. Hosting (Bun) is not planned yet.
- Bots stay simple: they sail, can be shot, and shoot back with lead. No tactics.
- Firing: one click fires the whole broadside on the facing side.
- Damage: single hull HP, but the sim records which bricks each ship has lost, so
  holes and flooding can be added later without a redesign.
- One of each (Joel, 2026-09-24): one ship class, one cannon type, one ammunition
  type, one map. Variety that costs little stays: sail and flag colours per player
  or team (FFA colours; Pirates vs Navy in TDM) are textures on the same ship.
  Anything else is built once and built well. More ship classes, cannon types and
  ammunition are "Later", and a new class is new `ShipSpec` values, not new code.
- Ships are candidate C (decided 2026-09-24 from the two research reports; see Brick
  ships): our own ~50 part shapes keyed by LDraw ID, generated from a TypeScript
  `ShipSpec`, rendered as `InstancedMesh` per part shape per ship.
- Gameplay is built on grey-box ships while the Lego ship is built in parallel in a
  ship lab; they merge at C5.
- Premium, not simplistic (Joel, 2026-09-25): an ultimate Lego pirate ship game with a
  realistic feel. Every behaviour, effect and the ship's look is held to that bar. The
  ship is a good pirate galleon in the design language of the refs (not a pixel copy)
  with at least two gun decks. The agents decide damage per hit and all tuning; Joel
  plays and judges once everything works, so no checkpoint waits on him.
- Where the effort goes (Joel, 2026-09-24): physics first. High quality in: ship
  physics on waves and wind, the waves themselves, steering, firing and animation,
  gun effects, explosions and destruction, brick logic (what connects, what falls),
  and a sophisticated, well-thought-out Lego ship. Cheap on purpose: the map. It is
  open ocean in a circular arena with sky and fog; no islands, rocks or fortress
  until later.

## Physics and feel

The ship is a rigid body in the authoritative sim, not a scripted mover. What the
player feels comes out of forces, so speed, turning, heel and pitching agree with
each other and with what the player sees.

- Waves: a sum of a few Gerstner waves, one pure function
  `sampleOcean(x, z, t) → { height, normal, velocity }` shared by sim and client.
  The client's water mesh and the sim's buoyancy and splashes use the same function,
  so a ship sits in the water it is drawn in and a ball splashes where the drawn
  surface is. Swell sized for the refs (heavy seas), set by feel, not capped at 1 m.
- Buoyancy: a fixed set of sample points along the hull. Each submerged point pushes
  up by its depth and damps by its vertical velocity relative to the water. Heave,
  pitch and roll follow from the waves; a ship rides over swells and rolls in a beam
  sea.
- Wind: one match wind (direction, strength, slow gusts from the seeded RNG). Sail
  force depends on the sail level and the angle to the wind (points of sail). Force
  at the sail's height heels the ship to leeward.
- Hull: a keel resists sideways motion far more than forward motion, which turns
  sail force into forward drive with some leeway. Drag rises with speed.
- Rudder: force proportional to water speed past it, so a stopped ship barely turns
  and a fast one carves. Turning heels the ship.
- Firing: each gun's recoil pushes the ship; a full broadside rocks it.
- Damage: brick loss changes nothing physical at first (single HP). Later, holes
  below the waterline can remove buoyancy for listing and flooding; the removed-brick
  set is already in sim state for this.
- Sinking is physical: buoyancy fades, the ship settles by the bow or stern and goes
  under.
- Determinism: fixed 30 Hz sim step (substeps if the buoyancy needs them), no
  engine, plain TypeScript, so replay from seed and inputs still holds. A rigid-body
  engine is not needed for ~12 ships with box collisions.
- Cosmetic physics runs on the client only and never feeds back into gameplay:
  brick debris and detached chunks tumble, splash, float briefly and sink; sail
  cloth and flags move with wind; smoke drifts with wind. Whether debris uses Rapier
  or a small custom solver is decided at S3 by how it looks and what it costs.
- Camera and animation: the chase camera follows smoothly without inheriting every
  roll; cannons recoil and run out; rudder and sails animate to their state; hits
  shake the camera by distance.
- Gun effects: muzzle flash with light, smoke that lingers and drifts, a visible
  ball, splash sized by impact, brick bursts and splinters on hits, and a large
  sinking sequence. Quality bar: ref-01 and ref-05.

## Player experience

UX is part of every checkpoint's check, not a final pass.

- One click from page load to sailing in a match with bots.
- Every action has feedback: firing (flash, smoke, recoil, boom, camera shake),
  hitting (hit marker, crack, debris), missing (a visible splash at range), getting
  hit (direction indicator, sound).
- The reticle is the landing point: the ball lands where you aim, so leading the
  target is the skill. Reload and can't-fire reasons (reloading, out of arc, out of
  range) show at the reticle.
- Ship state is readable at a glance: sail level, rudder, speed, wind, hull.
- No frame hitches: no per-frame allocation, assets loaded before play.
- Settings persist: mouse sensitivity, volume, graphics quality. Esc pauses to a menu.

## Damage (principles; amounts are tuned in the ship lab)

- A hit breaks a small, bounded amount at the impact point, never a crater. Repeated
  hits in one place open a hole. The ship stays recognizable until it sinks.
- Where the ball lands matters: hull hits cost HP and knock off bricks; rails and
  upper works lose bricks for little HP; sail hits punch holes in the cloth.
- HP decides gameplay; brick loss is the visible record of it. Tuning keeps them in
  agreement: a ship at 20 % HP looks badly holed.

## Core loop

Sail with the wind, line up a broadside, lead the target, fire, reload, repeat.
Sink ships to score. Sunk ships respawn.

## Controls

- `W` / `S`: raise / lower sail one level. Levels: 0 furled, 1 half, 2 full.
- `A` / `D` (held): turn rudder; released, it returns to center.
- Mouse (pointer lock): orbit camera = aim direction.
- Left click: fire the broadside on the side the camera faces, at the point on the sea
  under the reticle, if that side is loaded and the point is inside the traverse arc
  and range.
- Right mouse (held): gunport aim view — camera at the gunport on the facing side,
  zoomed, cannon barrel in frame (like `ref-04`/`ref-05`).
- `Tab`: scoreboard.
- `Esc`: pause menu (this view only; the server match goes on) with settings.

## Starting tuning numbers (all tunable constants in one module)

| Thing | Value |
|---|---|
| Ship hull (hit box) | 28 m long, 8 m beam, −2 m to +5 m about waterline |
| Max speed (full sail, beam reach) | 12 m/s; half sail 60 % (a target the force model is tuned to reach) |
| Wind factor by angle to wind | ~0.2 within 45° of upwind, 1.0 beam reach, 0.8 running (target) |
| Speed response | from rest, full sail reaches ~80 % of cruise speed in ~3 s on any point of sail off the wind; furled, it coasts down over seconds |
| Turn rate | ~12°/s at full rudder and full speed (target); comes from rudder force |
| Guns | two gun decks × 6 per side (lower ports ~1.3 m, upper ~3.3 m above waterline), ripple broadside 50 ms apart; positions live in one gun-layout module the ship spec may move |
| Reload | 6 s per side |
| Muzzle speed / gravity | 90 m/s / 9.81 m/s² |
| Elevation / traverse | −4° … +12° / ±25° from perpendicular |
| Per-gun spread | ±1° traverse, ±0.25° elevation, from the match's seeded RNG: a round patch about the reticle (±4 m across, ±6 m along at 220 m) |
| Damage | per ball: hull 5, upper works 2, sails 1; hull 100 HP (~22 hits to sink, ~28 in a melee) |
| Sinking / respawn | 4 s sinking (not hittable, no control), respawn 5 s later; a ship heeled or pitched past 75° capsizes and founders, credited to the last enemy that took its HP within 20 s |
| FFA | first to 8 sinks or 8 min (6 bots: 2.5 sinks/min, top captain 4–8) |
| TDM | Pirates vs Navy, first to 15 sinks or 10 min; a ship respawning on a side two ships larger crosses over |
| Room | 12 ships max; bots fill up to 6 ships and leave as humans join |
| Bot aim | per-broadside aim error 10–20 % of range: bots hit ~40 %, a careful human (~55 %) wins ~80 % of duels, a median duel lasts ~70 s |
| Sea-keeping | sails lose force as cos²(heel); heave/pitch damping pays for itself in forward speed (added resistance in waves): into the open-sea swell at full sail 10.4 m/s, pitch ±6.6°, 0.46 g peak |
| Snapshots | JSON with per-message deflate: 12 ships ≈ 45 KB/s per client (116 KB/s raw) |
| Arena | circle, radius 700 m; from 640 m an inward current, 2× full-sail speed at 700 m, carries ships back while their rudders keep water past them |

## Architecture

TypeScript everywhere, one package, Bun as runtime / test runner / package manager.

```
src/sim/      pure, deterministic game simulation — no I/O, no Date.now, no Math.random
src/protocol/ Effect Schema message definitions shared by client and server
src/server/   Bun + Effect v4: WebSocket rooms, 30 Hz tick loop, bots
src/client/   Vite + Three.js: rendering, input, networking, HUD, audio
```

Import rules: `sim` imports nothing from the other three. `protocol` may import `sim`
types. `server` and `client` never import each other.

### Simulation (functional core)

`stepMatch(state, inputsByShip, dt) → { state, events }` owns everything that decides
outcomes: ship motion, wind, rudder and sails, firing, cannonball ballistics, hit
detection, damage, sinking, respawn, scoring, match lifecycle (warmup → playing →
ended → restart), bots joining and leaving. Randomness comes from a seeded RNG stored
in the state, so a match replays exactly from its seed and inputs.

Bots are a pure function `decideBotControls(state, shipId) → controls` fed into the
same `stepMatch`. They steer for a broadside position on the nearest enemy, lead the
target, and fire when it is inside the arc and in range.

Aiming is a world point, not camera angles: from a chase camera, camera pitch is not
gun elevation. The client sends the point on the sea under the reticle; the shared
pure aim solve computes each gun's elevation and traverse from the server's own gun
pose and clamps them. Bots and the gunport view use the same solve. This also avoids
the drift that ship-local aim picks up while the ship turns.

Ball flight is one closed-form `ballPositionAt(ball, t)` in the sim, used by the
server's hit sweep and the client's rendering, so impacts line up exactly.

Each ship carries its brick damage in sim state: the set of removed bricks, reset on
respawn and included in the join snapshot. Late joiners and reconnects therefore see
the same damaged ships. The brick grid later gives holes, flooding, and a hitbox
better than one box.

Ships collide with each other (pushed apart, no ram damage at first); bots chasing
the same target would otherwise overlap.

Ocean waves are the shared pure function `sampleOcean(x, z, t)` (see Physics and
feel). Gameplay depends on it: ships float on it, and a ball splashes where its path
crosses the wave surface. Because both sides evaluate the same function at the same
sim time, visuals and hits agree at any wave height.

Hit detection is swept: each tick, the ball's segment from previous to new position is
tested against every other ship's hull box in its full pose (position, heading, heel,
pitch), in ship-local space. A ball never
hits its own ship. The single box misses the castles fore and aft; the brick grid
replaces it once ships are brick-built.

### Networking

- Server is authoritative. Fixed 30 Hz tick. Full snapshot of ships to every client
  every tick, JSON over WebSocket, messages defined with Effect Schema and decoded at
  both edges (the server treats client messages as untrusted).
  Declared limit: 12 ships × ~120 B × 30 Hz ≈ 45 KB/s per client. Fine for this game;
  switch to binary only if measured bandwidth says so.
- Cannonballs are never streamed. The server emits `cannonFired` with each ball's
  origin, velocity and spawn tick; clients compute the arc themselves.
- Every server event carries its tick. The client queues events and applies each
  when its render clock reaches that tick, so impacts, damage and splashes line up with
  the interpolated ball and ship positions.
- Client → server: `setHelm { rudder: -1 | 0 | 1 }`, `setSail { level: 0 | 1 | 2 }`,
  `fireBroadside { side, aimPoint }` (a world point on the sea; the server solves and
  clamps elevation and traverse), plus join/leave.
- Client renders the whole world, own ship included, from interpolated snapshots at
  (estimated server time − 100 ms). No client-side prediction and no lag compensation.
  Why: ships turn slowly and balls fly 1–4 s, so ~150 ms of added delay moves a
  target ~2 m, far under a 28 m hull. The camera and aim are local and respond at once.
  The lag players will feel is on firing (click to ball ≈ RTT + 100 ms), so a fuse
  sizzle plays locally on click; the flash, boom and ball appear when the fire event
  renders. Add own-ship prediction only if play-testing shows helm lag.

### Server

Bun HTTP + WebSocket through Effect v4 (`effect@4.0.0-rc.115`,
`@effect/platform-bun@4.0.0-rc.115`, matching the vendored source at
`~/.agents/repos/effect`). A room owns one match state and runs the tick loop on a
fixed timestep with an accumulator. Quick play: join a room of the chosen mode with
space, or create one.

### Client

Vite dev server proxies `/ws` to the game server. Vite runs under Node, not Bun:
under Bun its `/ws` proxy never reaches the server (found at C0). Three.js `WebGLRenderer` (WebGL2).
Per-frame code (render loop, interpolation, particles) is plain TypeScript with no
per-frame allocation; Effect is used at the network edge (schema decode) only.

- Ocean: vertex-displaced Gerstner mesh following the camera, using the same wave
  parameters as `sampleOcean`, with a fresnel, sun glint, foam on crests, and foam
  around hulls and in wakes. Built in C1, because the ship's motion on waves is
  part of how sailing feels.
- Sky: three's `Sky` shader with a low sunset sun; fog; ACES filmic tone mapping;
  bloom (so lanterns, muzzle flashes and sun glint glow).
- Brick ships: see Brick ships below. Sails and flags use canvas-drawn pixel-art
  textures: skull, lion, fleur-de-lis, and per-player colors in FFA. Lanterns are
  emissive.
- Effects: muzzle flash, cannon smoke, water splashes, wood/brick debris, wake foam.
- Damage: the client renders each ship's removed-brick set from sim state, and plays
  debris and chips when a hit event renders.
- HUD: hull HP, sail level, speed, wind direction, per-side reload, match timer, kill
  feed, scoreboard, respawn countdown, end-of-match results.
- Audio: WebAudio-synthesized cannon boom, splash, hull crack, and ocean ambience,
  panned by position. No external asset files.

## Brick ships

Scale is minifig scale: 1 stud ≈ 0.4 m, so a 28 m hull is ~70 studs long, a real
brick-built galleon of roughly 3,000–6,000 parts. Every part is a discrete piece, so
damage can knock off real parts.

Decided: **candidate C**. Evidence: `docs/research/lego-rendering.md` (parts,
rendering, budget) and `docs/research/ship-generation.md` (generation, damage graph).

Rejected:
- **A (voxel bricks only):** becomes C as soon as it needs slopes, wedges and detail
  parts. Stepped walls are fine (the refs show them); pure boxes are not.
- **B (render real LDraw geometry):** studs and underside tubes are 90–95 % of LDraw
  triangles; 12 ships are 9.7–16M triangles with no bevels. three's `LDrawLoader`
  makes one Object3D per part and never instances, so it is a viewer, not a runtime
  path. Editing in BrickLink Studio doesn't matter since nobody edits by hand.

### Parts

- ~40 basic shapes (bricks, plates, tiles, slopes, inverted slopes, round parts,
  cannon, lantern, mast pieces) plus ~10 for the bow: wedge-plate pairs
  24299/24307, 43722a/43723a, 41769a/41770a, 51739 and curved slopes 11477, 50950,
  15068, 93273. The stern in ref-01 is flat and boxy, so it needs nothing special.
- Modelled by us at true LDraw dimensions with 45° chamfered edges, keyed by LDraw
  part ID. LDraw supplies IDs, dimensions and the `.ldr` export for viewing in
  LDView/Studio.
- The moulded hull pieces (2557/2559/2560) are rejected: 14–20k triangles each,
  sized for 16-stud hulls, and can't be chipped.
- No LEGO logo on studs (LEGO claims the stud logo as a trademark), even though
  ref-05 shows it. LDraw is CC BY: keep a per-author credits file for any LDraw data
  we ship.

### Generation

- Each class is a typed TypeScript `ShipSpec`: hull lines (length, beam, depth,
  half-breadth offsets or plan/sheer/section curves), colour strakes that follow the
  sheer (black bottom, dark-red wale, gold trim, black topsides), decks, castles, gun
  rows, masts and yards, sails, and ornaments (stern windows, lanterns, skull
  plaques, rail posts, cannons, gun-port frames) placed by anchor and mirrored.
- A deterministic pipeline turns the spec into parts: rasterize each plate course
  into a mirrored occupancy mask (2–3 stud shell, decks, ribs), carve gun ports and
  windows, finish stepped edges with slopes / inverted slopes and bow wedges, pack
  each course into bricks and plates with a running bond, place sub-assemblies, and
  validate (no overlaps, all parts connected to the keel, part count in range,
  worst-case detached parts per hit under the cap). Output: `parts[]` (`partId`,
  `color`, transform), connection `edges[]`, and an `.ldr` export.
- Code does hull, packing, bonding and validation. An agent tunes `ShipSpec` numbers
  and writes each sub-assembly once, iterating from ship-lab screenshots at fixed
  cameras matching ref-01 and ref-02, with a checklist per view plus numeric checks
  (silhouette ratios, part and gun counts, connectivity). Joel judges the result.

### Rendering

- One `InstancedMesh` per part shape per ship, per-instance colour. Removing a part
  moves the last instance into its slot: no rebuild, no hitch.
- Rejected: `BatchedMesh` (34.7 ms for 12 ships: ANGLE's Metal backend runs WebGL
  multi-draw as a loop of single draws) and merged per-ship meshes (8.1 ms, but a
  ~92 ms rebuild on every hit).
- Studs are a separate instanced shape: skipped when covered, hidden at distance,
  left out of the shadow pass.
- Budget per ship: ≤ 300k triangles, ≤ 45 draws per pass. Each draw costs ~3.75 µs,
  so the shape count stays near 50. Measured: 12 ships at 6.8 ms (DPR 2, post, no
  shadows).
- Sails, flags and rigging are cosmetic meshes, not damage-graph parts: < 20k
  triangles per ship. LDraw string, chain and rigging-ladder parts are far too heavy.

### Damage structure

- Connectivity graph: nodes are parts, edges are stud overlaps plus explicit
  sub-assembly edges, anchored at the keel. Built at load (~5 ms).
- A hit removes parts within an impact radius up to a max count, then one flood fill
  from the anchor; unreached parts fall as debris. Only removed part IDs go over the
  network; every client derives the detached set from the same graph.
- Masts and castles are sub-graphs joined by a few strong edges, so they fall only
  when their base is gone. The generator's bonding plus the cap bounds cascades, so
  HP and visible brick loss stay in agreement.

## Verification loop

Test tools, built in C0–C1 because every later check depends on them:

- Scenarios: named pure start states (`?scenario=broadside-duel`, etc.) usable from
  tests and from the browser.
- A read-only debug hook on `window` exposing the client's view of the match, so
  Playwright can assert on game state instead of pixels.
- A server flag that injects latency and jitter.
- Replay: a match re-runs exactly from its seed and input log.

Checks:

- `bun test`: sim unit tests (motion, ballistics, hits, scoring, respawn, match
  lifecycle), server tests over real WebSocket clients, and a headless bots-only match
  that must finish with a winner.
- `bun run typecheck`.
- `bun run shot`: Playwright (Chromium is installed) opens the game, joins a match with
  bots, and saves screenshots to `.shots/` for visual comparison with `reference/`.

## Checkpoints

Each checkpoint is proven before the next starts. Every checkpoint runs over the
real WebSocket path from C0 on.

| # | Builds | Works when |
|---|---|---|
| **Gameplay track (grey boxes)** | | |
| C0 | Project setup only, no game code: pinned deps, folders and import rules, one `bun dev` (Bun server + Vite with `/ws` proxy), test, typecheck and shot scripts | Typecheck, a trivial test and a Playwright screenshot pass; `bun dev` starts and stops cleanly |
| C1 | Room and 30 Hz tick loop, Schema messages; waves in sim and Gerstner ocean on screen; ship physics (buoyancy, wind, keel, rudder, heel); snapshots, interpolation, chase camera, grey-box ship; scenarios, debug hook, latency flag | Sim tests: reaches target speeds by point of sail, turn rate, heel, floats stably in calm/beam/head-sea scenarios, boundary; Playwright holds W/D and the heading changes; Joel sails it and it feels right |
| C2 | Aim solve, broadside, reload, recoil, ball arcs, splashes on the wave surface, swept hits against the posed hull, HP; first-pass flash, smoke, splash, chips, boom; drifting target dummy | Landing point equals aim point; no tunneling; no self-hits; in Playwright a hit lowers HP |
| C3 | Sinking, respawn, ship–ship collision, FFA scoring, match lifecycle, HUD, kill feed | Two Playwright browsers: A sinks B; a short-timer match ends and restarts |
| C4 | Simple bots using the same aim solve | Headless bots-only match ends with a winner in seconds; Joel plays a full round |
| **Ship track (ship lab page, starts after C0)** | | |
| S1 | Ship lab page; the C part set (bow set included); one hull stretch with bow and stern generated from a `ShipSpec` | Screenshot next to ref-01 reads as Lego; 12 copies with ocean stand-in and shadows measured at DPR 1.5 within budget |
| S2 | Full galleon in the chosen way: hull, castles, masts, sails, cannons, lanterns | Joel approves the look; 12 copies at 120 fps |
| S3 | Damage in the lab: click to fire at the ship | Joel approves how much breaks per hit and how a sinking-level ship looks |
| **Merged** | | |
| C5 | S2 ships in the game; sky, fog, tone mapping, bloom | `bun run shot` next to ref-01; 12 ships at 120 fps, measured |
| C6 | S3 damage in the sim; brick debris physics, full gun effects and sinking sequence, WebAudio | A late joiner sees the same damage |
| C7 | Gunport aim view | Screenshot next to ref-04 |
| C8 | TDM, team sails, quick play menu, results screen | TDM win test |
| C9 | UX pass: first-run controls hint, settings, pause menu, tuning | Joel's play sessions |
| Later | Hosting, playing with friends, more ship classes, islands | When relevant |

Risk checks, where we learn early whether a bet holds: C0 (the stack), C1 (does
sailing feel right with 150 ms delay), C2 (is hitting fun), C4 (is a full round
fun), S1 (can the Lego ship look right), S3 (does damage feel right), C5 (does it
render fast enough).

Done: C0–C9 pass locally, Joel accepts the ref-01 and ref-04 screenshots, and Joel
enjoys playing it.

Known risks:

- The Lego ship has the most unknowns; S1 settles whether candidate C looks right by
  looking, not guessing. DPR 1.5 with shadows and the ocean is not yet measured;
  S1 measures it before S2 starts.
- Screenshot checks by a vision model are 64–68 % accurate; ship iteration needs
  numeric checks too, and Joel's look at S1 and S2.
- Ship physics on waves is the feel risk. Settle at C1 with Joel sailing it: a
  buoyancy model can jitter, feel floaty, or fight the steering. Scenarios for calm,
  beam sea and head sea make it testable.
- Effect v4 is a release candidate: pin exact versions. The vendored `BunHttpServer`
  supports WebSocket upgrades.
