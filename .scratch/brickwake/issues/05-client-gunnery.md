# Client: firing, ball arcs and first-pass effects

Type: task
Status: open
Blocked by: 03, 04

## Question

Wire C2 end to end: `fireBroadside` message and fire/hit/splash events, event queue
applied at render tick, reticle that is the landing point with reload and can't-fire
reasons, local fuse sizzle on click, rendered balls from `ballPositionAt`, first-pass
muzzle flash with light, lingering wind-drifted smoke, splash sized by impact, hit
chips, hit marker, camera shake by distance. Spec: Player experience, Gun effects.

## Done when

- Playwright aims at the target dummy, fires, and the debug hook shows HP lowered;
  screenshots of a broadside and of splashes saved.
- Firing feels weighty in the screenshots: flash, smoke and splashes are visible and
  sized for a heavy gun, not placeholder dots.

