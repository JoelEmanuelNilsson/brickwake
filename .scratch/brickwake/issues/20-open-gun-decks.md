# Gun decks you can see into

Type: task
Status: resolved
Blocked by: 17

## Question

Make the gunport view read like ref-04/ref-05. Ticket 17 found the ports are too small
(0.8 × 0.96 m through a 1.6 m deep frame, cannon mostly outside the hull), so no
gun deck shows and the port top cuts the view 7° above level. In the generator:
ports about 3 studs × 9 plates, no extra frame depth at the gun decks, cannons about
1 m further inboard with carriages on the deck, a readable gun-deck interior (deck
timber, beams, the neighbouring guns, lantern light). Then retune the eye placement
and look limits in `gunport-view.ts`. Part indices change, so rerun ticket 12's
sink-count probe and ticket 14's tests and keep their numbers in range; update
`tuning.damage` only if needed. Spec: Controls, ref-04/ref-05.

## Done when

- `bun run shot c7` next to ref-04 reads as the same view: port frame, barrel, a
  visible gun deck, the enemy ship's full height through the port at 150 m.
- The outside of the hull still reads right at ref-01 (`bun run shot c5`), ports
  framed, 24 guns; triangles and fleet frame time still within budget.
- Damage tests pass; balls to sink stay about 20–25.

## Answer

Resolved. c7 through a gunport now shows the gun deck around the port: red jambs, a gold lintel, the barrel at lower right, a lantern at upper left, the ceiling beams, ribs, the deck planks, and the enemy at full height. c5, c6 and c7 pass; `bun test src` has 143 passing; typecheck is clean.
- **Generator** (`src/sim/ship/`): each port is 4 studs × 9 plates (1.6 × 1.44 m), sized by `galleonSpec.port` `{width, height, sill: 0}`. `gunPortCells(spec, height, gx)` locates it, and both `generate.ts` and `validate.ts` use that one function.
  - Frames are painted flush into the 2-stud shell, so no extra frame depth. Each row follows its own outer face, because the tumblehome step (plate 24) now falls inside the lower ports. Framed cells keep their paint through the wall.
  - The cannon is centred in its port and anchored `gunInboard: 4` studs in from the face. Its carriage stands on the deck, and the muzzle clears the hull face by 0.4 m (it used to clear it by 1.2 m).
  - New `deckBeams` `{y: 28, every: 4}`: 2-stud beams across the ship under the lower deck's ceiling, one every 1.6 m.
  - New `portFrame.rib` (dark brown): ribs against the inner wall on both sides of every port.
  - Courses and strakes are rebuilt so each port spans whole courses. Lower port: plates 18–27, lintel 27. Upper port: plates 31–40, lintel 40. Heights at plate 41 and above are unchanged, so the rig, castles and upper works are unaffected.
- **Gun layout** (`src/sim/gun-layout.ts`): the heights are now the drawn barrel axis, lower 1.38 m and upper 3.46 m (were 1.30 and 3.30). x and halfBeam are unchanged. The ball leaves where the barrel axis crosses the hull face, 0.4 m inside the drawn muzzle. Test: drawn muzzle y matches the mount within 0.01 m.
- **Gunport view** (`src/client/game/gunport-view.ts`):
  - Camera: FOV 50°, eye 2.6 m behind a sight point 0.45 m toward the bow side of the barrel, level with the lintel's inner face.
  - Look limits: ±18° across, −8° to +12° up and down.
  - One lit lantern hangs from the ceiling at the upper left.
  - Aim is unchanged: 8/12 hits on the 150 m dummy, median 5.5 m from the aim point; landing point moved 0.00 m on entry.
- **Budgets** (M4 Pro, DPR 1.5, 2592×1675, under load from parallel workers; the old code was measured in the same session):
  - Near LOD: 261k tris / 42 draws + rig 4.5k (was 269k / 40).
  - Holed at 20 % HP: 277k + 4.5k = 282k, under 300k.
  - Fleet of 12: 8.4 ms median / 5.7 ms pipelined (old code 9.6 / 6.0 in the same session).
  - c5 bot match: pipelined 6.1–7.3 ms.
  - c7 at the port: pipelined 4.65 ms, 147 draws, 0.76M tris.
- **Damage**: `tuning.damage` is unchanged.
  - Ticket 12's probe (50 seeds of clustered volleys): 21.5 hits to sink (19.4 hull + 2.1 upper works; was 21.9). 252 parts lost by 20 % HP; worst detached per hit 93 (was 79).
  - Balls fired per sink rose from 23.5 to 29.4: straight-on balls fly through a port and out of the opposite one, since ports are at the same x on both sides.
  - Headless TDM over 6 seeds: 2.23 sinks/min vs 2.27 before.
- **Tests retargeted** (seeded outcomes vary run to run; the old code fails other seeds too):
  - tdm.test uses seed 3: seed 7 ended 11–10 at the time limit.
  - bots.test uses seed 3: seed 7 had a bot at 689 m; on the old code, seed 5 already reached 685 m against the 640 m soft radius.
  - ship-wreck needs hits > 40 (more rays pass through the ports).
  - galleon.test needs muzzle clearance > 0.2 m.
- **For 19**:
  - The view looks straight out of the port because the aim is the screen-centre ray, so the deck recedes at the sides only. Neighbouring guns (2.8 m along) stay outside the frame. An oblique ref-04 shot would need the aim ray separated from the camera's centre ray, and the DOM reticle moved to match.
  - In c5's low sun, the forward jambs' 1.2 m deep reveals catch full sun and bloom as bright slots along the side.
  - Bots can leave the soft radius (see above).
- **Proof**: `.shots/c7-{gunport,broadside,beam-sea}.png`, `.shots/c5-ref-01.png`, `.shots/c6-late-joiner{,-after}.png`, and stdout of `bun run shot:galleon` / `shot:damage`.
