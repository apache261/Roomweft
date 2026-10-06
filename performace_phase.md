# Performance — Phased Implementation Plan

Based on [performance.md](performance.md). This document turns the performance proposal into ordered implementation phases with expected improvements and acceptance criteria.

Status: Phase 1 instrumentation/fixtures, Phase 2 quality/idle rendering and Phase 3 hotspot CPU optimizations and Phase 4 runtime asset processing and Phase 5 spatial rendering and Phase 6 conservative room visibility/modular streaming and Phase 7 reviewed baked lighting/provisional HQ shadows implemented; physical-device baselines and profiling acceptance remain pending. No phase is marked fully complete. Expected improvements must be confirmed by measurement.

## Scope and working rules

- Improve walkthrough responsiveness, loading, memory use, and visual quality across phones, tablets, and computers.
- Preserve movement, collision, approved floors, material assignments, hotspots, and navigation references across all quality settings and runtime variants.
- Keep original uploads and the existing validated loading path available while optimized derivatives are unavailable.
- Compare each phase against the same benchmark scenes and devices before expanding scope.
- Introduce background processing, room streaming, and expensive rendering effects only when their prerequisite phases are ready.

## Phase 1 — Establish benchmarks and performance budgets

Implementation status: tooling implemented; physical-device acceptance pending. The code observations in `performance.md` remain candidates for investigation, not proven bottlenecks.

Implemented evidence:

- Six versioned benchmark scenes, upload manifest/hashes, and `npm run demo:performance`.
- Development-only `?perf=1` diagnostics shared by builder, preview, public and embed: frame percentiles, CPU submission proxy, multi-pass render counts, resource/texture inventory, decode/collision timing, first usable rendered view and JSON download timings.
- Repeatable measurement/profiling procedure in [docs/performance-benchmarks.md](docs/performance-benchmarks.md) and provisional device targets in [docs/performance-budgets.json](docs/performance-budgets.json).
- Headless browser smoke evidence for all six scenes in [docs/performance-baselines/chromium-smoke.json](docs/performance-baselines/chromium-smoke.json); this is software rendering, not a physical-device baseline.
- Preliminary hotspot CPU attribution and compressed DevTools profile in [docs/performance-baselines/hotspots-cpu-summary.json](docs/performance-baselines/hotspots-cpu-summary.json). This is a short software-renderer sample with concurrent browser activity, not production bottleneck proof.
- Frontend build and 36 unit tests passed; browser instrumentation checks passed across all six scenes, builder and embed. The existing hotspot browser acceptance check also passed with the source frontend proxy (placement, occlusion, pointer lock, popup pause, panorama, public/embed and emulated touch). The existing fan animation browser check passed in standalone, imported layout, public and embed modes after applying the project’s existing local Fiber Timer compatibility patch and refreshing Vite’s dependency cache.

Browser regression evidence: the alternate local dev port requires the source frontend proxy for storage CORS. The recorded Phase 2 full walking browser check passed, including the previously failing public courtyard exit, reviewed imports, locked thresholds, local/cross-scene exits and returns, and emulated touch. The historical Phase 1 run alone did not establish full browser acceptance. See Phase 3 for the courtyard-exit failure reproduced in the current run.

Remaining: sustained physical-device walkthroughs across the five device classes, reviewed CPU/GPU profiles, per-device loading/geometry/texture/memory budgets and measured regression thresholds. These require device measurements; pending values remain explicit rather than invented.

Implement:

- Prepare benchmark scenes for a small house, large modular interior, repeated furniture, texture-heavy uploads, animations, and many hotspots.
- Add development diagnostics for frame-time median, p95 and p99, draw calls, rendered triangles, and resource counts, including additional rendering passes.
- Measure download size, time to first usable view, decoding, and collision preparation separately.
- Record texture dimensions and estimated GPU memory; label estimates as proxies rather than exact VRAM measurements.
- Profile CPU, GPU, loading, and memory costs. Record device, browser, viewport, quality setting, and scene revision with each run.
- Test sustained walkthroughs on physical lower-end and midrange phones, tablets, integrated-GPU laptops, and desktops.
- Set provisional targets of approximately 60 FPS on supported desktops and stable 30 FPS on lower-end phones. Establish final budgets and regression thresholds from the measurements.

