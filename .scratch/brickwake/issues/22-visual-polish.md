# Visual polish

Type: task
Status: resolved
Blocked by: 15, 16, 17, 18, 20

## Question

Close the visual gaps later tickets left:
- White splash and spray are too bright.
- The sky near the sun is creamy white and the clouds are faint (ref-01 has an orange
  sky with a strong low sun).
- In the low sun, the gunport openings glow as bright slots along the hull.
- Inside the gun deck, the frame floods orange with bloom right after firing (c7).
- The pooled `ShipView` reuse gives debris the wrong deck. Sail holes: confirm they
  show, and keep a sail from vanishing when its yard falls.
- Small holes on the shadow side are hard to read against the sunset.
- Optional if budget allows: the gunport view looks along the deck at an angle like
  ref-04, with the aim ray separate from the camera's centre ray.
Spec: Client, Gun effects; reference ref-01, ref-04, ref-05.

## Done when

- `bun run shot c5 c7 fx` screenshots next to ref-01/ref-04/ref-05 fix each item; the
  Answer lists each item as fixed or deferred with a reason.
- Frame times at 12 ships unchanged or better (measured).

## Answer

Resolved. Proof: `bun run shot c5 c7 fx` passes; `.shots/c5-ref-01.png`, `c7-broadside.png` and `fx-broadside-3.png`/`fx-hit-1.png` were checked against ref-01/ref-04; `bun test src` has 148 passing; typecheck is clean.
- **Slots along the hull (fixed)**: the cause is sun specular, not interior lighting. Probes showed that roughness 0.7 or sun off removes them and fill off does not. At a 5° sun, glossy (0.3) 45° port-sill slopes and jambs mirror the sun at ~15 HDR, which is over the bloom threshold 2.0. `brick-ship-mesh.ts` caps `directSpecular` at 1.0 (`highlightCap`). Bright pixels in the c5 hull crop fell from 8,384 to 440, and the sheen stays.
- **Sky (fixed)**: `sky.ts` compresses the dome by luminance and grades it toward amber (the raw sky runs from 0.4 to over 16 HDR). Clouds get a warm key light of their own (three lit them with the view ray's extinction, so they took the colour of the sky behind them), with cloudScale 0.0004, coverage 0.62 and density 1.0. c5 sky sRGB: near sun 205/130/94 (was 255/255/252), above sun 168/114/84 (ref 161/102/79), far sky 120/71/51 (ref 133/84/67, was teal 90/107/91). The sun path on the sea stays gold.
- **Sea (fixed; the sky change caused it)**: once the sky was orange, the sea reflected it and went brown. `ocean.ts` cools reflections away from the sun's path. Open-sea sRGB is 24/35/39 (ref 38/51/62, dark teal).
- **Orange flood at the port (fixed)**: the muzzle-flash point lights at this ship's own muzzles have no shadows, so they lit the deck, the ceiling and the jambs through the solid hull. `GunDeckLanterns.dimFlashes` now turns off flash lights within 14 m of the eye and fades them back in by 20 m. The sea still gets them. c7 broadside mean luminance fell from 126 to 101 (the gunport view before firing is 68). The glare left in the port is the ripple's own flames and smoke outside the port during its 0.55 s.
- **Spray/splash too bright (fixed)**: water particles were authored at 1.1–1.45 × sunlight, 2–3.7 HDR against ~0.7 for a sunlit white brick. The new `ParticleLayerOptions.brightness` is 0.42 for spray, 0.45 for droplets and 0.5 for foam, so foam now matches the sea's crest foam.
- **Pooled view → wrong deck (fixed)**: `BrickDebris.forget(view)` runs when `Game.#sweep` returns a view to the pool, so its bricks stop resting on that deck. Test in `brick-debris.test.ts`.
- **Sail holes (confirmed)**: shot-through holes show the sky behind them in a c5-angle probe (84 `punchSail`s on the own ship). **Yard falls → sail vanished (fixed)**: `ShipRig.setSailHeld(i, "yard" | "mast" | "gone")` replaces `setSailShown`. A sail held by a yard shows wherever the yard is, even when its mast is gone. A body carrying any yard, even one shot off alone, takes a ghost rig with that sail. The jib still follows its mast.
- **Holes on the shadow side (fixed)**: hidden and interior parts carry an "enclosed" instance flag (+8 on red). They get 30 % of the unshadowed sky light (hemisphere, environment, fill), so a hole reads as a dark cavity in a fill-lit hull, as in `fx-hit-1`. Interior parts also get the sun, which is shadowed, and point lights at full strength. The gun deck at the port is darker and lit by its lantern.
- **Oblique ref-04 view (deferred)**: optional. It needs the aim ray split from the camera's centre ray and the DOM reticle moved to match (see 20's Answer). There was no budget left after the items above.
- **Frame time**, c5 at 12 ships, 2592×1675, same session:
  - Before: pipelined median 5.11 ms, slowest run 5.40 ms; each frame waited on alone 9.20 ms median, worst 12.0 ms.
  - After: pipelined median 5.03 ms, slowest run 5.26 ms; waited on alone 9.00 ms median, worst 12.6 ms.
  - One c5 run failed the worst-frame check at 19.4 ms while ticket 21 was running on the same cores; the rerun passed.
  - c7: pipelined 4.55 ms (was 4.68).
  - fx: 0 hitches, CPU p99 4.7 ms.
- **For 19**: the spray and foam `brightness` values, the `enclosedSkyLight` share (0.3) and the sky grade constants in `sky.ts` are the knobs. Ghost rigs are a pool of 4; a fifth falling yard loses its sail.
