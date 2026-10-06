# Virtual Tour Studio

Phases 1–6 of the proof of concept, plus V2 phases 1–5: create projects, walk through GLB scenes, view 360 panoramas, and connect scenes with navigation hotspots. Information and artwork hotspots support plain text, uploaded images and external links. The builder includes a properties panel and a visitor preview. Publish tours with stable share URLs and compact iframe embeds. Build a continuous lobby/room layout on a floor-plan grid and place multiple GLB furniture instances. Camera and start-scene settings persist. Orbit inspection remains available. The dashboard opens directly without authentication.

## Run locally

Requirements: Docker Engine and Docker Compose, with permission to use the Docker daemon.

```sh
./deploy.sh up
```

The script builds and starts all services in the background. It creates `.env` from `.env.example` when missing and uses sudo when the default local Docker socket requires it. Compose loads configuration from `.env`. Published ports bind to `0.0.0.0` by default; change `BIND_ADDRESS` and the port variables in `.env` as needed. For access from another device, set `WEB_ORIGIN` and `S3_PUBLIC_ENDPOINT` to URLs using the Docker host's reachable IP or hostname and the configured ports.

```sh
./deploy.sh down             # Stop containers; keep stored data
./deploy.sh down -v          # Stop containers and delete database/storage volumes
./deploy.sh up --no-deps web # Rebuild only the frontend
./deploy.sh logs -f api      # Follow API logs
./deploy.sh ps               # Check container status
./deploy.sh restart api      # Restart a service without rebuilding
```

`./deploy.sh up` runs `docker compose up --build --detach`. The frontend-only command adds `--no-deps web` to avoid restarting its dependencies; a full `docker compose up -d --build` also works. Extra command options and service names pass through to Compose. For future startup customization, use `.env`, or Compose's `COMPOSE_FILE`, `COMPOSE_PROJECT_NAME` and `COMPOSE_PROFILES` environment variables. Run `./deploy.sh --help` for available commands. You can call the script from another directory; it resolves the project folder automatically.

Open http://localhost:5173. The API runs at http://localhost:8080; check `GET /health`. MinIO runs at http://localhost:9000 with its console at http://localhost:9001. Default local console credentials are `tour-local` / `tour-local-secret`.

