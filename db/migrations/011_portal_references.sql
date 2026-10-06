CREATE TABLE scene_portal_refs (
 scene_id UUID NOT NULL,
 project_id UUID NOT NULL,
 portal_id UUID NOT NULL,
 destination_scene_id UUID NOT NULL,
 PRIMARY KEY (scene_id,portal_id),
 FOREIGN KEY (project_id,scene_id) REFERENCES scenes(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY (project_id,destination_scene_id) REFERENCES scenes(project_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX scene_portal_refs_destination_idx ON scene_portal_refs(destination_scene_id);
