# Hull generator from ShipSpec

Type: task
Status: open
Blocked by: 08

## Question

Build the deterministic pipeline from a typed `ShipSpec` to parts: plate courses
rasterized into mirrored occupancy masks, colour strakes following the sheer, gun
ports for two decks, stepped edges finished with slopes, inverted slopes and bow
wedges, running-bond packing, connection `edges[]`, validation (no overlaps, all
connected to the keel, part count in range), `.ldr` export.
Spec: Generation, `docs/research/ship-generation.md`.

## Done when

- Lab screenshot of the hull at the ref-01 camera reads as a brick-built galleon hull
  with a curved bow and boxy stern; saved.
- Validation runs in `bun test`; generation is deterministic.
- 12 hull copies with ocean stand-in and shadows measured at DPR 1.5 within budget.

