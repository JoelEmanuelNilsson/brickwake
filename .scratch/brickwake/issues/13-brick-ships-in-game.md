# Brick ships in the game and the premium scene

Type: task
Status: open
Blocked by: 07, 11

## Question

Build C5: replace grey boxes with the galleon (sails follow sail level, rudder and
cannons animate: recoil and run-out), sky shader with low sunset sun, fog, ACES tone
mapping, bloom, premium ocean (fresnel, glint, crest foam, hull foam and wakes), render
resolution cap. Spec: Client, C5 row.

## Done when

- `bun run shot` next to ref-01 reads as the same kind of scene.
- 12 ships at ≥ 120 fps measured in Chromium; never below 60.

