package httpapi

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"path/filepath"
	"testing"
	"virtual-tour/db"
	"virtual-tour/internal/database"
)

func TestLayoutMigrationPreservesImportedScenes(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "layout_migration_" + fmt.Sprintf("%x", uuid.New())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err = pool.Exec(ctx, "CREATE TABLE schema_migrations(path TEXT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob("../../db/migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if filepath.Base(file) >= "008" {
			break
		}
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(raw)); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		if _, err = pool.Exec(ctx, "INSERT INTO schema_migrations VALUES ($1)", "migrations/"+filepath.Base(file)); err != nil {
			t.Fatal(err)
		}
	}
	project, asset, scene := uuid.New(), uuid.New(), uuid.New()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO projects(id,name) VALUES ($1,'Original tour')", []any{project}},
		{"INSERT INTO assets(id,project_id,name,storage_key,size,upload_status) VALUES ($1,$2,'original.glb','original-key',20,'ready')", []any{asset, project}},
		{`INSERT INTO scenes(id,project_id,asset_id,name,start_camera) VALUES ($1,$2,$3,'Original scene','{"position":[0,1.65,0],"yaw":0,"pitch":0}')`, []any{scene, project, asset}},
		{`INSERT INTO hotspots(project_id,scene_id,type,title,position) VALUES ($1,$2,'INFO','Original marker','{"x":0,"y":1.5,"z":1}')`, []any{project, scene}},
	} {
		if _, err = pool.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	if err = db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	q := database.New(pool)
	var id pgtype.UUID
	_ = id.Scan(scene.String())
	loaded, err := q.GetScene(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Type != "3D" || !loaded.AssetID.Valid || loaded.LayoutRevision != 0 || string(loaded.Layout) != "{}" || string(loaded.StartCamera) == "{}" {
		t.Fatalf("imported scene changed: %+v", loaded)
	}
	hotspots, err := q.ListHotspots(ctx, id)
	if err != nil || len(hotspots) != 1 || hotspots[0].Title != "Original marker" {
		t.Fatal(hotspots, err)
	}
	if _, err = pool.Exec(ctx, "INSERT INTO scenes(project_id,name,type) VALUES ($1,'Invalid import','3D')", project); err == nil {
		t.Fatal("import without an asset accepted")
	}
	if _, err = pool.Exec(ctx, `INSERT INTO scenes(project_id,name,type,layout,layout_revision) VALUES ($1,'New layout','LAYOUT','{"version":1,"elements":[],"doors":[]}',1)`, project); err != nil {
		t.Fatal(err)
	}
}
