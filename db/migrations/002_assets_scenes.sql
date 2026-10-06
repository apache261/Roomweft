CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'GLB' CHECK (file_type = 'GLB'),
    storage_key TEXT NOT NULL UNIQUE,
    upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'ready')),
    size BIGINT NOT NULL CHECK (size BETWEEN 20 AND 104857600),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, id)
);
CREATE TABLE IF NOT EXISTS scenes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    type TEXT NOT NULL DEFAULT '3D' CHECK (type = '3D'),
    sort_order INTEGER NOT NULL DEFAULT 0,
    start_camera JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (project_id, asset_id) REFERENCES assets(project_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS assets_project_idx ON assets(project_id);
CREATE INDEX IF NOT EXISTS scenes_project_idx ON scenes(project_id);
