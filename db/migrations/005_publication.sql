ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug TEXT NOT NULL DEFAULT ('tour-' || replace(gen_random_uuid()::text,'-',''));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_unique ON projects(slug);
