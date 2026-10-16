# Intact chunk generation and scoped delivery

Saving a valid `reviewed-rooms` partition atomically queues a separate `chunks-v1` derivative job. The existing whole-file `runtime-v1` manifest and original remain accessible. API startup applies migration `015_chunk_derivatives.sql`; Docker includes the inventory, chunk, shared-image and spatial-split processor modules. Native processing uses the existing `ASSET_PROCESSOR_SCRIPT` configuration.

The processor extracts intact static meshes by reviewed source node/primitive ownership. Multi-primitive meshes require one owner. Each nonempty room gets a chunk, and global contributions appear once. Transform hierarchy and empty attachment nodes are retained, with explicit source-to-runtime surface mappings and identity `local_to_source`. Original glTF node indices are tagged before import, so a rewritten node table cannot silently change ownership. Original extras are preserved. Source names never establish ownership.

Low/Balanced/HQ payloads reuse the current material/texture processor. Triangle reordering is disabled for chunks; runtime checks compare ordered world-space triangles as well as semantic snapshots, surfaces, attributes, transforms and materials. UV1 remains intact. Each output passes glTF validation and Three GLTFLoader inventory, then Go checks authoritative source/partition coverage and every file hash and byte count before upload. Every required product uploads before the manifest becomes ready.

Skins, clips, morphs, instancing, lights, uncertain dependency groups, unsupported extensions and independently assigned primitives of one mesh retain the complete-original path. Giant intact meshes may be global, but are not cut. Processing admission remains 256 MiB source, 1 GiB Node heap, ten-minute execution and fifteen-minute lease. Chunk generation additionally caps reviewed rooms at 128, required uploaded products at 512, aggregate required output at 1 GiB and manifests at 4 MiB. These guards do not establish production device budgets.

Chunks embed their own textures. Repeated pixels can increase total delivery and decoded estimates; no shared-image savings are claimed. The manifest records actual payload bytes and per-tier texture estimates. Sum chunk payload bytes for a visited set, and count navigation/occlusion separately. The full exact navigation proxy retains every source surface identity without granting floor approval. The occlusion product is a byte-identical copy of the original GLB, retaining authored material, alpha image, visibility and sidedness semantics. Its full bytes and preparation cost must count toward future startup measurements. This conservative choice may eliminate initial download savings; regional exact occlusion remains future work.

Database claims snapshot processor version, partition revision, source hash, inventory and review. Publication requires the current attempt, unexpired lease and matching current source/revision. Partition edits reset queued attempts; current descriptor reads join against the saved revision. Obsolete reviews cannot be reclaimed or delivered. Interrupted current jobs can be reclaimed when their lease expires. Failed writes and rejected publication remove attempted uploaded keys. Abrupt process death and retirement of successful older products use the [durable storage retirement workflow](chunking-lifecycle.md#durable-storage-retirement).

Parent asset responses optionally advertise:

```json
{"streaming":{"state":"ready","processor_version":"chunks-v1","delivery":"scoped-descriptors","manifest_url":"/api/v1/assets/<uuid>/chunks"}}
```

Pending/failed states have no manifest URL. Private responses may include an actionable error; public responses omit it. `POST /api/v1/assets/{id}/process` also retries a failed current chunk job. Saving a new reviewed revision queues it automatically.

| Private route | Response |
| --- | --- |
| `GET /api/v1/assets/{id}/chunks` | `{delivery: "scoped-descriptors", manifest: ...}`; validated metadata with descriptor endpoint URLs |
| `GET /api/v1/assets/{id}/chunks/{chunk}?tier=low` | Renewable signed payload URL, SHA-256, bytes and texture estimates |
| `GET /api/v1/assets/{id}/chunk-indexes/navigation` | Exact navigation descriptor |
| `GET /api/v1/assets/{id}/chunk-indexes/occlusion` | Authored occlusion descriptor |
| `GET /api/v1/assets/{id}/chunk-dependencies/{dependency}?tier=hq` | Scoped dependency descriptor, if declared in a supported manifest |

All routes also exist below `/api/v1/public/tours/{slug}/assets/{id}`. Public requests first check the published tour's reference to the ready parent. Every refresh repeats authorization and resolves IDs only through the current validated manifest. Generated descriptor URLs include the source hash and partition revision; a conflicting `revision` or `source_sha256` query returns 409 so an old manifest cannot silently refresh to a new product. Unknown IDs return 404, invalid tiers return 400, and failed signing returns 503. Missing tiers default to Balanced. Unpublishing prevents new signing; existing signed URLs retain their normal expiry.

In `scoped-descriptors` mode, manifest payload `url` fields identify JSON descriptor endpoints, not binary files. Fetch one endpoint to obtain a signed binary URL. The manifest itself signs zero storage URLs, avoiding startup signing of unused chunks. Storage keys and local paths are never delivered. Descriptor identity is the parent/source/revision/chunk/tier/hash, not the URL. Viewer consumption and safe movement gating are implemented in [viewer bootstrap and preloading](chunking-viewer.md).

Checks:

```sh
npm --prefix asset-tools test
go test ./...
npm --prefix web test
npm --prefix web run build
TEST_DATABASE_URL=... go test ./internal/httpapi -run 'TestDerivativeQueuePublicationAndPrivateFallback|TestPartitionPersistenceInventoryAndCAS' -v
```

Native tests exercise nested transforms, multi-primitive groups, UV1, original preservation, actual runtime inventories and generated-byte integrity. Worker tests cover complete publication, failed uploads, corrupt files, illegal filenames and superseded revisions/attempts. Scoped handler tests cover private/public references, unpublishing, descriptor renewal, malformed manifests, invalid tiers/IDs, indexes, dependencies and signing failures. The database lifecycle test additionally covers automatic review queueing, expired lease recovery and obsolete review exclusion. Live PostgreSQL checks need an accessible `TEST_DATABASE_URL`; they were unavailable in this implementation environment.
