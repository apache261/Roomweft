package httpapi

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
	"time"
	"virtual-tour/db"
	"virtual-tour/internal/database"
)

func TestDerivativeQueuePublicationAndPrivateFallback(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "derivatives_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	config, _ := pgxpool.ParseConfig(url)
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	q := database.New(pool)
	handler := New(q, pool.Ping, &publicationObjects{})
	project, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Derivative lifecycle"})
	if err != nil {
		t.Fatal(err)
	}
	asset, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: project.ID, Name: "house.glb", StorageKey: project.ID.String() + "/source.glb", Size: 100, FileType: pgtype.Text{String: "GLB", Valid: true}})
	if err != nil {
		t.Fatal(err)
	}
	asset, err = q.CompleteAsset(ctx, asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/assets/" + asset.ID.String()
	if result := call(handler, "POST", path+"/process", ""); result.Code != 202 {
		t.Fatalf("queue: %s", result.Body.String())
	}
	job, err := q.ClaimDerivative(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = q.ClaimDerivative(ctx); err != pgx.ErrNoRows {
		t.Fatalf("duplicate claim: %v", err)
	}
	before := call(handler, "GET", path, "")
	if strings.Contains(before.Body.String(), "\"manifest\"") {
		t.Fatal("partial manifest exposed")
	}
	if _, err = pool.Exec(ctx, `UPDATE asset_derivatives SET lease_until=now()-interval '1 second' WHERE asset_id=$1`, asset.ID); err != nil {
		t.Fatal(err)
	}
	replacement, err := q.ClaimDerivative(ctx)
	if err != nil {
		t.Fatal(err)
	}
	manifest := []byte(`{"version":"runtime-v1","source_sha256":"` + strings.Repeat("a", 64) + `","variants":{"low":{"key":"private/low.glb"},"balanced":{"key":"private/balanced.glb"},"hq":{"key":"private/hq.glb"}},"collision":{"key":"private/collision.glb"}}`)
	if published, err := q.FinishDerivative(ctx, job, manifest, ""); err != nil || published {
		t.Fatalf("stale worker published: %v %v", published, err)
	}
	if published, err := q.FinishDerivative(ctx, replacement, nil, "validation failed; retry"); err != nil || !published {
		t.Fatal(err)
	}
	failed := call(handler, "GET", path, "")
	if !strings.Contains(failed.Body.String(), "validation failed") {
		t.Fatal("missing actionable failure")
	}
	if result := call(handler, "POST", path+"/process", ""); result.Code != 202 {
		t.Fatal("retry failed")
	}
	job, err = q.ClaimDerivative(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if published, err := q.FinishDerivative(ctx, job, manifest, ""); err != nil || !published {
		t.Fatal(err)
	}
	ready := call(handler, "GET", path, "")
	var response struct {
		URL     string              `json:"url"`
		Runtime database.Derivative `json:"runtime"`
	}
	if err = json.Unmarshal(ready.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.URL == "" || response.Runtime.State != "ready" || strings.Contains(string(response.Runtime.Manifest), `"key"`) {
		t.Fatal("original fallback or private delivery missing")
	}
	if _, err = q.CreateScene(ctx, database.CreateSceneParams{ProjectID: project.ID, ID: asset.ID, Name: "House"}); err != nil {
		t.Fatal(err)
	}
	public := "/api/v1/public/tours/" + project.Slug + "/assets/" + asset.ID.String()
	if r := call(handler, "GET", public, ""); r.Code != 404 {
		t.Fatal("unpublished derivatives exposed")
	}
	if _, err = q.PublishProject(ctx, project.ID); err != nil {
		t.Fatal(err)
	}
	if r := call(handler, "GET", public, ""); r.Code != 200 || !strings.Contains(r.Body.String(), "fresh=") || strings.Contains(r.Body.String(), `"key"`) {
		t.Fatalf("public manifest: %s", r.Body.String())
	}
	original, err := q.GetAsset(ctx, asset.ID)
	if err != nil || original.StorageKey != asset.StorageKey || original.UploadStatus != "ready" {
		t.Fatal("source changed")
	}
	if _, err = q.UnpublishProject(ctx, project.ID); err != nil {
		t.Fatal(err)
	}
	if r := call(handler, "GET", public, ""); r.Code != 404 {
		t.Fatal("unpublished URL refresh allowed")
	}
}
