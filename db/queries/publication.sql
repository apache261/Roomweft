-- name: PublishProjectUnchecked :one
UPDATE projects p SET published=true,updated_at=now() WHERE p.id=$1
AND EXISTS (SELECT 1 FROM scenes s WHERE s.id=p.start_scene_id AND s.project_id=p.id)
AND NOT EXISTS (SELECT 1 FROM scenes s LEFT JOIN assets a ON a.id=s.asset_id WHERE s.project_id=p.id AND
 NOT ((s.type='LAYOUT' AND s.layout_revision>0 AND s.layout->>'version'='1' AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.layout->'elements') e WHERE e->>'kind' IN ('ROOM','LOBBY','CORRIDOR','FLOOR')
 OR (e->>'kind'='INSTANCE' AND e->>'collidable'='true' AND CASE WHEN jsonb_typeof(e->'floor_meshes')='array' THEN jsonb_array_length(e->'floor_meshes') ELSE 0 END>0)))
 OR (a.upload_status='ready' AND ((s.type='3D' AND a.file_type='GLB') OR (s.type='PANORAMA' AND a.file_type='PANORAMA')))) IS TRUE)
AND NOT EXISTS (SELECT 1 FROM layout_asset_refs r JOIN assets a ON a.id=r.asset_id WHERE r.project_id=p.id AND (a.upload_status<>'ready' OR a.file_type<>'GLB'))
AND NOT EXISTS (SELECT 1 FROM scene_texture_refs r JOIN assets a ON a.id=r.asset_id WHERE r.project_id=p.id AND (a.upload_status<>'ready' OR a.file_type<>r.role))
AND NOT EXISTS (SELECT 1 FROM hotspots h WHERE h.project_id=p.id AND h.type='NAVIGATION' AND NOT EXISTS (SELECT 1 FROM scenes d WHERE d.id=h.destination_scene_id AND d.project_id=p.id AND d.id<>h.scene_id))
AND NOT EXISTS (SELECT 1 FROM hotspots h JOIN assets a ON a.id=h.image_asset_id WHERE h.project_id=p.id AND (a.upload_status<>'ready' OR a.file_type<>'IMAGE')) RETURNING p.*;
-- name: UnpublishProject :one
UPDATE projects SET published=false,updated_at=now() WHERE id=$1 RETURNING *;
-- name: GetPublicProject :one
SELECT * FROM projects WHERE slug=$1 AND published=true;
-- name: GetPublicAsset :one
SELECT a.* FROM assets a JOIN projects p ON p.id=a.project_id WHERE a.id=sqlc.arg(id) AND p.slug=sqlc.arg(slug) AND p.published=true AND a.upload_status='ready'
AND (EXISTS (SELECT 1 FROM scenes s WHERE s.project_id=p.id AND s.asset_id=a.id) OR EXISTS (SELECT 1 FROM hotspots h WHERE h.project_id=p.id AND h.image_asset_id=a.id) OR EXISTS (SELECT 1 FROM layout_asset_refs r WHERE r.project_id=p.id AND r.asset_id=a.id) OR EXISTS (SELECT 1 FROM scene_texture_refs r WHERE r.project_id=p.id AND r.asset_id=a.id));
-- name: GetPublicScene :one
SELECT s.* FROM scenes s JOIN projects p ON p.id=s.project_id WHERE s.id=sqlc.arg(id) AND p.slug=sqlc.arg(slug) AND p.published=true;