Expected improvements:

- Identify which changes will produce measurable benefits and provide repeatable evidence for later phases.

Done when:

- Every benchmark has a recorded baseline and repeatable procedure.
- Supported device classes have initial frame-time, loading, geometry, texture, and memory budgets.
- The highest-cost operations are identified with profiling evidence.

## Phase 2 — Add quality settings and safe idle rendering

Implementation status: code implemented; physical-device comparisons and final thresholds pending. Uses Phase 1 instrumentation; its physical-device acceptance remains pending.

Implemented evidence:

- Auto, Low, Balanced and HQ controls across builder, preview, public and embed, with saved manual preferences and pixel ratio caps of 1, 1.5 and 2.
- Capability-aware Auto initialization, sustained averages, separate thresholds, cooldowns, conservative CPU deferral and a reversible resolution-benefit trial. Interrupted/unhelpful trials restore the previous tier.
- Demand rendering with explicit camera/material/lighting/input/overlay invalidation, movement/braking/bob/height-smoothing and orbit gesture/damping scheduling, plus imported clips and layout-instance animation scheduling.
- Hidden documents stop rendering; held inputs and simulation velocity clear, navigation wake-up skips elapsed idle/hidden time, and visible animations retain their intended speed.
- Diagnostics distinguish all rendered frames from continuous frame-time samples so idle gaps do not become FPS regressions. Visible stalls remain recorded.
- Build and 43 unit tests pass. Quality browser checks pass across the four viewer modes, including manual persistence, no position change on quality selection, simulated visibility, animation, and mobile control layout. The recorded Phase 2 hotspot, visual fan and full walking acceptance checks passed; all six benchmark scenes passed with demand rendering.
- [docs/viewer-quality.md](docs/viewer-quality.md) documents the policy and procedure. [phase2-quality-smoke.json](docs/performance-baselines/phase2-quality-smoke.json) records zero frames in each settled 800 ms idle window at native DPR 2 with the three caps. [phase2-chromium-smoke.json](docs/performance-baselines/phase2-chromium-smoke.json) preserves the separate six-scene software-renderer reports.

Remaining: same-device physical comparisons, actual background-tab behavior across supported browsers, sustained thermal runs, and production regression thresholds. Software-renderer checks and simulated visibility are not physical-device acceptance. The earlier courtyard-exit failure did not reproduce in the final Phase 2 walking acceptance run.

Primary integration point: `web/src/SceneViewer.tsx`, plus camera, movement, animation, and viewer settings code.

Implement:

- Add Auto, Low, Balanced, and HQ settings with a persistent manual override.
- Cap pixel ratio explicitly, starting with Low: 1, Balanced: 1.5, and HQ: 2. Treat these as provisional values.
- Let Auto respond to sustained frame times and supported capabilities. Use averaging, different upgrade/downgrade thresholds, and cooldowns.
- Reduce resolution when profiling shows a GPU pixel-cost bottleneck; address draw calls or update work when CPU-bound.
- Render on demand while idle. Invalidate for camera changes, edits, loading, and overlays; continue scheduling frames during movement, damping, and animation.
- Pause unnecessary work when the page is hidden and resume without stale movement or large simulation steps.
- Keep navigation and collision behavior independent of quality settings.

Expected improvements:

- Reduce excessive rendering resolution and idle GPU work.
- Stabilize performance through gradual quality changes while retaining user control.

Done when:

- Manual settings survive reloads, and Auto avoids repeated switching near thresholds.
- Walking, orbit controls, animation, loading, and overlays update correctly with on-demand rendering.
- Returning from a hidden tab does not cause unintended movement.
- Baseline comparisons show the effect of resolution caps and reduced idle work on supported devices.

## Phase 3 — Reduce hotspot and per-frame CPU work

Implementation status: code implemented; physical-device CPU/frame-time comparisons pending. Uses Phases 1–2 tooling and demand rendering; their physical-device acceptance remains pending.

