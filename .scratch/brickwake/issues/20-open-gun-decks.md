# Gun decks you can see into

Type: task
Status: open
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
