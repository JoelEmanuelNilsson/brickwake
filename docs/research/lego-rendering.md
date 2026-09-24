# Lego-style ship rendering: research findings

Question: how the three.js client renders brick-built ships (3,000–6,000 parts each, up to
12 on screen) so they read as real Lego at 120 fps on an M4 Pro, with every part removable.
Throwaway scripts and the unzipped LDraw library are in `/tmp/brickwake-research/`
(`tris.mjs` counts triangles of an LDraw part recursively, with `--lo` for p/8 primitives
and `--nostud` to drop stud and underside primitives).

## Measurements (headless Chromium, ANGLE Metal, M4 Pro, 3456×2234 at DPR 2, GPU median ms, 12 ships)

Taken by the previous researcher; the harness is lost.

| Scene | ms |
|---|---|
| Empty scene, bloom + tone mapping | 3.7 |
| Empty scene, no post | 1.1 |
| InstancedMesh per part type, 204k tris/ship, 492 draws | 6.5 |
| Same, chamfered parts, 304k tris/ship | 6.8 |
| Same, "heavy" 1.58M tris/ship (19M total) | 12.6 |
| 204k instanced + shadows | 9.3 |
| 204k instanced, 100 part types (1,212 draws) | 9.2 |
| 204k instanced, MeshPhysicalMaterial | 7.5 |
| 204k instanced, no post | 4.8 |
| BatchedMesh, one per ship | 34.7 (1 ship: 7) |
| Merged geometry per ship | 8.1 (chamfer + shadows 9.2); rebuild ~92 ms CPU per hit |
| "Shared" material grouping | 12.3 |

Derived slopes (from the rows above): **~0.37 ms per extra million triangles**
((12.6 − 6.5) / (19M − 2.45M)) and **~3.75 µs per extra draw call**
((9.2 − 6.5) / (1,212 − 492)). The frame budget at 120 Hz is 8.33 ms.

## Q1. LDraw as a parts source

**Licence.** The library is CC BY 2.0 and CC BY 4.0 (parts edited after 2023-03-05 are
4.0). Commercial use is allowed. Attribution means: name the creator, give a URL for the
work, name the licence, link the licence, and say whether the work was modified; the first
four come from each file's header [1]. So a shipped build needs a generated credits file
built from the `0 Author:` lines of every part we derive from, plus "modified".
The LDraw licence covers the geometry only. LEGO states that the brick and the knobs
(studs) are among its trademarks and that the LEGO logo must not be used on unofficial
sites [2]; LDraw's `stud-logo*.dat` primitives draw the word "LEGO" on each stud [3].

**Size (from `complete.zip`, LDConfig dated 2026-05-29).** 24,735 files in `parts/`, of
which 9,235 are subparts in `parts/s/`; ~8,300 top-level parts remain after dropping
moved (`~Moved to`), pattern and sticker files. 1,784 primitives in `p/`, 926 high-res in
`p/48/`, 127 low-res in `p/8/`. 596 MB unzipped. 322 colours in `LDConfig.ldr`.

**Primitives and resolutions.** Parts reference shared primitives (`stud.dat`, `box5.dat`,
cylinders). `p/48` holds hi-res versions that authors reference explicitly; `p/8` holds
low-res versions renderers may substitute for fast drawing [4][5]. Measured with
`tris.mjs`: `stud.dat` is 48 tris (16 segments), `p/8/stud.dat` 24 tris, the 3D-logo stud
`stud-logo4.dat` 1,259 tris. `box5.dat` is a plain box: LDraw geometry has sharp edges and
no bevels; outlines are drawn with type-2 edge lines and type-5 conditional lines [5].

**Where LDraw triangles go** (standard res → low-res primitives with studs and underside
primitives removed):

| Part | std | lo, no studs/underside |
|---|---|---|
| 3024 plate 1×1 | 76 | 20 |
| 3001 brick 2×4 | 700 (hi-res 2,044) | 28 |
| 3710 plate 1×4 | 364 | 20 |
| 3070b tile 1×1 | 44 | 44 |
| 6141 round plate 1×1 | 288 | 104 |
| 3040b slope 45 2×1 | 178 | 58 |
| 15068 curved slope 2×2 | 286 | 174 |
| 41769a wedge plate 4×2 | 521 | 197 |
| 43722a wedge plate 3×2 | 375 | 183 |
| 2527c01 cannon + base | 2,368 | 1,600 |
| 37776 minifig lantern | 734 | 510 |

