# Performance benchmarks

The development viewer supports `?perf=1&device=your-device-label`. Diagnostics work in builder, preview, public and embed viewers. They are disabled in production builds.

From `web`, with the API/storage and current **source** Vite server running:

```sh
npm run demo:performance
# For another port: TOUR_ORIGIN=http://localhost:5174 npm run demo:performance
npm run test:performance
```

The demo creates a new project with six scenes and saves `/tmp/performance-benchmarks.json` (override `PERFORMANCE_MANIFEST`). It does not publish the project. Use the existing Publish flow for public/embed measurements. The manifest contains actual scene IDs/revisions and SHA-256 hashes and sizes for all fixture uploads. Keep it with each result; delete the benchmark project through the ordinary project controls when finished. Use a disposable local project, since the texture scene intentionally loads large decoded textures. A Docker frontend built from a previous source snapshot must be rebuilt, or run local Vite on a free port.

| Benchmark | Workload | Repeatable movement |
| --- | --- | --- |
| Small house | Existing `house.glb`, explicitly reviewed fixture floor | Start at center, face each wall, walk toward the front doorway and return |
| Large modular interior | 25 connected 6 m rooms, 40 doorways | Walk down the first column, turn across the last row, return along the same route |
| Repeated furniture | 64 instances of the same uploaded table in a 20 m room | Inspect from above, walk between table rows, return to center |
| Texture-heavy uploads | Four unique 2048 × 2048 base-color textures on four connected rooms | Visit each room and turn toward all walls; revisit the starting room |
| Animations | Existing `room-fan.glb` with embedded looping fan animation | Look up at fan for 30 seconds, circle the room and return |
| Many hotspots | 160 information markers in a four-room layout | Pan across the marker wall, turn away, visit another room and return |

Fixture definitions are versioned in `web/scripts/performance-fixtures.mjs`. Fixture floors are approved only within these known test scenes; production uploads still require review. These synthetic loads supplement representative customer uploads. Do not interpret them as representative device performance by themselves.

## Recording procedure

1. Record physical model, CPU/GPU, RAM, OS, browser version, power mode, refresh rate, viewport, device pixel ratio, device class and benchmark manifest. Enter a device label in the URL. Exports record browser, viewport, canvas, actual pixel ratio, saved scene fingerprint/layout revision, runtime settings/layout and hotspot fingerprints/count, walking/reveal state and viewer mode. Quality preference and the active tier are recorded; Historical baseline reports retain the former `current (no quality tiers yet)` label. State whether the run used a physical device or emulation; automatic exports deliberately label physical-device status unverified.
2. Use the same scene revision, start pose and route. Close unrelated tabs. Run each scene three times. Keep cold-cache and warm-cache results separate. To measure cold loading, disable browser cache and clear site storage/cache, then reload with diagnostics already enabled. Repeat on a recorded slow-network profile and check failed asset loading without treating failure as a usable view.
3. Keep the diagnostics panel **closed** while collecting. Warm up for 30 seconds, open the panel and choose **Start new frame sample**, close it, then follow the route for at least 2 minutes. This resets frame distributions while preserving startup/loading evidence; `sampleElapsedMs` identifies the sample duration. Reload between independent runs. For thermal tests, repeat the route for 15 minutes, noting charging state, heat and battery changes. The frame distribution retains the latest 36,000 visible frames; total frame count and elapsed time remain available. Export intermediate results every 5 minutes to compare thermal slowdown. Hidden-tab gaps are excluded; visible stutters remain included.
4. Open **Performance diagnostics (development)** and choose **Export performance run**. Save the JSON and manifest together. Export frame median/p95/p99/max, draw calls and triangles over all rendering passes, renderer geometry/texture/program counts, texture inventory, available heap proxy, separate decode/collision timings, first usable rendered view and resource download timings/sizes. First usable means model controls/collision plus hotspot and texture loading are ready and a frame has rendered; it includes asset URL API requests from viewer initialization. Failed loads leave it null. Cached GLTF loads may have no decode event: absence is not zero milliseconds.
5. Repeat scene switching (A → B → A) ten times and compare resource counts after returning and settling. Record navigation, floor support, wall collision, materials, animations and hotspot occlusion. Run builder, preview, public and embed; changes to editor settings should be measured as separate runs or reloads so the scene fingerprint describes saved state.

