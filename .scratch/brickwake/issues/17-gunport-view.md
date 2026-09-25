# Gunport aim view

Type: task
Status: resolved
Blocked by: 13

## Question

Build C7: right mouse held → camera at a gunport on the facing side, zoomed, cannon
barrel and port frame in view, same aim solve. Spec: Controls, ref-04/ref-05.

## Done when

- Screenshot next to ref-04 reads as the same view.


## Answer

Not resolved. The view works: controls, transition, aim, firing and lighting. It does not read as ref-04, because the hull's gunport is too small to show a gun-deck scene (numbers below).
- Built: `src/client/game/gunport-view.ts`, which holds `GunportView` (state, ease, pose) and `GunDeckLanterns`. `ChaseCamera` gained `gunport`, `holdGunport(held)` and `follow(…, ship?)`. Holding the right mouse (`Controls`; the context menu is suppressed; blur releases) eases in over 0.5 s with smootherstep. The camera moves along a quadratic path that ends on the line of sight, so it enters through the port. It eases out in 0.38 s. FOV goes from 55° to 40°; the near plane goes from 0.5 m to 0.08 m while blend > 0.
- Pose: the eye is on the lower-deck amidships gun of the side the aim point is on (`gunLayout` 4/16). The line of sight always passes through a sight point in the port, 0.16 m above the barrel and 0.1 m left of it; the eye swings about that point, 1.35 m behind it. The pose is ship-local, so the view pitches and rolls with the ship (beam sea: heel range 9.9°, view pitch range 9.9°). Look limits are ±18° across and −9°…+7° vertically (jambs, muzzle, lintel). Entering keeps the landing point: the reticle moved 0.00 m. While at the port, `ChaseCamera.yaw` follows the view, so the HUD, the hit indicator and leaving the port stay consistent.
- Aim is unchanged: `Gunnery` still reads `aimOrigin`/`aimDirection`, now the blended, unshaken centre ray. A broadside fired from the port scored 8/12 hits on the 150 m dummy, median 5.7 m from the aim point.
- Lighting: one brick lantern (37776) with a warm PointLight. The light is invisible outside the view, so the chase view pays nothing for it. Both shader variants are compiled at load (`compileLit`), so the first entry has no hitch. At the port, muzzle-flash lights within 14 m fade by (d/14)² (`dimFlashes`), because the flash tuned for hulls 10 m away whited out the frame.
- Fixed in `game.ts`: dt could go negative on the first rAF after `measure()`, because the rAF timestamp predates `performance.now()`. It is now clamped to ≥ 0.
- Debug hook: `gunport(held, look?)`; `camera()` adds `gunport` (blend), `gunportSide`, `fov` and `lookPitch`. `bun run shot c7` runs the check; `bun test src/client/game/gunport-view.test.ts` has 4 tests.
- Frame time at the port, 2592×1675, target-dummy: pipelined 4.6–5.4 ms, each frame waited on 6.2–7.4 ms on quiet runs; 142 draws, 0.77M tris.
- Shots: `.shots/c7-{gunport,broadside,beam-sea}.png`; `.shots/c7-vs-ref-04.png` puts ref-04, the port view and the broadside side by side.
- **Why it does not match ref-04**: the lower port measures 0.8 × 0.96 m (2 studs × 6 plates). It sits in a 2-stud shell with a frame 1 stud proud, which makes a 1.6 m deep tunnel. The 0.38 m barrel lies on the tunnel's axis, and the cannon is 3.2–4.8 m out from the centreline, mostly outboard. The breech is 0.4 m inside the wall face.
  - From any eye position that shows the deck interior, 1 m or more inboard, the gun covers the port.
  - The only clear line of sight is from the tunnel mouth, and the lintel cuts it at +7°, so masts at 150 m are cut off.
  - The result reads as looking out through a deep port past the barrel, not as ref-04's deck.
- **Fix, for the ship track or 19**: ports about 3 studs × 9 plates, no proud frame depth at the gun decks, and the cannon placed about 1 m further inboard, so the breech sits in the room and only the muzzle reaches the port. Then retune `sightPoint`/`eyeBack` and the look limits in `gunport-view.ts`; nothing else changes. This touches the generator, so it changes part indices, 12's sink count and 14's damage.

Resolved by [Gun decks you can see into](20-open-gun-decks.md), which fixed the port size this ticket reported.
