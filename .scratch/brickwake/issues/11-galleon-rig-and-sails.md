# Galleon: masts, sails and rigging

Type: task
Status: resolved
Blocked by: 10

## Question

Add masts and yards (brick sub-graphs joined by strong edges), cloth sails with
canvas pixel-art textures (black with white skull; navy white/red lion and blue/white
fleur-de-lis variants; FFA colours), flags, rigging and ratlines as cosmetic meshes
within budget, wind-driven cloth motion, sail furl levels 0/1/2. Spec: Brick ships,
Rendering budget.

## Done when

- Full-ship screenshots next to ref-01 and ref-02 read as a premium galleon.
- 12 full ships at 120 fps at DPR 1.5 with shadows, measured and reported.

## Answer

- Built: three masts (fore on the forecastle, main in the waist between upper ports, mizzen on the quarterdeck) as brick sub-assemblies: a cross-bonded 4×4 plate step, 77 round bricks 2×2 (`3941`, the only new shape), yards of two staggered 1-wide plate courses on the mast's forward stud row (tiled except where the mast stands), crow's nests on fore and main. Cosmetic: 8 square sails + jib in one mesh, jolly roger, two pennants and a stern ensign in one mesh, shrouds, ratlines, stays, backstays, lifts, bobstay, bowsprit and flagstaffs in one mesh.
- Entry points: `src/sim/ship/rig.ts` (`RigSpec`/`galleonRig` as mast sections bricks|yard|nest, `rigParts`, `rigLayout(spec)` in ship metres); `ShipSpec.rig`; `generateShip` reserves rig cells and appends rig parts unmottled. Client: `src/client/rig/ship-rig.ts` (`buildRigGeometry(layout)` once per class, `ShipRig` per ship), `src/client/rig/sail-livery.ts` (liveries, pixel-art atlas). Lab: `camera=rig|rig-bow`, `sail=0|1|2`, `livery=pirate|navy-lion|navy-fleur|ffa-<n>`, `windX/windZ`; `brickLab.setSailLevel/setLivery/setWind/rigStats`.
- Galleon: 4,518 parts (203 rig), 7,480 edges, 0 issues, 2 pruned, generate ~125 ms Bun / ~170 ms Chrome. Main truck 20.3 m above the waterline, main course yard 11.2 m.
- Budget per ship (hull + rig): near 269.4k tris / 40 draws (rig bricks ~28.5k + 1 draw, cosmetic 4.5k + 3 draws); mid 71.9k / 15; far 46.9k / 14 (cosmetic 2.8k: ratlines and lifts dropped via draw range). Mast bricks use the hull's flat mid/far shapes, sails and flags stay at every level: pixel diff at the switch distances (1 px gaussian, luma) near→mid 0.75/255, mid→far 0.05/255.
- Fleet of 12 (3 near / 6 mid / 3 far, 1.38M tris, 252 draws), DPR 1.5 (2592×1675), 4096 shadows + bloom, M4 Pro: 7.8 ms median, 8.8 p90, 4.2 ms pipelined (was 7.2 / 8.1 / 3.9 without rig). All near 10.6; no shadows 6.1; one ship 4.8.
- Proof: `bun run shot:galleon` → `.shots/galleon-{ref-01,ref-02,rig,rig-bow,sail-1,sail-0,navy-lion,navy-fleur,ffa,fleet}.png` plus the LOD set. `bun test src` 101 pass: rig parts present and on the keel, mast feet off ornament cells, one lost deck part leaves a mast standing and losing its step drops exactly that mast, each sail hangs from a yard part, cosmetic < 20k tris, full ship ≤ 300k / 45.
- Checklist: three masts, square black sails, white skull on the main course, crow's nests, bowsprit with jib, ratlines, jolly roger and red pennants ✓. The ref-01/ref-02 cameras now look up at the sails (target raised 3.1 m and 2 m); from astern the mizzen hides most of the skull, from the bow it reads at once.
- For 13: `const rig = new ShipRig(buildRigGeometry(rigLayout(spec)), livery)`, `mesh.root.add(rig.root)`; per frame `rig.update(dt, windX, windZ)` with the world wind velocity (`windVelocity(wind)`, m/s) and `rig.setDetail(mesh.detail)`. `rig.setSailLevel(0|1|2)` animates furl at 0.6 openness/s (open 0 / 0.55 / 1; `rig.openness` reads it). Billow, luffing and flag streaming are vertex-shader only, with a matching shadow depth material; no per-frame allocation.
- For 18: `rig.setLivery(pirateLivery | navyLionLivery | navyFleurLivery | ffaLivery(ffaColors[n]))`; one 256² atlas per livery name, shared, regions in `atlasRegions`.
- For 14/15: `rigLayout(spec).sails[i].cell` is a grid cell of the yard part sail `i` hangs from; `rig.setSailShown(i, false)` hides it (jib index = `sails.length`). Masts are 4 plate step parts then bricks; the step bonds to ≥ 2 deck parts.
- Gold: pearl gold now `#c9a04a`, metalness 0.6, roughness 0.3; it reads gold rather than tan under the sunset.
- Gaps: flags, ropes and the bowsprit do not fall with a mast yet (15); yards are fixed square (bricks), so no bracing to the wind; sails show one print on both faces (lion mirrored from ahead); ropes are thinner than a pixel beyond ~100 m.
