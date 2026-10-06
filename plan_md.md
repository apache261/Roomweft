# Virtual Tour Platform — Codex Implementation Plan

## 1. Project Goal

Build a self-hosted web application for creating immersive virtual tours from:

1. **3D files** supplied by a capture/3D team.
2. **360° panoramic images** supplied by photographers/capture teams.

The first version has **no authentication**.

The workflow should be:

```text
Open Application
    ↓
Create Project
    ↓
Upload 3D Model(s) and/or 360 Images
    ↓
Manage / Arrange Scenes
    ↓
Add Navigation + Hotspots + Information Popups
    ↓
Preview Tour
    ↓
Publish
    ↓
Use Public URL or Embed Code
```

The platform should not perform photogrammetry or reconstruct a building from photographs in v1.

It consumes already-created 3D models or 360 panoramas and turns them into interactive, browser-based tours.

---

# 2. Primary Requirements

The application must allow a user to:

- Create a project directly without logging in.
- Upload one or more 3D files.
- Upload one or more 360° images.
- Preview uploaded assets.
- Arrange assets into a tour.
- Define navigation between scenes.
- Add clickable hotspots.
- Add information popups to objects/locations.
- Add painting/artwork descriptions.
- Add images, text, links, and optional audio to hotspots.
- Configure starting position and camera orientation.
- Preview the final tour.
- Publish the tour.
- Generate a public shareable URL.
- Generate iframe embed code.
- Load the tour on desktop and mobile browsers.

---

# 3. Scope

## In Scope

### Project Management

- Create project.
- Rename project.
- Add title and description.
- Delete project.
- Duplicate project.
- Set project thumbnail.
- Set default/start scene.
- Draft/published status.

### 3D Assets

Initial supported formats:

- `.glb`
- `.gltf`

Optional import support:

- `.fbx`
- `.obj`

FBX/OBJ can be converted to GLB as part of an optional server-side processing pipeline.

Prefer GLB as the canonical runtime format.

### 360 Assets

Initial supported formats:

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`

360 images should primarily be equirectangular panoramas with an approximate 2:1 aspect ratio.

Example:

```text
8192 x 4096
4096 x 2048
2048 x 1024
```

### Tour Builder

Allow users to:

- Add scenes.
- Rearrange scene order.
- Rename scenes.
- Select a start scene.
- Configure camera starting position.
- Configure orientation.
- Add scene-to-scene navigation.
- Add hotspots.
- Add text information.
- Add media to hotspots.
- Delete or reposition hotspots.

### Public Viewer

The published viewer must:

- Load without authentication.
- Work through a public URL.
- Support iframe embedding.
- Support desktop mouse controls.
- Support touch controls.
- Support fullscreen.
- Show loading progress.
- Provide optional scene selector/minimap-style menu.
- Open information panels from hotspots.

---

# 4. Recommended Architecture

```text
                     ┌──────────────────────┐
                     │      Web Client      │
                     │ React / TypeScript   │
                     │ Three.js / R3F       │
                     └──────────┬───────────┘
                                │
                           REST / JSON
                                │
                     ┌──────────▼───────────┐
                     │      Go Backend      │
                     │   REST API + Jobs    │
                     └───────┬───────┬──────┘
                             │       │
                    ┌────────▼───┐ ┌─▼────────────┐
                    │ PostgreSQL │ │ Object Store │
                    │ metadata   │ │ S3 / MinIO   │
                    └────────────┘ └──────────────┘

                              │

                     Optional processing
                              │
               ┌──────────────▼──────────────┐
               │ Blender CLI / glTF tools    │
               │ ImageMagick / libvips       │
               │ FFmpeg                      │
               └─────────────────────────────┘
