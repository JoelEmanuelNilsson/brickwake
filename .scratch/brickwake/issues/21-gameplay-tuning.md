# Gameplay tuning and robustness

Type: task
Status: resolved
Blocked by: 15, 16, 17, 18, 20

## Question

Tune the game to feel premium and fair, and fix the known gameplay faults:
- Bots drift past the arena edge (~690 m with some seeds, edge push starts at 640 m);
  ticket 20 hid it by switching test seeds. Fix the cause, and test several seeds.
- Bots are too deadly (65–72 % hits at 150 m, ~42 HP per broadside): set skill so a
  competent human wins most duels while bots stay dangerous.
- Spread gives ±18 m in range at 220 m, so waterline aims fall short. Revisit it
  with the reticle-is-the-landing-point promise in mind.
- The head-sea slam at full speed (1.9 m off the surface): keep it realistic but
  not silly.
- Round pacing: hits to sink, reload, match length, respawn. Target: a full FFA round
  feels like a real engagement. Use headless bot matches as the tuning loop.
- Bandwidth (~92 KB/s per client at 12 ships): enable `perMessageDeflate` or justify
  not doing so.
- Flaky browser checks under load (c3/c4 wind-dependent, c7 blend timing): make them
  deterministic.
Spec: tuning table, Physics and feel, Player experience.

## Done when

- Bots stay inside the arena over ≥ 10 seeds (test); `bun test src` green.
- Tuning numbers and why are in the Answer; the spec's tuning table is updated to
  match.
- `bun run shot c1 c2 c3 c4 c7` pass twice in a row.

## Answer

Resolved. `bun test src`: 150 pass. Typecheck is clean. `bun run shot c1 c2 c3 c4 c7` passed twice in a row.
- **Arena drift, cause**: ships capsized and kept sailing upside down. A turn with full rudder, plus a list from flooding, plus a sea knocked them past about 60°. `shipAttitude` cannot tell a ship that is upside down, so bots went on steering them with no control. On the old code, 3 of 3 seeds had a capsized ship for 5–13 % of afloat time, and that is how ships reached 689 m. Fixes:
  - Sail drive and heeling force scale with cos²(heel), so a ship knocked down spills its wind.
  - A ship whose up vector passes `tuning.sinking.capsizeHeel` (75°) founders: `shipSunk` with `by: undefined`.
  - The arena edge is now an inward current (`tuning.arena.currentAtRadius`, 2× full-sail speed at 700 m) instead of a push force. The old force pinned a ship heading out at 0 m/s with no water past the rudder.
  - Bots commit to a turn they have chosen (`commitTurn` 60°, `Bot.turn`), and when within 20° of dead upwind (`headToWind`) they may bear away to either side. Before, they dithered dead downwind or dead upwind.
  - Test `bots stay inside the arena and upright` runs 10 seeds with 10 different winds for 180 s each. It fails on the old code and passes now: max radius 456–525 m over 12 full matches (was 572–693 m).
- **Bots**: `aimError` raised from 0.04–0.10 to 0.10–0.20.
  - Duels (`.scratch/brickwake/duel-21.ts`, 40 seeds): a careful human proxy (aim error 0.06, exact lead) wins 33/40 duels, hitting 53 % to the bot's 40 %. An average proxy (0.10) wins 26/40. Median duel is 70–90 s (was about 55 s, with both sides hitting 60 %).
  - FFA melee hit rate is 45 % (was 60 %).
- **Spread**: an ellipse of ±1° traverse and ±0.25° elevation (was a 1° cone). At 224 m the landing patch is ±4.2 m along and ±2.6 m across (was ±18 m along). A waterline aim now splashes at the waterline instead of up to 18 m short. The client's reticle ring reads `spread.traverse`.
- **Head-sea slam**: new `waveResistanceShare`: heave/pitch damping power is paid out of forward speed. `heaveDampingRatio` changed from 0.55 to 0.8 and `pitchDamping` from 4.5e7 to 7e7. Into the open-sea swell at full sail:
  - origin at most 1.81 m above the local surface (was 2.20)
  - pitch ±6.6° (was ±8.7°)
  - 0.46 g peak (was 0.64 g)
  - 10.4 m/s (was 11.7)

  In the head-sea scenario: 1.36 m (was 1.69) and 0.36 g (was 0.49). Calm-water targets are unchanged: 12.0 / 2.4 / 9.6 m/s.
- **Pacing** (12 seeded 6-bot FFA matches, `.scratch/brickwake/probe-21.ts`): 2.5 sinks/min (was 2.9), 28 hits per sink, and the top captain gets 4–8 sinks in 8 min. From this, FFA is now first to 8 (was 10) and TDM first to 15 (was 20). Reload 6 s, respawn 4+5 s, damage 5/2/1 and 100 HP are unchanged. About 22 hits sink a ship.
- **Bandwidth**: `perMessageDeflate: true` (`server.ts`). 12 ships drop from 116 to 45 KB/s per client, at 25 µs per snapshot. The server test asserts the extension is negotiated.
- **Browser checks made deterministic**:
  - c1 leaked its quick-play page, so c3 joined a room already in play. c1 now closes its pages.
  - The shot server seeds quick play: `Server.layer({ quickPlaySeed })` → `Rooms.layerSeeded`.
  - c4 waits for the bots to have moved, not for a fixed time.
  - c7 samples the blend in the page on every frame until it reaches 1 (monotone, ≥3 intermediate frames), and waits for blend 0 or 1 rather than sleeping.
- Spec tuning table updated: spread, capsizing, FFA/TDM limits, arena current, bot aim, sea-keeping, snapshots, damage.
- **For 19**:
  - The reticle ray only meets the sea (`client/game/gunnery.ts #pickAim`). Picking the first enemy hull would let you aim at a hull.
  - A capsize founder credits no one. Bots never shorten sail.
  - `bots.test` "headless" now plays to 5 sinks.
