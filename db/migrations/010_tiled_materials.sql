ALTER TABLE assets DROP CONSTRAINT assets_file_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_file_type_check CHECK (file_type IN ('GLB','PANORAMA','IMAGE','TEXTURE_BASE_COLOR','TEXTURE_NORMAL','TEXTURE_ROUGHNESS'));
CREATE TABLE scene_texture_refs (
 scene_id UUID NOT NULL,
 project_id UUID NOT NULL,
 asset_id UUID NOT NULL,
 role TEXT NOT NULL CHECK (role IN ('TEXTURE_BASE_COLOR','TEXTURE_NORMAL','TEXTURE_ROUGHNESS')),
 PRIMARY KEY (scene_id,asset_id),
 FOREIGN KEY (project_id,scene_id) REFERENCES scenes(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY (project_id,asset_id) REFERENCES assets(project_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX scene_texture_refs_asset_idx ON scene_texture_refs(asset_id);
