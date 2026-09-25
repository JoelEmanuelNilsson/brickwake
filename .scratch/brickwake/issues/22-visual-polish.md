# Visual polish

Type: task
Status: open
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