Implemented evidence:

- Full camera-view rejection before raycasts, including horizontal/vertical bounds and panorama markers.
- One shared visibility evaluator for markers and reticle targeting, with retained marker/projected vectors, reusable ray/intersection buffers and DOM writes only when values change.
- Visible camera-layer mesh inventory and world-space box rejection before direct mesh raycasts, with early exit at the first blocker and existing surface tolerance.
- Cached results invalidate on camera/projection, scene membership/visibility/layers, transforms, geometry/index versions and material changes. Skinned, instanced and morph occluders use conservative per-rendered-frame invalidation; ordinary animated transforms refresh bounds.
- Builder reveal and visitor/reticle occlusion remain separate policies. No extra timer or marker latency is introduced; demand rendering already suppresses idle updates. Room filtering awaits room metadata.
- Build and 46 unit tests pass, including off-screen rejection, moving walls, cache reuse/invalidation and conservative instance occlusion. Existing hotspot browser acceptance, visual fan checks in standalone/imported/public/embed modes, and all six benchmark instrumentation scenes pass against the source frontend. The full walking check reaches the public courtyard-exit assertion but fails there; the same failure reproduces with the original pre-Phase-3 hotspot layer and visibility helper served through a temporary Vite transform.
- [docs/hotspot-performance.md](docs/hotspot-performance.md) documents behavior and the repeatable `npm run benchmark:hotspots` command. [phase3-hotspot-cpu.json](docs/performance-baselines/phase3-hotspot-cpu.json) preserves three before/after runs of the versioned 160-marker fixture; [phase3-chromium-smoke.json](docs/performance-baselines/phase3-chromium-smoke.json) preserves the separate software-renderer smoke reports.

Remaining: sustained same-device browser CPU/frame-time comparisons, CPU/GPU profile review, supported physical-device acceptance, and resolution of the reproduced public courtyard-exit walking failure. This run does not re-establish full walking acceptance. The Node visibility microbenchmark excludes DOM, GPU and total browser frame time; its improvements are not walkthrough FPS gains.

Primary integration points: `web/src/HotspotLayer.tsx` and `web/src/hotspotVisibility.ts`.

Implement:

- Reject markers outside the full camera view before performing occlusion raycasts.
- Restrict raycasts to relevant occluders using available spatial bounds; add room filtering after room metadata exists.
- Cache results until camera, scene, or animated occluders change. Evaluate a bounded update rate for noncritical markers.
- Share visibility results with reticle targeting where their rules agree.
- Reduce temporary allocations and avoid redundant DOM writes in frame callbacks.
- Preserve intentional builder reveal behavior and visitor occlusion behavior.

Expected improvements:

- Reduce recursive raycasts and main-thread work in scenes with many hotspots.
- Reduce allocation-related stutters during movement and interaction.

Done when:

- Many-hotspot benchmarks show measured reductions in visibility work and CPU frame time.
- Hidden markers, visible markers, reticle targeting, and moving occluders behave correctly.
- Builder editing and visitor interactions pass regression checks.

**First milestone:** measured baselines, controlled rendering resolution, safe idle behavior, and lower hotspot overhead.

## Phase 4 — Build validated runtime asset derivatives

Implementation status: code implemented incrementally; physical-device loading, memory and sustained walkthrough acceptance pending. Uses Phases 1–3 instrumentation and quality controls.

Implemented evidence:

