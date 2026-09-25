# Match rules, sinking and HUD

Type: task
Status: resolved
Blocked by: 05

## Question

Build C3: physical sinking (buoyancy fades, settles by bow or stern), respawn,
ship–ship collision push-apart, FFA scoring, match lifecycle (warmup → playing →
ended → restart), full HUD (hull, per-side reload, timer, kill feed, scoreboard on Tab,
respawn countdown, results), hit-direction indicator. Spec: Core loop, HUD, C3 row.

## Done when

- Sim tests for sinking, respawn, collision, scoring and lifecycle.
- Two Playwright browsers: A sinks B; a short-timer match ends and restarts.

## Answer

Built C3 (`bun test src` 88 pass: 8 lifecycle + 2 collision + 1 server; typecheck green; `bun run shot c3` passes; c1, c2 still pass).
- Sim: `rules.ts` (`MatchRules`, `ffaRules`, `MatchPhase` warmup→playing→ended→warmup, `MatchWinner`, `scoreSink`/`scoreLimitReached`/`winnerOf`/`standings`
  switch on `rules.mode`: TDM adds a mode case + a team winner, not a new lifecycle). `MatchState` gains `rules`, `phase`; `createMatch({rules?})`.
  `ShipState` gains `life` (`afloat` | `sinking{since, floodEnd ±1}` | `sunk{respawnAt}`), `spawn` (+1 per respawn/restart), `kills`, `deaths`.
  `collision.ts` `collideShips`: keel capsules (±10 m, r 4 m), overlap split evenly + restitution-0.2 impulse at the contact (swings hulls). No ram damage.
- Sinking is physics: `buoyancyKept(life, x, t)` fades each column from the struck end (killing ball's `localPoint.x`) over 0.8 s, far end 2 s later; flooded
  columns lose surface damping; `tuning.sinking.drag` (1e5 N/(m/s)²) caps the plunge ~5.4 m/s. Calm water: 28–32° by bow/stern at 4 s, origin −10 m, every hull
  corner under by 4.5 s. Sinking ships take no input/orders, controls zeroed, hull still stops balls for 0 damage; sunk ships keep falling (not collided/hit).
- Order in `stepMatch`: inputs/orders (none while `ended`) → ripple → step all ships → collide → balls (sink on HP 0: `shipSunk{time, shipId, by}`, scores only in
  `playing`) → sinking→sunk at 4 s → respawn 5 s later on the ring (`shipRespawned`) → phase. Warmup→playing zeroes scores, repairs afloat ships. Ended→restart
  respawns everyone (scores 0, balls/pending cleared). FFA quick play: 10 s warmup, first to 10 or 8 min, 12 s results. Scenarios start in play (no warmup).
- Wire: welcome `rules`, `phase`; snapshot `phase` (`ended.winner` null = draw); ship `life`, `spawn`, `kills`, `deaths` (now 257 B/ship → 12 ships ≈ 92 KB/s;
  `perMessageDeflate` is the fix if it matters). `join {scenario, room?}`: same scenario + room name shares a private room, seats from `scenarioSeats(name)`.
  Scenario `duel`: `duel-a` at origin, `duel-b` 150 m to starboard at 15 HP, 30 s match, 6 s results.
- Client: `match-hud.ts` `MatchHud` (clock/phase/standing top centre, kill feed top right, Hull + Port/Stbd reload bottom right, centre banner for sinking/respawn
  countdown/"Clear for action"/"Battle begins", Tab scoreboard, results card Victory/Defeat/Draw with next-battle countdown); `hit-indicator.ts` (4 pooled red arcs,
  world-anchored, 1.8 s); `sinking.ts` `SinkingShips` (breach burst + shake on HP 0, deck smoke/embers/churn at 14 Hz, `Effects.plunge` when the deck goes
  under, hides the hull 1.5 s after sunk); `names.ts` `shipName(id)`. Timeline does not interpolate across a `spawn` change. Camera y clamps to ≥ 0 while own
  ship founders; reticle/fire off while not afloat or ended; `shipRespawned` resyncs own sail to 0. Debug hook: `DebugShip.life/kills/deaths/spawn`,
  `match()` → phase, rules, renderTime, `hud` text (clock, banner, scoreboard, feed). `?scenario=duel&room=<name>` in the browser.
- Measured: duel sunk in 1 broadside (3 hits), B settled 28–31° in Chromium; 0.034 ms/tick for 2 ships; c3 frame CPU 0.3 ms, GPU 1.1–1.3 ms at 1280×720.
  Shots: `.shots/c3-{hud,hit-direction,sinking-1..4,sinking-far,sunk-b,kill-feed,respawn-b,scoreboard,results-a,results-b,restart,warmup}.png`.
- For 07: bots feed `stepMatch` like players; skip non-`afloat` ships as targets and do not order while `phase._tag === "ended"`. For 16: hook `shipSunk`,
  `Effects.plunge` moment (in `SinkingShips`), `shipRespawned`, phase changes. For 18: add `mode: "tdm"` cases in `rules.ts`, a team on `ShipState`,
  `MatchRulesSchema.mode`/`MatchWinnerSchema` team member; `MatchHud` board title/verdict read `rules.mode`. For 13/15: `SinkingShips` drives visibility.
- Known gaps: no sound for sinking (16); one c1+c2 run lost its browser mid-run (shared cores); both pass alone. Hit marker still shows on a 0-damage hit.
