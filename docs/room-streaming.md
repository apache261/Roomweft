# Room visibility and progressive layout loading

Phase 6 uses template room bounds and physical doorway rectangles as visibility metadata. Visibility openings are independent of navigation exits: an exit never creates a line of sight or grants permission to enter an unprepared room. The portal evaluator clips openings against the camera frustum and accumulated opening cones, so aligned openings can expose several rooms while a bent connection does not automatically expose its entire graph. Camera positions on a doorway use both adjoining rooms; openings near the camera plane use a conservative local traversal. A bounded traversal falls back to the complete view if its work limit is reached.

Preview, public and embed layouts use this path automatically. Builder editing keeps the complete authored model. `?streaming=0` restores complete loading and disables room culling; `?spatial=0` controls batching/LOD independently while retaining the visual tree needed for room culling. Streaming partitions spatial batches by room ownership. Shared walls have both room owners. Authored objects retain material paths, floor approvals and exact hotspot occlusion; only the separate visual tree is hidden.

## Authoring and delivery

In Plan, choose an imported instance and use **Load with room** to assign a contained object to a template room. `room_id` is an optional, persisted and validated element field. Keep structural imports, stairs, atriums, open-plan geometry and objects spanning rooms **Always loaded**. Unclassified imports or standalone floors make visibility conservative because they can add openings not described by template doors. Loaded instances with animations or bounds outside their assigned room also trigger full visibility and loading. The editor enables room choices only when loaded mesh bounds fit, and clears assignments after spatial edits to the instance or owning room. Authors must review containment before assigning an object; this implementation does not derive trusted spatial bounds for an unseen arbitrary GLB.

Existing independently addressable GLB assets are delivery chunks, deduplicated by asset identity across all rooms. The occupied room and global assets receive priority; a doorway ring is preloaded regardless of look direction, followed by visible rooms. An aligned view can legitimately require many rooms. Generated template structure is small local geometry and remains resident. External material-preset textures remain global. A single large uploaded GLB is preserved as a single chunk; it must be authored as separate modules to gain room delivery savings. This implementation does not claim that hiding a monolithic model reduces its download or memory.

## Readiness, ownership and failure

A room remains blocked until all assigned GLBs have decoded and the exact navigation world has been prepared. Capsule support cannot overlap an unready room, including across a doorway or a saved/portal arrival. The initial controls wait for the occupied room and all global assets. Subsequent loading preserves the supported camera pose and held walking input. A quality-tier replacement retains the previous prepared scene and resource leases until the occupied room replacement is ready.

Requests have two concurrent load slots. The room cache retains up to 12 entries, expanding only for the currently required set; eviction releases leases for inactive entries, and in-flight completions after unmount release their leases once. The existing decoded cache independently bounds unowned entries to 12 and an estimated 512 MiB with a 30-second disposal grace period. Required/owned assets cannot be evicted to satisfy a soft budget. These values are provisional, not measured physical-device limits. Scene descriptors are retained for revisits, including after signed URLs expire. Failed requests retain a blocking boundary and a **Retry room loading** action.

Inspection/orbit and exterior or unknown viewpoints request the full scene. Unclassified structural geometry conservatively preserves windows, stairs and open areas. Enabled realtime shadow maps also request/render all room contributors; current viewers have no dynamic reflection capture pass. A future reflection renderer must request its complete contributor set before enabling capture. Navigation and hotspot occlusion use the authored resident geometry regardless of render visibility.

## Verification

Run from `web`:

```sh
npm test
npm run build
TOUR_ORIGIN=http://localhost:5174 npm run test:room-streaming
TOUR_ORIGIN=http://localhost:5174 npm run test:quality
TOUR_ORIGIN=http://localhost:5174 npm run test:performance
```

The browser commands require the source Vite frontend. The streaming fixture mocks API/storage requests, injects a failed room and 400 ms delays, and checks public walking, safe boundaries, retry, inspection, builder preview and public/embed complete-loading fallback. Unit coverage includes aligned and nonaligned openings, camera-plane transitions, conservative viewpoints, shared-wall ownership, exact navigation, cache concurrency/eviction/revisits, late completions and scoped signed-URL renewal. Backend checks validate room assignment persistence and reject unknown/non-room owners.

Evidence: [phase6-room-streaming.json](performance-baselines/phase6-room-streaming.json). In its failed-neighbor starting view, one 3,296-byte GLB is delivered successfully versus 19,776 bytes for all six chunks; two chunks are initially requested. This tiny mocked fixture establishes progressive delivery and readiness behavior, not production loading speed, walkthrough FPS or physical-device memory improvement.

Remaining acceptance: sustained physical-device/network measurements, reviewed room assignments for real uploads, many-room memory/eviction stress in actual browsers, and the previously recorded public courtyard-exit regression. Automatic splitting of monolithic uploads, persisted custom window/stair/atrium portals, room-scoped external texture delivery and dynamic reflection captures are not implemented; those layouts retain conservative paths.

The current [chunking Phase 10 acceptance](chunking-acceptance.md) passes the full walking browser check, including the previously tracked public courtyard exit. Reviewed monolithic static sources now have a separate opt-in chunk processor and shared-image delivery; uncertain sources retain the conservative complete path. Real-building and physical-device acceptance remain pending.
