# Practice house

Original low-poly models generated for this project. You may use, change and redistribute these assets. No downloaded models, textures or external dependencies.

| File | Room size | Assembled position X, Y, Z |
| --- | --- | --- |
| lobby.glb | 4 × 6 m | 0, 0, 0 |
| room-1.glb | 4 × 3 m | −4, 0, −1.5 |
| room-2.glb | 4 × 3 m | −4, 0, 1.5 |
| kitchen.glb | 4 × 4 m | 4, 0, −1 |
| cr.glb | 3 × 2 m | 3.5, 0, 2 |
| house-assembled.glb | All five rooms | Already positioned |

All files use metres, Y up, scale 1 and rotation 0°. Each individual prefab starts at its room center, with the floor surface at Y = 0. Walls are 2.8 m high. Doorways are 1.4 m wide and 2.2 m high. There are no roofs or door leaves, so you can see and practice moving through openings. Named floors, walls and furniture are separate mesh nodes. The viewer displays spaces in mesh names as underscores. UVs are included for material practice; colors need no texture files. Furniture is deliberately simple and collides like other imported geometry.

The pack includes muted, matte colors for easier viewing: sand walls and oak-colored floors in the lobby, dusty blue in Room 1, sage in Room 2, olive walls with clay-colored floors in the kitchen, and teal in the CR. Walnut furniture, colored bedding, sage kitchen cabinets and a charcoal countertop give the surfaces contrast. Colors are embedded in every individual GLB and the assembled house; no texture uploads are needed. `preview.png` shows the colored house. Re-upload the updated GLBs to use these colors in an existing project, and clear any scene-wide tint or assigned surface material that overrides the embedded colors.

## Optional room with a rotating ceiling fan

`room-fan.glb` is a 4 × 3 m bedroom with colored walls, a bed, wardrobe and four-blade ceiling fan. It includes a looping GLB rotation clip (one revolution every 1.6 seconds). The viewer plays embedded animations in standalone model scenes, imported layout modules, preview, public tours and embeds. Rebuild the frontend to enable playback in an older running editor.

See `fan-room-preview.png` for the room and fan.

To use it in the five-room assembly, upload `room-fan.glb` and place it **instead of Room 1** at X = −4, Z = −1.5, rotation 0°, scale 1. Or align it west of the lobby with doorway offset −1.5 m. Select **Fan_room_Floor** in **Choose floor meshes**, apply the selection, and save the layout. Approve the lobby floor too. Do not place it over an existing bedroom. The original five rooms and `house-assembled.glb` remain available as before.

The blades sit at Y = 2.34 m, above walking head height. This is a visual animation; walking collisions use the initial model geometry. Animated doors or moving platforms need additional collision handling.

## Optional room with small stairs and a raised floor

`room-stairs.glb` is a 4 × 3 m room with a flat entrance, three broad steps and a raised landing at Y = 0.45 m. Each step rises 0.15 m and has a 0.5 m tread. Blue walls, alternating oak/clay steps and a sage landing make the changes in height easy to see. There is no furniture blocking the stairs.

See `stairs-room-preview.png` for an overhead view.

Upload it and place it **instead of Room 1** at X = −4, Z = −1.5, rotation 0°, scale 1, or align it west of the lobby with doorway offset −1.5 m. Its east doorway stays at Y = 0, matching the lobby. Do not overlap an existing room.

In **Choose floor meshes**, search for `_Floor` and select all five: **Stairs_room_Floor**, **Stairs_room_Step_1_Floor**, **Stairs_room_Step_2_Floor**, **Stairs_room_Step_3_Floor** and **Stairs_room_Raised_Floor**. Apply the selection and save the layout. Approve the lobby floor too. Walk west from the doorway to climb, and east to descend. The default **Step height** of 0.25 m supports these steps at scale 1.

For a standalone 3D scene, approve the same five meshes in a walking region and click **Fit area to selected floors**. Its bounds are left −2, right 2, top −1.5, bottom 1.5, min Y −0.01 and max Y 0.46. Save changes before walking. You can save a start view on the lower floor or raised landing. Changing model scale also changes the step sizes.

The original assembled house remains the five-room version. Regenerating the pack includes this optional stairs room in `practice-house.zip`.

## First exercise: walk through the whole house

If your running editor shows **Build layout** instead of **+ New scene**, it is using the older UI. To import these models there, expand the asset library, choose **Upload GLB**, select the file, and then click **Create scene** beside the uploaded asset. **Build layout** creates generated rooms and does not import a GLB.

For Docker Compose, update the frontend from the repository root with `docker compose up -d --build --no-deps web`, then reload the browser. Use `sudo` if your account requires it to access Docker.