## Profiling CPU, GPU, loading and memory

Use a separate profiling run so profiler overhead does not contaminate baseline timing. For a reproducible Chromium CPU profile of the hotspot stress case, run `PERFORMANCE_CPU_PROFILE=1 PERFORMANCE_SCENE="Many hotspots" PERFORMANCE_SAMPLE_MS=10000 npm run test:performance`. This writes `.cpuprofile` files alongside smoke reports, labels profiler-enabled reports, and can be imported in DevTools. Filtering runs only the selected benchmark plus the viewer-mode smoke checks; use the unfiltered command for six-scene verification. In Chrome/Edge DevTools Performance, record the same 20–30 second route and save the trace. Inspect main-thread stacks for animation, marker visibility/raycast, React/DOM work and renderer submission. Record each suspected cost with stack name, total/self duration and the saved trace reference. GPU tracks, where provided by the device/browser, help distinguish GPU work from CPU submission; otherwise use platform GPU tools and record GPU cost as unavailable. Frame intervals and CPU submission duration do **not** measure GPU time. Idle gaps are excluded from frame-time distributions and `renderedFrames` also counts one-off demand renders; see [viewer-quality.md](viewer-quality.md).

Use the Network panel/HAR to attribute downloads and cache behavior, particularly when cross-origin storage does not expose `Timing-Allow-Origin`. Exported Resource Timing zero sizes can indicate cache hits or restricted visibility. No signed URLs are retained in diagnostic JSON. GLTF decode spans `GLTFLoader.parse` through decoded completion, including embedded image decoding. Collision preparation covers bounds, triangle extraction and index construction in `WalkWorld`; model/material/layout preparation remains visible in the browser trace. Times can overlap across assets and must not be added as a serial total.

For memory, take heap snapshots before loading, after repeated switches and after an idle/GC interval. Use renderer counts and texture dimensions alongside heap data. The texture inventory deduplicates by texture UUID and scans scene materials, shader texture uniforms, background and environment once a second. RGBA8-equivalent bytes include estimated mip chains and cube faces; actual formats, compressed data, half-float targets, renderer-internal targets, driver overhead and cached assets may differ. Unknown dimensions produce null estimates. These are **proxies, not exact VRAM measurements**. Heap bytes are only available in browsers exposing `performance.memory` and may include unrelated page allocations.

## Budgets and evidence

`docs/performance-budgets.json` contains provisional 60 FPS desktop/laptop and 30 FPS mobile/tablet goals. Loading, geometry, texture, memory and tail-frame/regression budgets remain null until physical measurements establish them. For each scene/device class, replace pending values with reviewed initial budgets, three-run spread, browser/device details, cache/network conditions, scene revision and profile evidence. Do not enforce regressions against software-rendered headless results.

The browser smoke command mocks APIs, serves the same GLB/PNG fixtures and exercises all six scenes plus builder and embed diagnostics. It writes JSON to `/tmp/performance-smoke` (override `PERFORMANCE_OUTPUT`; `PERFORMANCE_SAMPLE_MS` controls the short sample duration). This validates instrumentation and scenes without requiring backend state. Software-renderer timing is **not** a production baseline or physical-device result. Existing navigation/animation checks remain separate regression checks.

Recorded preliminary CPU evidence is in `docs/performance-baselines/hotspots-cpu-summary.json`; decompress `hotspots-chromium.cpuprofile.gz` before importing in DevTools. In this short startup sample, Three.js `WebGLProgram.onFirstUse` appears among the largest named sampled self costs, with mesh intersection and React element work also present. This suggests profiling shader/program startup separately from sustained hotspot visibility; it does not establish a device bottleneck. Concurrent browser activity and software rendering make these durations unsuitable as budgets.

Pending acceptance: physical lower-end and midrange phones, tablets, integrated-GPU laptops and desktops; sustained thermal walkthroughs; CPU/GPU trace review; measured non-frame budgets and regression thresholds. Production performance budgets require these measurements.
