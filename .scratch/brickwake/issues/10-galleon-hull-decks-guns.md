# Galleon: decks, castles and cannons

Type: task
Status: resolved
Blocked by: 09

## Question

Complete the galleon's body as a premium pirate ship in the refs' design language:
two gun decks with framed gun ports and cannons (matching the gun-layout module),
forecastle and tall quarterdeck with stern windows and gallery, gold trim, rails and
posts, skull plaques, lanterns, figurehead. Sub-assemblies written once, placed by
anchor and mirrored. Spec: Brick ships, ref-01/ref-02.

## Done when

- Screenshots at the ref-01 and ref-02 cameras: someone who sees them says “Lego pirate
  galleon” at a glance; checklist per view and numeric checks (silhouette ratios, gun
  count, connectivity, part count) reported in the Answer.


## Answer

- Built: two gun decks, 12 ports a side, each with a proud dark-red frame and gold lintel and a cannon whose muzzle clears the frame by 2 studs; forecastle, quarterdeck and poop with balustrades, rail posts, 14 lanterns, helm, stern and bow skull crests; transom with 12 glazed stern windows (two tiers) between gold pilasters, a gold gallery ledge with rail and lanterns.
- Entry points: `src/sim/ship/assemblies.ts` (cannon, lantern/rail posts, balustrade, gallery rail, plaque, helm, figurehead; written once) placed by `placeAssembly(assembly, x, y, z, turns, mirror)` in `generate.ts` from `ShipSpec.gun`/`ornaments`/`stern`/`gallery`/`portFrame` (`spec.ts`). Tile decks become plates under anything standing on them.
- LOD: `BrickShipMesh(library, placements, plugs)` + `updateDetail(camera, viewportHeight)`; near = chamfered + studs, mid = flat shapes sharing draws + 6-sided studs, far = flat, no studs, interior (reached only through ports) swapped for dark port plugs. Bands in px/m with hysteresis: near ≥ 26 / mid < 22, far < 7.5 / mid ≥ 9 (`brickDetailFor`). `remove(i)` removes a part from all levels with the plug it owns.
- Numbers (galleon): 4,323 parts, 7,247 stud edges, 0 validation issues, 2 pruned (stem tip), 24 cannons = 24 ports = `gunLayout`, all ornaments attached to the keel. Rendered: near 3,534 parts / 704 studs / 236.4k tris / 36 draws; mid 60.9k / 12; far 2,846 parts / 40.3k / 11. Build 10.9 ms, generate ~155 ms.
- Silhouette: LOA 28.4 m, beam 9.6 m (L/B 2.96); tops above waterline: poop 6.40 m, quarterdeck 5.44, waist 4.80, forecastle 5.44 (stern/waist 1.33).
- Fleet (12 ships at 31–400 m, 3 near / 6 mid / 3 far, 1.20M tris, 213 draws), DPR 1.5 (2592×1675), M4 Pro, 4096 shadows + bloom: 7.2 ms median, 8.1 p90 (3.9 ms pipelined). All 12 forced near: 9.8 ms; no shadows 5.5; one ship 4.7.
- Popping: pixel diff at the switch distances (lod-mid, lod-far cameras): near→mid mean 4.1/255 after a 2 px blur, luminance 65.6→66.9, diff lies only on 1 px brick seams and lantern outlines (no silhouette change); mid→far 0.8/255.
- Proof: `bun run shot:galleon` → `.shots/galleon-{ref-01,ref-02,side,bow,stern,top,guns,fleet}.png`, `galleon-lod-{mid,far}-{near,mid,far}.png`, stats + fleet timings on stdout. `bun test src` 79 pass (ornaments present and attached, assembly turn/mirror, pruned ≤ 2, budget per level, hysteresis, removal across levels, interior classification); typecheck clean.
- Checklist ref-01: dark hull with red/gold bands ✓, two framed gun tiers with cannons ✓, tall stern with glowing windows and crest ✓, lanterns on castle corners ✓; ref-02: cannon row jutting from framed ports ✓. Without masts it reads as a Lego gunship; "pirate galleon" needs ticket 11's rig and black sails.
- For 11: rig budget left at near is ~63k tris and 9 draws (≤ 300k / 45). Deck tops for mast steps: waist top plate 43 (4.80 m), keep mast feet off ornament cells (listed in `galleonSpec.ornaments`); mid/far layers must get rig equivalents or the rig pops.
- For 12: removal already updates all three levels and plugs; `BrickShipMesh` still cannot add instances, and exposure/interior are computed once, so a hit that opens the hull shows no newly exposed parts until pools are pre-sized or rebuilt.
- Gaps: pearl gold still reads tan under sunset; hull floats with the dark-red boot-top above the flat stand-in sea; near→mid loses brick seams (small, measured above); the cannon barrel is 1.25× thicker and 1.2× longer than the real part so it reads at game distance.