1. Create a project called “Practice house.”
2. Choose **+ New scene → 3D model**, name it “My house,” and upload **house-assembled.glb**.
3. Open **Walking → Add walking region**. A top-down map lets you draw the area without typing coordinates.
4. Click **Choose floor meshes** to open the **Approved floor meshes** dialog. Search for `_Floor`, select the five meshes named **Lobby_Floor**, **Room_1_Floor**, **Room_2_Floor**, **Kitchen_Floor** and **CR_(bathroom)_Floor**. Use the checkboxes or **Select shown**, then click **Apply selection**. Cancel or Escape discards changes. Leave furniture and walls unselected.
5. Click **Fit area to selected floors** to fill the boundaries and flat-floor height range automatically. For this house, the result is left **−6**, right **6**, top **−3**, bottom **3**, min Y **−0.01**, max Y **0.01**. To make a smaller area, choose **Draw area** and drag a rectangle on the map; drawing preserves the height range. Then click **Save changes → Walk inside**. Use WASD and mouse look, or the movement buttons. Start from the clear lobby, then practice using each doorway.
6. Move near the entrance and **Save start view**. Add information hotspots and try changing materials.

The model has connected floors and aligned doorways. The reviewed region covers the floor footprint; walls and furniture still block movement. The smaller CR does not fill the footprint's southeast corner, and there is no floor outside the entrance, so unsupported areas remain unwalkable.

## Second exercise: separate scenes

Upload each individual GLB through **+ New scene → 3D model**. Review its floor, walk inside and save its start view. Use these walking-region bounds:

| Model | Left | Right | Top | Bottom |
| --- | --- | --- | --- | --- |
| Lobby | −2 | 2 | −3 | 3 |
| Room 1 / Room 2 | −2 | 2 | −1.5 | 1.5 |
| Kitchen | −2 | 2 | −2 | 2 |
| CR | −1.5 | 1.5 | −1 | 1 |

Select only that room's Floor mesh and click **Fit area to selected floors**. You can also enter the reference bounds above and use min Y **−0.01**, max Y **0.01**. In the lobby, place Navigation hotspots by the four room doorways. Select each destination scene; add return hotspots in those rooms. Scene navigation switches models; it does not stitch them into a continuous space.

## Third exercise: assemble the parts yourself

In Blender or another glTF editor, import the five individual GLBs. Move each room's root object to the coordinates in the first table; keep scale 1 and rotation 0°. Inspect the doorway alignment, then export the five rooms together as one GLB. Upload that file and repeat the first exercise. You can also assemble these same parts directly in the web editor using the exercise below.

Open **floor-plan.svg** for the arrangement. **placement.json** contains machine-readable dimensions, positions and door offsets. Regenerate the pack from the repository root with `python3 scripts/make-house-prefabs.py`.

## Fourth exercise: assemble rooms in the web editor

1. Choose **+ New scene → Layout**. Under **Starting layout**, choose **Imported rooms — assemble GLB parts**, name it “My assembled house,” and click **Build layout**.
2. Expand **Asset library** and upload the five individual GLBs. Keep this one assembly scene selected; you do not need to create separate scenes for each uploaded file.
3. In **Plan → Add imported rooms, furniture or decoration**, click **Place lobby.glb**. The first part starts at X/Z = 0.
4. Under **Imported room assembly**, click **Choose floor meshes**, search for `_Floor`, select that module's floor and **Apply selection**. Repeat this floor review when placing each remaining room.
5. For each new room, choose **lobby** in **Align with room**, enter the doorway offset below, then click the indicated alignment button. These offsets match the prefab openings:

| Module | Alignment | Doorway offset |
| --- | --- | --- |
| Room 1 | Align west | −1.5 m |
| Room 2 | Align west | 1.5 m |
| Kitchen | Align east | −1 m |
| CR | Align east | 2 m |

6. Inspect the open doorways in 3D. Use **Position X/Z** and **Instance rotation** to adjust other models. The floor plan displays each imported module's actual footprint. Dragging, Undo/Redo and duplication work for modules too.
7. **Save changes → Walk inside → Save start view**. Preview or publish this single scene to walk continuously between the rooms.

Imported modules use Y up and metre units. Floor review follows the module's position, rotation and scale. Only selected meshes supply standing surfaces; unreviewed imports remain obstacles/decoration. Keep the collision checkbox enabled for rooms. Aligning edges moves models; it does not cut doorways into a solid wall. This workflow currently requires room exports with matching floor elevations and existing openings.

This feature updates both the frontend and API. Run `./deploy.sh up` from the repository root, then reload the browser.