```

---

# 5. Technology Stack

## Backend — Primary Stack

Use **Go** as the major backend language.

Recommended:

- Go 1.26+
- `net/http` or `chi`
- `pgx`
- `sqlc`
- PostgreSQL
- MinIO / Amazon S3 compatible storage
- structured logging with `slog`
- OpenAPI
- Docker / Docker Compose

Recommended Go libraries:

```text
github.com/go-chi/chi/v5
github.com/jackc/pgx/v5
github.com/sqlc-dev/sqlc
github.com/minio/minio-go/v7
github.com/google/uuid
github.com/go-playground/validator/v10
```

Use standard library functionality whenever practical.

Avoid unnecessarily heavy Go frameworks.

Recommended HTTP router:

```text
chi
```

---

# 6. Frontend Stack

Recommended:

- React
- TypeScript
- Vite
- React Three Fiber
- Three.js
- Drei
- Zustand
- Tailwind CSS

Libraries:

```text
react
typescript
three
@react-three/fiber
@react-three/drei
zustand
react-router
tailwindcss
```

The application should have two major frontend modes:

```text
/builder
/viewer
```

They can exist in the same React application.

---

# 7. 3D Rendering

Use:

```text
Three.js
+
React Three Fiber
```

Primary format:

```text
GLB / GLTF
```

The viewer should support:

- Perspective camera.
- Mouse look.
- Orbit mode for debugging.
- First-person walkthrough.
- WASD controls.
- Touch joystick or touch navigation.
- Collision detection.
- Raycasting.
- Clickable 3D hotspots.
- Camera reset.
- Loading progress.

Recommended helper packages:

```text
@react-three/fiber
@react-three/drei
three-mesh-bvh
```

Optional:

```text
@react-three/rapier
```

Use Rapier only if proper physics or collision handling is necessary.

For simple indoor navigation, `three-mesh-bvh` may be sufficient.

---

# 8. 360 Viewer

Do not force 360 images through the 3D model pipeline.

Treat panoramas as their own scene type.

Recommended implementation:

```text
Three.js sphere panorama
```

or use:

```text
Marzipano
```

Recommended v1 approach:

Use Three.js so the same viewer can render both 3D and 360 scenes.

A 360 scene can be implemented as:

```text
camera
    inside
inverted sphere
    ↓
equirectangular texture
```

This allows the hotspot system to remain shared across both scene types.

Scene type:

```text
MODEL_3D
PANORAMA_360
```

---

# 9. Unified Scene Model

Create a generic scene model.

Example:

```json
{
  "id": "scene_uuid",
  "project_id": "project_uuid",
  "name": "Living Room",
  "type": "MODEL_3D",
  "asset_id": "asset_uuid",
  "position": {
    "x": 0,
    "y": 1.7,
    "z": 0
  },
  "rotation": {
    "x": 0,
    "y": 0,
    "z": 0
  },
  "is_start_scene": true
}
```

For a panorama:

```json
{
  "id": "scene_uuid",
  "project_id": "project_uuid",
  "name": "Kitchen",
  "type": "PANORAMA_360",
  "asset_id": "asset_uuid",
  "yaw": 0,
  "pitch": 0
}
```

---

# 10. Hotspot System

Hotspots are one of the most important parts of the application.

A hotspot should support:

```text
INFO
NAVIGATION
IMAGE
VIDEO
AUDIO
LINK
ARTWORK
```

Example information hotspot:

```json
{
  "type": "INFO",
  "title": "Family Portrait",
  "description": "This portrait was painted in 1928.",
  "position": {
    "x": 1.24,
    "y": 1.72,
    "z": -3.4
  }
}
```

Example navigation hotspot:

```json
{
  "type": "NAVIGATION",
  "title": "Go to Kitchen",
  "target_scene_id": "uuid"
}
```

For 360 scenes, hotspot coordinates may use:

```text
yaw
pitch
```

Example:

```json
{
  "type": "INFO",
  "yaw": 1.42,
  "pitch": 0.15
}
```

The application should internally normalize the hotspot system so UI components can be reused.

---

# 11. Tour Builder UI

Suggested layout:

```text
┌────────────────────────────────────────────────────────────┐
│ Project Name                         Preview | Publish      │
├───────────────┬─────────────────────────────┬──────────────┤
│               │                             │              │
│ Scene List    │        3D / 360 View        │ Properties   │
│               │                             │              │
│ Living Room   │                             │ Name         │
│ Kitchen       │       Interactive           │ Type         │
│ Bedroom       │       scene editor          │ Position     │
│ Hallway       │                             │ Media        │
│               │                             │              │
│ + Add Scene   │                             │ Delete       │
│               │                             │              │
├───────────────┴─────────────────────────────┴──────────────┤
│ Assets | Hotspots | Navigation | Project Settings         │
└────────────────────────────────────────────────────────────┘
```

The user should be able to:

1. Select a scene.
2. Enter edit mode.
3. Click somewhere in the scene.
4. Create a hotspot.
5. Select hotspot type.
6. Enter content.
7. Save.
8. Immediately preview it.

---

# 12. Asset Manager

Assets should be separate from scenes.

Supported asset types:

```text
MODEL
PANORAMA
IMAGE
AUDIO
VIDEO
THUMBNAIL
```

Example asset metadata:

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "type": "MODEL",
  "original_filename": "ancestral-house.glb",
  "storage_key": "projects/{project_id}/assets/{uuid}.glb",
  "size_bytes": 123456789,
  "mime_type": "model/gltf-binary",
  "status": "READY"
}
```

