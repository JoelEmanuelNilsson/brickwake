# Ship lab and part library

Type: task
Status: open
Blocked by: none

## Question

Build S1's foundation: a ship lab page (separate Vite entry, fixed cameras matching
ref-01 and ref-02, sunset lighting and ocean stand-in, shadows), and the ~50 part
shapes keyed by LDraw ID at true dimensions with chamfered edges, studs as a separate
instanced shape, one `InstancedMesh` per shape per ship with per-instance colour and
swap-remove. Spec: Brick ships (Parts, Rendering), `docs/research/lego-rendering.md`.

## Done when

- Lab screenshot of a part sampler reads as real Lego plastic (bevel highlights,
  studs, colours of the refs); saved to `.shots/`.
- Instance swap-remove works without rebuild (test or debug-hook check).

