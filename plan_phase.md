# Virtual Tour — Proof-of-Concept Phase Plan

Based on `plan_md.md`, narrowed to a working demo. Build the application directly: open the dashboard, create a project, upload assets, build a tour, and share it. No authentication, accounts, ownership, roles, or login screens.

## Working assumptions

- Keep Go, PostgreSQL, S3-compatible storage, React, TypeScript, Vite, and Three.js through React Three Fiber.
- Include both 3D walkthroughs and 360 panorama tours, implemented one at a time.
- Use prepared, reasonably sized demo assets. This application does not generate 3D models.
- Start with self-contained `.glb` files and 2:1 equirectangular JPG, PNG, or WebP panoramas. Defer `.gltf` with external dependencies, FBX, and OBJ.
- Use one Go API and one frontend. Compose runs API, frontend, PostgreSQL, and MinIO for local development. Production uses an S3 bucket configured by the developers. No worker until processing is actually needed.
- Use `net/http` or `chi`, `pgx`, `sqlc`, and simple migrations. Avoid extra infrastructure and generic framework layers.
- All projects are editable by anyone who can open the application. The demo assumes a local or trusted environment.

Confirmed clarification: use MinIO locally and S3 in production, with the same storage code configured through environment variables. Keep both scene types from the source plan.

## Phase 1 — Start the app and create projects

Implementation status: built. Go tests (including PostgreSQL persistence), `go vet`, frontend build, browser CRUD/mobile checks, API and database process restarts, MinIO bucket initialization, and CORS checks passed. Compose configuration validates; running the complete Compose stack remains unverified because this session cannot access the Docker daemon.

Build:

- Minimal Go API, React frontend, database migrations, and Docker Compose.
- `/health` plus project create, list, read, rename, and delete endpoints.
- Dashboard at `/` and builder at `/projects/:id`.
- `.env.example` and a short README with local MinIO setup commands and production S3 configuration (endpoint, bucket, region, and credentials).
- Configure MinIO/S3 CORS for browser uploads and asset loading from the frontend origin.

Done when:

- `docker compose up --build` starts the application and initializes the local MinIO bucket.
- Opening the app immediately displays projects without login.
- A project can be created and reopened after restarting the application.

## Phase 2 — Upload a GLB and render a scene

Implementation status: built. Asset/scene migrations and sqlc queries, size-limited presigned POST uploads, completion validation, preserved originals, and the selected-scene GLB viewer are implemented. Go tests against PostgreSQL and MinIO, `go vet`, frontend build, Compose configuration, and browser upload/render/reload/error/mobile checks passed using `tests/testdata/house.glb`. Browser checks also confirmed selected-only asset loading and recovery after an unavailable asset URL. The full Compose stack remains unverified because this session cannot access the Docker daemon.

Build:

- Asset metadata and scenes, separate from projects.
- Presigned browser uploads to MinIO locally and S3 in production with progress and completion confirmation.
- Server-generated storage keys, upload size limits, and basic format validation.
- A small asset list and an action to create a scene from an uploaded GLB.
- GLB rendering with lighting, orbit controls, loading state, and readable errors.
- Load only the selected scene's asset. Preserve uploaded originals.

Done when:

- A prepared `house.glb` uploads, becomes a scene, and renders in the builder.
- Reloading the page restores the project, asset, and scene.
- Invalid files and failed uploads show a clear error.

## Phase 3 — Walk through the 3D scene

Implementation status: built. Desktop WASD/arrow-key movement, pointer-lock mouse look with Escape exit, orbit inspection, saved/reset start views, and touch drag/on-screen movement buttons are implemented. Double-sided raycasts check floors, walls, and standing clearance for the prepared metre-scale house. Go tests against PostgreSQL and MinIO, `go vet`, frontend build, navigation tests using the actual demo GLB, OpenAPI validation, and Compose configuration passed. Chromium browser checks passed for project → upload → scene → walk, mouse capture/Escape, movement/look, reset, saved view after reload, and emulated touch/mobile layout. Physical-device testing and the full Compose stack remain unverified; this session cannot access the Docker daemon.

Build:

