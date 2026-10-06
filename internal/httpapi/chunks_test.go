package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"os"
	"strings"
	"testing"
	"virtual-tour/internal/chunking"
	"virtual-tour/internal/database"
)

type chunkTestStore struct {
	Store
	AssetStore
	PublicationStore
	PartitionStore
	asset      database.Asset
	derivative database.Derivative
	revision   int64
	published  bool
}

func (s *chunkTestStore) GetAsset(_ context.Context, id pgtype.UUID) (database.Asset, error) {
	if id != s.asset.ID {
		return database.Asset{}, pgx.ErrNoRows
	}
	return s.asset, nil
}
func (s *chunkTestStore) GetPublicAsset(ctx context.Context, p database.GetPublicAssetParams) (database.Asset, error) {
	if !s.published || p.Slug != "published" {
		return database.Asset{}, pgx.ErrNoRows
	}
	return s.GetAsset(ctx, p.ID)
}
func (s *chunkTestStore) GetChunkDerivative(context.Context, pgtype.UUID) (database.Derivative, error) {
	return s.derivative, nil
}
func (s *chunkTestStore) QueueChunks(context.Context, pgtype.UUID, bool) error { return nil }
func (s *chunkTestStore) GetAssetPartition(context.Context, pgtype.UUID) (database.AssetPartition, error) {
	return database.AssetPartition{Revision: s.revision, SourceHash: strings.Repeat("a", 64)}, nil
}

type chunkTestObjects struct {
	publicationObjects
	calls int
	fail  bool
}

func (o *chunkTestObjects) ReadURL(_ context.Context, key string) (string, error) {
	o.calls++
	if o.fail {
		return "", fmt.Errorf("storage down")
	}
	return fmt.Sprintf("https://objects.example/payload?signature=%d", o.calls), nil
}

