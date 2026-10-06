-- name: CreateAsset :one
INSERT INTO assets (project_id, name, storage_key, size, file_type) VALUES ($1,$2,$3,$4,COALESCE(sqlc.narg(file_type)::text, 'GLB')) RETURNING *;
-- name: GetAsset :one
SELECT * FROM assets WHERE id=$1;
-- name: ListAssets :many
SELECT * FROM assets WHERE project_id=$1 ORDER BY created_at DESC, id;
-- name: CompleteAsset :one
UPDATE assets SET upload_status='ready' WHERE id=$1 RETURNING *;
-- name: DeleteAsset :execrows
DELETE FROM assets WHERE id=$1;
-- name: CreateScene :one
INSERT INTO scenes (project_id, asset_id, name, type, sort_order)
SELECT a.project_id,a.id,$3,CASE WHEN a.file_type='GLB' THEN '3D' ELSE 'PANORAMA' END,COALESCE((SELECT MAX(sort_order)+1 FROM scenes s WHERE s.project_id=$1),0)
FROM assets a WHERE a.project_id=$1 AND a.id=$2 AND a.upload_status='ready' AND a.file_type IN ('GLB','PANORAMA') RETURNING *;
-- name: ListScenes :many
SELECT * FROM scenes s WHERE s.project_id=$1 ORDER BY sort_order, created_at, id;
-- name: GetScene :one
SELECT * FROM scenes WHERE id=$1;
-- name: UpdateSceneCamera :one
UPDATE scenes SET start_camera=$2 WHERE id=$1 RETURNING *;
-- name: UpdateSceneSettings :one
UPDATE scenes SET settings=$2 WHERE id=$1 RETURNING *;
-- name: LockSceneHotspots :many
SELECT * FROM hotspots WHERE scene_id=$1 FOR UPDATE;
-- name: UpdateHotspotPosition :exec
UPDATE hotspots SET position=$2 WHERE id=$1;
