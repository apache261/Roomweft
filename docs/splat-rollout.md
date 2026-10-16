# Splat viewing acceptance and deployment

Capture viewing has local implementation and deterministic acceptance coverage. Production rollout defaults to **off** pending representative reconstructed-capture, physical-device and HTTPS/S3 validation. [Proxy walking](splat-walking-streaming.md) has a separate feature gate.

## Controls and rollback

| Control | off | viewer | on |
| --- | --- | --- | --- |
| `ASSET_SPLAT_SUPPORT` (API startup) | No new capture admission or signed reads | Existing private/public capture reads; no new upload tickets, pending completion or scenes | Capture admission and viewing |
| `VITE_SPLAT_SUPPORT` (Vite/Docker build) | Unavailable viewer; no capture creation controls | Existing viewing; no capture creation controls | Capture creation and viewing |

Both controls must permit the requested operation. Runtime flags are validated separately; invalid values stop API startup. Vite rejects invalid build values. Compose defaults both to `off`; native Vite defaults its build gate to `on` for development, and native API startup still defaults `off`. Existing scene metadata, settings, hotspots and reference protections remain intact in every mode. Editing existing metadata is retained. A disabled capture shows an unavailable message and Retry scene; scene selection and the hotspot directory keep other scenes reachable.

1. Back up the database and keep immutable private source objects. Start the new API with support off; startup applies migrations before listening.
2. Build the frontend with `VITE_SPLAT_SUPPORT=viewer` and restart the API with `ASSET_SPLAT_SUPPORT=viewer` to review persisted captures. Confirm `/api/v1/capabilities` reports viewer enabled and authoring disabled.
3. Exercise HTTPS upload/read CORS from the actual production origin, with your private S3 bucket and normal signed URL expiry. Configure [S3 CORS](s3-cors.json). Do not use a disabled-web-security browser for acceptance.
4. After the device/capture matrix below passes, set both controls to `on`, rebuild web and restart API. Verify upload → author → publish → public/embed, navigation and image references.
5. Roll back by setting the API to `viewer` to stop new admission, or `off` to stop new signing/viewing. Rebuild web with the matching build gate. Existing pages recheck capabilities on reload/Retry scene; already issued S3 URLs remain usable until normal expiry. No down migration, relabeling or document removal is necessary. Re-enabling restores persisted captures.

Use `docker compose build api web` for development, or the repository's production deployment workflow with the updated `.env`. Build flags are embedded in static JS and cannot be changed by setting environment variables on a running Nginx container. The API's runtime flag cannot enable a frontend built off.

## Local acceptance evidence

Commands run against local PostgreSQL/MinIO and Vite at MinIO's configured browser origin:

- `go test ./...` with `TEST_DATABASE_URL`, `TEST_S3=1` and S3 environment configuration: publication, immutable promotion/retry, reference protection, migration and existing GLB/panorama/layout regressions; persisted off/viewer/re-enable signing and scene identity.
- `npm --prefix web test`: 106 passing tests, including aggregate source/renderer budgets, idempotent release and build rollout policy.
- `VITE_SPLAT_SUPPORT=on npm --prefix web run build`: TypeScript and bundled renderer build; local decoder assets and copied MIT license.
- `npm --prefix web run test:splat-authoring`: full upload/create/prepare/camera/hotspot path; mixed public/embed viewing, information image, fullscreen, emulated touch drag, deletion protection and unpublish/republish with existing signed URL retention.
- `npm --prefix web run test:splat-viewer`: signed URL renewal, failure/retry, 12 consecutive reloads, worker ownership, independent viewers, context restoration, DPR/camera preservation, idle settling and disabled/re-enable mixed navigation. Runtime viewer-only mode hides capture creation controls. Writes `test-results/splat-viewing-acceptance.json` (local ignored artifact).
- `npm --prefix web run test:splat-proof`: synthetic 39,204-splat room, resize, five mount/unmount cycles and context recovery.
- `npm --prefix web run test:hotspots`: existing placement, occlusion, pointer-lock, GLB/panorama, public/embed and emulated touch regressions.
- `npm --prefix web run test:layout`: authoring, instances, attachments, walking, walls, public/embed and emulated touch regressions.

