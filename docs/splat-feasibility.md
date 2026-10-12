# Gaussian splats: phases 0–4

The selected renderer proof uses the MIT shader, covariance packing and worker sorter from `@react-three/drei` **10.7.9**, with Three **0.186.1** and React Three Fiber **9.8.1**. These installed versions are pinned in the frontend dependency/lock files. The adapted driver and complete MIT notice live in `web/src/splat/`. Its deliberate changes provide bounded whole-source loading, quaternion normalization, a constant-depth sorting fix, demand-frame invalidation and explicit worker/geometry/material/texture disposal. No conversion service, decoder download or runtime CDN is required.

Spark was evaluated from its [official overview](https://sparkjs.dev/docs/overview/) and [SplatMesh API](https://sparkjs.dev/docs/splat-mesh/). It supports Three/WebGL2, but a local installation could not be obtained from the package registry in this environment. The already installed Drei implementation was selected and tested locally. This does not claim Spark compatibility or performance.

## Supported source profile: splat-v1

Only `.splat` with content type `application/octet-stream` is admitted. The format is a headerless sequence of **32-byte** records:

| Offset | Attribute | Encoding and limits |
| --- | --- | --- |
| 0–11 | Source position x,y,z | Three little-endian float32 values, finite, absolute value ≤ 1,000,000 |
| 12–23 | Axis scales | Three little-endian float32 linear scales, 0.000001–1000; no logarithmic encoding |
| 24–27 | Color and opacity | Four unsigned bytes, sRGB R,G,B and linear alpha 0–255 |
| 28–31 | Orientation w,x,y,z | Four unsigned bytes, each decoded as `(byte−128)/128`; squared norm 0.81–1.21, normalized by the renderer |

At least one record and at most **2,000,000** records / **64,000,000 bytes** are allowed. Exact payload length must match the declared length and be divisible by 32. There is no compression, SH data, schema header, embedded URL or external resource. PLY (including ordinary point clouds), SPZ, KSPLAT and ZIP are rejected. As a headerless format, an arbitrary file that exactly satisfies this profile is indistinguishable from a splat; extension alone never establishes validity.

The inherited renderer maps source `(x,y,z)` to `(x,−y,−z)` and adjusts quaternion orientation consistently. This fixed format correction precedes source unit scale, Z-up correction (−90° about X), yaw about Y, and authored world translation. Saved camera/hotspot coordinates use prepared world metres; yaw and pitch use radians. Splat model preparation reuses the existing model contract. Position, orbit-only controls and inspection distance bounds are stored under `settings.splat.version=1`.

Transform edits atomically move hotspots through the previous transform inverse and the next transform. Saved cameras are cleared on transform edits so the author must save a new world view. Appearance-only edits preserve cameras. No mesh material assignment, light/environment intensity, HQ shadows or walking configuration is accepted for splat scenes. There is no collision or proxy approval in phases 0–2.

## Local proof and evidence

Run `npm --prefix web run dev` and open `/dev/splat`. This route is development-only. Generate deterministic captures with `node web/scripts/create-splat-fixtures.mjs`; run `npm --prefix web run test:splat-proof` against Vite. The proof uses an opaque yellow cube, orbit controls, demand frames and antialiasing disabled. It can unmount/remount the capture or rebuild the renderer. Context restoration creates a new Canvas and rebuilds the renderer-owned worker and GPU resources from retained fixture bytes. Scene switches abort fixture fetches and dispose the previous resource.

Headless Chromium with ANGLE SwiftShader on the implementation host rendered both captures and passed five mount/unmount cycles, resize, camera motion and explicit `WEBGL_lose_context` loss/restoration. Worker instrumentation returned to zero after unmount and one after remount/restoration. Screenshots were reviewed locally: the generated room walls/floor and opaque cube render together. This is a synthetic scene, not a reconstructed real interior.

| Fixture | Source bytes | Splats | First sort (decode + worker startup) | First usable frame | Estimated resident CPU | Estimated GPU |
| --- | --- | --- | --- | --- | --- | --- |
| Small colored plane | 14,112 | 441 | 327 ms | 332 ms | 61,740 bytes | 15,876 bytes |
| Generated indoor room | 1,254,528 | 39,204 | 96 ms | 104 ms | 5,544,752 bytes | 1,467,536 bytes |

These are provisional allocations estimated from source, packed textures, worker matrices, sort buffers and instance indices, not measured VRAM. First usable frame is the first Fiber frame after sorted indices are installed; the acceptance script waits for this frame and writes fresh timings to `test-results/splat-baseline.json`. Motion samples include host/browser round-trip time: early samples were 30–50 ms, with late SwiftShader samples reaching 1.3–1.7 seconds. No mobile or performance budget is accepted from these results. A representative reconstructed indoor export, physical GPU/device baselines, background-tab restoration and visual transparency/exposure review remain external acceptance work.

## Persistence, admission and delivery

Migration 017 extends kinds and size constraints without changing applied migrations or existing scene documents. New/imported scenes require a ready same-project source with matching kind; a database trigger independently enforces this. Scene creation infers `SPLAT` from a ready splat source and initializes the versioned settings. Existing 3D, panorama and layout paths remain supported. API cameras use the existing position/yaw/pitch schema. Normal scene deletion/reference protection and public asset scoping include the source automatically.

The asset library accepts `.splat` sources, checks size/record alignment and a bounded prefix of attributes before requesting a ticket. Completion authoritatively scans every record with a fixed 64 KiB buffer. Each storage client allows two concurrent splat inspections and a 30-second context deadline. Admission, DB size checks and completion use the same decoded count/byte ceiling. The inspected GET is bound to the pending ETag, which is rechecked before promotion. Validated bytes are staged on bounded local disk (at most 64,000,001 bytes per slot, including the trailing-byte rejection probe), hashed with SHA-256, and promoted with `If-None-Match: *`. The final object records the profile and source hash in private metadata. A retry after database failure recognizes the promoted identity and cannot replace it, even if the signed pending POST was reused. Originals are delivered unchanged through private signed reads; optional mesh processing is never queued for splats.

Splat public reads require a published project and an actual referenced ready source. The existing 15-minute signed URL expiry, project cleanup, source reference restrictions and CORS configuration apply. No secure-context-only decoder is introduced: local HTTP MinIO works and production must continue using the configured HTTPS browser origin/S3 CORS. Upload URLs and credentials must not be logged.

Phase 3 now lazy-loads a dedicated splat adapter in the shared builder/preview/public/embed viewer. It provides orbit inspection, a bounds-based fallback camera, progress and explicit retry. Sources never enter the GLB loader or walking controller. Phase 4 adds capture creation, supported authoring controls, saved inspection views and world-positioned hotspots.

## Validation commands

- `go test ./...` with `TEST_DATABASE_URL`, `TEST_S3=1` and local S3 settings exercises existing regressions and the new splat contract/private-delivery tests. The splat integration check simulates a database failure after promotion, replaces pending bytes, retries and verifies that the final source is unchanged.
- `npm --prefix web test` covers the browser profile and existing model/navigation/material/runtime contracts.
- `npm --prefix web run build` checks TypeScript and production bundling.
- `npm --prefix web run test:splat-proof` checks the renderer, motion, resize, repeated teardown and context recovery against Vite.
- `npm --prefix web run test:splat-upload` exercises local API/MinIO from a real browser, including early malformed-data feedback, signed POST CORS, completion, byte-identical signed download and the shared splat renderer. It creates and deletes its own project.

Production S3 CORS and physical devices require separate deployment/device acceptance; local MinIO/browser success does not establish those measurements.

## Shared renderer ownership (phase 3)

`splatAssetCache` keys leases by the scoped asset endpoint, independent of signed transport URLs. Two simultaneous owners in the same browser realm share validated source bytes; each Canvas owns its covariance buffers, worker, geometry, material and GPU textures. Releasing the last source owner aborts pending transfer/validation and removes the cache entry. Failed or late work cannot delete a newer entry. The adapter ignores obsolete completions and disposes resources if a scene leaves during preparation.

Source fetches read bounded streams even when Content-Length is missing and enforce the 64,000,000-byte profile. Validation yields between batches; covariance preparation yields every 8,192 records. Source loading and preparation have 60-second deadlines, and each asynchronous sort has a 15-second watchdog. Expired signed reads (401/403) renew the scoped descriptor once. User-visible failures offer Retry scene; raw signed URLs are not included in errors.

The sort worker admits one pending sort per viewer, invalidates a demand frame on completion, and resubmits using the latest camera/transform if it changed. Idle views do not run a permanent render loop. Visibility handling is shared with ViewerRuntime; context restoration rebuilds the Canvas and all renderer-owned resources. Antialiasing is disabled for splat canvases, as in the local proof. Exposure/background use the splat's supported appearance controls. Existing GLB, panorama and layout routes retain their own adapters.

`test:splat-viewer` passed scoped URL renewal, actual rendered color, failure/retry, saved camera, repeated reloads with stable worker counts, independent viewers, context restoration, and splat/GLB/panorama transitions. `splat-cache.test.mjs` unit coverage verifies shared ownership, cancellation, URL renewal, missing-length bounds and malformed bytes. Existing hotspot browser acceptance also passed after replacing nested overlay roots with explicitly owned DOM anchors, which avoid a teardown race exposed by mixed-scene transitions.

## Capture authoring and hotspot policy (phase 4)

Choose **New scene → Gaussian splat** to use an existing ready source or upload/create a raw `.splat` capture. The asset library labels captures and supports Create scene. In **Capture**, prepare scale, corrected up axis, yaw and world translation; set exposure/background and orbit distance bounds. Preview uses the same source transform in builder, preview, public and embed. Mesh materials, texture painting, partition review, mesh animation, floor review and walking controls are absent for this scene type.

**Save start view** records the current world position plus yaw/pitch in the existing radians convention. Reload and Reset view restore it. Transform saves reposition hotspots atomically on the server and clear the start view, as specified in phase 1. The frontend's draft transform and dirty comparison include translation; appearance-only saves retain the camera.

Create information or navigation hotspots in **Hotspots**. Set **Hotspot position X/Y/Z (m)** in prepared world coordinates or choose **Place 2 m in front of camera**, then Save hotspot. No surface attachment or triangle raycast is fabricated for a visual capture. Markers show only when projected inside the camera view; capture walls do not hide markers. The hotspot directory remains available for information and navigation. A later aligned proxy can add verified occlusion/walking. Captures cannot be selected as walking-exit destinations.

`test:splat-authoring` passed upload/create, hidden unsupported controls, exact camera restoration, information hotspots, translated/scaled hotspot persistence, appearance edits and splat → panorama → GLB → splat navigation in visitor preview. Existing hotspot acceptance passed normal mesh placement, occlusion/reveal, pointer-lock actions, public/embed and emulated touch. The physical-device matrix, representative reconstructed interior, performance/quality budgets and viewing MVP release acceptance are still separate pending work.