The first build compiles pinned official [MinIO](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z) and [mc](https://github.com/minio/mc/releases/tag/RELEASE.2025-08-13T08-35-41Z) source releases because prebuilt community images are unavailable. Later builds reuse Docker layers.

Compose waits for PostgreSQL and creates a private `virtual-tours` MinIO bucket before starting the API. MinIO allows requests from `WEB_ORIGIN` (default `http://localhost:5173`). Named volumes preserve database records and local object storage through container restarts and `docker compose down`.

```sh
docker compose restart api postgres
```

Reopen a project to confirm persistence. `docker compose down -v` deletes local data.

## Development and checks

Requirements outside Docker: Go 1.26+, Node.js 24+, and sqlc 1.30.0 for regenerating database code. Generated code is committed, so ordinary builds do not require sqlc.

The frontend pins React Three Fiber 9.8.1 while its stable frame loop still uses deprecated `THREE.Clock`. The npm `postinstall` script applies a Timer compatibility adapter to its ESM and CommonJS bundles, retaining the clock fields used by Fiber and Drei. Docker installs the same patch. Remove the adapter and version pin when a stable upstream release provides compatible Timer timing; the install script deliberately rejects a different Fiber version so upgrades require review.

```sh
docker compose up -d postgres minio minio-init
export DATABASE_URL='postgres://tour:tour-local-only@localhost:5432/virtual_tours?sslmode=disable'
export S3_ENDPOINT='http://localhost:9000'
export S3_PUBLIC_ENDPOINT='http://localhost:9000'
export S3_BUCKET='virtual-tours' S3_REGION='us-east-1'
export S3_ACCESS_KEY='tour-local' S3_SECRET_KEY='tour-local-secret'
npm --prefix asset-tools ci
export ASSET_PROCESSOR_SCRIPT="$PWD/asset-tools/process.mjs"
go run ./cmd/api
```

In another terminal:

```sh
cd web
npm ci
npm run dev
```

If dependency installation is slow, use `npm ci --prefer-offline --no-audit --no-fund` to reuse cached downloads and skip the install-time audit request. Run `npm audit` separately when checking dependencies for vulnerabilities. The Docker frontend build uses these options and a persistent BuildKit npm cache, so subsequent dependency installs can reuse downloads. A first install still needs access to `https://registry.npmjs.org/`; network timeouts can make npm appear stuck while it retries. Use `npm ci --prefer-offline --no-audit --no-fund --loglevel=verbose` to see download progress and failures. Once dependencies are installed, run `npm run dev` directly until the dependency files change.

Vite proxies `/api` and `/health` to the API, so the frontend uses same-origin requests. If customizing the local PostgreSQL password, update `DATABASE_URL` as well.

```sh
go test ./...
go vet ./...
npm --prefix web run build
npm --prefix web test
docker compose config --quiet
```

Run the API integration test against a running PostgreSQL database:

```sh
TEST_DATABASE_URL='postgres://tour:tour-local-only@localhost:5432/virtual_tours?sslmode=disable' go test ./internal/httpapi -v
```

It creates and removes its own uniquely identified project. It checks CRUD and reconnects to the database to verify persistence. Without `TEST_DATABASE_URL`, database integration tests are skipped. To also exercise real storage uploads, set `TEST_S3=1` and the S3 settings below before running `go test ./...`; this checks upload policy size limits, missing/invalid completion, idempotency, original preservation, scene references, and persistence.

Database queries live in `db/queries`; regenerate with `sqlc generate`. The API applies ordered migrations, recording applied filenames in `schema_migrations` from `db/migrations` in a transaction on startup, with an advisory lock to serialize startup migrations. Add schema changes as new migration files.

## Storage: MinIO locally, S3 in production

Local Compose uses MinIO. Production uses an existing AWS S3 bucket configured by developers through endpoint, bucket, region, and deployment credentials or an IAM role. The same storage client signs browser uploads and reads for both environments.

Production uses bundled PostgreSQL, the API, a built static frontend, an Nginx HTTPS proxy, and Certbot containers. It uses your existing private AWS S3 bucket instead of MinIO. You do not need to create a separate PostgreSQL server. `compose.production.yml` keeps the same PostgreSQL service and `postgres_data` volume names as development; the Compose project name controls whether an existing volume is reused.

```sh
cp .env.production.example .env
# Set POSTGRES_PASSWORD, S3 settings, WEB_ORIGIN, CERTBOT_DOMAIN and CERTBOT_EMAIL.
./deploy.sh --production up
./certbot.sh --production issue
./certbot.sh --production test
./certbot.sh --production certificates
./deploy.sh --production logs -f renew challenge
```

Both production and development read `.env`; `--production` selects the production Compose stack. Configure a strong URL-safe PostgreSQL password. If switching an existing deployment to production, keep its database/user/password and Compose project name unchanged to reuse its database. PostgreSQL's initialization variables do not change credentials in an existing volume. `DATABASE_URL` is generated for `postgres:5432` on the internal Docker network. Production publishes only the proxy's HTTP/HTTPS ports; PostgreSQL, the API and frontend stay inside Docker. `HTTP_ADDR=0.0.0.0:8080` is the API's internal container listener.

Set `WEB_ORIGIN=https://YOUR_DOMAIN`, `CERTBOT_DOMAIN=YOUR_DOMAIN` (without `https://`), and `CERTBOT_EMAIL` to your certificate contact email. Update `TLS_CERT_FILE` and `TLS_KEY_FILE` to match that hostname. Point the domain's DNS records to the production host and make public ports 80 and 443 reachable. The proxy initially serves HTTP certificate challenges; it enables HTTPS automatically after certificate issuance, forwards `/api/` and `/health` to the API, and serves the frontend through its static web container. Other HTTP requests redirect to HTTPS. Asset uploads and reads go directly to S3 using signed URLs; apply the bucket CORS policy for your HTTPS origin.

The [Certbot Docker image](https://eff-certbot.readthedocs.io/en/stable/install.html#running-with-docker) uses [webroot validation](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot), so renewal does not interrupt the HTTPS proxy. The renewal service starts with the production stack and checks every 12 hours. Nginx watches the certificate files and reloads within approximately ten seconds after issuance or renewal, without mounting the Docker socket. Certificates, ACME accounts, renewal settings and logs persist under `CERTBOT_DATA_DIR` (default `./data/certbot`). Back up that whole directory; `live/` contains links into `archive/`. Renewal failures remain in Docker logs and retry at the next interval.

```sh
./certbot.sh --production renew        # Immediate renewal check; only renews when due
./certbot.sh --production logs         # Follow renewal logs
./certbot.sh --production status       # Container status
./certbot.sh --production stop         # Pause renewal; keep the app/proxy/database running
./certbot.sh --production start        # Resume renewal
./deploy.sh --production down          # Stop the stack; preserve database/certificates
```

Manual issuance/renewal/test commands pause an active scheduler and restore it afterward to avoid competing Certbot locks. Prefix `certbot.sh` with `sudo` if your Docker socket requires it; `deploy.sh` handles the default local socket automatically. The standalone `./certbot.sh issue/test/start` commands remain available for certificate management alongside an external application proxy. If switching from that standalone certificate stack, run `./certbot.sh stop` before starting the bundled production proxy to free port 80. The standalone stack requires its external HTTPS proxy to reload certificate changes.

On the same host/project, switching from development replaces the `api`/`web` services while retaining PostgreSQL data. Old MinIO services may remain until stopped; their objects are not migrated to S3 by this change. Use the same project name only when intentionally switching that deployment; use a different `COMPOSE_PROJECT_NAME` for simultaneous independent development and production stacks.

- `S3_ENDPOINT`: server-side storage endpoint (`http://minio:9000` in Compose).
- `S3_PUBLIC_ENDPOINT`: browser-reachable endpoint (`http://localhost:9000` locally).
- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`: storage configuration. Keep real credentials outside source control.
- `S3_SESSION_TOKEN`: optional session token for temporary explicit credentials. If `S3_ACCESS_KEY` is unset, standard AWS environment credentials or an IAM role are used.
- `WEB_ORIGIN`: the browser's exact origin allowed by MinIO CORS.

For S3, replace the example origin in `docs/s3-cors.json` and apply it to the production bucket:

```sh
aws s3api put-bucket-cors --bucket YOUR_BUCKET --cors-configuration file://docs/s3-cors.json
```

Keep the bucket private. Uploads use a presigned multipart POST policy (15-minute expiry, exact size, and fixed content type); reads use 15-minute presigned GET URLs. Bucket CORS must allow POST, GET, and HEAD. The API must be able to get and put objects, including server-side copy. Configure `S3_PUBLIC_ENDPOINT` for the hostname the visitor's browser can reach; it is signed independently from the internal Docker endpoint. Local Compose is a development setup, with Vite and published ports bound to `0.0.0.0` by default. The project API has no authentication, as required for this POC.

## API

See [docs/openapi.yaml](docs/openapi.yaml).

| Method | Route | Result |
| --- | --- | --- |
| GET | `/health` | Database health (`200` or `503`) |
| GET | `/api/v1/projects` | Project array, newest first |
| POST | `/api/v1/projects` | Create from `{ "name": "House Tour", "description": "Optional" }` (`201`) |
| GET | `/api/v1/projects/{id}` | Read project |
| PATCH | `/api/v1/projects/{id}` | Update name, description and/or `start_scene_id` |
| DELETE | `/api/v1/projects/{id}` | Delete project (`204`) |

Names must contain 1–120 characters after trimming. Descriptions are optional, up to 5,000 characters. Malformed input returns `400`; missing projects return `404`. Responses are JSON except successful deletion.

## Try the walkthrough

The editor uses a desktop workspace: scenes and uploads in the left library, a persistent 3D viewport in the center, and a scrolling inspector on the right. The 3D editor viewport uses a theme-aware background and reference grid (1 m cells, 5 m major lines). **Grid** toggles it. These guides do not affect collisions, hotspot placement or the saved visitor appearance. Inspector tabs show one task at a time: Plan, Hotspots, Walking, Materials or Appearance. Switching tabs preserves the draft. Expand **Scene options** for rename/order/start controls and **Publish & share** for publication. **Project details** opens a separate dialog. On smaller screens, panels stack below the viewport.

Numeric inspector fields accept freely typed numbers, including negatives, decimals and scientific notation. Clearing a field or typing an invalid or out-of-range value keeps the text editable and shows an error beside it. Only valid values update the preview. Save changes, Save layout and Save settings require correcting every numeric error first; saving reveals and focuses the first invalid field, including errors in other inspector tabs. Verify this with `npm --prefix web run test:numeric-inputs` while the frontend is running.

Embedded GLB animation clips loop automatically in model scenes and imported layout modules, including preview, public tours and embeds. Each placed instance animates independently. The optional `assets/prefabs/practice-house/room-fan.glb` demonstrates a rotating ceiling fan above walking head height. Walking collisions use the initial model geometry, so animated doors and moving platforms need additional collision handling. Run `npm --prefix web run test:fan` to check visible playback.

In walking mode, **Head bob** toggles a gentle camera bounce that follows actual movement, and **Smooth movement** toggles acceleration, braking and floor-height smoothing. These viewer preferences are saved in the browser and work in the editor, public tours and embeds. Head bob starts off and respects the device's reduced-motion preference. It settles when stopped or blocked, clears on pause/reset, and never changes collisions or saved start heights. Wall/floor collision, step limits, slope checks and approved floor support always remain active. **Inspect model / Walk inside** switches walking mode separately. Run `npm --prefix web run test:walking-effects` for browser checks.

Choose **+ New scene** to create a connected layout, start with one room, import a GLB, or use a panorama. Give it a name and choose a template or existing asset. Dropping a new file into the dialog uploads it and creates the scene in one step. In a layout, **+ Add room** attaches a room and doorway to the current selection; the Plan tab's North/East/South/West buttons choose the side. Occupied sides are rejected. Click rooms in the 3D viewport or floor plan to edit them, and use Undo/Redo for layout changes.

**Save changes** keeps the current layout and settings. **Save & walk** saves valid changes before entering a keyboard-ready walking test. Imported models show **Set up walking** until their regions and structural floors are reviewed; use the Walking tab and Save changes. Movement settings and courtyard exits are optional expandable sections. Editor camera controls, movement starts/stops, tab switches and layout updates are immediate. Visitor preview/public/embed retain movement acceleration and eye-height easing.

To join existing room GLBs into one walking world, create a Layout with **Imported rooms — assemble GLB parts**. Upload the parts, place them in Plan and review each module’s floors through **Imported room assembly → Choose floor meshes**. **Align with room** plus North/West/East/South and **Doorway offset** position adjacent modules. Existing openings and matching floor heights are required. Save and walk continuously; visitor views load this same assembly. Floor approval is stored with each module and follows its transforms. Run `npm --prefix web run test:assembly` for browser acceptance and see `assets/prefabs/practice-house/README.md` for the five-part exercise. Rebuild both API and frontend with `./deploy.sh up` for this feature.

Imported scenes have a top-down map in **Walking**. Open **Choose floor meshes**, search and check the structural floors in the dialog, then **Apply selection**. Choose **Fit area to selected floors** to set the X/Z bounds and flat-floor heights. Use **Draw area** to drag a smaller rectangle; manual coordinate fields remain available. Drawing never approves additional meshes or changes floor heights. Run `npm --prefix web run test:walking-map` for map acceptance checks.

Client tours and embeds fill the screen with translucent camera controls and a directional movement pad. **Hotspots** opens a floating list; close it or use **Show hotspot** to return to the scene. Editor **Save changes** stays available except during an active save, reports invalid plans, and confirms when everything is already saved. Run `npm --prefix web run test:client-viewer` to check these interactions on desktop, mobile and embed routes.

Run `npm --prefix web run test:usability` to check scene creation, connected additions, walking setup, immediate controls and responsive creation.

Click or Tab into the 3D viewport, then use **WASD** or arrow keys to move. In **Inspect model**, movement follows the camera direction and dragging orbits the model. In **Walk inside**, navigation stays on approved floors with collision enabled; click for mouse look and press Escape to release capture. Keyboard navigation pauses when focus moves to a form or dialog.

Run `npm --prefix web run test:editor` for workspace, keyboard, focus and responsive browser acceptance.

Use **Theme** in the application header or public tour heading to choose **Light**, **Dark**, or **System**. System follows your device appearance automatically; an explicit choice persists across reloads and syncs between tabs. Themes apply to panels, forms, dialogs and viewer controls. Authored scene backgrounds, lighting and material colors keep their saved values. Run `npm --prefix web run test:themes` against a running frontend for theme browser acceptance (set `TOUR_ORIGIN` to its origin; default `http://localhost:5173`).

1. Create a project and open its builder.
2. Upload `tests/testdata/house.glb` (a small box-based house demo), or your own prepared self-contained GLB.
3. Wait for upload validation, then click **Create scene**.
4. Drag to orbit, scroll/pinch to zoom, and right-drag/two-finger drag to pan. For an imported model, use **Walking** in the inspector to review regions and floor meshes, then **Save changes**. Click **Walk inside** to enter the model.
5. Click the scene for mouse look and use WASD or arrow keys to move. **Escape** releases the mouse; **Inspect model** returns to orbit. On touch devices, drag the scene to look and hold the movement buttons.
6. Click **Save start view** to persist your position and orientation; **Reset view** returns there. Reload, then click **Walk inside**: the saved view returns. Without a valid saved view, the app chooses a verified standing position in an approved interior region.

Imported room assemblies require at least one collidable interior module with approved floor meshes before saving a start view. The viewer validates the saved position against the actual imported floors and standing clearance when loading it; module width/depth placeholders do not describe those floors. Saving layout geometry clears the previous start view, so save the layout first, then walk to your intended start and save it.
7. **Reload scene** obtains a fresh asset URL and retries loading.

Only the selected scene's asset is fetched. GLB files must be 20 bytes–1000 MiB with a valid glTF 2.0 binary container. External buffers and images are rejected; JSON chunks are limited to 8 MiB. Basic validation does not guarantee every GLB extension is renderable; unsupported models show a viewer error. Originals are copied without modification into a separate key after validation, so a reused upload policy cannot overwrite them. Failed/pending uploads remain visible; **Confirm upload** retries completion if the object reached storage, otherwise upload the file again.

The POC has no object garbage collection yet: temporary uploads and objects belonging to deleted projects can remain in storage. For longer-lived environments, configure a lifecycle expiry for the `pending/` prefix (for example, one day) and plan cleanup of abandoned originals.

| Method | Route | Result |
| --- | --- | --- |
| POST | `/api/v1/projects/{id}/uploads` | Start upload from `{ "name": "house.glb", "size": 12345 }`; returns asset and POST URL/fields (`201`) |
| POST | `/api/v1/assets/{id}/complete` | Validate stored file and mark ready (`200`); missing/invalid upload (`422`) |
| GET | `/api/v1/projects/{id}/assets` | Asset array, including pending uploads |
| GET | `/api/v1/assets/{id}` | Asset metadata and fresh read `url` when ready |
| POST | `/api/v1/projects/{id}/scenes` | Create from `{ "asset_id": "UUID", "name": "House" }` (`201`) |
| GET | `/api/v1/projects/{id}/scenes` | Scene array in order |
| GET | `/api/v1/scenes/{id}` | Scene metadata, including `start_camera` |
| PATCH | `/api/v1/scenes/{id}` | Rename with `{ "name": "Entrance" }`, reorder with `{ "move": "up" }` / `"down"`, and/or save `start_camera` (`200`) |
| DELETE | `/api/v1/scenes/{id}` | Delete scene, incoming/outgoing navigation links; replace a deleted start scene (`204`) |
| DELETE | `/api/v1/assets/{id}` | Delete unused asset metadata (`204`); used assets return `409` |
| GET | `/api/v1/scenes/{id}/hotspots` | Navigation and information hotspot array |
| POST | `/api/v1/scenes/{id}/hotspots` | Create from title, position and `destination_scene_id` (`201`) |
| PATCH | `/api/v1/hotspots/{id}` | Save complete hotspot content, including position (`200`) |
| DELETE | `/api/v1/hotspots/{id}` | Delete hotspot (`204`) |

Scene creation requires a ready asset in the same project. Camera position uses model world units, and yaw/pitch use radians (Three.js YXZ rotation, looking toward -Z at zero). For 3D, save `{ "start_camera": { "position": [0, 1.75, 0], "yaw": 0, "pitch": 0 } }`. For a panorama, save `{ "start_camera": { "yaw": 0, "pitch": 0 } }`. All fields for the relevant camera type are required; invalid values return `400` and missing scenes return `404`. New scenes have an empty start-camera object. The first scene automatically becomes the project start scene. Save a different start with `PATCH /api/v1/projects/{id}` and `{ "start_scene_id": "UUID" }`. Reopening the builder selects that scene. Deleting the start selects the first remaining scene in order, or clears it when no scenes remain. The database prevents deleting a referenced asset. Asset deletion removes metadata; original objects remain until storage cleanup is added.

The walkthrough assumes metre-scale, static models with Y up: eye height 1.65 m, body radius 0.22 m, speed 2 m/s, and small floor height changes up to 0.25 m. Double-sided raycasts check floor support, walls, and overhead clearance; small movement steps prevent tunnelling and allow sliding along walls. `tests/testdata/house.glb` is the supported demo. This is basic navigation, with no gravity, stairs solver, physics, or arbitrary-model support. Unsupported models may have no valid starting floor and show a readable message.

`npm --prefix web test` checks the actual house GLB for spawn, walls, doorway movement, wall sliding, floor edges, and rejects low ceilings/missing floors. The panorama test checks hotspot angles against camera rotation. PostgreSQL/MinIO integration tests verify PNG/JPG/WebP upload validation, preserved originals and MIME types, scene ordering, start views, same-project references, link deletion, and persistence through a fresh database connection.

## Prepare a GLB and adjust its appearance

3D scenes include **Appearance and model preparation** in the builder. Neutral lighting uses a locally generated room environment, sRGB output and ACES tone mapping. No external lighting preset downloads are required. Adjust **Exposure**, **Environment lighting**, **Light intensity**, and **Background** to preview the result. Optional color and roughness overrides work on cloned materials; embedded textures and uploaded originals remain intact. **Reset settings** restores defaults locally; **Save settings** persists them for builder, preview, public and embedded viewers. Panoramas keep their existing image color treatment.

The panel shows prepared dimensions in metres, texture count, and whether a standing floor was found. Assume one source unit is one metre and Y is up initially. Use **Model scale** `0.01` for centimetres or `0.001` for millimetres; choose **Z up** only for an export that actually needs correction. **Model rotation** is yaw in degrees after the up-axis correction. A single wrapper applies the same correction to visible geometry and collision. Draft hotspots move with the model. Saving a changed model transform moves saved hotspot coordinates atomically and clears the old start view; walk inside and save a new start afterward. Lighting-only changes preserve the start view. Save settings before editing hotspots.

The importer rejects unknown required extensions with a specific message and detects missing or undecodable embedded textures instead of silently displaying an untextured model. This version supports ordinary self-contained GLB and the installed loader's standard material extensions. Meshopt and renderer-aware KTX2/Basis decoding are supported, with local transcoder assets installed by npm. Draco remains unsupported; re-export Draco models without that compression. A model without standing floor support remains inspectable and reports how to prepare it for walking. This does not provide arbitrary-model navigation or a stairs solver.

Try `tests/testdata/textured-interior.glb` for a tiled lobby with two connected rooms and red/blue artwork. `textured-interior-cm-z.glb` intentionally requires scale `0.01` and Z-up correction. The fixtures can be regenerated with `python3 tests/scripts/make-interior.py` and contain their PNG texture inside the GLB.

```sh
npm --prefix web run demo:appearance
npm --prefix web run test:appearance
```

Both commands require the frontend/API/storage stack to be running; the browser check additionally requires `npx playwright install chromium` in `web`. `TOUR_ORIGIN` selects the deployment (default `http://localhost:5173`). For testing a workspace frontend/API while the container serves an older build, `TOUR_FRONTEND_ORIGIN=http://localhost:5174` routes the browser through that Vite server, including API requests; configure its `API_PROXY_TARGET` to the workspace API. This keeps the configured browser origin for storage CORS. The example command creates a project with both prepared fixtures. The browser check creates and deletes its own project and verifies recognizable colors across viewer modes, saved settings, original bytes, transforms, hotspot movement, start views, floor diagnostics, and import failures.

Scene PATCH accepts a full `settings` object separately from `start_camera`:

```json
{"settings":{"appearance":{"exposure":1,"environment_intensity":1,"light_intensity":1,"background":"#edf1e8","tint":"","roughness":null},"model":{"scale":0.01,"up_axis":"Z","rotation":0}}}
```

## Try 360 scenes and navigation

1. Upload `tests/testdata/panorama-a.png` and `tests/testdata/panorama-b.jpg` using **Upload panorama**, and create a scene from each. These are synthetic grid fixtures for checking orientation; `panorama.webp` is a third format fixture. Prepared photographic panoramas work too.
2. Drag the panorama to look around. Scroll or pinch to zoom. **Save start view** stores yaw and pitch; **Reset view** restores those angles and the default zoom.
3. Rename scenes, use **Move up/down**, and choose **Set as start** in the scene list.
4. In the first scene, choose the second scene under **Destination scene**, choose **Navigation** as the hotspot type, enter a title, click **Place hotspot**, then click a point in the panorama and **Save hotspot**. Dragging while placing only changes the view.
5. Click the on-scene marker to switch scenes. Add a return link in the second scene. The selector and link list provide alternatives when a marker is outside the view.
6. Add a GLB scene to the same project. Place its links by clicking model surfaces in orbit inspection. Panorama links store yaw/pitch; 3D links store world x/y/z. Release pointer lock with Escape to click markers during a walkthrough.
7. Reload to verify the start scene, scene order, saved views, and links. Deleting a destination removes links pointing to it.

Panoramas must be 2:1 JPG, PNG or WebP, at most 8192 × 4096 pixels and 100 MiB. The backend checks format, dimensions, and full pixel decoding before confirming an upload. The private bucket and presigned upload/read URLs are shared with GLB assets; originals are preserved.

A navigation request uses `{ "type": "NAVIGATION", "title": "Next room", "position": { "yaw": 0.5, "pitch": 0 }, "destination_scene_id": "UUID" }` for a panorama, or `"position": { "x": 0, "y": 1.5, "z": -2.3 }` for 3D. Destinations must be another scene in the same project. Invalid geometry or references return `400`. Deleting a scene removes both its own hotspots and incoming navigation hotspots; project deletion cascades through scene and hotspot metadata.

## Information hotspots and preview

1. Select **Information / artwork** in **Hotspot properties**, enter a title and description, and optionally add an HTTP(S) link. For navigation, choose **Navigation** and a destination scene instead.
2. Optionally **Upload hotspot image**, then select it under **Image (optional)**.
3. Click **Place hotspot**. Hover over a model surface or panorama point to see the yellow placement preview, then click. A yellow **Unsaved placement** marker remains until you click **Save hotspot**. Dragging the view does not place a marker. GLB placement uses a small surface offset to keep new markers clear of the wall.
4. Find saved markers in **Saved hotspots**. **Edit** selects their properties; **Show hotspot** aims the camera or frames the marker; **Test hotspot** opens information or follows its destination. Builder marker clicks select for editing. The selected marker has a yellow outline. **Reveal hidden hotspots (builder only)** exposes markers behind walls for editing, with dashed borders. In walking mode, Show aims from your current standing location and never teleports through geometry; use **Inspect model** and Reveal to find a marker behind a wall.
5. Click **Preview tour** for visitor behavior. Visitors also have a hotspot list when markers are outside the view or hidden by a wall. In desktop walking, click the scene for mouse capture, aim the reticle at a visible marker, then click when its title appears. Escape releases the mouse for normal controls. On touch, tap a visible marker or use the list. Information popups stop walking and release mouse capture; click the scene again after closing to resume capture.
6. Reload to confirm saved content and positions. **Retry hotspots** retries failed hotspot requests without reloading the model. Images referenced by hotspots cannot be deleted. Repositioning is local until Save; Delete removes the selected saved hotspot immediately.

Create a ready-to-use lobby example with information and room-navigation markers against the running local stack:

```sh
npm --prefix web run demo:hotspots
```

The command prints the new builder URL. The house and panorama are simple test fixtures; the second room is a separate scene reached by clicking a navigation marker. This example does not create a continuous room layout. Use `TOUR_ORIGIN=https://your-host` to target another running deployment.

Run the hotspot browser checks with the API, storage and frontend running:

```sh
cd web
npx playwright install chromium
npm run test:hotspots
```

The checks create and delete a separate example project. As with other POC uploads, its storage objects remain until storage cleanup. `TOUR_ORIGIN` defaults to `http://localhost:5173`. If a running container serves an older frontend, `TOUR_FRONTEND_ORIGIN=http://localhost:5174` tests a workspace Vite server through the configured origin so storage CORS remains consistent. The browser checks cover placement, save/reload, finding and testing markers, request retry, occlusion/reveal, pointer-lock activation, popups, navigation, panorama, public/embed, and emulated touch. Physical-device testing remains separate.

Create an information hotspot with `POST /api/v1/scenes/{id}/hotspots`, for example:

```json
{"type":"INFO","title":"Painting","description":"Artist and artwork details","position":{"yaw":0,"pitch":0},"image_asset_id":null,"external_link":"https://example.com/art"}
```

Use world `x/y/z` for 3D. `PATCH /api/v1/hotspots/{id}` takes the same full content, including type, title and position, to edit or reposition a hotspot. INFO has no destination; NAVIGATION requires another scene in the same project and no information fields. Titles have 1–120 characters, descriptions at most 5,000, and HTTP(S) links at most 2,048 bytes. Set optional image/destination IDs to null to clear them. Image IDs must refer to completed `IMAGE` assets in the same project. Start an image upload with `{"name":"painting.jpg","size":12345,"file_type":"IMAGE"}`; omitted `file_type` preserves panorama upload behavior.

## Publish, share and embed

1. Save your hotspots, camera views and project details, then click **Publish tour** under **Share tour**. Publication requires at least one usable scene, a valid start scene, completed scene/image assets, and valid navigation destinations.
2. Click **Open shared tour** or **Copy URL**. The viewer opens at `/t/:slug` without login. It starts at the saved start scene, supports scene selection, navigation, information popups and fullscreen when available. **Reload scene** refreshes expired asset URLs.
3. Click **Copy iframe code** and paste it into a separate site's HTML. The compact `/embed/:slug` viewer uses the same renderer. The supplied iframe includes fullscreen permission. If clipboard access is unavailable, select and copy the displayed URL/code manually.
4. Test the share URL in another browser and the embed on a separate page. For example, save an HTML file containing the copied iframe and serve it with `python3 -m http.server 8000`; open the file at `http://localhost:8000`.
5. Click **Unpublish tour** to make public metadata, scene hotspots and fresh asset URL endpoints return `404`. Both viewer routes then show **Tour unavailable** when opened or reloaded. Republish preserves the same slug.

Publishing sets a visibility flag over the saved project. Saved edits appear immediately through the existing share URL; there are no publication snapshots. The builder remains accessible in this trusted-environment POC. Public viewers use only tour-scoped read endpoints. Unused assets and assets/scenes from another project are unavailable through a tour's public routes. Public responses use `Cache-Control: no-store`. The private bucket serves presigned URLs valid for 15 minutes; unpublishing stops issuing new URLs, while URLs already issued and media already loaded remain usable until their expiry or the page is reloaded.

Imported-room-only layouts can be published after saving and approving at least one collidable module's floor meshes. Generated room/floor elements also supply usable floors. An assembly containing only unreviewed decoration is rejected. Imported GLBs must be ready, and navigation destinations and image/texture references must remain valid within the project.

| Method | Route | Result |
| --- | --- | --- |
| POST | `/api/v1/projects/{id}/publish` | Validate and publish saved tour (`200`); incomplete/invalid tour (`400`) |
| POST | `/api/v1/projects/{id}/unpublish` | Unpublish (`200`) |
| GET | `/api/v1/public/tours/{slug}` | Published name, description, start scene and ordered scenes (`200`); unpublished/unknown (`404`) |
| GET | `/api/v1/public/tours/{slug}/assets/{id}` | Fresh browser-reachable `url` for a ready asset used in this tour (`200`); unavailable/unused/other project (`404`) |
| GET | `/api/v1/public/tours/{slug}/scenes/{id}/hotspots` | Scene's information/navigation hotspots (`200`); unavailable/other project (`404`) |

Every project receives a unique stable slug on creation, including existing projects during migration. Rename, saving edits, unpublishing and republishing preserve it. Database integration tests check publish validation, visibility, stable slugs, saved edits, reconnection persistence, scoped reads and URL refresh. Browser checks cover the shared GLB/panorama renderer, information/images, navigation, clipboard actions, fullscreen, separate-origin iframe hosting, unpublishing, and emulated touch interaction. The implementation follows the stopping point in `plan_phase.md`; production deployment infrastructure remains deferred.


## Connected layouts (V2 Phase 3)

1. Open a project and click **Build layout**. It creates a lobby, corridor and two rooms with three doorways in one continuous scene. No uploaded building is needed.
2. Select a shape on the **Floor plan** or use **Selected layout element**. Drag to move with grid snapping, or edit position, width, depth and height in metres. **Rotate 90°**, **Duplicate element**, **Delete element**, **Undo layout** and **Redo layout** operate on the draft. Lobby, room, corridor, floor and wall templates can be added individually.
3. Make room edges touch, choose **Touching room edges**, then **Add doorway**. Select a doorway to edit its centre and clearance or delete it. Minimum clearance is 0.8 m wide and 2 m high, with 0.12 m of wall at each end. Room overlap, invalid door connections, blocked doorways and overlapping parallel wall thicknesses prevent saving. Coincident walls are merged into one set of visual/collision segments. Disconnected rooms produce a warning.
4. Upload a GLB under **Assets**, then use **Place [filename]** in the layout editor. Each instance has independent position, yaw, scale, color, roughness and collision. Furniture blocks walking by default; turn off **Instance blocks walking (furniture)** for decorations. Source geometry/textures are reused, instance materials are cloned, and uploaded originals stay intact. Instances assume Y up; scale converts source units to metres.
5. The 3D preview updates with valid drafts. An invalid draft keeps the last valid geometry visible and explains what to fix. Click **Save layout**, then **Walk inside**. Generated floors and walls always collide; doors connect rooms without changing scenes. Save a new start view after geometry edits. Save the layout before adding hotspots or saving a start view.
6. Surface-placed layout hotspots attach to the selected surface's element automatically. **Hotspot attachment** can choose another element or **Keep at world position**. Attached markers move atomically with saved element transforms. To delete an attached element, first detach or delete its hotspots and save those hotspot edits. Legacy world positions remain supported.
7. Reload to restore the saved layout and instances, then use **Preview tour**, **Publish tour** and the existing share/embed URLs. Layout instances are included in tour-scoped public asset access, and referenced GLBs cannot be deleted. Whole-project deletion cascades through layout references.

Layouts use a version 1 JSON document and a revision number. `GET /api/v1/scenes/{id}/layout` returns `{document, revision}`. `PUT` takes the same envelope and saves geometry, instance asset references and attached hotspot positions atomically. A stale revision returns `409` and retains the author's draft; reload to review the newer saved layout before reapplying changes. Missing attachment targets also return `409`. Ready same-project GLB references are required. Limits are 200 elements, 200 doorways and a 256 KiB request body. Public reads use `/api/v1/public/tours/{slug}/scenes/{id}/layout`; tour metadata also includes each scene's document and revision.

Create an unpublished example with two textured table instances, connected rooms and an attached welcome hotspot:

```sh
npm --prefix web run demo:layout
```

Run the layout browser acceptance checks against the running stack:

```sh
npm --prefix web run test:layout
```

These checks create their own project and remove it afterwards. `TOUR_ORIGIN` and `TOUR_FRONTEND_ORIGIN` work as described for the appearance checks. Unit checks cover doorway passage, shared walls, floor gaps, furniture collision, decoration passthrough, material isolation and attachment transforms. Browser checks exercise authoring, dragging, undo/redo, doorway editing, instance persistence, surface hotspot placement, continuous walking, solid walls, public/embed views and emulated touch.

This phase is single-level and uses the existing walking controller. Tiled texture editing is available in Phase 4 below; acceleration, fixed simulation timing, reviewed imported walking boundaries, simple stairs and explicit exits are implemented in Phase 5 below. Physical touch-device and performance-budget verification remain pending.

## Tiled materials (V2 Phase 4)

Upload PNG, JPG or WebP maps under **Assets → Texture map role → Upload texture map**. Each asset records its base-color, normal or roughness role. Base color uses sRGB; normal and roughness use linear data (roughness reads the green channel). Maps do not need panorama proportions, and use the existing 100 MiB and 8192 × 4096 pixel image limits. Originals are retained.

Under **Tiled materials**, add and name a preset, select maps, then set tile size in metres, U/V repeat multipliers, offsets, rotation, tint and roughness. Choose **Material surface** to assign a preset independently to each room's floor or wall, standalone floor/wall, or imported GLB mesh. **Original / default** removes an assignment. Presets are reusable within the scene; editing one changes every assigned surface. **Duplicate material preset** makes an independent finish. Imported mesh selections use stable child-index paths, including when mesh names repeat. Meshes without UVs explain the limitation and disable textured assignment; re-export them with UVs. Imported metre tiling estimates dimensions against existing UV extents, so unusual UV islands may require U/V adjustment.

Save **layout** for generated scenes, or **settings** for imported 3D scenes. Layout material saves share the existing atomic revision checks and hotspot updates. Room floors and wall sides accept separate finishes, including opposite sides of a shared wall. Template UVs are measured in metres and anchored to world coordinates: resizing preserves tile size, and adjoining modules align texture seams. **Repeat module to right** places an exact adjacent room/floor copy; room copies get an aligned doorway automatically. Existing overlap/doorway validation applies. Change the copy's surface assignment to give it an independent finish; the source assignment stays intact.

Texture references must belong to the same project, be ready, and match the map's role. Database references protect maps from individual deletion, cascade on project deletion, and participate in publish validation and public tour asset checks. Unused and foreign-project textures remain unavailable through public endpoints. Layout lighting changes retain layout texture references. Existing version 1 layouts and imported scenes can omit the new fields.

```sh
npm --prefix web run demo:materials
npm --prefix web run test:materials
```

The demo generates project-owned procedural stone, wood, wall, normal and roughness maps and uploads them with two furniture instances into a connected layout. Browser checks use their own disposable project; `TOUR_ORIGIN` and `TOUR_FRONTEND_ORIGIN` work as in the other acceptance scripts. Unit and database tests cover role color spaces, independent samplers/materials, metre UVs, shared wall sides, module floor support, persistence, revision rollback, same-project references, deletion protection and scoped public access.

## Smooth walking and explicit exits (V2 Phase 5)

Open **Walking areas and exits** to set speed, eye height, maximum step and slope. Layout walking areas follow the actual room and floor templates; **Exterior floor (requires an exit)** marks a standalone floor that visitors cannot reach by holding movement. Imported buildings start in inspection: use **Add walking region**, review the rectangle and floor elevation range, and open **Choose floor meshes** before saving scene settings. The **Approved floor meshes** dialog supports search, checkboxes, Select/Clear shown and an explicit **Apply selection** action. Cancel or Escape discards dialog changes. Green outlines show reviewed interiors; orange shows exterior regions. Roofs, tables, decorative surfaces and outdoor floors are excluded unless the author explicitly approves them. Changing model scale, up axis or rotation clears the old review and exits; review the prepared coordinates again. Existing uploaded bytes, saved views, hotspots, panoramas and share URLs remain readable.

The shared controller uses a capsule against a triangle BVH, with movement sweeps limited to 2.5 cm and exact projected floor-coverage checks along the support paths. It stops at walls, thin barriers, gaps, ceilings, region edges and locked exit thresholds together. Movement integrates at 120 Hz, caps catch-up work, accelerates/decelerates, normalizes diagonals and slides along contact planes. Long interruptions drop stale motion; blur, hidden tabs, pointer-lock release, popups and scene changes clear inputs and velocity. Mouse look remains immediate; eye height eases over small floor changes. Simple 20 cm stairs and a 15° ramp have separate fixture checks; arbitrary staircases and multi-storey navigation are not implied.

Walk to a threshold and choose **Add exit at current walking position**. Edit its label, crossing axis and width, destination scene/region, and arrival eye coordinates. The activation point needs a clear standing area, and the arrival must be clear of walls and other locked thresholds. Add a return exit in the destination, then save. Exit buttons become available within 1.5 m with a clear line of sight. Click the visible marker or **Click to [label]**; pointer-lock visitors can aim at an exit and click the reticle. Holding movement never activates an exit. Opening information never approves an exterior region. Same-scene transitions validate the existing navigation world; cross-scene exits load and validate the exact destination geometry before switching scenes. Collision remains enabled throughout. Reset view stays within an entered exterior region, and inspection mode preserves the last standing position; use the configured return exit to go inside.

Invalid starts use a verified safe fallback with a message. If no approved standing location exists, walking is disabled and inspection stays available. Numerical errors recover to the last valid standing location or a verified location in the currently approved region. Cross-scene arrival poses are also rechecked on restoration. The API checks finite settings, region membership, same-project destinations and durable portal references; it cannot prove arbitrary GLB collision from JSON settings, so mesh validation at activation is authoritative. Publication rechecks region references if a destination was edited after an exit was saved. Referenced destination scenes must be resolved before deletion; whole-project deletion still cascades. Migration 011 adds these references without changing existing documents.

```sh
npm --prefix web run demo:walking
npm --prefix web run test:walking
```

The demo combines tiled connected rooms, two table instances, an exterior courtyard, exits and returns, a gallery annex, artwork information and scene navigation. Test scripts explicitly review the known bundled interior fixtures; production uploads never receive that approval automatically. Unit tests cover 30/60/120 FPS schedules, long interruptions, thin and diagonal walls, floor gaps, low ceilings, ramps, stairs, excluded roofs/decorations and locked exits with a return. Browser acceptance covers the author review, movement boundaries, safe starts, popup pause, portal activation, public/embed and emulated touch. Physical-device and performance-budget verification remains pending.

## Runtime asset optimization (performance Phase 4)

Completed GLB and material-texture uploads queue validated runtime derivatives when the background worker is enabled. The asset library shows processing status and supports retries. Existing assets can be queued there. Original files remain available while processing or after failures. Docker includes the Node processor; native development enables it with `ASSET_PROCESSOR_SCRIPT` as shown above.

Low, Balanced and HQ select embedded and external texture variants with maximum dimensions of 1024, 2048 and 4096. Exact collision proxies preserve reviewed floors and authored surface paths. Auto commits texture changes only after accepting its quality trial. Shared model, texture and navigation caches preserve ownership across scene changes. See [runtime asset processing](docs/runtime-assets.md) for validation, private delivery, provisional budgets, checks and current limitations.

## Reviewed GLB chunking

Large static GLBs can be partitioned into author-reviewed room groups with independently delivered quality variants and shared images. Preview/public/embed viewers prepare exact navigation and occlusion before admitting movement; unsupported sources retain complete loading. Builder editing uses the complete source. Experimental intact-triangle cells are explicitly opt-in.

API rollout defaults to `ASSET_CHUNK_STREAMING=off`. Use `reviewed` for verified room groups or `spatial` to also permit reviewed experimental cells. `VITE_CHUNK_STREAMING=0` and `?streaming=0` provide viewer rollback. All processor modules are included in the Docker image; migrations 014–016 establish partition, job and storage retirement records. See [final validation, measurements and rollout](docs/chunking-acceptance.md) and [the implementation plan](rendering_pland_phase.md). Automated generated-fixture/live-stack checks do not replace real-building or physical-device acceptance.