func TestChunkScopedDeliveryAndRenewal(t *testing.T) {
	raw, err := os.ReadFile("../../tests/testdata/chunking/contracts/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var m chunking.Manifest
	if err = chunking.Decode(raw, &m); err != nil {
		t.Fatal(err)
	}
	var id pgtype.UUID
	_ = id.Scan(m.ParentID)
	store := &chunkTestStore{asset: database.Asset{ID: id, FileType: "GLB", UploadStatus: "ready"}, derivative: database.Derivative{State: "ready", Manifest: raw}, revision: 1}
	objects := &chunkTestObjects{}
	handler := New(store, nil, objects)
	private := "/api/v1/assets/" + m.ParentID
	public := "/api/v1/public/tours/published/assets/" + m.ParentID
	manifest := call(handler, "GET", private+"/chunks", "")
	if manifest.Code != 200 || strings.Contains(manifest.Body.String(), `"key"`) || objects.calls != 0 {
		t.Fatalf("manifest signs eagerly or leaks keys: %s", manifest.Body.String())
	}
	var result struct {
		Manifest chunking.DeliveredManifest `json:"manifest"`
	}
	if err = json.Unmarshal(manifest.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if err = result.Manifest.Validate(); err != nil {
		t.Fatal(err)
	}
	endpoint := "/chunks/room-a-geometry?tier=low"
	first := call(handler, "GET", private+endpoint, "")
	second := call(handler, "GET", private+endpoint, "")
	if first.Code != 200 || second.Code != 200 || first.Body.String() == second.Body.String() || objects.calls != 2 {
		t.Fatal("descriptor renewal failed")
	}
	for _, path := range []string{public + endpoint, public + "/chunks", private + "/chunks/missing", private + "/chunk-indexes/missing", "/api/v1/assets/00000000-0000-4000-9000-000000000099" + endpoint} {
		if r := call(handler, "GET", path, ""); r.Code != 404 {
			t.Fatalf("unexpected scope/ID acceptance %s: %d", path, r.Code)
		}
	}
	if r := call(handler, "GET", private+"/chunks/room-a-geometry?tier=garbage", ""); r.Code != 400 {
		t.Fatal("invalid tier accepted")
	}
	store.published = true
	for _, path := range []string{public + endpoint, public + "/chunk-indexes/navigation", public + "/chunk-dependencies/shared-image?tier=hq"} {
		if r := call(handler, "GET", path, ""); r.Code != 200 || strings.Contains(r.Body.String(), `"key"`) {
			t.Fatalf("scoped delivery failed: %s", r.Body.String())
		}
	}
	store.published = false
	if r := call(handler, "GET", public+endpoint, ""); r.Code != 404 {
		t.Fatal("unpublished renewal allowed")
	}
	if r := call(handler, "GET", private+endpoint+"&revision=2", ""); r.Code != 409 {
		t.Fatal("requested stale version accepted")
	}
	if r := call(handler, "GET", private+endpoint+"&source_sha256="+strings.Repeat("b", 64), ""); r.Code != 409 {
		t.Fatal("requested stale source accepted")
	}
	store.revision = 2
	if r := call(handler, "GET", private+endpoint, ""); r.Code != 409 {
		t.Fatal("stale revision exposed")
	}
	store.revision = 1
	store.derivative.Manifest = []byte(`{"schema":"streaming-v1"}`)
	if r := call(handler, "GET", private+endpoint, ""); r.Code != 503 {
		t.Fatal("malformed manifest accepted")
	}
	store.derivative.Manifest = raw
	objects.fail = true
	if r := call(handler, "GET", private+endpoint, ""); r.Code != 503 {
		t.Fatal("signing failure ignored")
	}
}

// Called by the existing disposable-schema lifecycle test when a database is available.
func verifyChunkDatabaseLifecycle(t *testing.T, ctx context.Context, pool *pgxpool.Pool, q *database.Queries, handler http.Handler, asset database.Asset, slug string) {
	t.Helper()
	read := func(name string, target any) []byte {
		raw, err := os.ReadFile("../../tests/testdata/chunking/contracts/" + name + ".json")
		if err != nil {
			t.Fatal(err)
		}
		if err = chunking.Decode(raw, target); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	var inventory chunking.Inventory
	var partition chunking.Partition
	var m chunking.Manifest
	invRaw := read("inventory", &inventory)
	read("partition", &partition)
	read("manifest", &m)
	initialDoc, _ := json.Marshal(chunking.DefaultPartition(inventory))
	initial, err := q.InitializeAssetPartition(ctx, asset.ID, inventory.SourceHash, invRaw, initialDoc)
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := json.Marshal(partition)
	saved, err := q.SaveAssetPartition(ctx, asset.ID, inventory.SourceHash, initial.Revision, doc)
	if err != nil {
		t.Fatal(err)
	}
	first, err := q.ClaimDerivative(ctx)
	if err != nil || first.Version != "chunks-v1" || first.PartitionRevision != saved.Revision {
		t.Fatalf("chunk claim: %+v %v", first, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE asset_derivatives SET lease_until=now()-interval '1 second' WHERE asset_id=$1 AND version='chunks-v1'`, asset.ID); err != nil {
		t.Fatal(err)
	}
	replacement, err := q.ClaimDerivative(ctx)
	if err != nil {
		t.Fatal(err)
	}
	m.ParentID = asset.ID.String()
	m.PartitionRevision = saved.Revision
	raw, _ := json.Marshal(m)
	if accepted, err := q.FinishDerivative(ctx, first, raw, ""); err != nil || accepted {
		t.Fatalf("expired attempt published: %v %v", accepted, err)
	}
	if accepted, err := q.FinishDerivative(ctx, replacement, raw, ""); err != nil || !accepted {
		t.Fatalf("replacement failed: %v %v", accepted, err)
	}
	for _, base := range []string{"/api/v1/assets/" + asset.ID.String(), "/api/v1/public/tours/" + slug + "/assets/" + asset.ID.String()} {
		if r := call(handler, "GET", base, ""); r.Code != 200 || !strings.Contains(r.Body.String(), `"streaming"`) {
			t.Fatalf("chunk advertisement: %s", r.Body.String())
		}
		if r := call(handler, "GET", base+"/chunks/room-a-geometry?tier=low", ""); r.Code != 200 || strings.Contains(r.Body.String(), `"key"`) {
			t.Fatalf("chunk signing: %s", r.Body.String())
		}
	}
	saved, err = q.SaveAssetPartition(ctx, asset.ID, inventory.SourceHash, saved.Revision, doc)
	if err != nil {
		t.Fatal(err)
	}
	pending, err := q.ClaimDerivative(ctx)
	if err != nil {
		t.Fatal(err)
	}
	complete, _ := json.Marshal(chunking.DefaultPartition(inventory))
	_, err = q.SaveAssetPartition(ctx, asset.ID, inventory.SourceHash, saved.Revision, complete)
	if err != nil {
		t.Fatal(err)
	}
	if accepted, err := q.FinishDerivative(ctx, pending, raw, ""); err != nil || accepted {
		t.Fatalf("late revision published: %v %v", accepted, err)
	}
	if _, err = q.ClaimDerivative(ctx); err != pgx.ErrNoRows {
		t.Fatalf("obsolete partition reclaimed: %v", err)
	}
	if r := call(handler, "GET", "/api/v1/assets/"+asset.ID.String()+"/chunks", ""); r.Code != 404 {
		t.Fatal("obsolete products exposed")
	}
}