The synthetic shared-viewer run used Chromium ANGLE SwiftShader, 441 splats / 14,112 source bytes and native DPR 2. One local run recorded first usable view at 928 ms, decode at 31 ms and first sort at 57 ms. These include local startup and software rendering; repeated runs vary. Verified quality DPR was Low 1, Balanced 1.5, HQ 2 and initial Auto 1.5, with unchanged camera and one worker throughout. Twelve reloads returned to one worker; failed/disabled views returned to zero. Settled idle checks allowed fewer than five frames in 500 ms. These are correctness assertions, not physical-device frame-time budgets.

The same authoring acceptance also passed against the production Nginx image with `TOUR_FRONTEND_ORIGIN=http://localhost:5180 npm --prefix web run test:splat-authoring`. The test serves built static assets through the configured local browser origin, grants Chromium local-network access permission, and retains actual API/MinIO requests and CORS checks. This verifies the production frontend bundle over local HTTP; actual production HTTPS/S3 remains pending.

## Quality and diagnostic interpretation

| Quality | DPR cap | Tradeoff |
| --- | --- | --- |
| Low | 1 | Lower raster resolution and pixel work; full capture/count retained |
| Balanced | 1.5 | Intermediate raster resolution and pixel work |
| HQ | 2 | Higher raster resolution; more pixel work, no new source detail |
| Auto | Shared capability and sustained-frame policy | Bounded DPR trials; interrupted/ineffective trials restore the previous tier |

The full capture and camera stay resident across quality changes. There is no splat LOD or mesh texture tier. Optional [exact tile streaming](splat-walking-streaming.md) has independent controls. DPR can help pixel cost but cannot resolve worker sorting or decoded-count costs.

Development `?perf=1` exposes anonymous network/stage measurements, first usable view, frame distributions, source/count, decode duration, last 120 sort durations, one-or-zero sort backlog and estimated CPU/GPU allocations. Estimates now include worker counting tables and one decode batch; they are broader than the initial renderer allocation estimate. Browser frame samples exclude idle gaps and GPU time is not measured. Source reservations allow two distinct maximum-size sources per browser realm (128,000,000 bytes); renderer reservations cap estimated aggregate CPU/GPU allocation at 384 MiB. Separate tabs have separate budgets. These are provisional ceilings, not total browser memory guarantees; transfer copies, driver allocations and garbage collection add overhead. Oversized, unsupported, timed-out and budget-rejected captures present actionable retry/export-smaller errors.

## Production image verification

The production Node 24 → Nginx image builds from locked dependencies and bundles the renderer, Basis decoder assets and adapted Drei MIT license. Registry requests timed out in this environment; a temporary acceptance build seeded the npm cache with 89 lock-integrity-matched local package tarballs and ran `npm ci --offline` successfully. This verifies a clean dependency install from cached packages, rather than live-registry availability. The unchanged repository Dockerfile then built successfully using the populated cache. Image inspection confirmed the lazy splat adapter, decoder files and byte-identical license. No acceptance cache is added to the repository or runtime image.

## Required release measurements (pending)

Use at least a representative reconstructed indoor export, plus small and near-limit captures, on desktop integrated graphics, physical iOS Safari and physical Android Chrome. Record source bytes/count, native DPR, quality, cold/warm first usable frame, sort median/p95/max, camera-motion frame median/p95/p99, JS heap where available, estimated CPU/GPU allocations and worker/source counts after 20 minutes and repeated mixed-scene visits. Review transparent overlap, large nearby splats, quick rotations, background/resume and context loss. Record the actual production HTTPS origin/S3 CORS and unpublish/renewal result.

Proposed review targets: first usable view ≤ 5 seconds for the representative capture over a recorded connection; motion frame p95 ≤ 33.3 ms on the reviewed desktop profile and ≤ 50 ms on reviewed mobile Low; no resource-count growth after 20 repeated scene switches, no idle sort growth, and no crash during a 20-minute session. These targets require product/device review against measured baselines before becoming accepted budgets. Do not mark the device matrix or production delivery accepted from SwiftShader or touch emulation.
