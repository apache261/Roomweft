ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_file_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_file_type_check CHECK (file_type IN ('GLB', 'PANORAMA'));
ALTER TABLE scenes DROP CONSTRAINT IF EXISTS scenes_type_check;
ALTER TABLE scenes ADD CONSTRAINT scenes_type_check CHECK (type IN ('3D', 'PANORAMA'));
CREATE UNIQUE INDEX IF NOT EXISTS scenes_project_id_unique ON scenes(project_id, id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_scene_id UUID;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_start_scene_fk' AND conrelid = 'projects'::regclass) THEN
        ALTER TABLE projects ADD CONSTRAINT projects_start_scene_fk FOREIGN KEY (id, start_scene_id)
            REFERENCES scenes(project_id, id) ON DELETE SET NULL (start_scene_id);
    END IF;
END $$;
UPDATE projects p SET start_scene_id=(SELECT s.id FROM scenes s WHERE s.project_id=p.id ORDER BY sort_order, created_at, id LIMIT 1)
WHERE start_scene_id IS NULL;

-- Serialise scene insertion with reorder/delete operations in the same project.
CREATE OR REPLACE FUNCTION prepare_scene() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM id FROM projects WHERE id=NEW.project_id FOR UPDATE;
    NEW.sort_order := COALESCE((SELECT MAX(sort_order)+1 FROM scenes WHERE project_id=NEW.project_id),0);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS scenes_prepare ON scenes;
CREATE TRIGGER scenes_prepare BEFORE INSERT ON scenes FOR EACH ROW EXECUTE FUNCTION prepare_scene();
CREATE OR REPLACE FUNCTION default_start_scene() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE projects SET start_scene_id=NEW.id WHERE id=NEW.project_id AND start_scene_id IS NULL;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS scenes_default_start ON scenes;
CREATE TRIGGER scenes_default_start AFTER INSERT ON scenes FOR EACH ROW EXECUTE FUNCTION default_start_scene();

CREATE TABLE IF NOT EXISTS hotspots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_id UUID NOT NULL,
    type TEXT NOT NULL DEFAULT 'NAVIGATION' CHECK (type = 'NAVIGATION'),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    position JSONB NOT NULL,
    destination_scene_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (destination_scene_id <> scene_id),
    FOREIGN KEY (project_id, scene_id) REFERENCES scenes(project_id, id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, destination_scene_id) REFERENCES scenes(project_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS hotspots_scene_idx ON hotspots(scene_id);
CREATE INDEX IF NOT EXISTS hotspots_destination_idx ON hotspots(destination_scene_id);
