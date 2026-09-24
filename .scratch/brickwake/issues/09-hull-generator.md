# Hull generator from ShipSpec

Type: task
Status: resolved
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

## Answer

- Pure sim (no three): `src/sim/ship/` — `spec.ts` `ShipSpec` + `galleonSpec`; `generate.ts` `generateShip(spec)` →
  `{ parts, edges, keel, ports, pruned }`; `structure.ts` (`ShipPart` grid record, `footprint`, `connectParts`,
  `reachable(count, edges, anchors, removed)`, `findOverlaps`, `exposure`); `validate.ts` `validateShip`; `ldr.ts`
  `toLdr`; `parts.ts` `partCatalog` (IDs, sizes, studs, sockets, LDraw origins, moved out of client) and `colors.ts`
  (`BrickColor`, LDraw codes). Client: `src/client/bricks/ship-placements.ts` `shipPlacements(spec, ship)`.
- Grid: x studs from the stern (+x bow), z studs from the centreline (+z starboard), y plates from the keel
  bottom; ship-local metres = ((x − 35)·0.4, (y − 13)·0.16, z·0.4). Parts store min-corner cell and quarter turns.
- Pipeline: per-column course stacks (body: spec courses; bow x ≥ 51: all plates) → occupancy from plan × section
  with stem rake and raked transom → 2-stud shell, 2-course floors, decks as beams (across) + planks (along) → walls
  propped down under inset courses → gunports carved from `galleonGunSpec` → strakes by sheer-relative height →
  inverted slopes (bilge, stern counter), 45° slopes (tuck-in, when a brick course steps in), wedge plates on the
  bow plan curve → running-bond packing that steers joints to parts already grounded → joint repair → prune.
- Galleon: 3,665 parts, 6,446 stud edges, 131 keel parts, 2 pruned (stem tip), generated in ~110 ms (Bun and
  Chrome). Rendered: 3,040 exposed parts (hold culled), 1,676 studs, 28 draws, 286.9k tris.
- 12 hulls, ocean, 4096 shadows, bloom, DPR 1.5 (2592×1675) on the M4 Pro: 6.0 ms/frame pipelined (10.4 ms
  if every frame waits for the GPU). 1 hull 3.0 ms; no shadows 3.7 ms; no bloom 5.2 ms. `bun run shot:hull`.
- Proof: `.shots/hull-{ref-01,ref-02,side,bow,top,fleet}.png`; lab `lab.html?ship=galleon&camera=ref-01`
  (`fleet=12`, `shadows=0`, `brickLab.measure(n)`). `bun test src/sim/ship src/client/bricks`: validation clean,
  deterministic, mirror-symmetric, every gun in `gunLayout` has an open port at the hull face, hold sealed,
  cutting the wale band detaches everything above, ≤ 300k tris and ≤ 45 draws.
- Changed shared facts: `galleonGunSpec` ports now sit on stud boundaries 2.8 m apart (lower −8.4…5.6 m,
  upper −10…4 m) and `halfBeam` is per deck (lower 4.0 m, upper 3.6 m, the tumblehome). Heights unchanged.
- Colour: black `#10151d`, pearl gold `#bcb48e` at metalness 0.45, lab env intensity 0.3; black now reads black
  and gold tan-gold at ref-01 (was brown / orange). Inverted slopes 3665/3660 now carry full-top studs (real parts).
- For 10–12: exposure is computed once; a removed part can reveal culled neighbours, and `BrickShipMesh` cannot
  add instances yet (12/14 need to rebuild or pre-size pools for them). Lower gun deck is tiles (no studs):
  cannons need a plate/jumper under them. Stern windows, gallery, port frames, rails and ornaments are 10's.
  Generation cost is mostly `repairConnections` re-running `connectParts`; generate once and share per spec.
- Gaps: strakes follow the sheer only where courses are plates (bow); the stern castle steps instead. No 45°
  tuck-in slopes appear on this galleon (its steps are plate ledges). Worst-case detached parts per hit not probed.