- Desktop WASD movement and mouse look, with a way to exit pointer lock.
- Save the current camera position and orientation as the scene start view.
- Reset camera to the saved view.
- Basic floor and wall checks using raycasts or `three-mesh-bvh` as needed for the demo model.
- Simple drag-to-look and on-screen movement buttons for touch devices.

Done when:

- A visitor can enter and walk through the prepared house model.
- The saved start view survives a reload.
- Basic collision works for the demo asset; full physics and arbitrary-model navigation are outside this POC.

**First milestone:** create project → upload GLB → create scene → walk inside it. Finish this before adding hotspots or publishing.

## Phase 4 — Add 360 scenes and scene navigation

Implementation status: built. JPG/PNG/WebP panorama uploads with format, full-decode, 2:1 and dimension validation; inward-facing panorama rendering; drag/pinch/scroll controls; saved yaw/pitch; scene rename/reorder/delete/start selection; and navigation hotspots in both coordinate systems are implemented. Same-project references are enforced, deleting a destination removes incoming links, and deleting the start scene selects the first remaining scene (or clears it). Go tests against PostgreSQL and MinIO, `go vet`, frontend build, navigation/angle tests, OpenAPI validation, and Compose configuration passed. Chromium checks passed for two-way panorama links, mixed 3D/panorama marker navigation, selected-only asset loading, start/view/order persistence, deletion cleanup, and emulated touch/mobile controls. Phase 3 desktop/touch walkthrough regression checks also passed. Physical-device testing and the full Compose stack remain unverified because this session cannot access the Docker daemon.

Build:

- Panorama uploads and a separate panorama renderer using an inward-facing sphere.
- Drag-to-look and zoom controls; save starting yaw and pitch.
- Scene list with rename, move up/down, delete, and select start scene.
- Navigation hotspot placement: world coordinates for 3D, yaw/pitch for panoramas.
- Choose a destination scene and switch scenes when the hotspot is clicked.
- A simple scene selector as an alternative way to navigate.

Done when:

- Two panoramas can be uploaded, arranged, and connected in both directions.
- A tour can switch between 3D and panorama scenes.
- Navigation and start-scene settings persist after reload.

**Second milestone:** upload panoramas → create scenes → connect them with navigation hotspots.

## Phase 5 — Add information hotspots and preview

Implementation status: built. The scene list, central viewer and hotspot properties panel support selecting, editing, repositioning and deleting NAVIGATION/INFO hotspots. Information and artwork popups include plain text, optional validated image uploads and HTTP(S) links. Hotspot placement and edits use an explicit Save action; visitor preview starts at the saved start scene, uses the shared renderer and hides editing panels. Applied migrations are now recorded to prevent older constraints from being reapplied. Go tests against PostgreSQL and MinIO, `go vet`, frontend build, navigation tests, OpenAPI validation and Compose configuration passed. Chromium checks passed for image uploads, both scene types, explicit save, reposition/edit/delete, reload persistence, preview popups/navigation and emulated mobile layout. Phase 3 desktop/touch walkthrough regression checks also passed. Physical-device testing and the full Compose stack remain unverified because this session cannot access the Docker daemon.

Build:

- A simple builder: scene list, central viewer, and properties panel.
- Click the scene to place a hotspot; select, edit, reposition, or delete it.
- Two hotspot types only: `NAVIGATION` and `INFO`.
- Information fields: title, plain-text description, optional image, and optional external link.
- Represent painting/artwork descriptions using the same information popup.
- Explicit Save and Preview actions. Preview uses the same renderer as the public viewer and hides editing controls.

Done when:

- A painting hotspot opens its title, description, and optional image.
- Hotspots work in both scene types and persist after reload.
- Preview shows the visitor experience with working navigation.

## Phase 6 — Publish, share, and embed

