ALTER TABLE scenes ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE scenes DROP CONSTRAINT scenes_type_check;
ALTER TABLE scenes ADD CONSTRAINT scenes_type_check CHECK (type IN ('3D','PANORAMA','LAYOUT'));
ALTER TABLE scenes ADD CONSTRAINT scenes_asset_kind_check CHECK ((type='LAYOUT' AND asset_id IS NULL) OR (type<>'LAYOUT' AND asset_id IS NOT NULL));
ALTER TABLE scenes ADD COLUMN layout JSONB NOT NULL DEFAULT '{}';
ALTER TABLE scenes ADD COLUMN layout_revision INTEGER NOT NULL DEFAULT 0 CHECK (layout_revision >= 0);
CREATE TABLE layout_asset_refs (
  scene_id UUID NOT NULL,
  project_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  PRIMARY KEY (scene_id,asset_id),
  FOREIGN KEY (project_id,scene_id) REFERENCES scenes(project_id,id) ON DELETE CASCADE,
  FOREIGN KEY (project_id,asset_id) REFERENCES assets(project_id,id) ON DELETE RESTRICT
);
CREATE INDEX layout_asset_refs_asset_idx ON layout_asset_refs(asset_id);
