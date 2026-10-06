# Baked lighting and provisional HQ shadows

Phase 7 adds reviewed external lightmaps and AO to the shared builder, preview, public and embed renderer. Existing PBR materials and the RoomEnvironment reflection environment remain available at every quality tier. Device budgets in `performance-budgets.json` are still unestablished: realtime shadows are an explicit HQ option with soft limits, and screen-space AO and additional postprocessing remain disabled.

## Authoring baked maps

1. Prepare a static imported GLB with a separate, non-overlapping second UV atlas (`TEXCOORD_1`, Three.js `uv1`). Generated template floors and walls currently lack a reviewed atlas and cannot accept external baked maps.
2. Bake indirect illumination outside this application. Exclude the runtime directional key light from the lightmap. Upload the result as `TEXTURE_LIGHTMAP`, encoded as an sRGB image with GLTF atlas orientation (sampler `flipY=false`). Upload AO as `TEXTURE_AO`, with linear occlusion in the red channel. Avoid applying AO twice if it is already included in the lightmap.
3. Select the maps in a material preset, assign it to an eligible static surface, inspect the authored result, and select **Review baked maps for current scene**. Save the scene. The review action records a revision; it does not validate the visual correctness of the atlas or generate a bake.
4. After geometry, model transforms, material assignments/properties, bake asset selections, light intensity, environment intensity, tint or roughness change, regenerate or review appropriate maps. Until reviewed again, external baked maps are disabled and their images are excluded from texture downloads. Exposure, quality selection and the dynamic-shadow toggle do not invalidate a bake.

The revision includes immutable source identity or manifest source hash and the relevant scene configuration. It is a deterministic authoring revision key, not a cryptographic integrity signature. Existing runtime asset integrity checks remain separate. Review stamps are persisted with material presets; the API validates texture roles, ready status and project ownership, and publication keeps the referenced assets protected from deletion. Migration `013_baked_lighting.sql` adds the two upload/reference roles. The existing texture worker supplies image tiers; it does not compute illumination.

External lightmaps replace ambient, hemisphere, probe and environment **diffuse** contributions on eligible materials. Environment **specular reflections** and the direct directional light remain active. This separation requires an indirect-only bake. Lightmaps use untiled, clamped UV1 samplers with sRGB decoding; AO uses linear UV1 samplers. Base-color, normal and roughness maps retain their existing UV/tile settings.

Missing/invalid UV1, stale stamps, moving animation subtrees, skinned meshes and morph targets fall back to existing lighting. External lightmaps require stock `MeshStandardMaterial` shading and a valid map on every submaterial of a mesh; custom shader hooks and partially mapped material arrays fall back. Native GLTF occlusion/lightmap inputs are preserved when no reviewed external map applies. Applying or removing external maps restores the previous materials and disposes owned sampler clones without disposing shared source assets.

## Realtime shadows

Enable **Moving-object shadows in HQ** in scene appearance settings and select HQ. The setting defaults off and is saved with the scene. Auto uses its committed quality tier for effects; a temporary resolution trial does not toggle the shadow pass.

The provisional policy uses one directional light, a 1024 × 1024 PCF shadow map, a camera-following orthographic footprint of ±8 scene units and depth range 0.1–40. It selects nearby moving meshes from actual animation tracks, skinned meshes and morph targets, with at most 24 casters and 50,000 caster triangles. Static resident geometry can receive shadows. Devices require a maximum texture size of at least 4096 and, when reported, more than four logical cores and more than 4 GB device memory. These capability gates and limits are conservative heuristics, not measured production budgets.

Phase 6 treats shadows as requiring all room contributors, so opted-in HQ shadows can increase model residency and remove streaming's memory savings. The pass waits while contributors are unavailable. A scene with no eligible nearby actors creates no shadow target. Downgrading quality removes the pass and releases its targets while preserving camera position. Mesh flags are restored when models leave the scene or the feature is disabled. Tall or multilevel scenes and shadow bias/footprint transitions still require visual review.

Development diagnostics (`?perf=1`) include reviewed/stale/missing-UV bake counts, moving-mesh exclusions, the shadow policy, caster count and triangles, contributor readiness and estimated shadow texture bytes. The 8 MiB map estimate is a proxy, not measured VRAM. `?hq=0` disables the new external bake and shadow paths for fallback comparisons.

## Validation and remaining acceptance

Run `npm run test:hq-rendering` from `web`, with `TOUR_ORIGIN` pointing to the source frontend. The browser fixture exercises all four viewer modes and three manual tiers, invalidation, fallback, bounded fan shadows, quality downgrade and repeated bake cleanup. Its generated UV1 fixture establishes mechanics, not a production atlas or photorealistic reference.

[Phase 7 HQ evidence](performance-baselines/phase7-hq-rendering.json) records Chromium SwiftShader results: baked output is unchanged when ambient intensity changes, unbaked output responds, and 12 apply/render/dispose cycles retain a stable texture count. A small isolated fixture grows from 2 to 3 draw calls and 14 to 26 triangles with a 1024 shadow map; these are fixture pass costs, not FPS improvements. The integrated fan scene selects five casters totaling 60 triangles and releases the pass on Low while preserving its pose.

Frontend build and 71 unit tests, Go tests with PostgreSQL integration and `go vet`, quality checks, six benchmark scenes and room-streaming browser checks pass. The existing fan-animation and runtime-asset browser regressions also pass across their viewer modes, including compressed animation, KTX2 decoding, quality pose preservation and failed/corrupt asset fallbacks.

Final acceptance still needs reviewed static bake references, actual uploaded atlases, physical-device sustained walkthroughs, measured frame-time/memory budgets, shadow transitions and visual comparisons. The previously reproduced public courtyard-exit regression remains tracked in the phase plan. No automatic baking or offline screenshot/panorama job is included; offline rendering remains conditional on a separate product requirement.
