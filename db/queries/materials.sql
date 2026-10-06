-- name: ClearSceneTextureRefs :exec
DELETE FROM scene_texture_refs WHERE scene_id=$1;
-- name: AddSceneTextureRef :execrows
INSERT INTO scene_texture_refs(scene_id,project_id,asset_id,role)
SELECT s.id,s.project_id,a.id,a.file_type FROM scenes s JOIN assets a ON a.project_id=s.project_id
WHERE s.id=$1 AND a.id=$2 AND a.file_type=$3 AND a.upload_status='ready'
ON CONFLICT DO NOTHING;
