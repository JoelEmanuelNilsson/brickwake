# Ship generation and structure: research findings

Question: how code or an AI agent can produce a brick-built galleon that looks like
`reference/ref-01..03.png` with no human in a Lego editor, and how its parts connect for
damage. Clones and experiments are in `/tmp/brickwake-research/` (throwaway).

## What the references show (observation, not a source)

- The hull sides are **vertical walls of stacked bricks and plates**, not smooth SNOT
  skins: horizontal color strakes (black, dark red, tan/gold trim lines), mixed brick
  lengths with visible seams, and studs on every exposed top edge. The hull curves in
  plan view by stepping courses in and out; the bottom narrows under the waterline.
- The "Lego" read comes from detail parts and sub-assemblies: gold-framed gun ports with
  black cannons on two decks, lanterns on posts, gold skull-and-crossbones plaques and
  ship's-wheel ornaments on the stern, stern windows lit from inside, rail posts, round
  bricks on the masts, chain/rope-ladder rigging. Sails are cloth with a printed skull,
  not bricks.
- So the hull needs a clean stud-grid layout with bond patterns and color bands, not a
  mesh-faithful smooth surface. Curves only need to be convincing at 1 stud per course.

## Q1. Legolization and brick layout

Algorithms that exist:

| Work | Method | Part vocabulary |
|---|---|---|
| Testuz, Schwartzburg, Pauly 2013 [1] | Voxelize, then greedily merge 1×1 cells per layer into bigger bricks with a cost that rewards fewer bricks and more cross-layer connections; a brick connectivity graph finds weak points and repairs them. | Rectangular bricks |
| Luo et al. 2015, *Legolization* [2] | Start from 1×1 bricks, random maximal merge, force a single connected component, then force-based stability analysis finds the weakest region and split/remerges it iteratively. | 1×1…1×8, 2×2…2×8 bricks, 8 colors [2 §6] |
| Kollsker & Malaguti 2021 [3] | Exact ILP per 2D layer. | Rectangular bricks |
| Zhou, Chen, Xu 2019, *Vivid LEGO Architectural Sculptures* [4] | Detect planar slope regions and cylinders on the input mesh, pick the sloped/round brick whose normal and size best match, pick a global scale that fits those details, fill the rest with cuboid bricks. | Cuboid, sloped, round bricks |
| BrickGPT / LegoGPT (CMU, ICCV 2025) [5] | Fine-tuned Llama-3.2-1B predicts bricks one at a time as `hxw (x,y,z)` lines; rejects invalid/colliding bricks; physics stability analysis with rollback. Trained on StableText2Brick, 47k structures voxelized on a **20×20×20** grid. | **8 rectangular bricks only** (1×1…2×6, no plates, no slopes) [5 `brick_library.json`] |

Code:

- **Bricker** (Blender add-on, GPL-3, public source [6]): voxelizes a mesh, merges into
  bricks/plates, and chooses slope vs inverted slope per brick from the nearest of eight
  45°-ish surface normals, only where the top/bottom is exposed
  (`functions/bricksdict/modify.py: set_brick_type_for_slope`, `functions/general.py:
  get_normal_direction`). The "Slopes" brick type is commented out of the public UI
  (`lib/property_groups/created_model_properties.py:256`).
- **hbmartin/legolization** (Python, GPL-3, active 2026 [7]): mesh → voxel → hollow → place
  → rigid-block-equilibrium stability LP → repair → LDraw. Slope/inverted-slope/tile
  finishing is on by default and uses mesh normals; plate caps are opt-in [7 ROADMAP].
  Its `references/` folder holds converted text of most of the literature above.
- **BrickGPT repo** [5]: `mesh2brick` and a connectivity check (networkx, O(N²) pair test).
- No three.js/JS legolizer with slopes turned up; JS voxelizers only emit cubes.

What gives smooth-looking curves instead of stair steps:

1. **Plates as the vertical unit** (1/3 brick): an outline that steps once per plate
   course reads as a curve at game distance. Every tool above that supports plates does this.
2. **Slope finishing on exposed step edges**, chosen from the surface normal (Bricker,
   Zhou 2019, legolization): slopes where the hull tucks in going up (tumblehome),
   inverted slopes where it widens going up (bilge/turn of the hull).
3. Real builders add **curved slopes and wedge plates** for plan-view curves and
   SNOT-mounted plates for the sides [8][9]; none of the open generators does SNOT.

Mesh legolization is the wrong entry point for this game: someone must first author a
galleon mesh, and the optimizers target stability and silhouette, not art direction
(color strakes, gun ports on exact rows, symmetric ornaments). The hull is already a
stack of horizontal sections, so the generator can rasterize it directly (Q2).

## Q2. Authoring a ship in code

