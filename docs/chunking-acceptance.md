# Phase 10 validation, rollout and final handoff

The implementation is finalized for reviewed static room groups, shared images
and optional intact-triangle spatial cells. Automated acceptance covers generated
fixtures and the local upload/worker/database/storage path. Production acceptance
is **held** until representative building comparisons, author visual review,
shader/upload traces and sustained physical-device measurements establish budgets.

## Explicit rollout and rollback

| Control | Behavior |
| --- | --- |
| `ASSET_CHUNK_STREAMING=off` (API startup default) | Suppress chunk advertisements and reject chunk/index/dependency delivery; complete assets remain readable. Processing/review may continue for staged evaluation. |
| `ASSET_CHUNK_STREAMING=reviewed` | Advertise validated `streaming-v1` / `chunks-v1` products for reviewed intact static room groups; spatial products retain complete loading. |
| `ASSET_CHUNK_STREAMING=spatial` | Also allow explicitly reviewed experimental `spatial_cell_size` products. This does not automatically enable splitting on uploads. |
| `VITE_CHUNK_STREAMING=0` | Build the viewer to bypass chunk streaming even if the API advertises ready products. |
| `?streaming=0` | Per-view complete-file reference/rollback for imported scenes and layouts. |
| Author partition policy `complete` | Invalidate current chunk products, keep the original immutable, and queue obsolete storage keys for retirement. |

The API rejects unknown rollout settings at startup. The viewer admits only the
implemented processor version, ready state and scoped descriptor delivery; future
versions remain on the complete path. Builder editing retains complete geometry.
Reviewed chunk streaming applies to preview, public and embed. An individual
neighbor failure retains the current view and safe movement boundary with retry.
Bootstrap/manifest failure uses the complete scene. Restart the API after changing
its rollout environment and reload viewers to apply rollback; existing signed
binary URLs expire under their ordinary 15-minute lifetime. Storage retirement
keeps a one-day grace and protects referenced current products.

## Repeatable verification

Install the existing `web` and `asset-tools` dependencies. Start the source API
against development PostgreSQL and S3-compatible storage, with
`ASSET_PROCESSOR_SCRIPT` pointing to `asset-tools/process.mjs`. For live acceptance,
use `ASSET_CHUNK_STREAMING=spatial` to include the experimental gate. Start Vite on
5183 with `API_PROXY_TARGET` pointing to that source API, for example port 8082.
Do not redirect tests to a production database.

Run from the repository root:

```bash
# Mocked browser suites and implementation checks; Vite must be running.
CHUNK_BROWSER_ORIGIN=http://localhost:5183 node scripts/validate-chunking.mjs

# Also verify database integration, actual upload/worker/storage and walking.
# TEST_DATABASE_URL must identify a development/test database.
TOUR_API_ORIGIN=http://localhost:8082 \
TOUR_ORIGIN=http://localhost:5173 \
TOUR_FRONTEND_ORIGIN=http://localhost:5183 \
CHUNK_BROWSER_ORIGIN=http://localhost:5183 \
node scripts/validate-chunking.mjs --live
```

The localhost:5173 browser origin is used for live storage CORS while its application
requests are proxied to the source frontend. Match that origin to storage CORS in
other environments. Live fixtures create and delete their own projects; database
lifecycle tests use disposable schemas. Browser suites run sequentially to avoid
software-renderer contention. Results and scrubbed logs go to
`CHUNK_ACCEPTANCE_OUTPUT` (default `/tmp/chunking-acceptance`).
Individual commands include `npm run test:chunk-comparison --prefix web` and
`npm run test:chunk-live --prefix web`. The runner also supports
`--only=quality,hq-rendering` for focused diagnosis. A failed required check exits
nonzero; an absent live database is reported and never treated as live evidence.

## Measurement definitions

The comparison uses the same generated source SHA-256, partition revision, viewport,
Balanced quality and two-visit route in complete and chunked modes. Both modes run
cold and after an A → alternate scene → A warm transition. A second pair adds
120 ms to binary responses. This is artificial latency, not bandwidth throttling.

Reports record all successful binary payload bodies before the first safely usable
walking view, including exact navigation, occlusion and shared image dependencies;
total binary bytes for the visited route; first rendered/walking times; frame-time
and CPU submission distributions; decode/preparation intervals; and geometry,
texture, decoded-cache and JS-heap proxies. Descriptor/HTTP overhead and failed
bodies are not included in these payload counters. Browser Resource Timing lower
bounds remain separately available in ordinary performance exports.

Shader/upload stalls and GPU time are explicitly unavailable without trace review.
Software-renderer frame distributions are instrumentation evidence, not device
budgets or claims of an FPS improvement. Warm means decoded-cache reuse in the same
page runtime, rather than HTTP-cache performance. Geometry/texture estimates are
not exact GPU memory measurements.

The complete authored occlusion source and exact navigation are still startup-global.
The generated small fixture therefore **does not establish startup transfer savings**.
Shared-image duplication reduction and conservative residency selection are separate
results. Before wider rollout, evaluate verified smaller/regional exact indexes on
representative uploads; do not claim savings based on hiding resident meshes.

## Final acceptance boundaries

The historical public courtyard-exit failure did not reproduce in the current full
walking browser acceptance, including public/embed and emulated touch. That result
is distinct from sustained physical-device acceptance. Animation continues through
the complete fallback; animated/skinned/morphing sources do not enter static chunk
processing. Atlas and hotspot semantics have automated regression coverage, while
author review of real uploaded buildings and baked maps remains required.

Production rollout should stay off until the same real source/revision/device has
repeatable useful startup or residency improvements without visual/navigation
regressions, established per-device budgets, trace review and a rollback check.
Spatial cells require their own silhouette, lighting, oversized-triangle and cell-
border review. Nothing in this automated report certifies those physical or author
review requirements.

## Recorded final evidence

[Acceptance matrix and check logs](performance-baselines/chunking-phase10-acceptance.json),
[live upload/worker/storage report](performance-baselines/chunking-phase10-live.json),
and [same-source cold/warm comparison](performance-baselines/chunking-phase10-comparison.json)
record this handoff. Database tests ran with `TEST_DATABASE_URL` configured.
The frontend has 98 passing unit checks and the processor has six; both ordinary
and disabled-streaming builds pass, as do Go tests and vet. Browser coverage
includes reviewed partitions, intact and spatial chunks, room streaming, runtime
variants, KTX2/Meshopt, baked lighting, animation, quality/hidden-tab resume, six
benchmark scenes, walking, hotspots and panoramas.

| Successful payload bodies | Complete source | Chunked |
| --- | ---: | ---: |
| Cold startup before safe walking | 12,960 bytes | 24,509 bytes |
| Cold two-visit route total | 12,960 bytes | 35,773 bytes |
| Warm same-page route | 0 bytes | 0 bytes |

These byte totals match for the zero-delay and artificial 120 ms latency pairs.
Walking time and software-renderer frame distributions are recorded per run,
without asserting a device speedup. The exact-index startup strategy explains
why this fixture does not justify enabling production rollout. Docker image
build verification is still unavailable; the packaging copy list now includes
all processor modules and native worker integration passes.
