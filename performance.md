# Production performance optimization plan

Status: Phase 1 benchmark fixtures/diagnostics and Phase 2 quality settings/demand rendering and Phase 3 hotspot CPU optimizations and Phase 4 runtime asset processing implemented; physical-device baselines and production budgets pending. See [docs/performance-benchmarks.md](docs/performance-benchmarks.md).

This document defines the production plan for rendering performance, asset preprocessing, visibility, and high-quality (HQ) output. Optimize for responsive walkthroughs across phones, tablets, and computers while preserving navigation correctness and visual quality.

## Current implementation

The frontend uses Three.js and React Three Fiber. Code inspection identified these starting points; they are not measured bottlenecks yet:

- `web/src/SceneViewer.tsx` now uses demand rendering with persistent Auto/Low/Balanced/HQ pixel ratio caps; `web/src/ViewerRuntime.tsx` coordinates activity, hidden-page pausing and safe wake-up timing. Auto uses sustained samples and a reversible pixel-sensitivity probe.
- `web/src/PreparedGLTFLoader.ts` supports verified Meshopt and renderer-aware KTX2/Basis decoding. Draco remains unsupported. Phase 4 adds validated background derivatives, texture tiers, stable surface mappings and shared navigation/resource caches; see [docs/runtime-assets.md](docs/runtime-assets.md).
- `web/src/LayoutControls.tsx` loads the referenced layout models together. Room streaming requires changes to loading and readiness handling.
- `web/src/HotspotLayer.tsx` shares cached marker/reticle visibility through `web/src/hotspotVisibility.ts`, rejecting off-screen markers and unrelated mesh bounds before direct raycasts. See [docs/hotspot-performance.md](docs/hotspot-performance.md) for synthetic evidence and pending physical-device comparisons.
- `web/src/navigation.ts` extracts imported triangles and builds collision and approved-floor indices. `web/src/TriangleIndex.ts` already provides a spatial index; preprocessing should reduce input complexity and startup work.
- `web/src/SceneLighting.tsx` uses environment lighting, tone mapping, and direct lights. Expensive shadows and postprocessing should be introduced through quality tiers.

## 1. Measure before optimizing

Create representative benchmarks covering a small house, a large modular interior, repeated furniture, texture-heavy uploads, animations, and many hotspots.

Record:

- Frame-time median and upper percentiles, including visible stutters.
- Draw calls and rendered triangles, including additional rendering passes.
- Download size, time to first usable view, decode time, and collision preparation time.
- Loaded texture dimensions, estimated GPU memory, and resource counts across scene changes.
- Sustained performance during longer walkthroughs and device heating.

Use browser profiling to distinguish CPU, GPU, loading, and memory constraints. GPU memory estimates and resource counts are proxies, not exact VRAM measurements.

Initial goals are approximately 60 FPS on supported desktop hardware and stable 30 FPS on lower-end mobile hardware. Final budgets for frame time, loading, geometry, textures, and memory must be established from physical-device benchmarks.

## 2. Adaptive quality across devices

Provide Auto, Low, Balanced, and HQ settings, with a persistent manual override. Auto should respond to sustained frame times and supported capabilities rather than device names alone.

Suggested starting presets:

| Setting | Low | Balanced | HQ |
| --- | --- | --- | --- |
| Pixel ratio cap | 1 | 1.5 | 2 |
| Geometry | Simplified LOD | Medium LOD | Detailed nearby objects |
| Texture dimensions | 512–1K | 1–2K | Up to 4K selectively |
| Lighting | Baked | Baked with limited dynamic lighting | Baked with selective realtime shadows |
| Postprocessing | Minimal | Optional ambient occlusion | Ambient occlusion and selective effects |

These values are provisional, not universal production budgets. A texture dimension limit does not replace a total texture-memory budget.

Implementation requirements:

