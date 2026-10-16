# Reviewed capture walking and exact tile streaming

Reviewed GLB proxies support capture walking, and independently addressable splat tiles support selective loading. Capture placement in layouts and photo/video reconstruction are unsupported. Synthetic browser checks cover correctness; representative captures, physical devices and production HTTPS/S3 still require validation.

## Authoring a walking capture

Upload a small static, self-contained GLB collision proxy containing structural geometry through the asset library. In a capture's **Walking** tab, select **Collision proxy**, enable **Show proxy wireframe**, and align its scale, up axis, yaw and world position against the splat. Proxy coordinates are independent prepared world metres; the GLB does not inherit the capture's raw `(x,−y,−z)` correction or preparation transform.

Save the transform, then check **I reviewed proxy alignment against the capture** and save again. Add walking regions, review the height band and select structural floor meshes using the existing floor picker. Save changes, choose **Walk inside**, verify standing clearance and save a walking start. Roofs/furniture never become approved floors automatically. Skinned, morph and GPU-instanced proxy geometry is rejected; export expanded static meshes instead. Unsupported proxy geometry is rejected by the browser adapter; inspection stays available when proxy loading/preparation fails.

The optional **Use reviewed proxy walls to hide hotspot markers** uses full proxy triangles. This is an approximation of captured walls and openings; reviewers must confirm alignment. Without that selection, hotspot markers retain screen visibility without wall occlusion. The proxy is invisible during visitor viewing and walking; authoring can show its cyan wireframe.

Uploaded proxy extras cannot bypass collision or approve unselected floors. Proxy navigation loads the immutable authored GLB rather than a lower visual-quality derivative. Walking reuses `WalkWorld`, its exact triangle indexes and `ModelWalkControls`: capsule contact checks, thin barriers, supported floor sweeps, step/slope limits, region bounds, explicit exits, standing recovery and pointer/touch controls remain shared with GLB/layout scenes. Capture visuals and proxy geometry must both be ready. A missing/invalid proxy leaves inspection available. Saved walking starts and arrivals are checked against approved regions and exact proxy geometry at runtime.

Proxy references are durable rows in `scene_splat_proxy_refs`, with same-project source/proxy foreign keys. Ready GLB kind/readiness is checked independently by a database trigger. Referenced proxies cannot be deleted and are included in publication checks and scoped public signing. Source preparation, proxy replacement or proxy transform edits atomically clear alignment review, navigation and saved cameras, including direct settings updates covered by migration 019. Appearance/occlusion changes preserve geometry approvals. Incoming exits with obsolete region references fail publication; capture arrival validation refreshes destination metadata and refuses stale reviews before entering.

## Tile generation and delivery

Enable tile generation, then complete a raw capture upload or choose **Generate capture tiles** in the asset library. The API queues `splat-tiles-v1` in the existing leased derivative worker. Generation runs in Go and needs no training service, conversion CDN or additional decoder. Raw sources remain usable when generation fails or exceeds the supported spatial-cell limit.

The generator validates the complete bounded raw source, calculates SHA-256, applies the fixed format coordinate correction to bounds, and assigns each original 32-byte record exactly once to a deterministic 8-metre spatial cell. Each tile's bounds include three times the largest source scale around each position. It retains color, orientation, opacity and scale bytes exactly. Limits are 2,000,000 source records / 64,000,000 bytes and 512 cells; this is a distinct manifest namespace and does not reuse GLB chunk/floor/material contracts.

Each manifest identifies the parent UUID, source hash/bytes/count, worker attempt, cell size and each tile's count, bytes, conservative bounds and payload hash. Tile keys use a source-hash/attempt namespace. All payloads are complete before lease/attempt compare-and-swap publication. Attempted keys are registered for durable retirement before upload; failed/stale outputs and deleted/replaced manifests use the existing retirement queue.

Private/public `/assets/:id/splat-tiles` routes reauthorize the ready parent on every manifest or tile descriptor read. Public access additionally requires publication and an actual source reference. Responses omit private storage keys; one tile descriptor signs one validated tile. Requests with a stale source hash or unknown tile fail. Unpublishing prevents descriptor renewal; existing signed S3 URLs retain normal expiry.

## Viewer ownership and readiness