- Verified Meshopt decoding and renderer-aware KTX2/Basis transcoding, with locally served decoder assets. Draco remains unsupported. Unsupported processing inputs retain the original loading path.
- Persisted PostgreSQL processing queue with queued/processing/ready/failed states, recoverable leases, attempt identity, bounded processing, retry controls and private immutable output keys. The manifest becomes visible only after every validated output uploads successfully; failed uploads and stale attempts clean up their own outputs.
- Conservative GLB validation, accessor deduplication/pruning, lossless index ordering and Meshopt compression. Runtime mesh paths, world geometry, transforms, skin/morph data, clips, UVs and material semantics are checked before publication.
- Embedded and external material textures receive 1024/2048/4096 maximum-dimension PNG variants with preserved aspect ratio and alpha. Scene-wide RGBA8-plus-mips proxy budgets are provisionally 64/192/384 MiB. Diagnostics identify unknown original costs and scenes that exceed even Low; these are not measured VRAM limits.
- Exact geometry-only collision proxies preserve authored floor approvals, walls, openings and steps. No lossy simplification or automatic floor approval is introduced. Small assets skip a proxy download when the combined bytes would exceed their original.
- Versioned, hashed manifests and source-to-runtime surface mappings preserve material overrides and navigation references. Verified variant failures fall back to original files; proxy failures use exact visual geometry.
- Shared decoded model/texture ownership, capability-scoped caches and signed-URL-independent identities support scene revisits. Prepared collision/floor datasets are reused by geometry/configuration revision, with invalidation for transforms and approvals. Active resources cannot be evicted; unowned resources have bounded caches and a disposal grace period.
- Quality changes preserve standing/orbit pose, navigation permissions and animation phase. Auto changes asset tiers only after accepting its resolution trial, avoiding downloads during temporary DPR probes.
- Backend tests cover queue recovery, stale attempts, partial uploads, atomic publication, original preservation and public access policy. A real local API/PostgreSQL/MinIO run verifies GLB and external normal-map processing; evidence is in [phase4-worker.json](docs/performance-baselines/phase4-worker.json). Frontend unit tests cover identity, fallbacks, navigation reuse/invalidation, ownership and aggregate texture budgets.

Validation and measured evidence:

- Frontend production build, 51 frontend tests, three processor tests, all Go tests with PostgreSQL integration and `go vet` pass. Native upload/processing checks include GLB and external alpha-bearing normal maps.
- [phase4-runtime-assets.json](docs/performance-baselines/phase4-runtime-assets.json) records Meshopt, actual Basis/KTX2 transcoding, embedded texture tiers, standing/orbit pose, fan animation, exact proxy and missing/corrupt derivative fallback checks across builder, preview, public and embed.
- [phase4-textures.json](docs/performance-baselines/phase4-textures.json) records four external 2048 textures loading as 1024 in Low and 2048 in Balanced, with public/embed checks and original fallback. Halving both dimensions reduces this RGBA8 texture estimate by approximately four times; PNG delivery bytes are recorded separately. The textured GLB drops from 2,660,252 source bytes to 70,148 Low bytes; the small fan grows from 9,888 to 11,804 bytes, so delivery improvements are asset-dependent.
- [phase4-navigation-cpu.json](docs/performance-baselines/phase4-navigation-cpu.json) records a 601-mesh fixture: median rebuild 157 ms versus 1.2 ms cached, with unchanged cache entries/owners through 100 repeated worlds. Repeat with `node web/scripts/benchmark-navigation.mjs`. This excludes network, decode, DOM, GPU and walkthrough FPS.
- [phase4-chromium-smoke.json](docs/performance-baselines/phase4-chromium-smoke.json) records all six instrumentation scenes. The existing quality, hotspot and visual fan browser checks also pass against the source frontend, including idle rendering, persistence, damping, hidden resume, placement, occlusion, pointer lock and touch emulation. These headless software-renderer checks are not physical-device acceptance.

Procedure and limitations: [docs/runtime-assets.md](docs/runtime-assets.md). Remaining acceptance includes physical-device before/after download/decode/navigation/memory measurements, sustained scene changes, supported mobile GPU formats, production texture budgets and the existing public courtyard-exit walking regression described in Phase 3. Docker image validation is pending because this session cannot access the Docker daemon. Exact proxies prioritize correctness; they do not reduce collision triangle counts.

Primary integration points: `web/src/PreparedGLTFLoader.ts`, `web/src/navigation.ts`, `web/src/TriangleIndex.ts`, and asset storage/API processing.

Implement in this order:

1. Add and verify Meshopt or Draco decoding and KTX2/Basis transcoding before serving compressed variants. Check supported texture formats at runtime.
2. Introduce background processing with explicit states and actionable errors. Preserve the original asset on every failure.
3. Validate source assets, remove unused data, deduplicate compatible resources, and optimize vertex/index data.
4. Generate texture variants and suitable mipmaps. Start with 512–1K for Low, 1–2K for Balanced, and selective textures up to 4K for HQ; enforce measured total texture-memory budgets too.
5. Generate reviewed collision proxies that preserve walls, openings, steps, head clearance, and floor gaps. Do not automatically approve unreviewed floors.
6. Store versioned derivatives and a manifest containing bounds, available variants, and stable mappings to authored surfaces. Extend it with room and LOD metadata in later phases.
7. Validate transforms, animations, UVs, color spaces, transparency, materials, hotspots, and navigation references before publishing a manifest atomically.
8. Cache prepared navigation data by asset and configuration revision. Invalidate when transforms or floor approvals change; use workers with transferable data where profiling justifies them.
9. Manage shared resource ownership and safe disposal. Keep decoded asset identity independent of expiring signed URL strings, and respect private storage policies.

Expected improvements:

- Reduce delivery size, decoded texture memory, and navigation preparation cost.
- Make optimized assets reproducible and recoverable without losing authored identities.

Done when:

- Supported compressed variants load correctly, and unsupported or unavailable variants use a validated fallback.
- Processing failures cannot expose partial asset sets or remove originals.
- Material overrides, floor approvals, animations, and hotspot references survive optimization.
- Collision proxy validation confirms navigation correctness before use.
- Loading and repeated scene-change benchmarks show measured benefits without growing resource counts.

## Phase 5 — Add spatial batching, instancing, and LOD

Implementation status: conservative runtime code implemented; physical-device rendering comparisons and reviewed LOD transitions pending. Uses Phase 4 prepared assets and exact navigation data.

Implemented evidence:

- Separate visual trees in preview/public/embed; original authored trees remain responsible for collision, approved floors and hotspot occlusion. Builder selection/editing retains individual meshes. `?spatial=0` provides the original rendering comparison path.
- Compatible opaque static meshes instance or merge in 8-metre spatial cells, with bounded merge sizes and scene-wide merged-vertex limits. Animation subtrees, transparency, skins/morphs, mirrored/sheared transforms and custom shaders remain separate.
- Instance IDs and merged triangle ranges map to authored mesh paths/layout elements. Material overrides apply before grouping; source meshes, transforms and approvals remain unchanged.
- Attribute-aware, border-locked medium/simplified geometry for eligible small repeated decorations, with error limits, bounded generation and original-detail fallback. Projected screen diameter and 15% hysteresis choose detail; full-detail conservative bounds remain valid. Structural/floor geometry stays detailed.
- [phase5-spatial-rendering.json](docs/performance-baselines/phase5-spatial-rendering.json) records a Chromium SwiftShader fixture: 120 draw calls become 1; distant geometry drops from 357,120 to 266,400 triangles. GPU geometry counters remain stable through 20 prepare/render/dispose cycles. This is not physical-device FPS or exact VRAM evidence.
- [phase5-furniture-comparison.json](docs/performance-baselines/phase5-furniture-comparison.json) compares the existing 64-table fixture on the same source frontend/browser/viewport with spatial rendering enabled/disabled: peak calls fall from 109 to 29, while triangles rise from 1,068 to 3,900 due to coarser group culling. This demonstrates a draw-call reduction, not an established total frame-time benefit; chunk sizing needs physical-device profiling.
- Frontend production build and 57 unit tests pass. Six new unit checks cover authored identity mappings, transformed bounds, spatial grouping/exclusions, LOD hysteresis, whole-group floor/size protection, exact occlusion and unchanged approved navigation.
- All six benchmark scenes pass against the source frontend, recorded in [phase5-chromium-smoke.json](docs/performance-baselines/phase5-chromium-smoke.json). Existing fan animation checks pass in standalone/imported/public/embed views. Existing quality checks pass across builder/preview/public/embed, including idle, damping, hidden resume and animation; evidence is in [phase5-quality-smoke.json](docs/performance-baselines/phase5-quality-smoke.json). Existing hotspot checks pass against the source frontend proxy (placement, occlusion, pointer lock, popup pause, panorama, public/embed and touch). Runtime-asset checks pass with spatial rendering enabled and disabled, including Meshopt/KTX2, tiers, pose, collision proxies, fallbacks and fan animation; [phase5-runtime-assets.json](docs/performance-baselines/phase5-runtime-assets.json) preserves the enabled-run evidence. Short frame-count checks initially failed during concurrent software-renderer runs; individual quality and runtime-asset reruns pass. The runtime-asset comparison also passes with spatial rendering disabled.