- Cap device pixel ratio explicitly.
- Lower resolution first when profiling indicates a GPU pixel-cost bottleneck; reduce draw calls or simulation work when CPU-bound.
- Use averaging, separate upgrade/downgrade thresholds, and cooldowns to avoid frequent quality changes.
- Keep movement, collision, approved floors, and portal validation identical across tiers.
- Render on demand when idle, with explicit invalidation for camera changes, edits, loading, and overlays. Continue scheduling frames while walking, damping, or animation is active.
- Pause unnecessary updates when the page is hidden and handle resuming without stale movement.

## 3. Visibility and selective rendering

### Frustum culling

Three.js enables frustum culling by default for renderable objects. Maintain correct bounds, especially for animated or instanced objects. Splitting a scene into useful spatial chunks allows sections outside the camera view to be skipped.

### Room and doorway visibility

For interiors, introduce explicit room bounds and doorway/opening metadata. These visibility openings are distinct from the application's existing navigation exits.

- Render the current room and rooms potentially visible through openings.
- Follow visibility through multiple aligned openings; adjacency alone is insufficient.
- Account for windows, stairs, atriums, exterior viewpoints, and open-plan spaces.
- Use conservative visibility when metadata is missing or uncertain, avoiding disappearing geometry.
- Update visible room sets when camera position, orientation, or opening state changes.
- Support inspection/orbit mode separately from indoor walking views.

Do not raycast every object every frame to decide whether it should render. Start with room visibility and spatial bounds; evaluate more complex occlusion methods only if benchmarks justify them.

Camera-hidden objects may still contribute shadows or reflections. Any HQ rendering passes need appropriate visibility rules of their own.

### Geometry organization

- Batch compatible static surfaces within a room or spatial chunk.
- Instance repeated compatible furniture and decorations, grouped spatially so culling remains effective.
- Preserve separate handling for animated, transparent, editable, or individually selectable objects.
- Avoid merging the entire building into one mesh, which reduces culling granularity.
- Maintain a mapping from optimized geometry to authored surface IDs for selection, material overrides, and approved floors.

### Level of detail

Generate detailed, medium, and simplified variants. Prefer projected screen size for LOD selection, with hysteresis to prevent repeated switching near thresholds. Preserve important silhouettes and doorway geometry.

### Streaming

Load the starting area first and preload nearby or soon-visible areas. Keep a bounded cache and evict unused assets safely.

Hiding an already-loaded object reduces rendering work; streaming also reduces initial download and memory requirements. Splitting a large GLB into independently loadable chunks is necessary for room-level delivery.

Before allowing movement into a new area, its collision and approved-floor data must be ready. Retain blocking boundaries during loading and failures.

## 4. Production asset preprocessing

Preserve original uploads and generate versioned runtime derivatives through background processing:

```text
Original GLB
    → validate and inspect
    → optimize geometry and compatible materials
    → generate LODs and texture variants
    → generate reviewed collision proxies and spatial metadata
    → optionally bake lighting
    → validate derivatives
    → store runtime variants and a manifest
```

### Geometry and textures

- Remove unused data and deduplicate compatible resources.
- Optimize vertex/index data and generate LOD variants.
- Support Meshopt or Draco decoding before enabling the corresponding compressed output.
- Support KTX2/Basis transcoding and capability detection before serving GPU-compressed textures.
- Resize textures by quality tier and generate suitable mipmaps.
- Preserve color-space assignments and material behavior, particularly normal maps and transparency.

Geometry compression primarily reduces delivery size; LOD and batching address rendering cost. JPEG, PNG, WebP, or AVIF download size alone does not represent decoded GPU texture memory.

### Identity and correctness

Do not automatically rename, merge, or simplify authored surfaces without preserving their identities. Material assignments and approved-floor selections must survive optimization. Validate animations, transforms, UVs, hotspots, and navigation references against the derivatives.

Collision simplification must preserve walls, openings, steps, head clearance, and floor gaps. Generated proxies require validation and must not silently approve previously unreviewed walking surfaces.

### Processing and delivery lifecycle