Status:

```text
UPLOADING
PROCESSING
READY
FAILED
```

---

# 13. Upload Architecture

Do not stream large 3D files through the Go API if avoidable.

Preferred flow:

```text
Browser
   ↓
Request upload URL
   ↓
Go API
   ↓
Generate presigned S3 URL
   ↓
Browser uploads directly to S3 / MinIO
   ↓
Browser confirms upload
   ↓
Go stores metadata
```

API example:

```text
POST /api/v1/projects/{projectId}/uploads
```

Response:

```json
{
  "upload_url": "...",
  "asset_id": "uuid"
}
```

After completion:

```text
POST /api/v1/assets/{assetId}/complete
```

For local development use MinIO.

Production can use:

- AWS S3
- Cloudflare R2
- DigitalOcean Spaces
- Backblaze B2
- another S3-compatible platform

---

# 14. Asset Processing Pipeline

Large 3D assets may need optimization.

Processing should be asynchronous.

Do not block the HTTP request.

Suggested pipeline:

```text
Upload
  ↓
Asset record created
  ↓
Processing job
  ↓
Validate format
  ↓
Extract metadata
  ↓
Optimize
  ↓
Generate preview
  ↓
Mark READY
```

Use a simple PostgreSQL-backed job table initially.

Avoid introducing Redis unless needed.

Example:

```text
jobs
```

Columns:

```text
id
type
payload
status
attempts
created_at
started_at
completed_at
error
```

A Go worker process can poll and process jobs.

Executables:

```text
cmd/api
cmd/worker
```

---

# 15. 3D Optimization

Recommended tools:

```text
gltf-transform
gltfpack
Draco
Meshopt
KTX2
Basis Universal
```

Potential optimization pipeline:

```text
uploaded GLB
     ↓
validation
     ↓
gltf-transform
     ↓
mesh optimization
     ↓
texture resizing
     ↓
KTX2 texture conversion
     ↓
optimized GLB
```

Store both:

```text
original
optimized
```

Never overwrite the capture team's source asset.

Possible storage:

```text
projects/{project}/assets/{asset}/original.glb
projects/{project}/assets/{asset}/optimized.glb
```

---

# 16. Very Large Buildings

Do not assume the complete property can always be a single GLB.

Support multiple model scenes.

Example:

```text
Exterior
Living Room
Dining Room
Kitchen
Bedroom 1
Bedroom 2
Garden
```

Each may be represented by its own model.

Later optimization may support:

```text
LOD
spatial streaming
room-based loading
```

Do not implement complex spatial streaming in the first MVP.

---

# 17. Backend API

Base:

```text
/api/v1
```

## Projects

```text
POST   /projects
GET    /projects
GET    /projects/{id}
PATCH  /projects/{id}
DELETE /projects/{id}
```

## Assets

```text
GET    /projects/{projectId}/assets
POST   /projects/{projectId}/uploads
POST   /assets/{assetId}/complete
DELETE /assets/{assetId}
```

## Scenes

```text
GET    /projects/{projectId}/scenes
POST   /projects/{projectId}/scenes

GET    /scenes/{sceneId}
PATCH  /scenes/{sceneId}
DELETE /scenes/{sceneId}
```

## Hotspots

```text
GET    /scenes/{sceneId}/hotspots
POST   /scenes/{sceneId}/hotspots

PATCH  /hotspots/{hotspotId}
DELETE /hotspots/{hotspotId}
```

## Publishing

```text
POST /projects/{projectId}/publish
POST /projects/{projectId}/unpublish
```

Public:

```text
GET /public/tours/{slug}
```

---

# 18. Public URL

Example:

```text
https://tour.example.com/t/ancestral-house
```

No authentication required.

Published projects should have:

```text
slug
published_at
is_published
```

---

# 19. Embedding

Each published project must support:

```html
<iframe
  src="https://tour.example.com/embed/ancestral-house"
  width="100%"
  height="600"
  allow="fullscreen"
></iframe>
```

Add routes:

```text
/t/{slug}
/embed/{slug}
```

Embed mode should remove unnecessary navigation and editing controls.

Optional query parameters:

```text
?autoplay=1
?ui=0
?scene=living-room
```

---

# 20. Database

Use PostgreSQL.

Tables:

```text
projects
assets
scenes
hotspots
scene_links
jobs
```

Possible schema:

## projects

```text
id UUID PK
name TEXT
slug TEXT UNIQUE
description TEXT
thumbnail_asset_id UUID NULL
start_scene_id UUID NULL
is_published BOOLEAN
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
published_at TIMESTAMPTZ NULL
```

## assets

```text
id UUID PK
project_id UUID
type TEXT
filename TEXT
mime_type TEXT
size_bytes BIGINT
storage_key TEXT
optimized_storage_key TEXT NULL
status TEXT
metadata JSONB
created_at TIMESTAMPTZ
```

## scenes

```text
id UUID PK
project_id UUID
asset_id UUID
name TEXT
scene_type TEXT
sort_order INTEGER
config JSONB
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

## hotspots

```text
id UUID PK
scene_id UUID
type TEXT
title TEXT
description TEXT
position JSONB
target_scene_id UUID NULL
media_asset_id UUID NULL
config JSONB
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

## scene_links

Optional.

Navigation hotspots can initially handle scene relationships directly.

---

# 21. Suggested Go Project Structure

```text
virtual-tour/
├── cmd/
│   ├── api/
│   │   └── main.go
│   └── worker/
│       └── main.go
│
├── internal/
│   ├── config/
│   ├── database/
│   ├── project/
│   ├── asset/
│   ├── scene/
│   ├── hotspot/
│   ├── publish/
│   ├── storage/
│   ├── jobs/
│   └── httpapi/
│
├── db/
│   ├── migrations/
│   └── queries/
│
├── web/
│
├── docker/
│
├── compose.yml
├── Makefile
├── go.mod
└── README.md
```

Prefer feature/domain-oriented Go packages.

Avoid a giant:

```text
handlers/
services/
repositories/
```

folder structure where every domain is mixed together.

---

# 22. Frontend Structure

```text
web/
├── src/
│   ├── app/
│   ├── api/
│   ├── components/
│   ├── builder/
│   │   ├── ProjectBuilder.tsx
│   │   ├── SceneList.tsx
│   │   ├── AssetPanel.tsx
│   │   ├── PropertyPanel.tsx
│   │   └── HotspotEditor.tsx
│   │
│   ├── viewer/
│   │   ├── TourViewer.tsx
│   │   ├── ModelScene.tsx
│   │   ├── PanoramaScene.tsx
│   │   ├── Hotspot.tsx
│   │   ├── NavigationHotspot.tsx
│   │   └── FirstPersonControls.tsx
│   │
│   └── stores/
│
├── package.json
└── vite.config.ts
```

---

# 23. Scene Renderer Abstraction

Do not tightly couple the viewer to one scene format.

Create:

```text
SceneRenderer
```

Concept:

```tsx
switch (scene.type) {
  case "MODEL_3D":
    return <ModelScene scene={scene} />;

  case "PANORAMA_360":
    return <PanoramaScene scene={scene} />;
}
```

This makes it possible to add future scene formats.

Potential future types:

```text
GAUSSIAN_SPLAT
VIDEO_360
POINT_CLOUD
```

---

# 24. Future Gaussian Splat Support

Do not make Gaussian splatting mandatory for the MVP.

However, design the scene abstraction so it can later support:

```text
GAUSSIAN_SPLAT
```

Potential future libraries:

- PlayCanvas splat renderer
- Three.js compatible Gaussian splat viewer
- Spark
- custom WebGPU renderer

Potential formats:

```text
PLY
SPLAT
KSPLAT
SPZ
```

Do not implement until real capture-team output requires it.

---

# 25. Navigation

## 3D Models

Support:

```text
WASD
Arrow Keys
Mouse Look
Touch Controls
```

Optional:

```text
click-to-walk
```

Start with WASD + pointer-look.

For mobile:

```text
left virtual joystick = movement
drag screen = look
```

## 360

Support:

```text
drag = look around
pinch = zoom
hotspot = move to another scene
```

