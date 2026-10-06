package httpapi

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"virtual-tour/internal/chunking"
	"virtual-tour/internal/database"
)

type ChunkStore interface {
	GetChunkDerivative(context.Context, pgtype.UUID) (database.Derivative, error)
	QueueChunks(context.Context, pgtype.UUID, bool) error
}

type chunkAdvertisement struct {
	State       string `json:"state"`
	Processor   string `json:"processor_version"`
	ManifestURL string `json:"manifest_url,omitempty"`
	Delivery    string `json:"delivery"`
	Error       string `json:"error,omitempty"`
}

func (a *API) chunkAsset(r *http.Request, asset database.Asset, public bool) *chunkAdvertisement {
	store, ok := a.store.(ChunkStore)
	if a.chunkStreaming == ChunkOff || !ok || asset.FileType != "GLB" || asset.UploadStatus != "ready" {
		return nil
	}
	d, err := store.GetChunkDerivative(r.Context(), asset.ID)
	if err != nil {
		return nil
	}
	result := &chunkAdvertisement{State: d.State, Processor: chunking.ProcessorVersion, Delivery: "scoped-descriptors"}
	if !public {
		result.Error = d.Error
	}
	if d.State == "ready" {
		var m chunking.Manifest
		if chunking.Decode(d.Manifest, &m) != nil || m.Validate() != nil || !a.allowsChunks(m) {
			return nil
		}
		result.ManifestURL = chunkBase(r, asset.ID.String()) + "/chunks?revision=" + strconv.FormatInt(m.PartitionRevision, 10) + "&source_sha256=" + m.SourceHash
	}
	return result
}
func chunkBase(r *http.Request, id string) string {
	if slug := r.PathValue("slug"); slug != "" {
		return "/api/v1/public/tours/" + url.PathEscape(slug) + "/assets/" + id
	}
	return "/api/v1/assets/" + id
}

