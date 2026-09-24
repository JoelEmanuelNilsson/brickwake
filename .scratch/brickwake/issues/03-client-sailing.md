# Client: sail a grey-box ship on the ocean

Type: task
Status: open
Blocked by: 02

## Question

Build C1's client: WebSocket client with schema decode, snapshot interpolation at
server time − 100 ms, Gerstner ocean mesh from the same wave parameters as
`sampleOcean`, grey-box ship sitting in the drawn water, smooth chase camera with
pointer lock orbit, W/S/A/D input, readable sailing HUD (sail, rudder, speed, wind),
`?scenario=` support, read-only `window` debug hook. No per-frame allocation.
Spec: Client, Player experience, Verification loop.

## Done when

- Playwright holds W/D and the debug hook shows the heading changing; screenshot saved.
- One click from page load to sailing.
- The ship visibly rides swells and rolls in a beam sea; camera does not inherit every
  roll. Frame time measured and reported.

