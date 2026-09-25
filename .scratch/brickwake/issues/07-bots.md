# Bots

Type: task
Status: resolved
Blocked by: 06

## Question

Build C4: pure `decideBotControls(state, shipId)` using the shared aim solve, bots
fill rooms to 6 ships and leave as humans join. Bots sail with the wind, seek a
broadside position, lead the target and fire in arc and range. Simple, but they must
look like competent captains, not spinning boxes. Spec: Simulation (bots), Room row.

## Done when

- Headless bots-only match finishes with a winner in seconds (`bun test`).
- Replay from seed and input log reproduces the match exactly.


## Answer

Built C4 (`bun test src` 91 pass: 3 new bot tests, server tests updated for bots; typecheck green; `bun run shot c4` passes).
- Sim: `src/sim/bots.ts` `decideBotControls(state, shipId) → BotDecision {controls, order, target}` (pure) and `drawBotSkill`. `MatchState` gains
  `bots: Bot[] {id, skill, target}` and `botsJoined`; `stepMatch` runs every bot's decision first and merges it into inputs/orders, so a replay
  needs only the seed and the human input log. `balanceBots(state)` (`match.ts`) adds `bot-N` ships to `tuning.bots.fillTo` (6) with skill drawn
  from the match RNG, or removes bots (foundered first, then newest) while ships > 6. `removeShip` clears the bot and any bot targeting it.
- Captaincy: target = nearest afloat enemy + 120 m per other bot already on it − 80 m for the current one. Helm scores 95 signed turns (±352°,
  7.5° steps) by where the ship is 10 s after completing the turn (arc at ~10°/s, then straight at `sailTargetSpeed`): standoff range, target
  abeam now and then, sail speed, edge, clearance 80 m at 2/5/10 s. Never points within 55° of the wind and never tacks (the physics stalls a
  tacking ship: rudder force needs water speed), it wears round; a reversal cost stops dithering; rudder flips when making sternway. Always full
  sail. Fires only in `playing`, within its `fireRange`, target on the bearing side: lead = shared `aimGun` flightTime + mean ripple, iterated 3×,
  aim y = 1 m, then a per-broadside disc error (`aimError`·range, match RNG ^ id hash); order only if `broadsideRefusal` passes.
- Skill per bot (uniform): standoff 110–170 m, fireRange 180–260 m, lead 0.85–1.05, aimError 0.04–0.10. All knobs in `tuning.bots`.
- Server: quick-play rooms call `balanceBots` after each join/leave (scenario rooms get none) and announce bots with `shipJoined`/`shipLeft`;
  quick play picks a room by human count. Client: `shipName` names `bot-N` from the end of the name list (no wire change; `bot-` prefix = bot).
- Measured (open sea, gusts, 6 bots, full FFA rules, seeds 1–4): 447–480 s of play (mostly the 8-min limit; winner every time), 5.6–6.2 s wall
  (~0.4 ms/tick with bot decisions); ~2 broadsides/min per bot; hit rate 65–72 %; 0 % of afloat time within 45° of the wind; max radius 456–502 m;
  closest centres 15–28 m (rare touches); 33–43 sinks per match. Test match (seed 7, first to 3): 133 s of play in 1.7 s.
  `aimError` 0.12–0.20 drops hit rate to ~52 %; range error barely matters (shallow arcs through a 7 m-high box), lateral error does.
- `bun run shot c4`: human joins quick play, 5 bots, warmup→play, 3+ bots fire, 31 bot hits seen in ~30 s, bots moved 229–427 m.
  Shots: `.shots/c4-{join,fight-1..3,scoreboard}.png`.
- For 19: bots are deadly at 150 m (a 12-gun broadside at 70 % ≈ 42 HP); tune `tuning.bots.skill.aimError` and fire cadence there. Bots only
  engage ~45 % of the time abeam within 100–240 m; weights in `tuning.bots.weights`. Bots fight each other as readily as the human.
- Known gaps: bots never shorten sail; they hold fire in warmup; no memory of who shot them; slight downwind bias (`downwindMargin` 250 m).
