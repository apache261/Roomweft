ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_file_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_file_type_check CHECK (file_type IN ('GLB','PANORAMA','IMAGE'));
CREATE UNIQUE INDEX IF NOT EXISTS assets_project_id_unique ON assets(project_id,id);
ALTER TABLE hotspots DROP CONSTRAINT IF EXISTS hotspots_type_check;
ALTER TABLE hotspots ADD CONSTRAINT hotspots_type_check CHECK (type IN ('NAVIGATION','INFO'));
ALTER TABLE hotspots ALTER COLUMN destination_scene_id DROP NOT NULL;
ALTER TABLE hotspots ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE hotspots ADD COLUMN IF NOT EXISTS external_link TEXT NOT NULL DEFAULT '';
ALTER TABLE hotspots ADD COLUMN IF NOT EXISTS image_asset_id UUID;
ALTER TABLE hotspots DROP CONSTRAINT IF EXISTS hotspots_content_check;
ALTER TABLE hotspots ADD CONSTRAINT hotspots_content_check CHECK (
 (type='NAVIGATION' AND destination_scene_id IS NOT NULL AND image_asset_id IS NULL AND description='' AND external_link='') OR
 (type='INFO' AND destination_scene_id IS NULL AND length(description)<=5000 AND length(external_link)<=2048));
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='hotspots_image_fk' AND conrelid='hotspots'::regclass) THEN
 ALTER TABLE hotspots ADD CONSTRAINT hotspots_image_fk FOREIGN KEY (project_id,image_asset_id) REFERENCES assets(project_id,id) ON DELETE RESTRICT;
 END IF;
END $$;
