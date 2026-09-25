# Brickwake — build map

Label: wayfinder:map

## Destination

Brickwake built end to end: checkpoints C1–C9 and S1–S3 of `docs/game-design.md` pass
locally, and the game is ready for Joel to play a full round and judge it.

## Notes

- Spec: `docs/game-design.md` is the source of truth for every decision. Tickets point
  at its sections; they do not restate them. Joel's 2026-09-25 ruling (Decisions) sets
  the bar: premium in behaviour, effects and look; two gun decks; agents decide tuning
  and damage per hit; nothing waits on Joel.
- Execution is carried into this map: each ticket is a `task` (AFK) that builds its
  part and proves it. One opus worker at medium reasoning per ticket; the worker does
  the whole ticket itself and starts no subagents.
- How a ticket is worked:
  1. Read this map, your ticket, the spec sections it names, and the Answers of the
     tickets it is blocked by. Read `~/.agents/skills/coding-standards/SKILL.md`
     before touching `.ts`; Effect v4 source is at `~/.agents/repos/effect`.
  2. Build it. Keep feedback loops tight: run the tests you touched, not the world.
     Run `bun install` first if `node_modules` is missing (worktrees).
  3. Prove every "Done when" line with a command or a saved screenshot in `.shots/`,
     and look at the screenshots yourself against `reference/`. Downscale before
     viewing (`sips -Z 1024 in.png --out /tmp/x.png`) and view ≤ 12 images per
     ticket: full-size screenshots overflow the context and kill the session.
  4. Set `Status: resolved`, append `## Answer` to the ticket: what was built, file
     entry points, measured numbers, facts later tickets need, known gaps (≤ 25 lines).
  5. Commit per `~/.agents/skills/commit/SKILL.md`.
- Two tracks run in parallel in git worktrees (gameplay 01–07, ship 08–12); the
  orchestrator merges and updates Decisions so far.

## Dependency graph

Gameplay track 01–07, ship track 08–12, merged 13–19.

```mermaid
flowchart LR
  01[01 sim physics] --> 02[02 server] --> 03[03 client sailing] --> 05[05 client gunnery]
  01 --> 04[04 sim gunnery] --> 05
  05 --> 06[06 match + HUD] --> 07[07 bots] --> 13
  06 --> 16[16 audio]
  08[08 lab + parts] --> 09[09 hull generator] --> 10[10 decks + guns] --> 11[11 rig + sails] --> 13[13 ships in game]
  10 --> 12[12 lab damage] --> 14
  13 --> 14[14 damage in sim] --> 15[15 destruction + effects]
  13 --> 17[17 gunport view]
  13 --> 18[18 TDM + menus]
  15 & 16 & 17 & 18 --> 19[19 UX + final]
```

## Decisions so far

- [Sim: ocean and ship physics](issues/01-sim-ocean-and-ship-physics.md) — force-based ship on `sampleOcean(sea,…)`; targets met (12 m/s beam reach, 12.3°/s turn, 8.3° heel); axes +x bow/+z starboard; fixed SIM_DT.
- [Ship lab and part library](issues/08-ship-lab-and-parts.md) — 51 LDraw-keyed chamfered shapes in `src/client/bricks/`, instanced per shape with swap-remove; 60 tris/brick means hulls must cull enclosed parts and covered studs.
- [Server: room, tick loop and protocol](issues/02-server-room-and-protocol.md) — `/ws` join→welcome(sea, wind, ships)→30 Hz snapshots with ticked events; scenario rooms for tests; NET_LATENCY_MS/NET_JITTER_MS; 181 B/ship.
- [Sim: gunnery and hits](issues/04-sim-gunnery.md) — `aimGun`/`broadsideRefusal` shared aim solve, drag 0.04/s, ~300 m max range, 1° cone spread (±18 m in range at 220 m — revisit in 19), fire/hit/splash events on the wire.
- [Client: sail a grey-box ship on the ocean](issues/03-client-sailing.md) — `src/client/game/`; render hooks + tick-queued event handlers; `window.brickwake` debug hook; 4.5 ms GPU at DPR-capped 1.5; MSAA half-float is half the GPU cost.
- [Hull generator from ShipSpec](issues/09-hull-generator.md) — pure `src/sim/ship/` generator (3,665 parts, ~110 ms); hull alone renders 286.9k tris, 12 hulls 6.0–10.4 ms at DPR 1.5 — full ship needs distance LOD to fit budget; gun ports 2.8 m on stud grid.
- [Client: firing, ball arcs and first-pass effects](issues/05-client-gunnery.md) — reticle on the sampled sea, tick-synced balls, pooled `game.effects` (flash, smoke, splash, chips); 4–9/12 hits at 150 m; debug hook `fireAt`/`orbit`.
- [Match rules, sinking and HUD](issues/06-match-rules-and-hud.md) — `rules.ts` mode switches (TDM = new cases), ship `life`/`spawn`/kills on the wire, physical stern-first sinking, pirate HUD + hit indicator; `bun run shot c3` two-browser check; 257 B/ship.
- [Galleon: decks, castles and cannons](issues/10-galleon-hull-decks-guns.md) — 4,323 parts, 24 cannons on two decks; 3 LODs (near 236k tris/36 draws, mid 61k, far 40k); fleet of 12 at 7.2 ms median; revealed-on-hit parts need growable instance pools.
- [Audio](issues/16-audio.md) — `src/client/audio/`, sounds synthesized in a worker at load, positional with speed-of-sound delay, compressor+limiter; `/sound.html` test page; `game.audio.hullHit/sinking/plunge` for 15; mix table for 19.
- [Bots](issues/07-bots.md) — pure `src/sim/bots.ts`, 5 bots fill quick play; headless 8-min match in ~6 s with a winner; bots hit 65–72 % at 150 m (too deadly — tune `tuning.bots.skill.aimError` in 19); they wear rather than tack.
- [Galleon: masts, sails and rigging](issues/11-galleon-rig-and-sails.md) — three brick masts + cosmetic `ShipRig` (shader billow, furl 0/1/2, liveries); near 269k tris/40 draws; fleet 7.8 ms median; yards don't brace to the wind yet.

## Not yet specified

- Below-waterline holes and flooding driven by the removed-brick set: in scope only if
  14 shows it fits cheaply; otherwise it moves to Out of scope.
- Final tuning numbers (wind, damage, reload, bot accuracy) are settled by play in 19.

## Out of scope

- Hosting, playing with friends online, more ship classes, cannon or ammo types,
  islands and the fortress (spec: Later).
- Client-side prediction, unless 03 or 19 shows helm lag.
