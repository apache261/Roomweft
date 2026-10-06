# Virtual Tour Studio — V2 Plan

Status: Phases 1–5 implemented. This extends the existing phases 1–6 in `plan_phase.md`.

## Goal

Let an author build a lobby and connected rooms inside the app, arrange multiple models, apply tiled materials, place visible hotspots, and publish a tour with smooth walking. Visitors stay inside the allowed walking area unless they explicitly click an author-configured exit.

Interpret “wider support” as support for more prepared GLB interiors and modular layouts. Interpret “multiple tiling” as both repeated floor/wall textures and repeated room/floor modules. Both are included below; neither means automatic support for every arbitrary model.

Keep the current Go, PostgreSQL, MinIO/S3, React, TypeScript, and Three.js stack. Preserve uploaded originals, existing GLB and panorama scenes, saved views, hotspots, and public URLs. No login or additional service is required for this version.

## Existing gaps to address

- `SceneViewer.tsx` supplies fixed strong lights, including a green ground tint, without environment lighting or author controls. The demo house is basic geometry, so lighting alone will not make it a finished interior.
- Each current 3D scene displays one GLB. Scene ordering does not position rooms or join their doorways.
- `navigation.ts` uses discrete floor and wall raycasts. It checks small steps and floor support, but has no author-defined indoor boundary, exit rule, navigation mesh, or stairs solver. Geometry with outdoor floors can still offer a walkable path outside.
- `WalkControls.tsx` applies movement directly at a fixed speed and accepts saved positions without checking that they remain walkable.
- `HotspotLayer.tsx` renders HTML markers at stored points. Placement switches to orbit mode; builder clicks edit while preview clicks activate. There is no “Show me this hotspot” action or placement ghost. These are usability gaps to investigate, not a confirmed explanation for every invisible marker.

## Intended author workflow

1. Create a project and choose **Build layout**, **Import building**, or **360 tour**.
2. For a layout, start with a lobby and two room templates. Move and resize rooms on a floor-plan grid, connect doorways, and add furniture models.
3. Apply separate floor and wall materials with repeat size, rotation, and color controls.
4. Inspect the 3D result, mark allowed walking areas, place a starting position, and configure optional exits.
5. Add a hotspot, see its placement preview, save it, and use **Show hotspot** or **Test hotspot** immediately.
6. Open **Walk preview**, verify room connections and boundaries, then publish and share.

An imported building can skip layout editing and use the same appearance, walking-area, and hotspot tools. A panorama keeps angular navigation and does not use floor collision.

## Phase 1 — Make existing hotspots visible and understandable

Implementation status: built. Placement ghosts, surface offsets, selected-marker highlights, Show/Edit/Test controls, builder-only reveal, visitor occlusion, a persistent hotspot list, request retry, pointer-lock reticle activation, and popup movement pause are implemented in the shared renderer. A sample lobby/room tour can be created with `npm --prefix web run demo:hotspots`. Frontend build, five unit/navigation checks, and Chromium browser checks passed for GLB and panorama placement/save/reload, editing, request retry, reveal/occlusion, pointer lock, popups, scene navigation, public/embedded viewers, and emulated touch. Physical-device testing remains pending. The running container still needs its frontend rebuilt; this session has no Docker daemon access.

Walking Show hotspot aims from the current supported standing location; it does not relocate the visitor through geometry. Inspect mode frames the marker, and the builder can reveal markers hidden by walls. Overlapping markers prioritize the one selected with Show. Uploaded originals and existing hotspot coordinate formats remain unchanged.

Build:

- Reproduce placement, saved-marker display, and activation in GLB orbit, GLB walk, panorama, preview, public, and embedded views. Check camera position, clipping, stacking, pointer capture, and failed hotspot requests before selecting a fix.
- Add a visible placement ghost and a selected-marker highlight. State “Click a surface, then Save hotspot”; distinguish unsaved placement from a saved marker.
- For 3D surface placement, apply a small normal offset to the displayed marker so it does not sit inside the wall. Retain compatibility with existing world-coordinate positions.
- Add **Show hotspot** to the list: aim at the marker from a valid nearby standing location in walk mode, or frame it in inspection mode. Do not move the walking camera through walls or outside its allowed region. For panoramas, rotate toward the saved angles.
- Add **Test hotspot** and explicit **Edit** actions. Make the different builder and visitor behaviors clear through controls rather than relying on an unexplained mode change.
- Use high-contrast markers, readable labels, and touch targets of at least 44 CSS pixels. Provide a persistent hotspot list when a marker is off-screen or hidden by geometry.
- Separate visibility rules: builders can reveal hidden markers for editing; visitors should not see markers through walls. Handle occlusion, near clipping, and markers behind the camera deliberately.
- In pointer-lock walking, show a reticle and allow clicking a targeted visible hotspot. Escape releases mouse capture and exposes ordinary buttons. Opening information stops movement; closing it requires a new click to resume capture.
- Show “No hotspots yet,” loading failures with Retry, and a short first-use example. Include a sample information marker and room-navigation marker in the demo tour.

