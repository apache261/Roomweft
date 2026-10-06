package database

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"testing"
	"time"
	"virtual-tour/db"
)

func TestStorageRetirementDatabaseLifecycle(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL for retirement triggers, reference protection and cascades")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("retirement_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE")
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
	if err = db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	q := New(pool)
	project, err := q.CreateProject(ctx, CreateProjectParams{Name: "Retirement test"})
	if err != nil {
		t.Fatal(err)
	}
	asset, err := q.CreateAsset(ctx, CreateAssetParams{ProjectID: project.ID, Name: "model", StorageKey: "original.glb", Size: 100, FileType: pgtype.Text{String: "GLB", Valid: true}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = q.CompleteAsset(ctx, asset.ID); err != nil {
		t.Fatal(err)
	}
	manifest, _ := json.Marshal(map[string]any{"variants": map[string]any{"low": map[string]string{"key": "old.glb"}}})
	if _, err = pool.Exec(ctx, `INSERT INTO asset_derivatives(asset_id,version,state,manifest) VALUES($1,'runtime-v1','ready',$2)`, asset.ID, manifest); err != nil {
		t.Fatal(err)
	}
	if err = q.QueueStorageRetirement(ctx, "old.glb"); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE storage_retirements SET retire_after=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	if _, err = q.ClaimStorageRetirement(ctx); err != pgx.ErrNoRows {
		t.Fatalf("current manifest must protect its payload: %v", err)
	}
	manifest, _ = json.Marshal(map[string]any{"variants": map[string]any{"low": map[string]string{"key": "new.glb"}}})
	if _, err = pool.Exec(ctx, `UPDATE asset_derivatives SET manifest=$2 WHERE asset_id=$1`, asset.ID, manifest); err != nil {
		t.Fatal(err)
	}
	if _, err = q.ClaimStorageRetirement(ctx); err != pgx.ErrNoRows {
		t.Fatalf("retired payload must honor signed URL grace: %v", err)
	}
	if _, err = pool.Exec(ctx, `UPDATE storage_retirements SET retire_after=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	key, err := q.ClaimStorageRetirement(ctx)
	if err != nil || key != "old.glb" {
		t.Fatalf("claim: %s %v", key, err)
	}
	if _, err = q.ClaimStorageRetirement(ctx); err != pgx.ErrNoRows {
		t.Fatal("leased deletion claimed twice")
	}
	if err = q.FinishStorageRetirement(ctx, key, "offline"); err != nil {
		t.Fatal(err)
	}
	if _, err = q.ClaimStorageRetirement(ctx); err != pgx.ErrNoRows {
		t.Fatal("failed deletion did not back off")
	}
	if err = q.FinishStorageRetirement(ctx, key, ""); err != nil {
		t.Fatal(err)
	}
	if _, err = q.DeleteProject(ctx, project.ID); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM storage_retirements WHERE storage_key IN ('original.glb','new.glb')`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("cascade did not retire original and derivative: %d %v", count, err)
	}
}