Naval architecture already describes a hull as data: a **lines plan** (sheer plan,
half-breadth plan, body plan) and a **table of offsets** giving half-breadth from the
centreline at each station × waterline [10]. Sampling that table at 1 stud (x) × 1 plate
(z) gives exactly the per-course outline a brick hull needs, mirrored for symmetry.

Working precedent for a parametric galleon: the MIT-licensed Godot game *Corsairs* [11]
builds 11 ship classes from a profile record (`masts`, gun-port `rows`, sail `tiers`,
stern `castle` stages) plus three curves of t = bow→stern: `_half_width(t)`,
`_deck_y(t)` (sheer rising at both ends) and `_bottom_y(t)`, and a 5-row normalized
cross-section `ROWS` (x-multiplier, height fraction) with a raked transom
(`scripts/ship_visual.gd:46-220`). That separable form (plan curve × sheer × one section
shape) is enough for a stylized galleon; a small offsets table is the richer version.
No open-source procedural *brick* ship generator was found; `bpyhullgen` [12] and
form-parameter design [13] generate engineering hulls as surfaces.

How MOC builders build hulls [8][9] (Eurobricks threads; the pages were read through
search excerpts, as direct fetches were blocked):
- Plan the outline first; build a plate skeleton in that outline, stepping the edge
  one stud at a time, checked from above so the taper reads as a curve.
- Rows of SNOT bricks carry sideways plates for the sides; 2 plates + 1 brick = 5 plates
  = the width of a sideways 1×2 plate, which makes the grid close.
- Curved slopes smooth the stepped profile; slopes or a second SNOT row make the tumblehome.
- Official sets mix both: 70413 *The Brick Bounty* uses molded hull pieces [14]; 21322
  *Pirates of Barracuda Bay* combines hull elements with brick-built, sloped sides that
  give its bulging profile [15].

"Lego ship" vs "Minecraft boat" (from the refs plus the sources above): studs and brick
seams visible, bond patterns with mixed lengths, color strakes following the sheer,
plate-resolution steps, slope/curved finishing at the bilge and rails, and dense detail
sub-assemblies (ports, cannons, lanterns, windows, ornaments, rails). One color on 1×1
cubes with brick-height steps is the Minecraft look.

## Q3. Agent-authored design

Evidence says an LLM should author **parameters and small sub-assemblies**, not raw
placements for thousands of parts:

- **BrickAGI** [16] (LLM Lego-design benchmark, 2026): frontier models' parts lists
  "don't physically connect"; with required placements and no taught connection rules,
  GPT-5.5 completes 16.7 % of 24 core tasks (31.3 % when the bonding rule is taught).
  Its authors conclude the failure is largely a **representation** problem.
- **BrickGPT** [5] needed a fine-tuned model, a 20³ grid and rejection/rollback to get
  stable output, and reports beating a few-shot in-context LLM baseline (Table 1).
- **MC-Bench** [17]: LLMs build Minecraft structures by writing a JS function
  `buildCreation(x,y,z)` against `safeSetBlock` / `safeFill` primitives
  (`server_worker/js_scripts/build.js`), i.e. code with loops and fills, not block lists.
- **Render-and-verify loops help but are not enough alone.** CADCodeVerify [18]
  (ICLR 2025) renders 4 views, asks a VLM yes/no questions generated from the prompt, and
  feeds "no/unclear" back: 7.3 % better point-cloud distance and 5.5 % more successful
  objects than one-shot GPT-4, with VLM answers only 64–68 % accurate. BlenderGym [19] (CVPR 2025): VLMs editing
  Blender scenes via code are far behind humans (e.g. placement loss 11.89 GPT-4o vs 0.423
  human); a generate-candidates-then-verify step helps.

Formats that make it tractable: a typed spec of named parameters (the agent edits
numbers and names, never studs); symmetric halves generated by mirroring; sub-assemblies
of ≤ ~100 parts each authored as short code or LDraw fragments on a local grid; and
deterministic validators (connectivity, collisions, counts) that return exact errors
instead of asking a VLM.

## Q4. Structure for damage

How other games do it:

- **Teardown**: voxels are connected only face-to-face; after removal, connected components
  that lost their hold become separate bodies. No load or stress calculation; one voxel can
  hold a building [20][21][22].
- **GearBlocks** (developer post [23]): per-attachment health was rejected (interpenetration,
  hard to explain, cost on every contact). Each part has a strength threshold; an impact
  above it breaks the part off with all its attachments; falling debris spreads damage
  naturally; explosions use distance falloff.
- **Besiege**: each block joint breaks when force/torque exceeds a per-block, per-face
  threshold [24] (community wiki).
- **Brick Rigs**: bricks break off at connections; official 1.10 notes add **welds** that
  make a group act as one brick and advise keeping weld groups small to keep destruction [25].
  The damage formula is not published.
- **Robocraft** (classic): blocks not connected to the pilot seat are destroyed [26] —
  the same "not connected to the anchor → falls off" rule this game wants.