- Track processing state and actionable errors while retaining the original asset.
- Key derivatives by source identity and processing version so they can be regenerated reproducibly.
- Include bounds, room membership, stable surface mappings, LODs, and available variants in a manifest.
- Publish validated manifests atomically so viewers cannot receive partially generated asset sets.
- Keep the existing validated loading path available while a derivative is unavailable.
- Use storage/CDN caching appropriate to the application's private assets and signed URL policy; avoid tying decoded asset identity solely to expiring URL strings.
- Manage shared resources and eviction explicitly to prevent memory growth or disposal of assets still in use.

glTF Transform is a candidate for geometry optimization, texture resizing, and compressed runtime variants. Offline lighting baking requires a separate authoring/rendering workflow.

## 5. HQ rendering

### Interactive walkthroughs

Prioritize baked lightmaps, baked ambient occlusion, good PBR materials, and reflection environments for static interiors. Add realtime shadows selectively for moving objects and important lights. Enable expensive material features and postprocessing only within measured quality budgets.

Baked lighting must be regenerated or disabled when edits invalidate it, including changes to geometry, lights, or relevant materials. Separate static baked contributions from dynamic lighting to avoid counting the same illumination twice.

### Offline output

If HQ means photorealistic screenshots or panoramas, implement a separate offline rendering process. Store completed images as derivatives and deliver them through the panorama/image viewer. Interactive walkthroughs continue to use optimized geometry.

Offline output should be associated with the scene revision and camera pose. Pre-rendered panoramas support fixed viewpoints; continuous free movement requires the interactive 3D scene.

## 6. CPU and interaction optimization

### Hotspots

- Reject markers outside the full camera view before occlusion raycasts.
- Restrict raycasts to relevant occluders using room/spatial metadata.
- Share visibility results between markers and reticle targeting where appropriate.
- Cache results until the camera, scene, or animated occluders change; consider bounded update rates for noncritical markers.
- Reduce temporary allocations and redundant DOM writes in frame callbacks.
- Keep intentional builder reveal behavior and visitor occlusion behavior intact.

### Navigation and animation

- Use simpler validated collision proxies instead of detailed visual meshes.
- Move expensive preparation to background workers where appropriate, using transferable data rather than Three.js scene objects.
- Cache reusable prepared data by asset and configuration revision, invalidating it when transforms or floor approvals change.
- Suspend unnecessary hidden animations only when doing so cannot affect collision or visible results. Resuming should preserve the intended timeline.
- Keep collision and floor queries independent of render visibility, LOD, and quality tier.

## 7. Implementation order

1. Establish representative benchmarks, telemetry, and device budgets.
2. Add explicit resolution caps, adaptive quality, and safe idle rendering.
3. Optimize hotspot visibility and per-frame allocations.
4. Add decoder support, versioned preprocessing, texture variants, and validated collision proxies.
5. Introduce spatial batching, instancing, and LOD while preserving surface identity.
6. Add room/opening visibility and progressive streaming.
7. Add baked lighting and budgeted HQ effects; implement offline HQ output if required.

Measure each stage against the same scenes and devices before expanding scope.

## 8. Production acceptance

- Test physical lower-end and midrange phones, tablets, integrated-GPU laptops, and desktop hardware across supported browsers.
- Run longer walkthroughs to expose thermal slowdown and battery impact.
- Exercise doorway transitions, aligned openings, windows, orbit inspection, stairs, animations, and hotspot occlusion.
- Test slow loading and failed room requests without allowing movement into unprepared areas.
- Repeat scene changes and quality changes to detect resource leaks and invalid disposal.
- Confirm floor approvals, material assignments, hotspots, collisions, and portal arrivals remain correct in every variant.
- Compare HQ appearance against reviewed references and check LOD/quality transitions for visible popping.
- Establish regression thresholds from measured baselines before enforcing production budgets.

## References

- [Three.js Object3D: frustum culling, visibility, and transforms](https://threejs.org/docs/pages/Object3D.html)
- [Three.js GLTFLoader: compressed asset decoder integration](https://threejs.org/docs/pages/GLTFLoader.html)
- [React Three Fiber: scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [React Three Fiber: performance pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls)
- [glTF Transform CLI: optimization and compression tools](https://gltf-transform.dev/cli)