Procedure and limitations: [docs/spatial-rendering.md](docs/spatial-rendering.md). LOD variants are bounded runtime products, not persisted/downloadable derivatives; scene download size is unchanged. Unclassified/large meshes remain detailed. Physical-device loading/preparation/memory comparisons, sustained walkthroughs and visual review of real-upload transitions remain pending. The earlier public courtyard-exit regression remains an outstanding acceptance item.


Implement:

- Batch compatible static surfaces within rooms or useful spatial chunks.
- Instance repeated compatible furniture and decorations in spatial groups that remain practical to cull.
- Keep animated, transparent, editable, or individually selectable objects separate where needed.
- Preserve mappings from runtime geometry to authored surface IDs for selection, material overrides, and approved floors.
- Generate detailed, medium, and simplified geometry variants. Select LOD by projected screen size with hysteresis.
- Preserve important silhouettes and doorway geometry, and maintain correct bounds for animated and instanced objects.
- Keep collision and floor queries independent of visual LOD and render visibility.

Expected improvements:

- Reduce draw calls and rendered triangles while preserving useful culling granularity.
- Improve performance in large interiors and scenes with repeated objects.

Done when:

- Relevant benchmarks show reduced draw calls or geometry cost.
- Selection, editing, materials, and floor approvals still resolve to the correct authored surfaces.
- LOD transitions meet visual review criteria, and objects do not disappear because of incorrect bounds.
- Navigation remains identical across visual variants.

## Phase 6 — Add room visibility and progressive streaming

Implementation status: conservative template-room visibility and modular GLB streaming implemented; physical-device and real-upload acceptance pending. Uses Phases 4–5 ownership, decoding, exact navigation and spatial rendering.

Implemented evidence:

- Explicit template bounds and doorway polygons form a visibility graph separate from navigation exits. Frustum/portal clipping follows multiple aligned openings, preserves adjoining rooms at doorway/camera-plane transitions, and uses conservative fallback for uncertain geometry, exterior and inspection views.
- Optional persisted `room_id` assignments with backend/frontend validation and a Plan **Load with room** control. Imported structural/open areas, standalone floors, animated or out-of-bounds assigned objects use conservative visibility/loading. Builder editing retains complete authored geometry.
- Independently addressable GLB chunks load the starting/occupied room and global assets first, then preload the adjacent doorway ring and visible rooms. Asset identity deduplicates references; source descriptors survive decoded eviction and scoped API refresh handles expired delivery URLs.
- Two concurrent requests, a 12-entry inactive room cache, active-resource leases and safe late-completion cleanup. Required sets can exceed this soft cache limit. Exact collision/floor preparation gates entry, saved starts and portal arrivals. Failed rooms retain boundaries with readable loading/retry states.
- Separate visual trees partition batches by room ownership, preserve shared-wall contributors and leave collision/floor approvals/hotspot occlusion unchanged. Streaming scene rebuilds preserve supported pose and held input; quality replacements retain the previous prepared scene until the occupied replacement is ready. Realtime shadow maps conservatively request/render all contributors.
- Frontend build and 66 unit tests pass; Go tests with PostgreSQL integration and `go vet` pass. New tests cover portal clipping, boundaries, shared-wall grouping, cache concurrency, failures/retry, eviction/revisit, safe late completion and signed-URL renewal. Existing quality browser checks pass across builder/preview/public/embed, recorded in [phase6-quality-smoke.json](docs/performance-baselines/phase6-quality-smoke.json). All six benchmark instrumentation scenes pass against the source frontend, recorded in [phase6-chromium-smoke.json](docs/performance-baselines/phase6-chromium-smoke.json). Visual fan checks pass in standalone/imported/public/embed views. Runtime-asset checks pass for Meshopt/KTX2, texture tiers, standing/orbit pose, exact proxies, fallbacks and animation; [phase6-runtime-assets.json](docs/performance-baselines/phase6-runtime-assets.json) records the final individual run. A short animation frame-count check missed its threshold during concurrent build activity and passes when rerun individually.
- [phase6-room-streaming.json](docs/performance-baselines/phase6-room-streaming.json) records a Chromium SwiftShader six-room fixture with failed/400 ms delayed requests: two initial requests, one successful 3,296-byte starting GLB versus 19,776 bytes for all six, blocked failed entry, successful retry/entry, distant chunks deferred, full inspection and viewer fallback checks. This establishes progressive delivery correctness, not physical-device loading/FPS/memory gains.

