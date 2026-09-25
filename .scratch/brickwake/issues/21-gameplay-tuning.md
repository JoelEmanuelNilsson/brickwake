# Gameplay tuning and robustness

Type: task
Status: open
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