---

# 26. Collision

Start simple.

Use:

```text
three-mesh-bvh
```

for efficient mesh intersection.

Capabilities:

- prevent walking through walls.
- stay above floor.
- optional raycast-based floor detection.

Do not implement full rigid-body physics unless needed.

---

# 27. Hotspot Placement Mode

Builder workflow:

```text
Select "Add Hotspot"
        ↓
cursor becomes crosshair
        ↓
click geometry
        ↓
raycast returns intersection
        ↓
store world coordinates
        ↓
open hotspot editor
```

For 360:

```text
Select "Add Hotspot"
        ↓
click panorama
        ↓
convert direction to yaw/pitch
        ↓
store yaw/pitch
```

---

# 28. Painting / Artwork Popup

Provide an optional specialized hotspot type:

```text
ARTWORK
```

Fields:

```text
title
artist
year
description
image
audio
external_url
```

Example popup:

```text
┌──────────────────────────────┐
│ Portrait of Maria            │
│ Juan Example • 1928          │
│                              │
│ [Artwork image]              │
│                              │
│ This painting was created... │
│                              │
│ ▶ Play Audio Guide           │
│                              │
│ Learn More                   │
└──────────────────────────────┘
```

Do not make artwork a hard-coded concept in the renderer.

It is simply a specialized hotspot configuration.

---

# 29. Project Dashboard

Since there is no authentication, opening the application should directly show:

```text
Projects

[ + New Project ]

House Tour
Museum Demo
Store Demo
```

Project actions:

```text
Open
Preview
Publish
Duplicate
Delete
```

For a local/private deployment this is sufficient.

Authentication can be introduced later without changing the project model.

---

# 30. No Authentication Requirement

Do NOT implement:

```text
users
login
registration
JWT
OAuth
RBAC
password reset
sessions
```

for the MVP.

However:

Do not hardcode project ownership assumptions into the database.

A future nullable `owner_id` can be added later.

---

# 31. Security Even Without Authentication

Even without authentication:

- Validate file extensions.
- Validate actual MIME/content type.
- Limit upload size.
- Prevent path traversal.
- Never trust original filenames.
- Generate storage keys server-side.
- Sanitize user-provided HTML.
- Prefer Markdown/plain text instead of arbitrary HTML.
- Add CSP headers.
- Restrict iframe embedding behavior intentionally.
- Do not execute uploaded files.
- Use presigned storage URLs.
- Apply rate limits to destructive/publicly exposed endpoints if deployed publicly.

This application may initially be used on a trusted network, but avoid unsafe design choices.

---

# 32. Docker Development Environment

Create:

```text
compose.yml
```

Services:

```text
api
worker
postgres
minio
web
```

Example:

```text
Browser
   │
   ├── :5173 frontend
   │
   └── :8080 Go API

PostgreSQL :5432
MinIO      :9000
MinIO UI   :9001
```

Production can place the application behind:

```text
Nginx
Caddy
HAProxy
```

---

# 33. Recommended Supporting Tools

## 3D

```text
Blender
gltf-transform
gltfpack
KTX2 / Basis Universal
Meshopt
Draco
```

## Images

Use:

```text
libvips
```

preferred over ImageMagick for high-volume image processing.

Possible Go binding or execute CLI from worker.

Tasks:

```text
thumbnail generation
360 preview generation
image resizing
WebP conversion
```

## Video / Audio

Use:

```text
FFmpeg
```

for:

```text
audio normalization
video transcode
poster-frame generation
```

Do not build custom media encoders in Go.

Go should orchestrate established tools.

---

# 34. API Documentation

Maintain OpenAPI documentation.

Recommended:

```text
docs/openapi.yaml
```

Endpoints should be generated/documented consistently.

The web frontend should ideally use a generated TypeScript client later.

For MVP, a handwritten typed API wrapper is acceptable.

---

# 35. Logging

Use Go:

```go
log/slog
```

Log:

```text
request_id
method
path
status
duration
project_id
asset_id
job_id
```

Do not log:

```text
presigned URLs
secrets
full uploaded content
```

---

# 36. Configuration

Use environment variables.

Example:

```text
APP_ENV=development

HTTP_ADDR=:8080

DATABASE_URL=postgres://...

S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=virtual-tours
S3_REGION=us-east-1
S3_USE_SSL=false

PUBLIC_BASE_URL=http://localhost:5173
```

