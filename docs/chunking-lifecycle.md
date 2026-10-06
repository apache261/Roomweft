# Chunk textures, lifetime management and experimental spatial cells

Phases 7–9 extend `chunks-v1`. Existing self-contained manifests remain readable;
source upload validation still rejects external resources. Static reviewed groups
remain the supported input. Animation, skinning and morphing retain the original
fallback. These changes do not establish production or physical-device acceptance.

## Shared image delivery and quality replacement

The processor inventories embedded image hashes across chunks and tiers before
extracting images. It externalizes an image only when at least two chunks use the
same pixels at a common tier. Each dependency is identified by `image-<sha256>`,
with immutable `images/<sha256>.bin` bytes and scoped private/public descriptors.
Each chunk lists the union of its tiers' dependencies, but the loader requests only
images actually referenced by the chosen tier. A dependency's three descriptors
identify the same pixels; different tier pixels receive different identities.

Runtime GLBs may contain `tour-image:<dependency-id>` image URIs. Buffer URLs and
arbitrary external image URLs remain forbidden. The viewer validates the manifest,
parent scope, descriptor identity, image byte count and SHA-256 before substituting
owned blob URLs. The processor validates rewritten GLBs with only declared image
resources and compares actual loader geometry inventories before publication.
Image extraction preserves material extensions, samplers, UV channels, texture
transforms and image orientation; it does not repack or alter baked atlases.

Encoded images have reference-counted owners independent of GPU samplers. Decoded
models retain image leases until cache disposal. Compatible textures are interned
by scope, pixel hash, color space, channel, wrapping, filtering, transform and the
other GPU upload settings. Different sampler/role semantics can still need separate
allocations. Model disposal releases shared texture ownership rather than disposing
textures still used by another model. Overrides and baked maps continue through
their existing owning layers. `?perf=1` reports shared image/sampler owner counts.

A quality replacement uses the existing prepared-tree commit: the previous session,
visual leases and supported pose remain available until the replacement is ready.
Auto DPR trials retain their existing asset tier policy. `image-metrics.json` records
embedded candidate bytes, unique dependency bytes and saved output image bytes
across all generated tiers; this is a processing diagnostic, not a startup saving.
The complete authored occlusion payload still contains its source images.

## Browser lifetime

Room caches discard obsolete queued work and release obsolete in-flight ownership
immediately. Model transfers abort only after their last owner releases them;
shared image transfers have the same rule. Late decodes release acquired ownership,
and every release is idempotent. Required exact indexes, transition targets and
wanted visuals remain pinned even above the soft resident limit.

Inactive entries use LRU with a two-second grace in chunk sessions, followed by
owning-cache disposal under the existing 12-entry/512 MiB decoded cache envelope
and 30-second grace. Timed pruning lets inactive entries settle even without a
subsequent room change. These are heuristics, not established production budgets.

## Durable storage retirement

Migration `016_storage_retirement.sql` records object retirement independently of
parent asset rows. Database triggers record replaced/deleted derivative manifests
and deleted originals, including project cascades. Updating a partition invalidates
its old chunk manifest even when the author returns to complete-original mode.
Workers record attempted output keys **before** uploading, covering interrupted
processes; failed immediate cleanup also queues a durable retry.

Retirement waits one day (current signed reads expire in 15 minutes). The worker
claims at most 16 records per iteration with a five-minute lease and checks all
current asset and derivative references before claiming. Failed deletion records
an error and retries after a bounded hourly backoff. Successful deletion removes
the record. Current products remain protected. Apply the migration before running
the updated worker. Live PostgreSQL trigger, reference-protection, retry and cascade checks pass.
The local upload/worker/storage/browser path also passes; see [final acceptance](chunking-acceptance.md). Docker image build verification remains unavailable in this workspace.

## Explicit spatial splitting

The author inspector offers an experimental checkbox and `spatial_cell_size`
(0.5–64 source units). It defaults off and requires conservative visibility with
reviewed static ownership. This option persists in the partition revision and is
validated by both Go and TypeScript contracts and the generated schema.

The processor assigns whole oriented triangles to cells using their world-space
bounding-box center. It compacts every vertex attribute without interpolation,
preserves primitive material membership and transforms, and records contiguous
source-triangle runs, including noncontiguous runs within one local primitive.
Cell bounds come from the actual exported geometry, not nominal cell boxes.
Spanning triangles can therefore produce large overlapping bounds; they are never
duplicated or clipped. At most 128 cells and the existing aggregate output limits
are allowed. Unsupported primitive extensions, skins, morphs and animation use the
complete-original fallback. Exact navigation and occlusion stay source-derived.

Bootstrap and movement select cells using conservative actual bounds and capsule
halos; camera frusta and movement sweeps select resident/prefetched contributors.
Inspection and HQ shadows request every cell. Movement into a capsule footprint
with missing intersecting visual cells remains blocked. Ambiguous room membership
retains conservative whole-region readiness.

## Verification

Run `npm test --prefix asset-tools`, `npm test --prefix web`,
`npm run build --prefix web` and `go test ./...`.
With Vite on port 5183, run `npm run test:chunk-streaming --prefix web` for shared
image delivery and `npm run test:chunk-spatial --prefix web` for
experimental cells. Browser fixtures use generated GLBs, scoped API mocks and
Chromium SwiftShader; they are not real-upload or physical-device evidence.

The textured small-room fixture's complete exact indexes can exceed original
startup bytes. Image duplication reduction is verified separately from total
startup/network savings. Representative building comparisons, visual review of
cell boundaries and sustained physical-device runs remain production acceptance work.

Recorded browser evidence: [shared image rooms](performance-baselines/chunking-phase789.json)
and [spatial cells](performance-baselines/chunking-phase789-spatial.json).