// Every descriptor refresh repeats parent authorization before resolving IDs.
func (a *API) currentChunks(w http.ResponseWriter, r *http.Request) (chunking.Manifest, bool) {
	w.Header().Set("Cache-Control", "no-store")
	var m chunking.Manifest
	if a.chunkStreaming == ChunkOff {
		fail(w, 404, "chunk streaming disabled; use complete asset")
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
	if asset.FileType != "GLB" || asset.UploadStatus != "ready" {
		fail(w, 404, "ready chunked parent not found")
		return m, false
	}
	store, ok := a.store.(ChunkStore)
	if !ok {
		fail(w, 404, "chunk products unavailable")
		return m, false
	}
	d, err := store.GetChunkDerivative(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && d.State != "ready" {
		fail(w, 404, "current chunks are not ready")
		return m, false
	}
	if err != nil {
		a.resourceError(w, err)
		return m, false
	}
	if err = chunking.Decode(d.Manifest, &m); err != nil || m.Validate() != nil || m.ParentID != id.String() {
		fail(w, 503, "invalid chunk manifest; use original asset")
		return m, false
	}
	if !a.allowsChunks(m) {
		fail(w, 404, "chunk processing mode is not enabled; use complete asset")
		return m, false
	}
	// Also compare the review when custom stores supply stale or malformed output.
	if reviewStore, ok := a.store.(PartitionStore); ok {
		p, err := reviewStore.GetAssetPartition(r.Context(), id)
		if err != nil || p.Revision != m.PartitionRevision || p.SourceHash != m.SourceHash {
			fail(w, 409, "chunk revision changed; reload parent descriptor")
			return m, false
		}
	}
	if revision := r.URL.Query().Get("revision"); revision != "" && revision != strconv.FormatInt(m.PartitionRevision, 10) {
		fail(w, 409, "chunk revision changed; reload parent descriptor")
		return m, false
	}
	if hash := r.URL.Query().Get("source_sha256"); hash != "" && hash != m.SourceHash {
		fail(w, 409, "chunk source changed; reload parent descriptor")
		return m, false
	}
	return m, true
}
func (a *API) chunkManifest(w http.ResponseWriter, r *http.Request) {
	m, ok := a.currentChunks(w, r)
	if !ok {
		return
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	origin := scheme + "://" + r.Host
	base := origin + chunkBase(r, m.ParentID)
	convert := func(p chunking.Payload, path string) chunking.DeliveredPayload {
		separator := "?"
		if strings.Contains(path, "?") {
			separator = "&"
		}
		path += separator + "revision=" + strconv.FormatInt(m.PartitionRevision, 10) + "&source_sha256=" + m.SourceHash
		return chunking.DeliveredPayload{URL: base + path, SHA256: p.SHA256, Bytes: p.Bytes, TextureBytes: p.TextureBytes, MaxTexture: p.MaxTexture}
	}
	d := chunking.DeliveredManifest{Manifest: m, Chunks: []chunking.DeliveredChunk{}, Dependencies: []chunking.DeliveredDependency{}}
	// Embedded durable values never leave the service; URLs point to bounded
	// descriptor endpoints, which sign only the payload requested by the client.
	d.Manifest.Chunks = nil
	d.Manifest.Dependencies = nil
	d.Manifest.Navigation.Payload = chunking.Payload{}
	d.Manifest.Occlusion.Payload = chunking.Payload{}
	for _, c := range m.Chunks {
		v := map[string]chunking.DeliveredPayload{}
		for tier, p := range c.Variants {
			v[tier] = convert(p, "/chunks/"+c.ID+"?tier="+tier)
		}
		c.Variants = nil
		d.Chunks = append(d.Chunks, chunking.DeliveredChunk{Chunk: c, Variants: v})
	}
	for _, dep := range m.Dependencies {
		v := map[string]chunking.DeliveredPayload{}
		for tier, p := range dep.Variants {
			v[tier] = convert(p, "/chunk-dependencies/"+dep.ID+"?tier="+tier)
		}
		dep.Variants = nil
		d.Dependencies = append(d.Dependencies, chunking.DeliveredDependency{ResourceDependency: dep, Variants: v})
	}
	nav, occ := m.Navigation, m.Occlusion
	nav.Payload = chunking.Payload{}
	occ.Payload = chunking.Payload{}
	d.Navigation = chunking.DeliveredIndex{ExactIndex: nav, Payload: convert(m.Navigation.Payload, "/chunk-indexes/navigation")}
	d.Occlusion = chunking.DeliveredIndex{ExactIndex: occ, Payload: convert(m.Occlusion.Payload, "/chunk-indexes/occlusion")}
	respond(w, 200, map[string]any{"delivery": "scoped-descriptors", "manifest": d})
}
func (a *API) chunkPayload(w http.ResponseWriter, r *http.Request) {
	m, ok := a.currentChunks(w, r)
	if !ok {
		return
	}
	tier := r.URL.Query().Get("tier")
	if tier == "" {
		tier = "balanced"
	}
	if tier != "low" && tier != "balanced" && tier != "hq" {
		fail(w, 400, "tier must be low, balanced or hq")
		return
	}
	var p chunking.Payload
	if id := r.PathValue("chunk"); id != "" {
		for _, c := range m.Chunks {
			if c.ID == id {
				p = c.Variants[tier]
			}
		}
	}
	if id := r.PathValue("dependency"); id != "" {
		for _, d := range m.Dependencies {
			if d.ID == id {
				p = d.Variants[tier]
			}
		}
	}
	switch r.PathValue("index") {
	case "navigation":
		p = m.Navigation.Payload
	case "occlusion":
		p = m.Occlusion.Payload
	}
	if p.Key == "" {
		fail(w, 404, "payload ID not in current manifest")
		return
	}
	if !a.storageReady(w) {
		return
	}
	signed, err := a.storage.ReadURL(r.Context(), p.Key)
	if err != nil {
		fail(w, 503, "could not sign chunk URL; retry")
		return
	}
	respond(w, 200, chunking.DeliveredPayload{URL: signed, SHA256: p.SHA256, Bytes: p.Bytes, TextureBytes: p.TextureBytes, MaxTexture: p.MaxTexture})
}

// Referenced by API registration for both private and published-parent scopes.
func (a *API) registerChunks(mux *http.ServeMux, base string) {
	mux.HandleFunc("GET "+base+"/chunks", a.chunkManifest)
	mux.HandleFunc("GET "+base+"/chunks/{chunk}", a.chunkPayload)
	mux.HandleFunc("GET "+base+"/chunk-dependencies/{dependency}", a.chunkPayload)
	mux.HandleFunc("GET "+base+"/chunk-indexes/{index}", a.chunkPayload)
}