Procedure and limitations: [docs/room-streaming.md](docs/room-streaming.md). Generated template structure and external material textures remain resident/global. Existing modular uploads are independently delivered chunks; monolithic GLBs are not automatically split. Custom windows/stairs/atriums without reviewed portal metadata use conservative full visibility/loading. Dynamic reflection capture is not present. Physical-device starting-view/sustained walkthrough measurements, real-upload visual review and browser memory stress remain pending, as does the earlier public courtyard-exit regression. No phase is marked fully accepted.

Primary integration point: `web/src/LayoutControls.tsx`, together with asset manifests, visibility, loading readiness, and navigation boundaries.

Implement:

- Define explicit room bounds and doorway/opening metadata. Keep visibility openings distinct from navigation exits.
- Compute conservative visibility from camera position and orientation, following multiple aligned openings rather than adjacency alone.
- Handle windows, stairs, atriums, open-plan areas, and exterior viewpoints. Use conservative fallback visibility when metadata is missing.
- Support inspection/orbit mode separately from indoor walking visibility.
- Split delivery into independently loadable chunks; hiding objects alone does not reduce initial download or loaded memory.
- Load the starting area first, then preload nearby or soon-visible areas.
- Add a bounded cache with explicit shared-resource ownership and safe eviction.
- Permit entry only when collision and approved-floor data are ready. Keep blocking boundaries during slow loading and failures, with readable loading and retry states.
- Give shadow and reflection passes visibility rules appropriate to their contributors.

Expected improvements:

- Reduce initial downloads, loaded memory, and rendering work for large modular interiors.
- Keep movement safe during asynchronous loading.

Done when:

- Doorway transitions, aligned openings, windows, stairs, exterior views, and orbit inspection show no missing visible geometry.
- Slow or failed room requests cannot allow movement into unprepared areas.
- Cache eviction and revisiting rooms restore assets correctly without invalid disposal or memory growth.
- Starting-view loading and sustained walkthrough measurements improve against the baseline.

**Second milestone:** validated optimized assets, lower geometry cost, and safe room-level loading.

## Phase 7 — Add budgeted HQ rendering

Implementation status: reviewed static baked maps and conservative, opt-in HQ shadows implemented; reviewed visual references and physical-device budgets remain pending. Uses previous-phase quality, asset ownership, diagnostics and conservative streaming behavior.

Implemented evidence:

