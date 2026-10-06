# Runtime asset processing

Performance Phase 4 adds recoverable GLB and material-texture processing. Originals remain immutable and usable before processing, after a failed attempt, and when a browser cannot load a derivative. Panorama and hotspot image assets continue using their existing path.

## Enable and operate

Docker includes the pinned `asset-tools` dependencies and sets `ASSET_PROCESSOR_SCRIPT=/app/asset-tools/process.mjs`. For native development, run `npm --prefix asset-tools ci` and export `ASSET_PROCESSOR_SCRIPT="$PWD/asset-tools/process.mjs"` before starting the API. Without that variable the worker stays disabled. API startup applies migration `012_asset_derivatives.sql`.

Completed GLB and `TEXTURE_*` uploads queue processing. The asset library exposes status and retry, including an optimization action for earlier uploads. `POST /api/v1/assets/{id}/process` queues an eligible completed asset; repeated requests do not restart ready jobs. Failed attempts can be retried. Owner asset responses include actionable errors; public responses omit processing errors.

The worker processes one job at a time, limits originals to 256 MiB, caps Node's heap at 1 GiB, and times out after ten minutes. A fifteen-minute database lease recovers interrupted jobs. Attempts have unique IDs; a stale process cannot publish over its replacement. Error/log output is bounded.

## Validation and publication

Self-contained GLB sources pass the glTF validator. The processor preserves the scene hierarchy and performs conservative accessor deduplication/pruning and lossless vertex/index ordering with Meshopt. It compares transforms, animation/skin/morph values, oriented geometry, UV attributes and material semantics. A Three loader inventory also confirms actual runtime mesh paths, names and world geometry. No graph flattening, material merging or geometric quantization occurs.

Required unsupported extensions, external GLB dependencies and source Draco/KTX2/instancing processing currently fail with an actionable message. This processing limitation is separate from browser viewing: Meshopt and KTX2/Basis viewing are verified; Draco viewing remains unsupported. KTX2 output generation is deferred. Compression can increase small GLB payloads: the fan fixture grows from 9,888 to 11,804 bytes, so blanket download improvements are not claimed. Resized textures are PNG and the GPU creates ordinary mipmaps.

Low/Balanced/HQ cap embedded and external material images at 1024/2048/4096 while preserving alpha and aspect ratio. The processor checks each tier's RGBA8-plus-mips estimate against provisional 64/192/384 MiB caps. The viewer applies these budgets to the sum of distinct known scene assets and lowers tiers when needed. Unknown originals and a scene larger than Low remain visible and explicitly reported in diagnostics; this is not a strict device-memory guarantee. Original fallback may consume more memory than a requested tier.

Collision proxies contain exact position/skin/morph geometry and hierarchy with rendering data removed. Authored collision flags and selected floors are applied from the same surface paths; proxies cannot approve floors. This preserves geometry and reduces irrelevant proxy payload, rather than simplifying collision triangles. The browser avoids a proxy download when its combined variant/proxy bytes would exceed the original source size.

The versioned manifest records source/output SHA-256, sizes, bounds, tier texture estimates, surface mappings and collision validation. Outputs are private, immutable and attempt-scoped. The worker verifies files and uploads the complete set before publishing a ready manifest through a compare-and-swap database update. Failed/stale attempts delete their own uploaded files. No failure overwrites or deletes an original. Abrupt process termination can leave unreferenced attempt objects; storage garbage collection is future operational work.

## Delivery and ownership

Asset and published-tour endpoints authorize access before generating signed URLs; publication reference checks also apply to derivatives. Unpublishing prevents new public URL delivery, subject to the existing expiry of previously issued URLs. Storage keys and local processor paths are omitted from client manifests.

The browser verifies derivative hashes before decode, then uses the original on missing, corrupt or unsupported output. Integrity verification requires `crypto.subtle`; without it the original path remains available. Expired original URLs refresh through the authorized endpoint. Cache identity uses authorization scope, asset ID, source hash, processor version and tier, rather than signed URL strings.

Model caches share only compatible renderer texture-format profiles. Reference counts protect sources used by independently cloned scene materials, animation state and collision trees. Model and texture caches use bounded unowned entries with a thirty-second grace period; active owners may exceed their nominal caps. Transcoder workers stop only when pending decodes have finished and no model owners remain.

Prepared navigation data is keyed by source geometry, model/layout configuration, transforms, collision flags and reviewed floor references. Geometry/index changes invalidate it. Each walk world retains its own navigation permission state. Equivalent variant changes preserve standing and orbit poses, explicit exterior permissions and clip phase; changed configuration must revalidate them. Auto's temporary DPR trial does not request new texture tiers until accepted.

## Repeatable checks

```sh
npm --prefix asset-tools test
npm --prefix web test
npm --prefix web run build
TEST_DATABASE_URL='postgres://tour:tour-local-only@localhost:5432/virtual_tours?sslmode=disable' go test ./...
go vet ./...
TOUR_ORIGIN=http://localhost:5173 npm --prefix web run test:runtime-assets
TOUR_ORIGIN=http://localhost:5173 npm --prefix web run test:runtime-textures
```

`TEST_ASSET_API_URL=http://localhost:8080 npm --prefix asset-tools run test:worker` additionally needs a local running API with the worker enabled, PostgreSQL and private MinIO, using the environment described in the README. The browser checks mock API delivery but exercise actual Meshopt/Basis decoders and texture loading. The worker test exercises real upload, queue, storage, hashes, publication restrictions and original preservation. It cleans up its test project.

Use [the benchmark procedure](performance-benchmarks.md) for same-device cold/warm scene changes, decode and collision timings, texture/resource inventory, and sustained walking. Keep physical-device measurements separate from software-renderer smoke results. Native checks pass; the Docker image still needs a build/run check because the current session cannot access its daemon. Mobile GPU formats, thermal behavior and final budgets remain pending. The previously reproduced public courtyard-exit walking failure is tracked in `performace_phase.md` and is not claimed resolved by these checks.

Recorded Phase 4 evidence is linked from [the phased plan](../performace_phase.md). The 601-mesh navigation microbenchmark measured median preparation of 157 ms cold and 1.2 ms cached, with stable cache entries/owners over 100 repeats. Run `node web/scripts/benchmark-navigation.mjs` to repeat it. The four external 2048 textures load at 1024 in Low, reducing their RGBA8-plus-mips proxy by approximately four times. These measurements establish fixture-specific benefits; they do not establish physical-device FPS or production memory budgets.