Implementation status: built. Projects have unique stable slugs and publish/unpublish actions with validation of scene assets, the start scene and navigation/image references. Public `/t/:slug` and compact `/embed/:slug` viewers share the preview renderer, use scoped public read endpoints, refresh asset URLs on scene load/reload, and include information popups, responsive controls and fullscreen where supported. Share URL and iframe copy actions include selectable text fallbacks. Unpublished tours return `404` from all public API endpoints and show an unavailable state in both viewer routes. Saved edits appear in published tours without snapshots. Go tests against PostgreSQL and MinIO, `go vet`, frontend build, navigation tests, OpenAPI validation and Compose configuration passed. Chromium checks passed for publish validation, new-browser public viewing, mixed scene navigation, information/images/links, copy actions, fullscreen, a separate-origin iframe, saved live edits, unpublish/republish and emulated touch/mobile controls. Desktop/touch walkthrough and hotspot builder regression checks also passed, including a fix for the cursor-reset movement delivered while entering mouse capture. Both the mixed house tour and the two-panorama tour reopened with working information hotspots and navigation after restarting the API process. Physical-device testing and the full Compose stack remain unverified because this session cannot access the Docker daemon.

Build:

- Publish/unpublish actions with a unique stable slug.
- Public viewer at `/t/:slug` and compact embed viewer at `/embed/:slug`.
- Copy URL and copy iframe code actions.
- Publish validation: at least one usable scene, a valid start scene, and valid navigation destinations.
- Unpublished tours return an unavailable response from public routes.
- Loading/error states, responsive information panels, and fullscreen where supported.

POC publishing is a visibility flag over the saved project. Saved edits appear in the published tour; there are no versioned publication snapshots.

Done when:

- The tour opens through its share URL in another browser without login.
- The iframe works on a separate test page with hotspot navigation.
- Unpublishing removes access through both public routes.
- The viewer is usable on a desktop browser and at least one touch device.

**Third milestone:** information hotspots → preview → publish → share and embed.

## Minimal data and API

Use four tables:

| Table | Purpose |
| --- | --- |
| `projects` | Name, description, start scene, slug, published flag |
| `assets` | Project, file type, storage key, upload status, size |
| `scenes` | Project, asset, name, type, order, start camera settings |
| `hotspots` | Scene, type, position, content, optional destination scene |

Keep camera settings and hotspot positions in small JSON fields where convenient. Store navigation destinations on hotspots; no separate scene-links table.

Implement only endpoints needed by the phases:

- `/health`
- `/api/v1/projects` and `/api/v1/projects/{id}`
- `/api/v1/projects/{id}/uploads` and `/api/v1/assets/{id}/complete`
- `/api/v1/projects/{id}/assets` and `/api/v1/assets/{id}`
- `/api/v1/projects/{id}/scenes` and `/api/v1/scenes/{id}`
- `/api/v1/scenes/{id}/hotspots` and `/api/v1/hotspots/{id}`
- `/api/v1/projects/{id}/publish` and `/api/v1/projects/{id}/unpublish`
- `/api/v1/public/tours/{slug}`

Keep the MinIO/S3 bucket private and return presigned read URLs for assets used by the builder and published tours. For local MinIO, generate presigned URLs using a browser-reachable endpoint rather than a Docker-only hostname. Public metadata must resolve asset URLs that work in the visitor's browser; refresh expired URLs when loading a scene. Ensure scene deletion clears incoming navigation references and updates the start scene; prevent deletion of assets still used by scenes or hotspots.

## Verification and stopping point

At each phase, format code, run relevant checks, and exercise its acceptance criteria. Add focused backend tests for persistence, invalid references, upload completion, and published/unpublished access. Keep a short API reference alongside the README.

Final demo:

1. Create a house project, upload a GLB, and walk through it.
2. Add a painting information hotspot and save it.
3. Add another scene and navigate between scenes.
4. Preview, publish, copy the URL, and test the iframe.
5. Create a panorama project with two linked 360 images and publish it.
6. Restart the app and confirm both tours still work.

The POC is complete when this demo works. Do not expand scope to cover every feature in `plan_md.md`.

## Deferred

- Authentication, users, permissions, billing, and multi-tenancy.
- Workers, job queues, automatic optimization, transcoding, and thumbnail generation.
- FBX/OBJ conversion and multi-file GLTF imports.
- Audio/video hotspots, galleries, specialized artwork forms, and project duplication.
- Full physics, advanced touch joysticks, click-to-walk, and automatic navigation meshes.
- Minimap/floor plans, streaming/LOD, Gaussian splats, VR, analytics, and guided tours.
- Publication versioning, generated API clients, and production deployment infrastructure.
