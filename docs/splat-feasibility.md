# Gaussian splats: phases 0–2

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

| Fixture | Source bytes | Splats | First sort (decode + worker startup) | Estimated resident CPU | Estimated GPU |
| --- | --- | --- | --- | --- | --- |
| Small colored plane | 14,112 | 441 | 64 ms | 61,740 bytes | 15,876 bytes |
| Generated indoor room | 1,254,528 | 39,204 | 85 ms | 5,544,752 bytes | 1,467,536 bytes |

These are provisional allocations estimated from source, packed textures, worker matrices, sort buffers and instance indices, not measured VRAM. First sort precedes the first usable frame; the acceptance script waits for subsequent animation frames and writes fresh timings to `test-results/splat-baseline.json`. Motion samples include host/browser round-trip time: early samples were 30–50 ms, with late SwiftShader samples reaching 1.3–1.7 seconds. No mobile or performance budget is accepted from these results. A representative reconstructed indoor export, physical GPU/device baselines, background-tab restoration and visual transparency/exposure review remain external acceptance work.

## Persistence, admission and delivery

Migration 017 extends kinds and size constraints without changing applied migrations or existing scene documents. New/imported scenes require a ready same-project source with matching kind; a database trigger independently enforces this. Scene creation infers `SPLAT` from a ready splat source and initializes the versioned settings. Existing 3D, panorama and layout paths remain supported. API cameras use the existing position/yaw/pitch schema. Normal scene deletion/reference protection and public asset scoping include the source automatically.

The asset library accepts `.splat` sources, checks size/record alignment and a bounded prefix of attributes before requesting a ticket. Completion authoritatively scans every record with a fixed 64 KiB buffer. Each storage client allows two concurrent splat inspections and a 30-second context deadline. Admission, DB size checks and completion use the same decoded count/byte ceiling. The inspected GET and pending-to-final copy are bound to the pending ETag. Originals are delivered unchanged through private signed reads; optional mesh processing is never queued for splats.

Splat public reads require a published project and an actual referenced ready source. The existing 15-minute signed URL expiry, project cleanup, source reference restrictions and CORS configuration apply. No secure-context-only decoder is introduced: local HTTP MinIO works and production must continue using the configured HTTPS browser origin/S3 CORS. Upload URLs and credentials must not be logged.

Shared tour rendering, authoring controls and splat hotspots are phases 3–5. Until those are implemented, persisted SPLAT scenes show an explicit phase-3 viewing message instead of entering the GLB loader. Uploading a source and creating a scene through the API is supported; the new-scene authoring dialog remains deferred to phase 4.