A plain brick or plate body is 12–28 triangles; studs and underside tubes are 90–95 % of
its LDraw cost. This matches the previous measurement for a 4,804-part ship: 1.37M tris,
of which 569k top studs and 448k underside, 357k bodies; 811k with low-res studs.

**`LDrawLoader` (three 0.186.1 source, `examples/jsm/loaders/LDrawLoader.js`).**
- Resolves each subfile by trial and error across `parts/`, `p/`, `models/`, relative
  and absolute paths (L577–620) unless `setFileMap` is given; the docs recommend packing a
  model and its parts into one MPD with `utils/packLDrawModel.mjs` (L1753–1755).
- Primitives are merged into their part's geometry; each non-primitive subfile becomes a
  child `Group` (L1180–1340). Each part yields a `Group` with up to three renderables: a
  `Mesh` for faces, `LineSegments` for edges and `ConditionalLineSegments` (L1366–1382),
  the last needing `setConditionalLineMaterial` (L1837, L2420).
- Parts are cached and returned as `group.clone()` (L1396–1400): geometry is shared but
  every placed part is its own Object3D with its own draw calls. No instancing, no
  merging of the model. A 4,800-part ship becomes up to ~14,000 renderables.
- `smoothNormals` is on by default and runs per part at load (L1356–1361).
- Materials: default finish is `MeshStandardMaterial` roughness 0.3, metalness 0;
  pearlescent, chrome, rubber, matte-metallic and metal get fixed presets (L2352–2386);
  the `MATERIAL` finish (glitter, speckle) is not implemented (L2334–2337).
- Conclusion: `LDrawLoader` is a viewer and an offline import tool, not a runtime path
  for 60,000 parts.

**Making LDraw geometry cheap** (all standard, all build-time): drop underside
primitives (never seen on a mounted part); emit studs as separate instances and skip any
stud covered by a part above; swap in `p/8` primitives; decimate only the few detail
parts (cannon, lantern) by hand or with a simplifier; distance LOD by hiding stud
instances. Brickadia's LOD simplifies each brick (drops edges, lips, roundness) before
reducing the combined mesh, because general-purpose simplifiers failed on brick builds
[6]. Brick Rigs added LODs for all bricks in 1.7 (Steam release notes) [7].

## Q2. The real-time Lego look

What first-party sources say:
- **LEGO Builder's Journey** (Light Brick Studio, Unity HDRP): the PC version adds
  ray-traced lighting, shadows and reflections; their GTC 2021 talk lists "anatomy of a
  LEGO brick", geometry processing, materials and post effects as the ingredients [8].
  The Vision Pro port kept the look with a baked ambient-occlusion volume texture and a
  64×64 shadow map [9]. The talk's specific bevel sizes and material values are not in any
  text source I found.
- **Mecabricks** (Blender add-on): the material fakes rounded edges in the shader by
  default (Cycles bevel), has subsurface scattering, and adds optional scratches,
  fingerprints, dirt and colour variation; real bevel geometry is described as a
  close-up option [10].
- **BrickLink Studio** (Eyesight renderer): stud logos are a render-time "material
  effect" toggle; there is no bevel control, so edge shape comes from the part mesh [11].
- **Brickadia**: clusters bricks into combined meshes, one draw per cluster via texture
  arrays, rebuilds only the touched cluster asynchronously, and uses brick-aware LOD [6].
- **LEGO Fortnite**: Epic's public material covers Chaos physics for building and
  breaking [12]; the UEFN brick editor docs recommend converting finished builds to static
  meshes for performance [13]. No public rendering breakdown.
- **LEGO Worlds**: no first-party rendering source found.

What that means for three.js (cost from the measurements where measured):

