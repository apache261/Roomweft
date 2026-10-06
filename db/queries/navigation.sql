-- name: LockProject :one
SELECT * FROM projects WHERE id=$1 FOR UPDATE;
-- name: SetStartScene :one
UPDATE projects p SET start_scene_id=sqlc.narg(scene_id)::uuid, updated_at=now()
WHERE p.id=$1 AND (sqlc.narg(scene_id)::uuid IS NULL OR EXISTS (SELECT 1 FROM scenes WHERE id=sqlc.narg(scene_id)::uuid AND project_id=$1)) RETURNING p.*;
-- name: EditScene :one
UPDATE scenes SET name=COALESCE(sqlc.narg(name)::text, name), start_camera=CASE WHEN sqlc.arg(save_camera)::boolean THEN sqlc.arg(camera)::jsonb ELSE start_camera END WHERE id=sqlc.arg(id) RETURNING *;
-- name: SwapSceneOrder :exec
UPDATE scenes SET sort_order=CASE WHEN id=sqlc.arg(first_id)::uuid THEN sqlc.arg(second_order)::int ELSE sqlc.arg(first_order)::int END WHERE id IN (sqlc.arg(first_id)::uuid,sqlc.arg(second_id)::uuid);
-- name: RemoveScene :execrows
DELETE FROM scenes WHERE id=$1;
-- name: GetHotspot :one
SELECT * FROM hotspots WHERE id=$1;
-- name: CreateHotspot :one
INSERT INTO hotspots (project_id,scene_id,type,title,position,destination_scene_id,description,external_link,image_asset_id)
SELECT s.project_id,s.id,sqlc.arg(type),sqlc.arg(title),sqlc.arg(position),sqlc.narg(destination)::uuid,sqlc.arg(description),sqlc.arg(external_link),sqlc.narg(image)::uuid
FROM scenes s WHERE s.id=sqlc.arg(scene_id)
AND (sqlc.narg(destination)::uuid IS NULL OR EXISTS (SELECT 1 FROM scenes d WHERE d.id=sqlc.narg(destination)::uuid AND d.project_id=s.project_id AND d.id<>s.id))
AND (sqlc.narg(image)::uuid IS NULL OR EXISTS (SELECT 1 FROM assets a WHERE a.id=sqlc.narg(image)::uuid AND a.project_id=s.project_id AND a.file_type='IMAGE' AND a.upload_status='ready')) RETURNING *;
-- name: UpdateHotspot :one
UPDATE hotspots h SET type=sqlc.arg(type),title=sqlc.arg(title),position=sqlc.arg(position),destination_scene_id=sqlc.narg(destination)::uuid,description=sqlc.arg(description),external_link=sqlc.arg(external_link),image_asset_id=sqlc.narg(image)::uuid
WHERE h.id=sqlc.arg(id)
AND (sqlc.narg(destination)::uuid IS NULL OR EXISTS (SELECT 1 FROM scenes d WHERE d.id=sqlc.narg(destination)::uuid AND d.project_id=h.project_id AND d.id<>h.scene_id))
AND (sqlc.narg(image)::uuid IS NULL OR EXISTS (SELECT 1 FROM assets a WHERE a.id=sqlc.narg(image)::uuid AND a.project_id=h.project_id AND a.file_type='IMAGE' AND a.upload_status='ready')) RETURNING *;
-- name: ListHotspots :many
SELECT * FROM hotspots WHERE scene_id=$1 ORDER BY created_at,id;
-- name: DeleteHotspot :execrows
DELETE FROM hotspots WHERE id=$1;
-- name: PatchProject :one
UPDATE projects p SET name=COALESCE(sqlc.narg(name)::text,name), description=COALESCE(sqlc.narg(description)::text,description),
start_scene_id=CASE WHEN sqlc.arg(set_start)::boolean THEN sqlc.narg(start_scene_id)::uuid ELSE start_scene_id END, updated_at=now()
WHERE p.id=sqlc.arg(id) AND (NOT sqlc.arg(set_start)::boolean OR EXISTS (SELECT 1 FROM scenes s WHERE s.id=sqlc.narg(start_scene_id)::uuid AND s.project_id=p.id)) RETURNING p.*;