Done when:

- A newly placed marker is visible before and after Save and reload.
- An author can find and test every saved hotspot from the list.
- A visitor can open information and follow navigation using desktop walking controls and touch controls.
- Opening and closing a popup never leaves movement stuck or makes an accidental scene transition.

## Phase 2 — Improve GLB appearance and import preparation

Implementation status: built. 3D scenes persist neutral environment lighting, exposure, light intensity, background, optional color/roughness overrides, and model scale/up-axis/yaw settings through scene PATCH and public tour reads. Environment lighting is generated locally with Three.js RoomEnvironment; sRGB output and ACES tone mapping are shared across 3D viewers, while panoramas keep their own image treatment. Materials are cloned per prepared model and overrides can be removed without changing original materials, textures or uploaded bytes. The panel displays prepared dimensions, texture count, unit guidance and standing-floor diagnostics.

One wrapper transform drives visible geometry and collision. Draft hotspots follow preparation changes; saved hotspot coordinates move atomically with saved transforms, and obsolete start views are cleared. Lighting-only changes retain the start view. Invalid transforms that would move hotspots outside supported coordinate bounds roll back. Existing cameras are checked for standing support before being restored. Import diagnostics identify unknown required extensions, unavailable compression decoders, missing image references and failed embedded-image decoding. Draco/Meshopt/KTX2 decoder support remains deferred until verified compressed fixtures are available; this is the conditional decoder work described below, not a claim that compressed imports are supported.

Two self-contained textured fixtures and a reproducible generator are included: `textured-interior.glb` and `textured-interior-cm-z.glb` (scale 0.01, Z up). `npm --prefix web run demo:appearance` creates an example project with both prepared models. Go tests with PostgreSQL, Go vet, the frontend build, nine frontend unit/navigation checks, and appearance/hotspot browser checks passed. Browser verification covers recognizable red/blue material colors in builder, reload, preview, public and embedded views; reversible overrides; unchanged original bytes; preparation and hotspot persistence; camera reset; floor and import diagnostics; and desktop/emulated-touch hotspot regression. Physical-device testing remains pending. API and frontend containers need rebuilding; this session cannot access the Docker daemon.

Build:

- Replace the fixed tinted light setup with a neutral default. Add environment lighting, exposure, light intensity, and background controls with a Reset option.
- Keep one consistent color-space and tone-mapping configuration across builder, preview, public, and embedded views. Preserve panorama image colors separately.
- Preserve GLB materials and embedded textures by default. Offer optional overrides without modifying the uploaded original.
- Show model dimensions, units assumption, up-axis correction, and editable scale/rotation. Normalize placement through a wrapper transform; update visual geometry, hotspots, and collision consistently.
- Report missing textures, unsupported required extensions, failed decoding, and models with no valid floor. Add compression decoder support only for formats covered by verified fixtures, starting with Draco/Meshopt geometry and KTX2 textures if needed.
- Supply a textured lobby/rooms demo, in addition to the existing collision fixture. Use local or project-owned lighting assets so tour rendering does not depend on a third-party preset URL.

Done when:

- A textured fixture keeps recognizable colors across all viewers, including after reload.
- A metre-scale model and a model requiring scale/up-axis correction can both be prepared for walking.
- Unsupported imports show actionable errors without replacing the original asset.

## Phase 3 — Build rooms, a lobby, and multiple model instances

Implementation status: built. **Build layout** creates a continuous lobby/corridor/two-room world with explicit doorways and a linked floor-plan/3D editor. Lobby, room, corridor, floor and wall templates support selection, drag movement, quarter-turn structural rotation, dimensions in metres, duplication, deletion, undo/redo and configurable grid snapping. Doorway editing shows width/height clearance. Overlapping room interiors, conflicting parallel wall thicknesses, invalid or overlapping door openings and standalone walls blocking openings are rejected; disconnected rooms produce a warning. Coincident room walls are unioned before meshing, and the exact visual meshes supply collision. Invalid drafts retain the last valid preview geometry.