Create:

```text
.env.example
```

Never commit secrets.

---

# 37. Development Phases

## Phase 1 — Project Skeleton

Build:

```text
Go API
PostgreSQL
React frontend
Docker Compose
MinIO
```

Acceptance criteria:

- `docker compose up` starts the project.
- Browser displays project dashboard.
- API health check works.
- PostgreSQL connection works.
- MinIO bucket is available.

---

# Phase 2 — Projects

Implement:

```text
Create
List
Edit
Delete
```

Acceptance criteria:

User can create:

```text
Ancestral House
```

and open its project builder.

---

# Phase 3 — Uploads

Implement direct-to-S3 uploads.

Support:

```text
GLB
GLTF
JPG
PNG
WEBP
```

Acceptance criteria:

- Upload progress displayed.
- Asset shown after upload.
- File metadata saved.
- Invalid extensions rejected.

---

# Phase 4 — 3D Viewer

Implement GLB viewer.

Features:

```text
load GLB
camera
lights
environment
orbit debug controls
loading indicator
```

Acceptance criteria:

A capture team's GLB file can be opened in Chrome.

---

# Phase 5 — 3D Walkthrough

Add:

```text
WASD
mouse look
first-person camera
floor detection
basic wall collision
```

Acceptance criteria:

Visitor can walk through a model instead of only rotating around it.

---

# Phase 6 — 360 Viewer

Implement panoramic scenes.

Acceptance criteria:

A 2:1 equirectangular image appears as an immersive environment and can be viewed by dragging.

---

# Phase 7 — Scene Builder

Implement:

```text
create scene
rename
reorder
start scene
scene properties
```

Acceptance criteria:

Multiple uploaded models/panoramas can be arranged as tour scenes.

---

# Phase 8 — Navigation

Implement scene links.

Example:

```text
Living Room
    ↓
Kitchen
    ↓
Dining Room
```

Acceptance criteria:

Clicking a navigation hotspot loads the target scene.

---

# Phase 9 — Information Hotspots

Implement:

```text
INFO
ARTWORK
IMAGE
LINK
```

Acceptance criteria:

User can click an object/wall location and place a hotspot.

---

# Phase 10 — Media Hotspots

Implement:

```text
audio
video
image gallery
```

Acceptance criteria:

Artwork hotspot can include an audio guide and images.

---

# Phase 11 — Publish

Implement:

```text
publish
unpublish
slug
public viewer
```

Acceptance criteria:

```text
/t/{slug}
```

loads without access to builder controls.

---

# Phase 12 — Embed

Implement:

```text
/embed/{slug}
```

Acceptance criteria:

The tour works inside:

```html
<iframe>
```

on another webpage.

---

# Phase 13 — Asset Optimization

Implement worker pipeline.

Acceptance criteria:

Uploaded GLB may be transformed to optimized GLB.

Do this only after basic viewer functionality is stable.

---

# 38. MVP Definition

MVP is complete when the following works:

```text
1. Open application
2. Create "House Tour"
3. Upload house.glb
4. Open model
5. Walk through house
6. Add painting hotspot
7. Add painting title and description
8. Add another scene
9. Link rooms together
10. Preview
11. Publish
12. Copy public URL
13. Copy iframe embed code
14. Open embedded tour on another website
```

Also:

```text
1. Create another project
2. Upload 360 images
3. Arrange panoramas
4. Add navigation hotspots
5. Publish as a tour
```

---

# 39. Non-Goals for MVP

Do not build yet:

- Authentication.
- Multi-tenant permissions.
- Billing.
- Subscription plans.
- Native mobile application.
- Automated photogrammetry.
- AI reconstruction.
- Floor-plan generation.
- Full Unreal/Unity export.
- Real-time multiplayer.
- Multiplayer avatars.
- Gaussian Splat editing.
- VR headset support.
- WebXR.
- Advanced analytics.
- Complex CMS.
- Kubernetes deployment.

Keep the first version focused.

---

# 40. Performance Goals

Initial targets:

Desktop:

```text
60 FPS where reasonably possible
```

Mobile:

```text
30+ FPS
```

Viewer should provide:

- loading progress
- lazy asset loading
- asset caching
- texture compression when processed
- room/scene separation for large projects

Do not download all project scenes at startup.

Only load:

```text
current scene
+
small metadata for navigation
```

Load target scenes when needed.

