package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
	"virtual-tour/internal/chunking"
	"virtual-tour/internal/database"
)

type PartitionStore interface {
	GetAssetPartition(context.Context, pgtype.UUID) (database.AssetPartition, error)
	InitializeAssetPartition(context.Context, pgtype.UUID, string, []byte, []byte) (database.AssetPartition, error)
	SaveAssetPartition(context.Context, pgtype.UUID, string, int64, []byte) (database.AssetPartition, error)
}
type partitionDownloader interface {
	Download(context.Context, string, string, int64) error
}

// Bounded inspection work is explicit author action, not implicit asset delivery.
var inventorySlot = make(chan struct{}, 1)

func (a *API) partitionAsset(w http.ResponseWriter, r *http.Request) (database.Asset, PartitionStore, bool) {
	id, ok := projectID(w, r)
	if !ok {
		return database.Asset{}, nil, false
	}
	if a.assets == nil {
		fail(w, 503, "asset store unavailable")
		return database.Asset{}, nil, false
	}
	asset, err := a.assets.GetAsset(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return asset, nil, false
	}
	if asset.FileType != "GLB" || asset.UploadStatus != "ready" {
		fail(w, 400, "partition review requires a completed GLB")
		return asset, nil, false
	}
	store, ok := a.store.(PartitionStore)
	if !ok {
		fail(w, 503, "partition storage unavailable")
		return asset, nil, false
	}
	return asset, store, true
}
func (a *API) getPartition(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	asset, store, ok := a.partitionAsset(w, r)
	if !ok {
		return
	}
	p, err := store.GetAssetPartition(r.Context(), asset.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		reason := "Source inventory not prepared; complete original remains available"
		if asset.Size > 256*1024*1024 {
			reason = "Source exceeds the 256 MiB inspection limit; complete original remains available"
		}
		respond(w, 200, map[string]any{"revision": 0, "inventory": nil, "document": nil, "fallback": reason})
		return
	}
	if err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, 200, p)
}
func (a *API) inspectPartition(w http.ResponseWriter, r *http.Request) {
	asset, store, ok := a.partitionAsset(w, r)
	if !ok {
		return
	}
	if asset.Size > 256*1024*1024 {
		fail(w, 422, "source exceeds the 256 MiB inspection limit; complete original remains available")
		return
	}
	objects, ok := a.storage.(partitionDownloader)
	script := os.Getenv("ASSET_PROCESSOR_SCRIPT")
	if !ok || script == "" {
		fail(w, 503, "source inspection requires the configured asset processor and storage download support")
		return
	}
	select {
	case inventorySlot <- struct{}{}:
		defer func() { <-inventorySlot }()
	default:
		fail(w, 429, "another source inspection is running; retry shortly")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	dir, err := os.MkdirTemp("", "tour-partition-")
	if err != nil {
		a.resourceError(w, err)
		return
	}
	defer os.RemoveAll(dir)
	source, output := filepath.Join(dir, "source.glb"), filepath.Join(dir, "inventory.json")
	if err = objects.Download(ctx, asset.StorageKey, source, asset.Size); err != nil {
		fail(w, 502, "could not inspect original source; complete original remains available")
		return
	}
	command := exec.CommandContext(ctx, "node", "--max-old-space-size=1024", filepath.Join(filepath.Dir(script), "inventory.mjs"), source, output)
	if err = command.Run(); err != nil {
		fail(w, 422, "source inspection is unsupported or timed out; complete original remains available")
		return
	}
	stat, err := os.Stat(output)
	if err != nil || stat.Size() > 4*1024*1024 {
		fail(w, 422, "source inventory exceeds inspection limits; complete original remains available")
		return
	}
	bytes, err := os.ReadFile(output)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	var inventory chunking.Inventory
	if err = chunking.Decode(bytes, &inventory); err == nil {
		err = inventory.Validate()
	}
	if err != nil || inventory.SourceBytes != asset.Size {
		fail(w, 422, "source inventory validation failed; complete original remains available")
		return
	}
	// Independently verify source bytes, rather than trusting only processor output.
	hash, err := partitionSourceHash(source)
	if err != nil || hash != inventory.SourceHash {
		fail(w, 422, "source inventory identity mismatch")
		return
	}
	document, _ := json.Marshal(chunking.DefaultPartition(inventory))
	p, err := store.InitializeAssetPartition(ctx, asset.ID, inventory.SourceHash, bytes, document)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, 200, p)
}
func (a *API) putPartition(w http.ResponseWriter, r *http.Request) {
	asset, store, ok := a.partitionAsset(w, r)
	if !ok {
		return
	}
	var body struct {
		Revision   *int64          `json:"revision"`
		SourceHash string          `json:"source_sha256"`
		Document   json.RawMessage `json:"document"`
	}
	if !readJSONLimit(w, r, &body, 4*1024*1024) {
		return
	}
	p, err := store.GetAssetPartition(r.Context(), asset.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 409, "inspect the original source before reviewing partitions")
		return
	}
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if body.Revision == nil {
		fail(w, 400, "partition revision is required")
		return
	}
	if *body.Revision != p.Revision || body.SourceHash != p.SourceHash {
		fail(w, 409, "partition or source changed; reload the current review")
		return
	}
	var document chunking.Partition
	if err = chunking.Decode(body.Document, &document); err != nil {
		fail(w, 400, "invalid partition contract: "+err.Error())
		return
	}
	var inventory chunking.Inventory
	if err = chunking.Decode(p.Inventory, &inventory); err == nil {
		err = document.Validate(inventory)
	}
	if err != nil {
		fail(w, 400, "invalid partition review: "+err.Error())
		return
	}
	raw, _ := json.Marshal(document)
	saved, err := store.SaveAssetPartition(r.Context(), asset.ID, body.SourceHash, *body.Revision, raw)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 409, "partition or source changed; reload the current review")
		return
	}
	if err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, 200, saved)
}

func partitionSourceHash(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