Stud-connectivity graph cost, measured (`/tmp/brickwake-research/exp/connectivity.ts`,
Bun on M4 Pro): a generated hull shell (72×24 studs, 40 plates tall, running bond, two
decks) with **3,475 parts / 13,666 stud edges** builds its graph in **2.5 ms** (hash of
each part's bottom-face stud cells, lookup of each part's top-face cells), a full flood
from the keel takes **57 µs**, and a hit (remove parts within 1.5 studs, flood, drop the
unreached) takes **p99 0.23 ms**. Cost is linear in parts, so 5,000 parts is < 5 ms at
load and < 0.1 ms per hit. No incremental-connectivity structure is needed.

Bond quality decides whether damage stays bounded: over 200 random hits, a thin 1-stud
brick shell detached up to **141 parts** from one hit; a 3-stud plate-stacked shell
detached at most **10**. Bounded damage is a generator guarantee (bond overlap, ribs,
decks), plus a cap in the damage rule.

## Recommendation

**Description format: a typed TypeScript `ShipSpec`, one per class.** Fields:
- `hull`: length/beam/depth in studs; a table of offsets (half-breadth at ~8 stations ×
  ~6 waterlines, interpolated) or the separable form (plan curve, sheer, keel rise, one
  section shape); stern transom rake; tumblehome.
- `strakes`: color bands as height ranges that follow the sheer (black bottom, dark-red
  wale, gold trim lines, black topsides).
- `decks` (heights), `castles` (stern castle and forecastle extents and levels),
  `gunRows` (deck, count, spacing, sub-assembly), `masts` (x, height, tops, yards),
  `sails` (cloth, texture), `rigging` (shrouds/ladders as instanced chains).
- `ornaments`: named sub-assemblies placed by anchor (`sternWindow`, `lantern`,
  `skullPlaque`, `wheelOrnament`, `railPost`, `cannon`, `gunPortFrame`), mirrored unless
  marked single.

**Pipeline (description → parts), deterministic from a seed:**
1. Rasterize: per plate course z, half-breadth at each stud column x → a 2D occupancy
   mask, mirrored. Keep a 2–3 stud shell, deck plates, and a rib every N studs.
2. Carve openings (gun ports, windows) and reserve cells for sub-assemblies.
3. Finish edges: where the outline steps between courses, put slopes (tuck-in) or
   inverted slopes (flare) on the exposed edge, Bricker/Zhou style; curved slopes and
   wedge plates on bow/stern plan curves if the part set has them.
4. Pack each course into bricks/plates with a running bond: longest-first greedy with a
   seam-offset rule against the course below and color boundaries from `strakes`
   (Testuz/Luo merge heuristic; no optimizer needed at this size).
5. Place sub-assemblies at their anchors and add their explicit connection edges.
6. Validate: no overlaps, every part reachable from the keel, part count in range, and a
   worst-case detached-part count per probe hit under the cap. Fail the build otherwise.
7. Emit `parts[] = {partId, color, transform}`, `edges[]`, and an LDraw `.ldr` for
   viewing in LDView/Studio. Parts use LDraw IDs, which fits candidate C (own meshes keyed
   by LDraw number) or B.

**Who authors:** code does the hull, packing, bonding and validation, the parts LLMs get
wrong (BrickAGI). An agent authors and tunes the `ShipSpec` numbers and writes each
sub-assembly once as small code on a local grid, iterating from screenshots. Joel judges
only the final result.

**Checking against the refs:** the ship lab renders fixed cameras that match ref-01
(stern quarter, low) and ref-02 (broadside along the gun decks) with the game's lighting.
The agent answers a fixed checklist per view (CADCodeVerify-style): stern castle height ≈
hull depth, lanterns at stern corners, two visible gun rows with gold frames, color
strake order, skull ornaments present, sail skull readable. Geometry is checked by
numbers, not VLM: silhouette height/length ratios, part count, gun count, connectivity.

**Connectivity and damage:** nodes = parts; edges = stud overlaps between a part's top
face and the part above plus explicit sub-assembly/SNOT edges; anchor = keel parts. Built
at load (~5 ms). A hit removes the parts inside an impact radius up to a max count, then
one flood from the anchor; unreached parts fall as debris. Only removed part IDs go over
the network; every client derives the detached set from the same graph. Masts and
castles are sub-graphs with a few strong edges, so they only fall when their base is gone.
Large rigid decorations can be welded (one node), like Brick Rigs.

## Contradictions with the design doc

- Candidate A's risk ("curves become steps … Minecraft") overstates the problem: the refs
  themselves show stepped brick walls. Steps at plate resolution with slope finishing and
  detail sub-assemblies read as Lego; smooth curves are not required.
