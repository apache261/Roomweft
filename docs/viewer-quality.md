# Viewer quality and rendering

Choose **Rendering quality** in builder, visitor preview, public or embed viewers. Auto is the default; Low, Balanced and HQ are persistent manual overrides. The browser stores the preference under `tour-render-quality`, shared across viewer routes and tabs on the same origin. If storage is unavailable, the current session still works.

| Setting | Pixel ratio cap |
| --- | --- |
| Low | 1 |
| Balanced | 1.5 |
| HQ | 2 |

The actual pixel ratio is bounded by the native device pixel ratio. These are provisional resolution presets. Asset variants, geometry LOD, texture derivatives and HQ lighting have separate policies described in the rendering guides. Quality changes preserve the camera pose and use the same collision/approved-floor world.

## Auto policy

Auto starts at Balanced, or Low when the renderer reports a maximum texture dimension below 4096. Devices reporting at most four logical cores or at most 4 GB device memory have an Auto ceiling of Balanced and a provisional 30 FPS target; other devices use a 60 FPS target and an HQ ceiling. Browser capability hints can be missing or coarse, so these choices still require physical-device validation. Manual overrides remain available.

The controller samples consecutive visible rendered frames, smooths frame interval and CPU submission with a one-second exponential average, and ignores demand-rendering idle gaps. Startup has an eight-second warm-up. After four seconds above 135% of the frame-time target, it can try one lower resolution tier when CPU submission is below the conservative cutoff (60% of frame interval or 8 ms, whichever is higher). If native resolution already falls below the next tier's cap, it keeps the tier.

A four-second resolution trial must improve average frame interval by at least 15%. Otherwise Auto restores the original tier and records that CPU, geometry or other costs need profiling. This is a **pixel-sensitivity probe, not a GPU-time measurement**. It can be influenced by changes in the scene or other browser work. An interrupted trial (idle or hidden tab) restores its original tier. Trials have a 30-second cooldown. CPU-heavy samples defer resolution changes for 15 seconds.

Ten seconds of sustained frame intervals below 110% of the target, with CPU submission below half of the target, permit a gradual upgrade within the capability ceiling. Upgrades have a 20-second cooldown. The separate thresholds and sustained windows prevent rapid switching near a boundary. CPU submission includes synchronous GL work and does not prove a CPU bottleneck; the conservative policy avoids assuming that every slow frame comes from pixel cost. Hotspot and geometry costs require separate profiling.

## Idle and hidden behavior

The Canvas uses demand rendering. React scene edits, loading completion, overlays, lighting/material changes, saved-view reset, hotspot framing, panorama drag/zoom and input events request frames. Walking holds frames while input, acceleration/braking, head bob or height smoothing remain active. OrbitControls requests its damping tail. Imported animation clips keep scheduling frames, including animated instances in layouts. Static scenes stop scheduling frames after settling.

Hidden documents switch to `frameloop="never"`; the visibility handler clears held movement and simulation velocity. The shared frame clock resets on hide/resume and after demand-rendering idle. The first resumed frame has zero simulation delta, and visible navigation steps are bounded at 100 ms; visible stalls over 250 ms are recorded in diagnostics while contributing zero simulation delta. During continuous visible rendering, clips advance by visible elapsed time independently of the navigation step cap. Animated clips pause their local timeline while hidden and resume without integrating hidden elapsed time.

Diagnostics distinguish `renderedFrames` (all visible rendered frames), `totalFrames`/`frameMs.samples` (continuous frame intervals), and `idleWakeFrames`. Draw-call, triangle and CPU-submission distributions include idle wake renders; FPS/frame-time distributions exclude idle gaps. A stationary demand-rendered scene can have few or no frame-time samples, which is not a failure or an FPS value. The development `window.__tourPerformance` getter exposes the current diagnostic snapshot when `?perf=1` initialized a run.

## Verification

```sh
cd web
npm test
npm run build
TOUR_ORIGIN=http://localhost:5174 npm run test:quality
TOUR_ORIGIN=http://localhost:5174 npm run test:performance
```

Run against the current source Vite server. The quality browser test uses headless Chromium/ANGLE SwiftShader with device pixel ratio 2. It checks all three caps, saved manual/Auto choices, camera position across quality changes, zero idle renders, input wake-up, braking and damping settlement, hotspot overlays, simulated hidden/resume events, animation scheduling and builder/preview/public/embed modes. The full walking browser acceptance also covers reviewed floors, collision boundaries, local/cross-scene exits, public/embed and emulated touch. The existing fan browser test verifies visible animation in standalone, layout, public and embed views. Unit tests exercise Auto's windows, capability ceiling, CPU deferral, failed/successful/interrupted trials, cooldowns, blocked storage, and long-step handling.

`docs/performance-baselines/phase2-quality-smoke.json` records the cap/idle checks. Repeat the six-scene benchmark suite at the same viewport/native pixel ratio and keep quality smoke reports separate from the original baseline. Physical-device comparisons, actual background-tab tests, sustained thermal walkthroughs and final thresholds remain pending; short software-renderer checks cannot establish production gains or budgets. See [performance-benchmarks.md](performance-benchmarks.md).
