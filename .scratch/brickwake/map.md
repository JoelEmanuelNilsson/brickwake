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
     and look at the screenshots yourself against `reference/`.
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

## Not yet specified

- Below-waterline holes and flooding driven by the removed-brick set: in scope only if
  14 shows it fits cheaply; otherwise it moves to Out of scope.
- Final tuning numbers (wind, damage, reload, bot accuracy) are settled by play in 19.

## Out of scope

- Hosting, playing with friends online, more ship classes, cannon or ammo types,
  islands and the fortress (spec: Later).
- Client-side prediction, unless 03 or 19 shows helm lag.
