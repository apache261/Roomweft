-- name: CreateLayoutScene :one
INSERT INTO scenes(project_id,name,type,layout,layout_revision) VALUES ($1,$2,'LAYOUT',$3,1) RETURNING *;
-- name: SaveLayoutDocument :one
UPDATE scenes SET layout=$2,layout_revision=layout_revision+1,start_camera='{}' WHERE id=$1 AND type='LAYOUT' RETURNING *;
-- name: ClearLayoutAssetRefs :exec
DELETE FROM layout_asset_refs WHERE scene_id=$1;
-- name: AddLayoutAssetRef :execrows
INSERT INTO layout_asset_refs(scene_id,project_id,asset_id)
SELECT s.id,s.project_id,a.id FROM scenes s JOIN assets a ON a.project_id=s.project_id
WHERE s.id=$1 AND a.id=$2 AND a.file_type='GLB' AND a.upload_status='ready'
ON CONFLICT DO NOTHING;