Unsaved inspection views fit the whole capture bounds; authored start views enable selective bootstrap. The planner requests tiles intersecting the camera frustum or within eight metres of the camera, prioritizing nearby tiles. It includes a nearest-tile fallback for empty inspection views. Two bounded transfers run concurrently; obsolete pending transfers abort immediately and inactive retained buffers use two-second hysteresis. Every payload is bounded, hashed and raw-profile validated. Replacement decode has a 60-second deadline and worker sorting retains its 15-second watchdog. Signed-read expiry renews the scoped descriptor once. A failed neighbor can be explicitly retried.

Resident records are combined into **one globally sorted splat renderer**, rather than independently sorted transparent tile meshes. Replacement decoding/sorting happens while the previous renderer remains visible. The new set commits only after its first sort completes; no commit resets the supported camera. Walking's admission callback requires all tiles intersecting the standing capsule to belong to the committed visual set, in addition to normal floor/collision approval. Failed or evicted records cannot grant standing permission. Decode/sort errors block admission until recovery; a healthy prior view is retained when a replacement cannot be allocated.

Source leases, including streaming sessions, share the 128,000,000-byte reservation ceiling; renderer allocations share the existing 384 MiB estimate ceiling. Rebuilding resident buffers can briefly require both renderer allocations. A large replacement may hit that ceiling and require a smaller export. There is no LOD reduction. This implementation reduces selective network/loading work, while large visible captures can still require most source bytes and expensive resident redecoding.

## Independent rollout

| Runtime setting | Browser build setting | Default |
| --- | --- | --- |
| `ASSET_SPLAT_SUPPORT` | `VITE_SPLAT_SUPPORT` | `off`; existing off/viewer/on contract |
| `ASSET_SPLAT_WALKING` | `VITE_SPLAT_WALKING` | `off`; on/off |
| `ASSET_SPLAT_STREAMING` | `VITE_SPLAT_STREAMING` | `off`; on/off |

Both runtime and build settings must enable a feature. Startup/build reject invalid values. Compose and the frontend Docker build wire all settings. Apply migrations before enabling authors. The native worker is started through `ASSET_PROCESSOR_SCRIPT`, as with existing derivatives; tile generation itself uses Go, while GLB/texture jobs still use the configured Node script.

Disable walking to retain capture inspection and persisted reviews without enabling movement. Disable streaming, or use `?splat_streaming=0`, to load the immutable complete source. Stream initialization that finds no usable product falls back to the complete source; it never fabricates a tile manifest. Rollback preserves scenes/reviews/source products and does not relabel or delete records. Previously queued jobs can finish after the streaming flag is disabled; delivery remains gated.

## Local evidence and limits

- Go tests with PostgreSQL/MinIO cover proxy project/kind/readiness rules, deletion protection, public proxy delivery, approval invalidation, exact tile generation, failed uploads/stale attempts, private/public tile descriptors, source hash checks, unpublish and durable retirement.
- Frontend tests cover independent proxy transforms, reviewed floor contact/clearance, barriers, missing tile admission, selective transformed bounds, malformed manifests/payloads, expiry renewal, targeted retry, commit/eviction and warm retained-buffer reuse. Existing navigation suites continue to cover stairs, thin walls, floor gaps and region boundaries.
- `npm --prefix web run test:splat-walking-tiles` exercises the alignment overlay/review flow, public/embed collision walking, explicit cross-capture exits and returns, wall stops, camera preservation through tile replacement, reset, stale-arrival invalidation and unpublish. It writes ignored `test-results/splat-tiles-comparison.json`.
- The synthetic three-cluster capture has 1,323 splats / 42,336 bytes, with a 2,316-byte static proxy. The initial public/embed view fetched 14,112 visual bytes and retained 441 splats: 16,428 bytes including the full proxy, compared with 44,652 bytes for complete visual/proxy delivery (63% fewer decoded payload bytes). An unchanged warm view reuses its retained tiles without additional visual downloads. These are decoded payload counts, not TCP/TLS transfer measurements or reconstructed-capture performance claims.
- Production static frontend builds include the adapter, local renderer assets and license. Existing raw authoring/viewer acceptance passes with `?splat_streaming=0` after the extension.

Representative indoor capture review must still confirm conservative bounds, near-camera transparency, visible coverage through quick rotations, proxy alignment and wall/opening approximation. Physical-device loading/frame/memory thresholds and production S3/CORS acceptance remain pending. The earlier release measurement checklist applies; local synthetic success does not accept those deployment/device gates.