| Ingredient | How | Cost |
|---|---|---|
| Bevels / chamfers | A 45° chamfer on every edge of the body mesh (box: 12 → 44 tris). The chamfer strip catches highlights and makes a dark groove at every seam between neighbouring bricks, which is where the "separate pieces" read comes from. | +0.3 ms (204k → 304k tris/ship, measured) |
| Glossy ABS | `MeshStandardMaterial` roughness ~0.2–0.35 with a PMREM environment map; `MeshPhysicalMaterial` clearcoat for the lacquer layer | clearcoat +1.0 ms (measured); env map is the cheap part |
| Seams | Come from the chamfers; no gap geometry needed | included above |
| AO | Baked per part vertex (inside corners, underside) plus a per-instance darkening from neighbour occupancy computed at ship build; `GTAOPass` exists in three 0.186.1 but was not measured at DPR 2 | baked: ~0; GTAO: unmeasured |
| Shadows | One directional shadow map | +2.8 ms at DPR 2 (measured) |
| Subsurface | Not needed for opaque ABS in a sunset scene; translucent lantern glass is emissive + bloom | 0 |
| Stud logos | Geometric logo is 1,259 tris per stud (not viable); a normal-map decal on the stud cap is cheap, but the LEGO logo is a trademark [2], so use a plain stud or our own mark | ~0 as texture |
| Edge lines | LDraw's type-2/5 lines give an instruction-manual look, not the photo look of ref-01 | skip |

## Q3. Budget and removable-part technique

Frame budget: 8.33 ms. Post (bloom + tone mapping) at DPR 2 costs 2.6 ms of that on its
own (3.7 − 1.1), and the ocean, sky and effects are not yet counted.

| Candidate | Tris/ship | 12 ships | Estimated GPU ms (DPR 2, no shadows) |
|---|---|---|---|
| B raw LDraw, std res | 1.37M | 16.4M | ~12 (heavy row: 12.6 at 19M) |
| B raw, low-res studs | 811k | 9.7M | ~9.2 |
| B after build-step stripping | ~250–400k | 3–4.8M | ~6.8–7.3; converges on C |
| A voxel boxes + studs | ~200k | 2.45M | 6.5 (measured) |
| C own chamfered parts + visible studs | ~300k | 3.6M | 6.8 (measured) |

Raw LDraw misses 120 fps on geometry alone. Stripped LDraw and C cost the same for plain
parts; the difference is detail parts (LDraw cannon 1,600 tris after stripping vs a few
hundred for our own) and bevels (LDraw has none).

Techniques for removable parts, measured:
- **InstancedMesh per part shape per ship: 6.5 ms. Choose this.** Removal is O(1): move
  the last instance into the removed slot, decrement `count`, upload the two changed
  matrices/colours with `addUpdateRange`. Colour per instance via `setColorAt`, so shape
  count, not colour count, sets the draw count.
- BatchedMesh: 34.7 ms. ANGLE's Metal backend implements multi-draw as a loop of single
  draws (`ContextMtl::multiDrawArrays` → `MultiDrawArraysGeneral`) [14], and three's
  BatchedMesh depends on `WEBGL_multi_draw` (`WebGLBufferRenderer.js` L33–34). Not viable
  on Mac Chrome.
- Merged geometry per ship: 8.1 ms (slower than instanced) and a ~92 ms CPU rebuild per
  hit. Brickadia makes merging work by clustering and rebuilding off-thread [6]; that is
  complexity with no GPU gain here, since instancing already renders faster.
- Hybrid (merged static + instanced near damage): no case for it, since merged is slower
  than instanced even before hits.

Draw calls: each part shape costs one draw per ship per pass. 40 shapes × 12 ships × 2
passes (colour + shadow) ≈ 960 draws, ≈ 3.6 ms at the marginal ~3.75 µs per draw. Keep the shape set near 40; each extra shape costs ~0.09 ms
with shadows. Studs should not cast shadows (halves the stud draws in the shadow pass).
Unmeasured option: one InstancedMesh per shape shared by all ships, with a per-instance
ship index and 12 ship matrices as a uniform array applied in the vertex shader, which
would cut draws ~12×; instance matrices stay static in ship space.

## Q4. Sails, rigging, ropes, flags

Lego ships use printed cloth sails, moulded rigging ladders (2541, 1989–2002) and, in
later sets, string and chain [15]; all are in the LDraw library, and all are expensive
there:

| LDraw part | tris |
|---|---|
| 64991 sail 28×17 (flat / formed) | 508 / 1,552 |
| 2541 rigging ladder 5×27 | 8,816 |
| 30104 minifig chain 17L | 13,552 |
| 14225 braided string 31L | 25,080 |
| 2335 flag 2×2 | 260 |

