# Ship lab and part library

Type: task
Status: resolved
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


## Answer

- Lab: `lab.html` → `src/client/lab/main.ts` (Vite entry `lab`; dev URL `/lab.html`). Params:
  `camera=sampler|parts|details|ref-01|ref-02`, `dpr=` (cap 1.5), `bloom=0`. Stand-ins: `sky.ts`
  (sunset dome, sun glow, fbm clouds; also the PMREM env), `ocean.ts` (flat sea, tiling wave normals).
  Key light from the camera side + rim light from the sun, 4096 PCF shadows, ACES 0.5, bloom.
  Debug hook `window.brickLab` (`stats`, `meshIds`, `remove(indices)`, `setCamera`).
- Parts: `src/client/bricks/parts.ts` `partShapes`, 51 shapes keyed by LDraw ID (bricks, plates,
  jumper, tiles, slopes, inverted, cheese, curved 11477/15068/50950/93273, wedge plates
  41769/41770, 43722/43723, 24307/24299, 51739, round, cannon `2527c01`, lantern `37776`, barrel,
  wheel `4790`, fence `3633`), `buildStudGeometry`, `gridMatrix(x, yPlates, z, quarterTurns)`, `ldu`.
  Slope/bow outlines and studs read from LDraw files; detail parts are our models at about LDraw size.
  Frame: LDraw's with y, z negated (y up), origin at footprint bottom centre; slopes descend to +z,
  cannon points +z; `ldrawOrigin` is for `.ldr` export; `overhangs` marks cannon and wheel.
- `geometry.ts` `PartMesher`: convex prisms chamfered on every edge (`edgeChamfer` 1 LDU), lathes,
  35° crease normals. `colors.ts`: LDraw codes; pearl gold is metallic (+2 packed in instance red).
- `brick-ship-mesh.ts`: `createBrickLibrary()` (shared per renderer), `BrickShipMesh(library,
  placements)`: one `InstancedMesh` per shape per ship + one stud mesh (casts no shadow), O(1)
  swap-remove by placement index, `hiddenStuds` + `setStudVisible`, empty meshes hidden.
- Tris: box parts 60, slopes 76, curved 100–132, wedges 60–92, round 128/192, stud 60, lantern 416,
  barrel 440, fence 420, wheel 696, cannon 732. Draws = shapes used + 1 (lantern +1 for glass).
- Sampler (369 parts, 780 studs): 54 draws, 76.4k tris, build 8.5–14.5 ms; removing 74 parts takes
  0.2–0.3 ms and leaves the same mesh objects.
- Proof: `bun run shot:lab` saves `.shots/lab-{sampler,parts,details,ref-01,ref-02,removed}.png` and
  fails unless swap-remove keeps every InstancedMesh; `bun test src/client/bricks` checks shapes are
  closed, outward and in footprint, plus swap-remove and stud show/hide.
- For 09+: 4,800 bodies × 60 tris ≈ 290k, so cull interior parts and covered studs. `labCameras`
  ref-01/ref-02 assume a ~28 m ship, stern at -z; retune on the real hull. DPR 1.5 GPU timing not
  measured here (09). Pearl gold still reads a little orange under the sunset light.