Multiple instances of ready project GLBs persist independent position, yaw, scale, collision, color and roughness. Loaded source geometry/textures are reused while materials are cloned per instance. Furniture collides by default, decorations can opt out, and structural floors/walls always collide. Template floor regions and preferred lobby starts are supplied to the shared navigation-world interface; camera restoration retains standing-floor validation. Phase 5 now supplies the shared capsule controller, fixed simulation timing, acceleration, imported-boundary review, simple stair/ramp checks and explicit exit rules described below.

Version 1 documents use stable element/door UUIDs, atomic saves and optimistic revisions. Layout scenes have no single asset ID; existing GLB/panorama asset requirements remain. Dedicated private/public layout GET and private PUT routes are documented in OpenAPI, with 256 KiB request limits, 200-element/door limits, finite numeric checks, dimensions and same-project ready GLB validation. Reference rows protect in-use assets and cascade on project deletion. Revision conflicts preserve the draft; Reload scene fetches the newer document. Local-coordinate hotspot attachments move atomically on layout saves; deleting a target requires explicit hotspot detachment/deletion. World-coordinate hotspots remain compatible. Saved layouts and instance assets are included in publish validation and tour-scoped public reads.

`npm --prefix web run demo:layout` creates an unpublished connected-room example with two textured table instances and an attached welcome hotspot. `layout-table.glb` is included with the reproducible procedural fixture generator. Go tests with PostgreSQL (including migration compatibility), Go vet, frontend build, thirteen frontend unit/navigation checks and layout/appearance/hotspot browser checks passed. Existing GLB/panorama colors, preparation, hotspots, pointer lock, popups and public/embed behavior passed regression checks. Browser acceptance covers creation, drag/snapping, undo/redo, doorway reconnection, duplication, independent instances, save/reload, real surface placement, attachment movement/deletion guards, conflicting saves/reload recovery, continuous desktop walking, generated walls, public/embed and emulated touch. Physical-device testing and supported performance budgets remain pending. API/frontend containers need rebuilding; this session cannot access the Docker daemon.

Build:

- Add a layout scene type with a top-down grid editor and linked 3D preview. A layout is one continuous walking world, distinct from a list of separate scenes.
- Provide lobby, room, corridor, floor, wall, and doorway templates with dimensions in metres. Start with one level and rectangular rooms.
- Support select, move, rotate, resize, duplicate, delete, undo/redo, and grid snapping. Display dimensions and doorway clearance.
- Connect room edges by explicit doorway openings. Prevent overlapping walls and warn about disconnected rooms. Generate visible and collision geometry from the same layout definition.
- Place multiple GLB assets as instances with independent position, rotation, scale, and collision settings. Reuse source geometry/textures but isolate per-instance material edits.
- Treat furniture as obstacles by default; allow decorations to be non-colliding. Keep structural floors and walls colliding.
- Save a whole layout change atomically, show unsaved changes, and restore it after reload. Preserve stable element IDs for hotspot attachments.

Done when:

- An author creates a lobby, corridor, and two rooms without an external modelling tool.
- Room duplication and multiple furniture instances persist with independent transforms.
- Visitors can walk through connected doorways without scene switching and cannot pass through generated walls.

## Phase 4 — Support multiple tiled materials

Implementation status: built. Reusable scene material presets support role-specific uploaded base-color, normal and roughness maps, metre tile size, U/V repeats, offsets, rotation, tint and roughness. The author selects independent room floor/wall finishes, standalone structural surfaces or imported mesh surfaces. Stable mesh child-index paths distinguish duplicate names; missing or incomplete/nonfinite UVs retain the original material and show an author limitation. Imported metre repeats estimate mesh dimensions against existing UV extents; unusual UV islands still require author adjustment. Presets can be duplicated for independent edits, and removing an assignment restores the original/default surface.

Generated geometry has metre-based world-aligned UVs, preserving tile size on resize and seams between adjacent modules. Shared walls retain one visual/collision mesh with separate room-side finishes. Repeat module to right creates an exactly adjacent room/floor copy, with an aligned doorway for rooms; assignment changes on the copy leave the source assignment intact. Existing geometry and doorway validation still applies.

Migration 010 records texture assets by map role and adds scene texture reference rows. Atomic layout saves and imported-scene settings saves validate ready same-project maps with matching roles; failed saves roll back references. Referenced textures cannot be individually deleted, whole-project deletion cascades, layout lighting saves retain texture references, and publication/public reads include all referenced maps while excluding unrelated assets. Existing scene settings and version 1 layout documents remain readable without the new fields. sqlc output, OpenAPI and README are updated. Loaded image resources are reused while per-material sampler transforms and role color spaces are isolated; uploaded originals remain unchanged.

