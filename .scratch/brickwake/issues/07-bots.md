# Bots

Type: task
Status: open
Blocked by: 06

## Question

Build C4: pure `decideBotControls(state, shipId)` using the shared aim solve, bots
fill rooms to 6 ships and leave as humans join. Bots sail with the wind, seek a
broadside position, lead the target and fire in arc and range. Simple, but they must
look like competent captains, not spinning boxes. Spec: Simulation (bots), Room row.

## Done when

- Headless bots-only match finishes with a winner in seconds (`bun test`).
- Replay from seed and input log reproduces the match exactly.