- Separate lightmap/AO upload roles, migration, role-aware material references, publication and deletion protection, and existing runtime texture-tier processing.
- Static imported UV1 atlas support with explicit author review stamps. Geometry, lighting, assignments and material edits disable stale external bakes and their downloads. Moving/deforming meshes, missing UV1 and unsupported lightmap shaders fall back to existing lighting.
- Indirect-only lightmaps replace ambient/environment diffuse illumination while preserving PBR specular reflections and the realtime direct key light. Sampler clones and shader hooks restore cleanly without disposing shared source resources.
- Persisted, default-off HQ moving-object shadows: one 1024 PCF map, bounded footprint, at most 24 nearby casters and 50,000 caster triangles, with conservative capability gates. Auto effects follow its committed tier; quality downgrade releases the pass without changing pose. Shadow contributor readiness retains Phase 6's conservative full-loading policy.
- Screen-space AO and additional expensive effects remain disabled because physical budgets are not established. Static author-provided baked AO is available across tiers. No automatic lighting baker or conditional offline image renderer is included.
- [docs/hq-rendering.md](docs/hq-rendering.md) documents authoring, invalidation, limits, diagnostics and the `?hq=0` fallback. [phase7-hq-rendering.json](docs/performance-baselines/phase7-hq-rendering.json) records rendered indirect-light separation, stable texture counts over 12 cleanup cycles, all four modes and three manual tiers, invalidation and bounded fan shadows. Its isolated fixture adds one draw call and 12 triangles; this is software-renderer pass cost, not a physical-device improvement.
- Frontend build and 71 unit tests pass; Go tests including PostgreSQL persistence/reference checks and `go vet` pass. Quality, six benchmark scenes and room-streaming browser checks pass, recorded in [phase7-quality-smoke.json](docs/performance-baselines/phase7-quality-smoke.json), [phase7-chromium-smoke.json](docs/performance-baselines/phase7-chromium-smoke.json) and [phase7-room-streaming.json](docs/performance-baselines/phase7-room-streaming.json). Existing fan-animation checks pass in standalone, imported layout, public and embed modes; [phase7-runtime-assets.json](docs/performance-baselines/phase7-runtime-assets.json) records passing compressed animation, KTX2, standing/orbit pose and failed/corrupt derivative/proxy regressions.

Remaining: reviewed author-created atlases and HQ visual references, physical-device frame-time/memory budgets, sustained shadow/quality transitions and production acceptance. Template geometry lacks a reviewed bake atlas; external maps apply only to eligible imported static surfaces. Opted-in shadows may increase residency by loading all room contributors. Software-renderer checks do not establish production budgets. The previously reproduced public courtyard-exit regression remains outstanding.

Primary integration point: `web/src/SceneLighting.tsx`, plus asset preprocessing and quality settings.

Implement:

- Prioritize baked lightmaps, baked ambient occlusion, reviewed PBR materials, and reflection environments for static interiors.
- Add selective realtime shadows for moving objects and important lights.
- Enable ambient occlusion, expensive material features, and additional effects only within measured tier budgets.
- Regenerate or disable baked lighting when relevant geometry, light, or material edits invalidate it.
- Separate static baked contributions from dynamic lighting to avoid double illumination.
- If photorealistic screenshots or panoramas are required, add a separate offline rendering process and store outputs by scene revision and camera pose.
- Deliver completed offline images through the existing image/panorama viewer. Use interactive geometry for continuous free movement.

Expected improvements:

- Improve reviewed visual quality while maintaining responsive interactive walkthroughs.
- Provide revision-linked offline output when that product requirement exists.

Done when:

- HQ appearance matches reviewed references and remains within device budgets.
- Baked lighting invalidation works after relevant edits.
- Quality changes do not introduce unacceptable popping, lighting changes, or navigation regressions.
- If offline output is included, its revision and camera association are correct and processing failures are recoverable.

## Verification and rollout

For every phase:

- Run the relevant frontend build and existing automated/browser checks. Run backend checks when processing, persistence, or API behavior changes.
- Repeat the affected benchmark scenes on the same devices and record before/after results.
- Exercise builder, preview, public, and embed viewers wherever the shared rendering behavior changes.
- Check movement, floor approvals, collisions, portal arrivals, materials, animations, and hotspot occlusion.
- Repeat scene and quality changes to detect leaks or disposal of resources still in use.
- Keep a reversible fallback for newly introduced optimized loading and rendering paths.
- Update phase status with implementation evidence, measured results, and remaining limitations. Distinguish browser emulation from physical-device testing.

Final acceptance requires sustained physical-device walkthroughs, slow-network and failed-loading checks, reviewed HQ appearance, and regression thresholds established from Phase 1. Numerical improvements and production budgets remain unconfirmed until these measurements are complete.