`npm --prefix web run demo:materials` generates a project-owned procedural stone/wood/wall example with normal and roughness maps and two furniture instances. Go tests with PostgreSQL (including migration compatibility), Go vet, frontend build, seventeen frontend unit/navigation checks and materials/layout/appearance/hotspot browser acceptance passed. Materials acceptance covers role uploads, rendered finishes, independent assignments, resize/repeat/save/reload, imported mesh assignment, missing-UV feedback, public/embed and emulated touch. Physical-device testing and performance budgets remain pending. Imported UV distortion is not automatically repaired; Phase 5 walking upgrades are documented below.

Build:

- Add reusable material presets and uploaded texture assets for floors, walls, and selected imported mesh surfaces.
- Support separate base-color, normal, and roughness maps; record each map's role so color textures and data textures use the correct color-space treatment.
- Set repeat size in metres, U/V repeat, offset, rotation, tint, and roughness. Apply independent materials to different rooms and surfaces.
- Generate consistent UVs for template geometry so resizing a room preserves tile size. Validate UV availability on imported meshes and show a clear limitation when missing.
- Support repeated floor/module placement on the layout grid, with seam and doorway alignment. Cloning a room must not silently change the source room's material.
- Keep texture references in project storage and reuse loaded resources; include every referenced texture in public tour access checks.

Done when:

- A lobby uses stone tiles, one room uses wood, and another uses a different wall material in the same layout.
- Tile size remains consistent after resizing rooms and reopening the project.
- Repeated modules connect without duplicate collision walls or gaps in floor support.

## Phase 5 — Smooth walking and enforce deliberate exits

Implemented:

The shared `WalkWorld` indexes actual collision triangles in a median BVH and verifies capsule clearance, bounded movement sweeps, continuous projected floor coverage, regions and locked thresholds. `WalkSimulation` integrates at 120 Hz with bounded catch-up, acceleration/deceleration, normalized diagonals, contact-plane sliding and last-supported recovery. Author controls persist speed, eye height, maximum step and slope. Mouse look remains immediate while rendered eye height smooths small floor changes.

Layouts derive reviewed regions from structural floors; standalone exterior floors require explicit approval through an exit. Imported models remain in inspection until the author reviews floor mesh paths, bounds and elevations. Roofs and decoration tops do not supply support automatically. Preparation changes clear previous reviews. Invalid starts and geometry changes recover with feedback, and no-support scenes retain inspection with walking disabled.

Exits persist an activation threshold, destination scene/region and arrival pose. Movement cannot activate them. Click/tap transitions verify floor support and capsule clearance using the actual destination meshes, then restore the checked pose. Same-project references are saved transactionally, protected against destination deletion, and rechecked at publication. Return exits use the same validation; Reset in an exterior region stays there. Information popups pause movement without granting exit access. Migration 011, regenerated sqlc queries and OpenAPI schemas document persistence.

`demo:walking` combines connected tiled rooms, furniture, a courtyard with an explicit return, a gallery annex, artwork information and scene navigation. Twenty-two frontend checks cover frame schedules, thin/diagonal walls, narrow doorways, tiny floor gaps, ceilings, roofs, simple 20 cm stairs, a 15° ramp and portal returns. Go/API checks with PostgreSQL and S3, Go vet and the frontend build pass. Walking browser acceptance covers reviewed imports, safe starts, held movement against a threshold, popup pause, pointer-lock click activation, local/cross-scene returns, public/embed and emulated touch. Layout, materials, hotspot and appearance browser regression suites also pass. Physical-device checks and performance budgets remain pending; arbitrary staircases and multi-storey routing are not claimed.

Requirements implemented:

- Introduce a shared navigation-world interface for imported buildings and generated layouts. Use a capsule controller with swept collision and a spatial acceleration structure, or an equivalent verified solver. Choose the implementation after testing the fixtures; a bounding box alone is insufficient.
- Use a fixed simulation timestep, limited catch-up work after slow frames, acceleration/deceleration, normalized diagonal motion, and smooth wall sliding. Keep mouse look responsive; avoid mandatory head bob or heavy camera smoothing.
- Support configurable speed, eye height, step height, and maximum slope. Smooth small floor-height changes. Validate ramps and simple stairs separately before claiming support.
- Define allowed walking regions explicitly. Generated layouts derive them from interior floors; imported GLBs need author-reviewed regions or navigation geometry. Exclude roofs, decorative surfaces, and outdoor floors by default.
- Require continuous floor support and standing clearance throughout movement. Enforce wall collision, floor edges, region boundaries, and locked exit thresholds together.
- Validate saved starts and navigation arrival points against current collision and allowed regions. If invalid, choose a verified safe fallback and notify the author. If no valid location exists, keep inspection available and disable walking with an explanation.
- Store the last valid standing position and recover there if numerical errors or later layout edits invalidate the camera. Clear motion on blur, popup opening, scene changes, and pointer-lock release.
- Add an explicit exit/portal object with a label, activation point, destination region or scene, and validated arrival pose. Walking into it must stop at the threshold and show “Click to enter courtyard,” for example.
- Clicking an enabled exit performs a controlled transition to its approved arrival position. It never disables collision globally. Without an author-configured exterior region or destination, visitors cannot leave the model.
- Navigation hotspots may perform an explicit scene transition; information hotspots never grant exit access. Returning inside uses a configured entry portal. Inspection remains a separate author/viewer mode, not a walking escape.

Done when:

- Walking remains steady during diagonal motion, wall sliding, narrow doorways, and variable frame times.
- Holding movement against an exterior doorway, window, wall, or floor edge cannot leave the allowed interior.
- An author-configured exit works only after an explicit click/tap, lands in a valid destination, and has a working return path.
- Invalid starts and disconnected imported floors produce a useful message instead of spawning outside or falling through geometry.

## Persistence and API changes

- Add ordered database migrations; keep existing scenes and hotspot records readable. Regenerate sqlc queries and update `docs/openapi.yaml` alongside implementation.
- Extend scenes with validated appearance and navigation settings. Allow layout scenes without a single GLB `asset_id`; retain required assets for existing GLB/panorama types.
- Store versioned layout documents with stable element IDs, dimensions, transforms, doorway connections, material assignments, allowed regions, and portals. Use optimistic revision checks to prevent overwriting a newer layout save.
- Extend project assets with texture roles and validation appropriate to those roles. Keep same-project reference checks and prevent deletion of referenced assets.
- Allow hotspots to attach to layout elements or model instances using local coordinates, while preserving existing world positions and panorama angles. Moving an element moves its attached hotspot; deleting it requires resolving attached hotspots explicitly.
- Use scene PATCH for small settings changes and a dedicated layout GET/PUT endpoint for atomic document reads/writes. Define request limits and validate finite coordinates, dimensions, transforms, revisions, and references server-side.
- Extend publish validation and tour-scoped public reads to include layout data, materials, instance assets, portal destinations, and verified starts. Preserve existing publish/unpublish and signed-URL expiry behavior.

## Implementation order and verification

Deliver hotspot visibility first, then appearance/import preparation, layout creation, tiled materials, and the navigation upgrade. Build the layout collision interface during Phase 3 so Phase 5 does not require a second geometry format. Do not publish layout tours until movement and boundary acceptance checks pass.

For each phase, run relevant frontend/backend checks and browser acceptance scenarios. Add focused tests for geometry and navigation behavior, persistence, migration compatibility, invalid references, and public asset access. Use browser tests for marker visibility and pointer-lock interaction; unit tests alone cannot prove those work.

Fixtures must include: the existing house, a textured building, connected modular rooms, an outdoor floor behind a blocked exit, a thin wall, a narrow doorway, a low ceiling, a floor gap, a corrected-scale import, and an invalid saved start. Check 30/60/120 FPS simulation schedules and a long-frame interruption. Record performance on a named desktop and physical touch device before setting supported model budgets.

Final demo:

1. Build a tiled lobby and two connected rooms, then place two instances of one furniture GLB.
2. Add an artwork information hotspot and a scene-navigation hotspot; find and test both immediately.
3. Walk smoothly through the lobby and rooms; attempt to walk through walls and outside doors and confirm movement stops.
4. Click the courtyard exit, arrive safely, and return through the entry portal.
5. Save, reload, publish, and test the same tour in a second browser and iframe.
6. Reopen an existing GLB/panorama tour and verify its saved views, hotspots, and share URL still work.

## Deferred beyond V2

Automatic reconstruction from photographs, unrestricted arbitrary-model navigation, multi-storey editing and elevators, advanced physics, crowds, massive-world streaming, VR, new import formats beyond verified GLB extensions, and publication snapshots. Single-level room modules and material tiling are included in V2; multi-storey construction is not.