At game cost: a sail is one grid mesh (~16×16 quads, ~500 tris) with a vertex-shader
billow driven by wind and sail level and the canvas texture from the design doc; flags
the same at ~8×4. Shrouds and rope ladders are alpha-tested textured quad strips (a
ladder or chain texture on 2 tris per segment) or instanced low-poly chain links
(~16 tris each; ~500 links/ship ≈ 8k tris). Running rigging is thin 3–4-sided tubes or
camera-facing ribbons. All of this is cosmetic, not damage-graph parts, as
ship-generation.md already says. Total ≲ 20k tris and ~5 draws per ship.

## Q5. Bow and stern curves

ref-01 shows a flat stern transom and near-vertical stepped sides (observation). The
stern needs no curve parts. The bow in plan view does: without them the 1-stud steps of
a rasterized plan curve show as a staircase at the waterline and rail.

Parts that fix this, from the LDraw library (IDs, standard tris):
- Wedge plates for the plan curve at each plate course: 24299/24307 2×2 L/R (226),
  43722a/43723a 3×2 R/L (375), 41769a/41770a 4×2 R/L (521), 51739 2×4 (424).
- Curved slopes for the sheer and the bow rail top: 11477 2×1 (152), 50950 3×1 (172),
  15068 2×2 (286), 93273 4×1 double (328).
- Moulded hulls (2557 bow 16×12, 2559/2558 stern, 2560 base 8×16): 14–20k tris each,
  sized for 16-stud-wide 1990s hulls, and one piece each, so a hit cannot chip them.
  Reject.

In C these are 12–40-tri prisms plus instanced studs. Mirrored L/R pairs must be separate
shapes (a negative-determinant instance matrix flips winding, and three sets front-face
winding from the object's `matrixWorld` only, `WebGLRenderer.js` L1200). About 10 extra shapes (4 wedge pairs + 4 curved slopes,
counting pairs) ≈ +0.9 ms with shadows at 12 ships, or fold them into the 40-shape
budget by dropping rarely used shapes.

## Recommendation

- **Candidate C.** Our own ~40 part shapes, modelled at true LDraw dimensions with 45°
  chamfers, keyed by LDraw part ID (as ship-generation.md already proposes), with studs as
  a separate instanced shape. The shape set: plates/bricks/tiles in the common lengths
  (1×1…2×4), slopes 45° 2×1, the wedge plates and curved slopes of Q5, round plate/brick
  1×1, and hand-modelled cannon, lantern, wheel, skull plaque, barrel, mast segment.
- **Parts source.** LDraw for IDs, dimensions and reference geometry, and as the debug
  export format. Do not render LDraw geometry. If a detail part is derived from an LDraw
  file, ship a credits file per CC BY [1]. No LEGO logo on studs [2].
- **Rendering.** `InstancedMesh` per part shape per ship, per-instance colour, O(1)
  swap-remove on hits, studs culled at build time when covered and restored when the
  covering part falls, studs off beyond a distance, studs excluded from the shadow pass.
  `MeshStandardMaterial` (roughness ~0.25) with a PMREM environment map; clearcoat only if
  the 1 ms fits. Baked AO. No BatchedMesh, no merging.
- **Budget per ship:** ≤ 300k triangles (≈ 4,800 parts × 44-tri chamfered body ≈ 210k +
  visible studs at 24–34 tris + ~20k rigging/sails), ≤ 45 draws per pass. 12 ships:
  ~3.6M tris, ~540 colour-pass draws. Measured 6.8 ms at DPR 2 with post, no shadows.

## Contradictions with the design doc and ship-generation.md

- Design doc, candidate B: "three.js ships an `LDrawLoader`" suggests a runtime path; the
  loader produces one Object3D per part plus edge-line objects and cannot be the runtime
  renderer. "Needs a build step" understates it: after the build step B becomes C.
- Design doc, candidate A: A and C converge; A needs slopes, wedges and detail parts to
  look like ref-01, which makes it C.
- Design doc: "Library license: Creative Commons attribution" is right but incomplete:
  attribution is per author, and the LEGO trademark on studs and the logo is separate [2].
- Design doc target "120 fps with 12 ships" at 3456×2234: the ships alone with shadows
  measured 9.3 ms at DPR 2, over the 8.33 ms frame. The "capped render resolution" the doc
  already allows is required, and the cap is below DPR 2.
