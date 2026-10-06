# Spatial rendering (Phase 5)

Preview, public and embed viewers build a separate visual tree from the prepared
Phase 4 model/layout. Builder views retain individual authored meshes. Add
`spatial=0` to the viewer query string to use the original visual tree for comparison.
Navigation, approved floors and hotspot occlusion always use the authored tree.
The tree is never reparented, simplified or hidden by visual LOD.

Compatible opaque static meshes are grouped into 8-metre world-space cells.
Meshes sharing geometry and equivalent material settings become instances;
remaining compatible meshes are merged in groups of at most 65,536 vertices.
Merged geometry is capped at 500,000 vertices per view; excess meshes retain their
original draw path. Material maps/sampler identity, layers, shadow flags, render
order, vertex schemas and culling settings must match. Transparent, skinned,
morphing, mirrored, sheared, animated and custom-shader objects remain separate. Animation
subtrees retain their original mixer bindings and hierarchy. A module containing
animation is conservatively excluded as a whole. Set `runtimeSeparate` in prepared
object userData to exclude additional subtrees.

`runtimeInstances` records each instance's authored mesh/path/layout element.
`runtimeSurfaces` records merged triangle ranges with the same identities.
`resolveRuntimeSurface()` resolves an instance ID or triangle index. Builder
selection and material editing continue to use individual authored geometry;
material assignments are applied before compatibility grouping. No new floor
approvals are inferred.

Repeated small decorations get detailed, medium and simplified index variants,
using Meshopt's attribute-aware simplifier with locked borders, normals/UV weights
and relative geometric error limits of 0.001/0.003. Medium and simplified targets
are 60%/30% of the original index count; error limits can prevent those ratios.
Variants are generated after WASM readiness, with a total 200,000-vertex processing
cap. Static single meshes may opt in with `visualLOD` in prepared userData.
Approved floors, objects named as walls/floors/doors/stairs/ceilings/openings/frames,
and objects exceeding 3 metres retain detailed geometry. Merged structural
surfaces are never simplified. Missing simplifier support retains detailed meshes.
This conservative runtime implementation does not add persisted LOD derivatives
or reduce downloaded geometry bytes. Large/unclassified objects retain detail.

LOD uses projected bounding-sphere diameter in CSS pixels (180/60 thresholds),
15% hysteresis, and conservative near-side depth. A camera intersecting the sphere
forces detail. Instances use their complete group sphere, so nearby members retain
detail. Original full-detail bounds remain valid for every LOD. Variant attributes
and merged buffers are owned by the visual tree; source geometry/materials/textures
remain shared and are never disposed by it. Geometry variants add bounded memory;
actual mobile CPU preparation and memory costs still need device measurements.

## Verification

From `web/`:

- `npm run build` and `npm test`.
- `npm run dev -- --port 5174`, then `npm run test:spatial-rendering`.
- `TOUR_ORIGIN=http://localhost:5174 npm run test:performance`. Set `SPATIAL_RENDERING=0` for the original visual comparison; the runtime-assets browser test supports the same switch.
- Existing quality, runtime-assets, hotspots and fan browser checks.

The standalone Chromium SwiftShader fixture has 120 repeated spheres. Its
[recorded report](performance-baselines/phase5-spatial-rendering.json) shows 120
calls becoming 1, with 357,120 detailed triangles becoming 266,400 at distance.
Twenty prepare/render/dispose cycles retain one shared GPU geometry and show no
increase in the renderer's geometry counter. These are draw/triangle/ownership
checks, not physical-device FPS or exact VRAM measurements. Coarser group culling can increase rendered triangles; compare draw calls and geometry cost together. Unit checks cover
surface mappings, transforms, chunk culling bounds, exclusions, hysteresis,
original occlusion despite hidden render geometry, and identical navigation.

The existing 64-table scene also has a
[same-browser enabled/disabled comparison](performance-baselines/phase5-furniture-comparison.json):
peak calls decrease from 109 to 29, but triangles increase from 1,068 to 3,900.
The original run includes a zero-draw loading frame, so peak counts are used here.
These short demand-rendering samples establish the culling tradeoff, not sustained
walkthrough performance or an optimal cell size. Adjust cell sizes only with
CPU/GPU measurements on the target devices.

Remaining acceptance: physical-device comparisons, sustained walkthroughs,
reviewed LOD silhouettes/transitions for real uploads, and room metadata/chunk
streaming in Phase 6. The earlier public courtyard-exit walking regression remains
outside this phase's acceptance evidence. Persistent/offline LOD generation can
follow profiling; no runtime variant can alter navigation permissions.