- Candidate B's selling point ("editable in BrickLink Studio") does not matter when nobody
  edits by hand. LDraw is useful as the part-ID namespace and a debug viewer format,
  which C already keeps.
- "HP decides gameplay; brick loss is the visible record": connectivity falloff means one
  hit can remove more than the impact radius. The cascade has to be bounded by the
  generator's bonding and a cap, or the HP–brick-loss match drifts.

## Open risks

- Plan-view curves at bow and stern with only rectangular parts may still look boxy; this
  depends on whether the part set has wedge plates and curved slopes (rendering researcher).
- Real SNOT hull skins need sideways connections on the stud grid; the rasterizer above
  is studs-up only. Adding SNOT means a second grid orientation for the side skin.
- VLM checks are 64–68 % accurate [18]; screenshot iteration needs numeric checks
  alongside and a human look at milestones.
- Rigging and rope ladders in the refs are hundreds of link parts; they should be
  instanced cosmetics, not damage-graph nodes.
- Bricker and hbmartin/legolization are GPL-3: read them, don't vendor them.

## Sources

1. Testuz, Schwartzburg, Pauly. *Automatic Generation of Constructable Brick Sculptures*. Eurographics 2013 short papers. https://diglib.eg.org/items/82e2ee53-fa57-4929-ac81-85acd0d9f855
2. Luo et al. *Legolization: Optimizing LEGO Designs*. ACM TOG 34(6), SIGGRAPH Asia 2015. https://www.cs.columbia.edu/~yonghao/siga15/luo-Legolization.pdf
3. Kollsker, Malaguti. *Models and algorithms for optimising two-dimensional LEGO constructions*. EJOR 2021 (text in [7] `references/`).
4. Zhou, Chen, Xu. *Automatic Generation of Vivid LEGO Architectural Sculptures*. CGF 2019, doi:10.1111/cgf.13603.
5. Pun et al. *Generating Physically Stable and Buildable Brick Structures from Text* (BrickGPT). arXiv:2505.05469; code https://github.com/AvaLovelace1/BrickGPT (`src/brickgpt/data/brick_library.json`, `models/brickgpt.py` `world_dim=20`).
6. Bricker source (Christopher Gearhart), https://github.com/miklobit/bricker
7. hbmartin/legolization, https://github.com/hbmartin/legolization (README, ROADMAP "Research traceability").
8. Eurobricks, *How to design hulls*, https://www.eurobricks.com/forum/forums/topic/195808-how-to-design-hulls/
9. Eurobricks, *[Tutorial] MOC SNOT Base*, https://www.eurobricks.com/forum/forums/topic/183047-tutorial-moc-snot-base/
10. US Naval Academy EN400 course notes, ch. 2 (hull form, lines plan, table of offsets). https://www.usna.edu/NAOE/_files/documents/Courses/EN400/02.02%20Chapter%202.pdf
11. Corsairs (Godot, MIT), https://github.com/Elkhan-Isayev/corsairs `scripts/ship_visual.gd`
12. bpyhullgen, https://github.com/edzop/bpyhullgen
13. McCulloch, feasible-form-parameter-design, https://github.com/LukeMcCulloch/feasible-form-parameter-design
14. Brickset review, 70413 The Brick Bounty, https://brickset.com/article/14304
15. Brickset review, 21322 Pirates of Barracuda Bay, https://brickset.com/article/49409
16. BrickAGI, https://github.com/withtally/brickagi (README, v1.5 baselines).
17. MC-Bench backend, https://github.com/mc-bench/mc-bench-backend (`src/mc_bench/apps/server_worker/js_scripts/build.js`).
18. Alrashedy et al. *Generating CAD Code with Vision-Language Models for 3D Designs* (CADCodeVerify). ICLR 2025. https://proceedings.iclr.cc/paper_files/paper/2025/file/81a934cd364e18ea6fdeaf57a93c17d4-Paper-Conference.pdf
19. Gu et al. *BlenderGym*. CVPR 2025. https://blendergym.github.io/
20. Teardown modding docs, https://www.teardowngame.com/modding/
21. Steven Wittens, *Teardown Frame Teardown*, https://acko.net/blog/teardown-frame-teardown/
22. Dennis Gustafsson on Software Engineering Daily, https://pod.wave.co/podcast/software-engineering-daily/teardown-and-voxel-based-rendering-with-dennis-gustafsson-0b4d6e9b
23. GearBlocks devblog, *Damage is done*, https://www.gearblocksgame.com/2018/12/07/damage-is-done-well-it-took-me-long-enough-but/
24. Besiege wiki, block break forces, https://besiege.fandom.com/wiki/Category:Blocks
25. Brick Rigs 1.10 official feature list, https://steamcommunity.com/app/552100/discussions/0/737034666592307465/
26. Robocraft wiki, Pilot Seat, https://robocraft-archive.fandom.com/wiki/Pilot_Seat
