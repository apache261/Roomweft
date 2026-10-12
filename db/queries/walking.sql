-- name: ClearPortalRefs :exec
DELETE FROM scene_portal_refs WHERE scene_id=$1;
-- name: AddPortalRef :execrows
INSERT INTO scene_portal_refs(scene_id,project_id,portal_id,destination_scene_id)
SELECT s.id,s.project_id,$3,d.id FROM scenes s JOIN scenes d ON d.project_id=s.project_id
WHERE s.id=$1 AND d.id=$2 AND d.type IN ('3D','LAYOUT');
