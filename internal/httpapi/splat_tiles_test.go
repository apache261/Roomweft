package httpapi

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"virtual-tour/db"
	"virtual-tour/internal/database"
	"virtual-tour/internal/derivatives"
	"virtual-tour/internal/splattiles"
	"virtual-tour/internal/storage"
)

func TestSplatTileScopedPublicationAndRetirement(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" || os.Getenv("TEST_S3") == "" {
		t.Skip("set database and local S3 tests")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	q := database.New(pool)
	objects, err := storage.FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	p, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Tile delivery"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, p.ID)
	path := "../../web/public/splat-fixtures/small.splat"
	info, _ := os.Stat(path)
	key := "tile-test/" + p.ID.String() + "/source.splat"
	if err = objects.PutFile(ctx, key, path, "application/octet-stream"); err != nil {
		t.Fatal(err)
	}
	defer objects.Delete(ctx, key)
	asset, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: p.ID, FileType: pgtype.Text{String: "SPLAT", Valid: true}, Name: "Capture", Size: info.Size(), StorageKey: key})
	if err != nil {
		t.Fatal(err)
	}
	q.CompleteAsset(ctx, asset.ID)
	scene, err := q.CreateScene(ctx, database.CreateSceneParams{ProjectID: p.ID, ID: asset.ID, Name: "Capture"})
	if err != nil {
		t.Fatal(err)
	}
	q.QueueSplatTiles(ctx, asset.ID, false)
	var attempt pgtype.UUID
	attempt.Scan(uuid.NewString())
	if _, err = pool.Exec(ctx, `UPDATE asset_derivatives SET state='processing',attempt=$2,lease_until=now()+interval '15 minutes' WHERE asset_id=$1 AND version='splat-tiles-v1'`, asset.ID, attempt); err != nil {
		t.Fatal(err)
	}
	job := database.DerivativeJob{AssetID: asset.ID, Attempt: attempt, Kind: "SPLAT", Version: splattiles.Version, Key: key, Size: info.Size()}
	if err = derivatives.Process(ctx, q, objects, "", job); err != nil {
		t.Fatal(err)
	}
	d, _ := q.GetSplatTiles(ctx, asset.ID)
	var durable splattiles.Manifest
	if splattiles.Decode(d.Manifest, &durable) != nil || durable.Validate() != nil {
		t.Fatal("invalid published tiles")
	}
	for _, tile := range durable.Tiles {
		defer objects.Delete(ctx, tile.Key)
	}
	handler := NewWithOptions(q, pool.Ping, Options{SplatSupport: SplatOn, SplatStreaming: true}, objects)
	private := "/api/v1/assets/" + asset.ID.String() + "/splat-tiles"
	public := "/api/v1/public/tours/" + p.Slug + "/assets/" + asset.ID.String() + "/splat-tiles"
	if r := call(handler, "GET", public, ""); r.Code != 404 {
		t.Fatal("unpublished tiles exposed")
	}
	if _, err = q.PublishProject(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	for _, base := range []string{private, public} {
		r := call(handler, "GET", base, "")
		if r.Code != 200 || strings.Contains(r.Body.String(), `"key"`) {
			t.Fatal("invalid delivered manifest", r.Body.String())
		}
		r = call(handler, "GET", base+"/"+durable.Tiles[0].ID+"?source_sha256="+durable.SourceHash, "")
		if r.Code != 200 {
			t.Fatal(r.Body.String())
		}
		var payload struct {
			URL   string `json:"url"`
			Bytes int64  `json:"bytes"`
		}
		json.Unmarshal(r.Body.Bytes(), &payload)
		response, err := http.Get(payload.URL)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || int64(len(data)) != payload.Bytes {
			t.Fatal("tile payload truncated")
		}
	}
	if r := call(handler, "GET", private+"/unknown", ""); r.Code != 404 {
		t.Fatal("unknown tile admitted")
	}
	if r := call(handler, "GET", private+"?source_sha256="+strings.Repeat("f", 64), ""); r.Code != 409 {
		t.Fatal("stale identity admitted")
	}
	q.UnpublishProject(ctx, p.ID)
	if r := call(handler, "GET", public+"/"+durable.Tiles[0].ID, ""); r.Code != 404 {
		t.Fatal("unpublished renewal allowed")
	}
	// Deleting the source after its scene retires every durable derived key.
	if err = q.DeleteScene(ctx, scene.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = q.DeleteAsset(ctx, asset.ID); err != nil {
		t.Fatal(err)
	}
	for _, tile := range durable.Tiles {
		var exists bool
		pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM storage_retirements WHERE storage_key=$1)`, tile.Key).Scan(&exists)
		if !exists {
			t.Fatal("derived tile not durably retired")
		}
	}
}