---

# 41. Asset Size Guidance

Soft warnings:

```text
GLB > 100 MB   → warn
GLB > 300 MB   → strongly warn
Texture > 4096 → recommend optimization
Panorama > 8K  → consider alternate sizes
```

Do not hard-block large assets unless required.

The capture team's originals may be large.

Preserve original assets and create web-optimized derivatives.

---

# 42. Viewer Loading Strategy

For public tours:

```text
Load tour metadata
      ↓
Load start scene
      ↓
Display loading progress
      ↓
Enter tour
      ↓
Preload likely next scene
```

Do not preload every room.

---

# 43. Mobile Considerations

Must test:

```text
Chrome Android
Safari iPhone/iPad
Chrome Desktop
Edge Desktop
Firefox Desktop
```

Mobile viewer should have:

- large touch targets
- touch camera controls
- optional virtual joystick
- orientation-independent UI
- no hover-only actions

---

# 44. Future Features

Architecture should allow future support for:

```text
Gaussian Splats
WebXR / VR
guided tours
tour narration
floor plans
minimaps
analytics
tour templates
password-protected tours
custom branding
multiple organizations
CDN asset delivery
automatic model optimization
AI-generated hotspot descriptions
measurement tools
annotations
visitor analytics
lead forms
```

Do not implement them during the MVP unless necessary.

---

# 45. Codex Coding Instructions

Codex should:

1. Implement incrementally.
2. Keep Go as the primary backend language.
3. Prefer standard Go packages and small libraries.
4. Keep backend domain packages independent.
5. Use PostgreSQL migrations.
6. Use `sqlc` for SQL access.
7. Use `pgx` for PostgreSQL.
8. Use S3-compatible storage.
9. Use MinIO for local development.
10. Use React + TypeScript for frontend.
11. Use Three.js through React Three Fiber.
12. Use GLB as the preferred 3D runtime format.
13. Implement 360 scenes separately but behind a shared scene abstraction.
14. Keep hotspot behavior reusable across scene types.
15. Avoid authentication code.
16. Avoid unnecessary microservices.
17. Avoid Kubernetes.
18. Avoid Redis initially.
19. Keep asset processing in a separate Go worker executable.
20. Add tests for backend domain logic and API handlers.
21. Run formatting/linting/tests after meaningful changes.
22. Keep README and OpenAPI docs updated.
23. Never silently ignore processing errors.
24. Preserve original uploaded files.
25. Never mutate capture-team source assets.

---

# 46. Initial Repository Setup Task

Codex should start by creating:

```text
virtual-tour/
├── cmd/
│   ├── api/
│   └── worker/
├── internal/
├── db/
│   ├── migrations/
│   └── queries/
├── web/
├── docker/
├── docs/
├── compose.yml
├── .env.example
├── Makefile
├── go.mod
└── README.md
```

Initial services:

```text
api
worker
postgres
minio
web
```

Initial API:

```text
GET /health
GET /api/v1/projects
POST /api/v1/projects
GET /api/v1/projects/{id}
```

Initial frontend:

```text
/
    Project Dashboard

/projects/:id
    Project Builder

/t/:slug
    Public Viewer

/embed/:slug
    Embed Viewer
```

---

# 47. First Development Milestone

The first meaningful milestone should be deliberately small:

```text
Create Project
      ↓
Upload GLB
      ↓
Create 3D Scene
      ↓
Render GLB
      ↓
Walk inside it
```

Do not start hotspot editing, publishing, or media before this works reliably.

The second milestone:

```text
Upload multiple 360 images
      ↓
Create panorama scenes
      ↓
Connect them with navigation hotspots
```

The third milestone:

```text
Unified hotspot editor
      ↓
Preview
      ↓
Publish
      ↓
Embed
```

---

# 48. Architectural Principle

Treat the platform as a **tour authoring system**, not merely a 3D viewer.

The rendering engine should be replaceable.

The core model is:

```text
PROJECT
   │
   ├── ASSETS
   │
   └── SCENES
          │
          └── HOTSPOTS
                 │
                 ├── INFORMATION
                 ├── MEDIA
                 └── NAVIGATION
```

A scene renderer translates a scene into an immersive browser experience.

This makes the system flexible enough for:

```text
houses
real estate
museums
art galleries
hotels
schools
stores
offices
heritage buildings
factories
construction projects
```

without changing the underlying platform.
