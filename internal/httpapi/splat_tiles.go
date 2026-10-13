package httpapi

import (
	"context"
	"github.com/jackc/pgx/v5/pgtype"
	"net/http"
	"strings"
	"virtual-tour/internal/database"
	"virtual-tour/internal/splattiles"
)

type SplatTileStore interface {
	QueueSplatTiles(context.Context, pgtype.UUID, bool) error
	GetSplatTiles(context.Context, pgtype.UUID) (database.Derivative, error)
}

func (a *API) registerSplatTiles(mux *http.ServeMux, base string) {
	mux.HandleFunc("GET "+base+"/splat-tiles", a.splatTileManifest)
	mux.HandleFunc("GET "+base+"/splat-tiles/{tile}", a.splatTilePayload)
}
func (a *API) currentSplatTiles(w http.ResponseWriter, r *http.Request) (splattiles.Manifest, bool) {
	var m splattiles.Manifest
	w.Header().Set("Cache-Control", "no-store")
	if !a.splatStreaming || !a.allowSplat(w, "SPLAT", false) {
		if !a.splatStreaming {
			fail(w, 404, "Splat streaming disabled; use original")
		}
		return m, false
	}
	id, ok := projectID(w, r)
	if !ok {
		return m, false
	}
	var asset database.Asset
	var err error
	if r.PathValue("slug") != "" {
		asset, err = a.publication.GetPublicAsset(r.Context(), database.GetPublicAssetParams{ID: id, Slug: r.PathValue("slug")})
		if err != nil {
			a.publicError(w, err)
			return m, false
		}
	} else {
		asset, err = a.assets.GetAsset(r.Context(), id)
		if err != nil {
			a.resourceError(w, err)
			return m, false
		}
	}
	if asset.FileType != "SPLAT" || asset.UploadStatus != "ready" {
		fail(w, 404, "Ready splat parent required")
		return m, false
	}
	store, ok := a.store.(SplatTileStore)
	if !ok {
		fail(w, 404, "Splat tile products unavailable")
		return m, false
	}
	d, err := store.GetSplatTiles(r.Context(), id)
	if err != nil || d.State != "ready" {
		fail(w, 404, "Splat tiles not ready; use original")
		return m, false
	}
	if splattiles.Decode(d.Manifest, &m) != nil || m.Validate() != nil || m.ParentID != id.String() || m.SourceBytes != asset.Size {
		fail(w, 503, "Invalid splat tile manifest; use original")
		return m, false
	}
	prefix := strings.TrimSuffix(asset.StorageKey, ".splat") + "/" + splattiles.Version + "/" + m.SourceHash + "/" + m.AttemptID + "/"
	for _, tile := range m.Tiles {
		if tile.Key != prefix+tile.ID+".splat" {
			fail(w, 503, "Invalid private splat tile namespace")
			return m, false
		}
	}
	if source := r.URL.Query().Get("source_sha256"); source != "" && source != m.SourceHash {
		fail(w, 409, "Splat source identity changed; reload scene")
		return m, false
	}
	return m, true
}
func (a *API) splatTileManifest(w http.ResponseWriter, r *http.Request) {
	m, ok := a.currentSplatTiles(w, r)
	if !ok {
		return
	}
	for i := range m.Tiles {
		m.Tiles[i].Key = ""
	}
	respond(w, 200, m)
}
func (a *API) splatTilePayload(w http.ResponseWriter, r *http.Request) {
	m, ok := a.currentSplatTiles(w, r)
	if !ok {
		return
	}
	for _, t := range m.Tiles {
		if t.ID == r.PathValue("tile") {
			if !a.storageReady(w) {
				return
			}
			url, err := a.storage.ReadURL(r.Context(), t.Key)
			if err != nil {
				fail(w, 503, "Tile signing unavailable; retry")
				return
			}
			respond(w, 200, map[string]any{"url": url, "bytes": t.Bytes, "sha256": t.SHA256, "source_sha256": m.SourceHash})
			return
		}
	}
	fail(w, 404, "Unknown splat tile")
}
func (a *API) processSplatTiles(w http.ResponseWriter, r *http.Request, asset database.Asset) {
	if !a.splatStreaming || !a.allowSplat(w, "SPLAT", true) {
		if !a.splatStreaming {
			fail(w, 503, "Splat tile generation disabled")
		}
		return
	}
	if asset.UploadStatus != "ready" {
		fail(w, 400, "Ready splat required")
		return
	}
	store, ok := a.store.(SplatTileStore)
	if !ok {
		fail(w, 503, "Splat tile processing unavailable")
		return
	}
	if err := store.QueueSplatTiles(r.Context(), asset.ID, true); err != nil {
		a.resourceError(w, err)
		return
	}
	state := "queued"
	if d, err := store.GetSplatTiles(r.Context(), asset.ID); err == nil {
		state = d.State
	}
	respond(w, 202, map[string]string{"state": state, "version": "splat-tiles-v1"})
}
