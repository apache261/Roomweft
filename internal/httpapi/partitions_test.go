package httpapi

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"virtual-tour/db"
	"virtual-tour/internal/chunking"
	"virtual-tour/internal/database"
)

type partitionObjects struct {
	publicationObjects
	source    string
	downloads int
}

func (o *partitionObjects) Download(_ context.Context, _ string, target string, _ int64) error {
	o.downloads++
	bytes, err := os.ReadFile(o.source)
	if err != nil {
		return err
	}
	return os.WriteFile(target, bytes, 0600)
}
func TestPartitionPersistenceInventoryAndCAS(t *testing.T) {
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
	schema := "partitions_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	p, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Partition review"})
	if err != nil {
		t.Fatal(err)
	}
	source, _ := filepath.Abs("../../tests/testdata/chunking/giant-static.glb")
	stat, _ := os.Stat(source)
	asset, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: p.ID, Name: "static.glb", StorageKey: "private/static.glb", Size: stat.Size(), FileType: pgtype.Text{String: "GLB", Valid: true}})
	if err != nil {
		t.Fatal(err)
	}
	asset, err = q.CompleteAsset(ctx, asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	script, _ := filepath.Abs("../../asset-tools/process.mjs")
	t.Setenv("ASSET_PROCESSOR_SCRIPT", script)
	objects := &partitionObjects{source: source}
	handler := New(q, pool.Ping, objects)
	route := "/api/v1/assets/" + asset.ID.String() + "/partition"
	result := call(handler, "GET", route, "")
	if result.Code != 200 || !strings.Contains(result.Body.String(), "complete original") {
		t.Fatal(result.Body.String())
	}
	result = call(handler, "POST", route+"/inventory", "")
	if result.Code != 200 {
		t.Fatalf("inventory: %d %s", result.Code, result.Body.String())
	}
	var initial database.AssetPartition
	if err = json.Unmarshal(result.Body.Bytes(), &initial); err != nil {
		t.Fatal(err)
	}
	var inventory chunking.Inventory
	var document chunking.Partition
	_ = chunking.Decode(initial.Inventory, &inventory)
	_ = chunking.Decode(initial.Document, &document)
	if initial.Revision != 0 || document.Policy != "complete" || document.Validate(inventory) != nil {
		t.Fatal("invalid initial conservative review")
	}
	document.Policy = "reviewed-rooms"
	document.GlobalNodes = []string{}
	document.Rooms = []chunking.Room{{ID: "static-room", Name: "Static source group", Bounds: inventory.Bounds, NodePaths: []string{inventory.Nodes[1].Path}}}
	body, _ := json.Marshal(map[string]any{"revision": initial.Revision, "source_sha256": initial.SourceHash, "document": document})
	result = call(handler, "PUT", route, string(body))
	if result.Code != 200 {
		t.Fatalf("save: %d %s", result.Code, result.Body.String())
	}
	var saved database.AssetPartition
	_ = json.Unmarshal(result.Body.Bytes(), &saved)
	if saved.Revision != 1 {
		t.Fatal("review did not increment revision")
	}
	if result = call(handler, "PUT", route, string(body)); result.Code != 409 {
		t.Fatal("stale revision accepted")
	}
	// A same-source refresh does not overwrite the authored groups or revision.
	result = call(handler, "POST", route+"/inventory", "")
	if result.Code != 200 {
		t.Fatal(result.Body.String())
	}
	var refreshed database.AssetPartition
	_ = json.Unmarshal(result.Body.Bytes(), &refreshed)
	if refreshed.Revision != 1 || string(refreshed.Document) != string(saved.Document) {
		t.Fatal("refresh overwrote source ownership")
	}
	bad := document
	bad.GlobalNodes = []string{inventory.Nodes[1].Path}
	body, _ = json.Marshal(map[string]any{"revision": 1, "source_sha256": initial.SourceHash, "document": bad})
	if result = call(handler, "PUT", route, string(body)); result.Code != 400 {
		t.Fatal("duplicate source owners accepted")
	}
	body, _ = json.Marshal(map[string]any{"revision": 1, "source_sha256": strings.Repeat("b", 64), "document": document})
	if result = call(handler, "PUT", route, string(body)); result.Code != 409 {
		t.Fatal("stale source accepted")
	}
	body, _ = json.Marshal(map[string]any{"revision": 1, "source_sha256": initial.SourceHash, "document": map[string]any{"schema": "partition-v1"}})
	if result = call(handler, "PUT", route, string(body)); result.Code != 400 {
		t.Fatal("missing fields accepted")
	}
	// Existing delivery still returns the parent source. No chunk API is exposed.
	result = call(handler, "GET", "/api/v1/assets/"+asset.ID.String(), "")
	if result.Code != 200 || !strings.Contains(result.Body.String(), "url") {
		t.Fatal("original descriptor unavailable")
	}
	if result = call(handler, "GET", "/api/v1/public/tours/anything/assets/"+asset.ID.String()+"/partition", ""); result.Code != 404 {
		t.Fatal("private author inventory exposed publicly")
	}
	oversized, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: p.ID, Name: "large.glb", StorageKey: "private/large.glb", Size: 256*1024*1024 + 4, FileType: pgtype.Text{String: "GLB", Valid: true}})
	if err != nil {
		t.Fatal(err)
	}
	oversized, err = q.CompleteAsset(ctx, oversized.ID)
	if err != nil {
		t.Fatal(err)
	}
	before := objects.downloads
	result = call(handler, "POST", "/api/v1/assets/"+oversized.ID.String()+"/partition/inventory", "")
	if result.Code != 422 || objects.downloads != before {
		t.Fatal("inspection admission fetched oversized bytes")
	}
}
