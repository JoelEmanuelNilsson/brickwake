# TDM, team sails and menus

Type: task
Status: resolved
Blocked by: 13

## Question

Build C8: TDM (Pirates vs Navy), team sails and flags, quick play menu with mode
choice (one click to sail), results screen. Spec: C8 row, tuning table.

## Done when

- TDM win test passes; menu and results screenshots saved.


## Answer

Built C8. `bun test src` passes 130 (4 new in `src/sim/tdm.test.ts`), typecheck is green, and `bun run shot c8` passes. c1–c4 pass: c3 and c4 each failed once in a combined run and passed alone. c4's "bots sail about" check depends on the random wind.
- **Sim**: `ShipState` gains `team: Team | undefined` (`"pirates" | "navy"`, undefined in FFA) plus `shots`, `hits` and `damage`. Stats reset with kills/deaths; `hits` counts only balls that took HP.
- **`rules.ts`**: new `tdmRules` (`tuning.match.tdm`: 20 sinks / 10 min / 10 s warmup / 15 s results), `teamFor`, `allies`, `TeamSinks`, and `MatchWinner` `{_tag:"team"}`. `scoreSink`, `scoreLimitReached` and `winnerOf` now take a `MatchScore {ships, teamSinks}`.
- **Team score**: `MatchState.teamSinks` holds each side's score, so a side keeps its sinks when a ship leaves.
- **Friendly fire**: an ally's ball strikes the hull for 0 damage, and an ally's sink credits nobody.
- **Joining**: `joiningTeam(state)` puts a joiner on the smaller side. On a tie it picks the side with fewer humans, because that side's bots make room for the next human. `balanceBots` removes bots from the larger side first. Each side spawns on its own half of the ring, and `respawn` keeps the team.
- **Bots**: `chooseTarget` skips allies. Headless 6-bot TDM match (seed 7, first to 12): 485 s of play in ~5.9 s, pirates won 12–9, no bot ever targeted an ally, and no friendly hit did damage.
- **Wire**:
  - `join.mode` and `rules.mode` accept `"ffa" | "tdm"`.
  - Snapshot ships carry `shots`, `hits`, `damage` and `team` (null in FFA), about +48 B/ship.
  - `welcome` and `snapshot` carry `teamSinks`.
  - `MatchWinnerSchema` has a `team` case.
  - Rooms: quick play keeps separate rooms per mode.
  - New scenario `skirmish`: TDM to 1 sink; player (pirates) plus a navy `dummy` at 15 HP 150 m to starboard, and 2 bots per side.
- **Title screen** (`index.html` `#overlay`, `Game.#chooseMode`):
  - Layout: gold BRICKWAKE crest and title over the live scene, then "Free for all" and "Pirates vs Navy" cards (limits filled in from the rules), then a key-cap controls strip.
  - The page joins the remembered mode at load (`localStorage["brickwake.mode"]`, `?mode=`; default FFA). Clicking a card switches rooms (`leave` + `join`) and sets sail in one click. A click anywhere else sails in the current mode.
  - The screen's centre is empty background by design (1fr/1fr grid), so the existing centre-click Playwright checks still land on "set sail". Scenario pages hide the cards.
- **HUD** (`match-hud.ts`):
  - TDM side scores sit under the clock, plus "You sail with the …" / "Pirates · n sinks · 2nd of 3".
  - Kill-feed names use team colours (`--pirates` #ef6a55, `--navy` #7fa9ff).
  - Tab scoreboard and results columns: Sinks / Sunk / Hits / Aim % / Damage. TDM groups rows under side headers and shows a big side score. The verdict comes from the own side.
  - `shown()` adds `teams`, `scoreboard.title` and `scoreboard.foot`.
- **Liveries** (`names.ts` `shipLivery(id, team)`, applied in `game.ts` when a ship's team changes):
  - TDM: pirates fly the black skull; navy fly lion or fleur, split by id hash.
  - FFA: humans take `ffaColors` in join order and bots take them from the end; scenario ids fly the pirate black.
  - The fleur emblem is now gold.
  - Debug hook: `DebugShip.team`, `DebugShip.livery`, stats, `match().teamSinks` and `paintOwn(livery)`.
- **Sail fix from 13**: sails and flags now use `MeshLambertMaterial`, and the pirate cloth is `#111112`. Measured on the c5 ref-01 frame (median sRGB): near mizzen went from (27,13,6) to (12,3,1); far sails toward the sun went from (111,68,38) to (58,32,13).
  - The old tan was the GGX glossy lobe, not the cloth colour: a pure-black Standard sail still gave (109,67,37).
  - (55,31,11) is haze and bloom: a pure-black Lambert sail reads that value there.
  - The white sails lose the 0.4 env diffuse.
- **Shots**: `.shots/c8-{menu,tdm-hud,tdm-scoreboard,sails-{pirate,navy-lion,navy-fleur}{,-bow},results}.png`.
- **For 19**:
  - The controls strip omits the right-mouse gunport view (17). Add `<kbd>Right</kbd> gunport view` once merged.
  - Menu settings and pause belong to 19.
  - A TDM human who leaves mid-match with no bots left can unbalance the sides; there is no auto-switch.
  - From the ref-01 camera the mizzen still hides the main-course skull; the jolly roger shows it.
- **For merges with 14**: the `ballHit` branch in `stepMatch` now computes `friendly` (0 damage between allies) and credits the shooter's `hits`/`damage` from `target.hp - hp`. Keep both when damage per hit changes.
