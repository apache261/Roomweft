# GLB chunking Phase 0 references

Phase 0 establishes complete-file correctness references and measurements. Independently derived chunks are not implemented. The fixtures, generated source hashes, browser baseline runner and admission regression are repeatable; physical-device measurements and shader/GPU trace review remain pending. No production budget or download saving is inferred from these synthetic models.

Regenerate the checked-in fixtures from the repository root:

```sh
python3 tests/scripts/make-chunking-fixtures.py
# Optional valid sparse GLB just above the current 256 MiB processor limit:
python3 tests/scripts/make-chunking-fixtures.py --oversized
```

`tests/testdata/chunking/manifest.json` records source SHA-256, byte counts, coordinates, reviewed source floor paths, saved start and route. Generation uses Python's standard library and is deterministic. `over-admission.glb` is ignored by Git. Trailing BIN padding makes its admitted file size large without creating a complex decode workload; this tests admission, not representative large-model performance. The Go admission regression confirms rejection before storage access or output publication/deletion. Browser tests separately confirm that an unavailable derivative descriptor loads the original. Neither substitutes for a live upload/worker integration acceptance run.

| Reference | Correctness purpose |
| --- | --- |
| `authored-rooms.glb` | Two authored room hierarchies; shared material/image resources; separate UV0/UV1; crossing beam and doorway contributors; skin joint/clip dependency group; open view through a window sill; source-path floor approvals |
| `giant-static.glb` | Same static boxes flattened into one primitive; demonstrates why node grouping alone cannot partition a giant mesh |
| Companion layout scene | Module-local attached hotspot and explicit, click-required exit; two connected generated rooms |
| Behind-wall hotspot | Occlusion reference behind the imported model's left wall |
| `over-admission.glb` (on demand) | Current processing limit rejection with immutable original fallback |

Fixture ownership labels are references, not persisted reviewed partition metadata. The window is a visibility opening and is not a walking exit. Floors are explicitly selected only in these known references. The giant mesh's approval names the source mesh, with region/height filtering restricting eligible triangles; this does not approve other upward-facing geometry automatically. The room fixture's skinned geometry is deliberately retained as a complete dependency group.

Run unit/format validation and headless baseline collection after installing both `web` and `asset-tools` dependencies. Start the **current workspace source** Vite server; Docker may serve an older snapshot:

```sh
npm --prefix web test
go test ./internal/derivatives
npm --prefix web run dev -- --port 5175
# In another terminal:
TOUR_ORIGIN=http://localhost:5175 npm --prefix web run test:chunking-baseline
```

Reports go to `/tmp/chunking-phase0` (override `CHUNKING_OUTPUT`). The runner fixes the viewport to 900 × 650 and quality to Balanced. Each cold case uses a new browser context; each warm case switches A → another reference → A within the same page, retaining decoded model/navigation caches. It walks toward the doorway, explicitly activates the exit, enters Room B, turns, resets to the supported start and repeats. No additional complete-file transfers are allowed during the route/revisits. The runner uses intercepted same-origin delivery, so it reports delivered fixture payload bytes separately from browser Resource Timing. This is not a real-network or HTTP-cache benchmark. Reset return and short movement samples supplement the sustained manual route below.

The [six-case baseline summary](performance-baselines/chunking-phase0/summary.json) and committed reports under `performance-baselines/chunking-phase0/` are labelled Chromium SwiftShader software-renderer instrumentation evidence. They are not physical-device baselines or performance acceptance. Cold/warm samples may have no new decode or download work when caches satisfy the load; missing measurements do not mean zero decode cost.

## Diagnostic fields

`?perf=1&device=your-device-label` exports schema 2, preserving the earlier frame distributions and `firstUsableViewMs` field:

- `firstRenderedViewMs`: first visible frame with draw submissions; may precede content/navigation readiness.
- `firstUsableViewMs`: controls, content, hotspot descriptors and material textures ready at a rendered frame.
- `firstSafelyUsableWalkingViewMs`: usable content plus active walking controls and verified standing floor. Inspection-only and panorama views leave this null.
- `timings`: request network, GLTF decode, model/layout preparation and exact collision preparation spans with start/end offsets and status. Spans can overlap and must not be summed as a serial total.
- `assetLoads`: anonymous per-attempt IDs and kind (`original`, `variant`, `collision`, `room-asset`); explicit request, downloaded payload bytes, integrity verification where applicable, decode start and decoded completion. Room-asset records additionally distinguish decoded-resource readiness, navigation preparation, visual commit and movement admission. These refer to separately uploaded room assets today, not internal GLB chunks. Future chunk delivery can reuse this instrumentation contract.
- `downloads` and `network`: URL-free Resource Timing spans, observed startup/total transfer bytes and unknown-size request count. Includes textures, APIs, ancillary resources and navigation payloads requested during the run. Zero-size responses can mean cache or unavailable cross-origin timing; in-flight requests, viewer-shell requests begun before run initialization and dropped browser timing entries are excluded. Totals are observed lower bounds; use a HAR/server payload ledger for full accounting.
- `resources`: resident scene geometry buffer estimate, texture inventory/RGBA8 estimate, decoded asset cache count/estimated bytes, navigation cache triangle count, renderer counts and optional JS heap. These overlap and must not be added as exact VRAM totals. GPU formats, shared attribute buffers, internal render targets and cache ownership can differ.

Decode completion does not imply area readiness. The room timeline's admission event is emitted when prepared controls commit, after decoded resources are available. Whole-file walking readiness is reported at the rendered-frame milestone. Diagnostics retain at most 500 attempt/stage records per run and 32 events per attempt. Reports omit endpoints/signed URLs. Shader compilation/upload stall attribution and GPU time require a separate trace; frame/CPU submission measurements alone cannot establish those costs.

## Physical-device baseline procedure (pending)

With API/storage and the source frontend running, `npm --prefix web run demo:chunking` creates a new private reference project and writes `/tmp/chunking-demo.json` with actual scene IDs, revisions and source hashes. Use the existing Publish control if measuring public/embed. This command is separate from the mocked smoke tests. Keep the demo manifest with reports.

Follow the [existing physical-device recording procedure](performance-benchmarks.md#recording-procedure) on identical scene revisions, Balanced quality, viewport/DPR and network profile. Record model, OS/browser, CPU/GPU/RAM, refresh/power state and physical versus emulated status. Collect three cold loads and three warm revisits per device. Cold means cleared site/browser caches; warm means decoded-cache reuse, recorded separately from HTTP-cache-only reloads.

Measure all bytes before a usable view, including global textures and exact collision/occlusion data, using Resource Timing plus HAR when timing is incomplete. For a sustained route, walk the manifest waypoints from A to B, activate the explicit exit, turn toward each wall/window, return to A and repeat for at least two minutes; record return path behavior. Inspect wall occlusion, attachment position, material/UV appearance, skin/clip continuity and standing clearance. Capture a separate startup browser trace for cold/warm decode, collision preparation and shader/upload stalls; record unavailable GPU fields explicitly. Keep profiling runs separate from timing baselines. Review representative real uploads before establishing budgets.

Physical lower-end/midrange phones, tablets, integrated-GPU laptops and desktops, slow-network loads, sustained thermal routes and live oversized upload fallback are still acceptance work. This phase does not certify the earlier performance phases, courtyard-exit regression, automatic splitting or future chunk savings.