- ship-generation.md open risk (boxy bows): answered in Q5. The stern in ref-01 is itself
  boxy; the bow needs 4 wedge-plate pairs and ~4 curved slopes.

## Open risks

- **Resolution and shadows are unmeasured below DPR 2.** Estimated from pixel count:
  DPR 1.5 has 56 % of the pixels, so post drops from ~2.6 to ~1.5 ms; shadow and shading
  cost should drop similarly, but that run never finished. The ship lab must measure
  DPR 1.5 with shadows, with the ocean in the scene, before S2 is approved.
- The shared-across-ships InstancedMesh (12× fewer draws) is unmeasured.
- Chamfer size and clearcoat are look decisions; check them against ref-01 in the lab.
- Debris: knocked-off parts tumble and show their undersides, which the stripped shapes
  don't have. Use a debris variant with a flat or tube underside, or accept it at debris
  distance.
- Hidden interior parts (the 2–3-stud hull shell) still render; skipping enclosed parts
  until a neighbour is removed would save up to ~30–50 % of body triangles but needs the
  occupancy grid on the client.

## Sources

1. LDraw.org, `CAreadme.txt` and `CAlicense4.txt` in the parts library (`complete.zip`), https://www.ldraw.org/article/593.html
2. LEGO Group, *Fair Play* policy, https://www.lego.com/en-us/legal/notices-and-policies/fair-play and https://www.lego.com/cdn/cs/legal/assets/blt1a4c9a959ce8e1cb/LEGO_Fairplay_Nov2018.pdf
3. LDraw wiki, *Studs with Logos*, https://wiki.ldraw.org/wiki/Studs_with_Logos ; `p/stud-logo*.dat`, `p/logo.dat` in the library
4. LDraw wiki, *Primitive* and *Primitives Reference*, https://wiki.ldraw.org/wiki/Primitive , https://wiki.ldraw.org/wiki/Primitives_Reference
5. LDraw File Format Specification 1.0.2, https://www.ldraw.org/article/218.html ; `p/box5.dat`, `p/stud.dat`, `p/8/stud.dat`
6. Brickadia, *Optimizing Bricks for Alpha 5, Part 2*, https://brickadia.com/blog/optimizing-bricks-for-alpha-5-part-2/ ; *Devlog #5*, https://brickadia.com/blog/devlog-5/
7. Fluppisoft, Brick Rigs 1.7 notes, https://steamcommunity.com/app/552100/discussions/0/4339860800344538822/ ; *Scalable Flaps*, https://fluppisoft.com/blog/scalable-flaps/
8. Light Brick Studio, *Real time ray tracing* (GTC 2021 talk page), https://www.lightbrick.com/realtime-ray-tracing ; talk video https://www.youtube.com/watch?v=Xh_b9WDfZ-s
9. Unity, *How a team of six ported LEGO Builder's Journey to Apple Vision Pro*, https://unity.com/resources/light-brick-studio-visionos
10. Mecabricks, *Advanced Add-on for Blender* forum thread (author posts), https://stage.mecabricks.com/en/forum/discussions/63c9d6455ca7e62179f35d8a?page=25
11. BrickLink Studio Help, *Photoreal / Eyesight options*, https://studiohelp.bricklink.com/hc/en-us/articles/6505772624023-Photoreal-Eyesight-options
12. Epic Games, *Chaos Physics in LEGO Fortnite* (GDC 2024), https://www.youtube.com/watch?v=WPsRfZ8rxOg
13. Epic Developer Community, *LEGO Brick Editor in Fortnite*, https://dev.epicgames.com/documentation/fortnite/lego-brick-editor-in-fortnite
14. ANGLE source, `src/libANGLE/renderer/metal/ContextMtl.mm`, https://chromium.googlesource.com/angle/angle/+/bf48ca965358ab9560632acf5e39d953a710625b/src/libANGLE/renderer/metal/ContextMtl.mm
15. BrickLink catalog, part 2541 and sets containing it, https://www.bricklink.com/catalogItemIn.asp?P=2541&in=S ; LEGO 71042 instructions, https://www.lego.com/en-us/service/building-instructions/71042
16. three.js r186 source: `examples/jsm/loaders/LDrawLoader.js`, `src/objects/BatchedMesh.js`, `src/renderers/webgl/WebGLBufferRenderer.js`, `src/objects/InstancedMesh.js`
