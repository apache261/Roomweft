package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"virtual-tour/internal/database"
)

type PublicationStore interface {
	PublishProject(context.Context, pgtype.UUID) (database.Project, error)
	UnpublishProject(context.Context, pgtype.UUID) (database.Project, error)
	GetPublicProject(context.Context, string) (database.Project, error)
	GetPublicAsset(context.Context, database.GetPublicAssetParams) (database.Asset, error)
	GetPublicScene(context.Context, database.GetPublicSceneParams) (database.Scene, error)
}

func (a *API) publicationRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/projects/{id}/publish", a.publish)
	mux.HandleFunc("POST /api/v1/projects/{id}/unpublish", a.unpublish)
	mux.HandleFunc("GET /api/v1/public/tours/{slug}", a.publicTour)
	mux.HandleFunc("GET /api/v1/public/tours/{slug}/assets/{id}", a.publicAsset)
	a.registerChunks(mux, "/api/v1/public/tours/{slug}/assets/{id}")
	mux.HandleFunc("GET /api/v1/public/tours/{slug}/scenes/{id}/hotspots", a.publicHotspots)
	mux.HandleFunc("GET /api/v1/public/tours/{slug}/scenes/{id}/layout", a.getLayout)
}
func (a *API) publish(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	if _, err := a.store.GetProject(r.Context(), id); err != nil {
		a.storeError(w, err)
		return
	}
	p, err := a.publication.PublishProject(r.Context(), id)
	if errors.Is(err, database.ErrPortalReference) {
		fail(w, 400, err.Error())
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 400, "tour requires usable scenes, a valid start scene, and valid navigation and image references")
		return
	}
	if err != nil {
		a.storeError(w, err)
		return
	}
	respond(w, 200, p)
}
func (a *API) unpublish(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	p, err := a.publication.UnpublishProject(r.Context(), id)
	if err != nil {
		a.storeError(w, err)
		return
	}
	respond(w, 200, p)
}
func (a *API) publicError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "tour or scene unavailable")
		return
	}
	a.resourceError(w, err)
}
func (a *API) publicTour(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	p, err := a.publication.GetPublicProject(r.Context(), r.PathValue("slug"))
	if err != nil {
		a.publicError(w, err)
		return
	}
	scenes, err := a.assets.ListScenes(r.Context(), p.ID)
	if err != nil {
		a.publicError(w, err)
		return
	}
	if scenes == nil {
		scenes = []database.Scene{}
	}
	respond(w, 200, struct {
		Name        string           `json:"name"`
		Description string           `json:"description"`
		Start       pgtype.UUID      `json:"start_scene_id"`
		Scenes      []database.Scene `json:"scenes"`
	}{p.Name, p.Description, p.StartSceneID, scenes})
}
func (a *API) publicAsset(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	asset, err := a.publication.GetPublicAsset(r.Context(), database.GetPublicAssetParams{ID: id, Slug: r.PathValue("slug")})
	if err != nil {
		a.publicError(w, err)
		return
	}
	if !a.storageReady(w) {
		return
	}
	url, err := a.storage.ReadURL(r.Context(), asset.StorageKey)
	if err != nil {
		fail(w, 503, "could not load asset URL; try again")
		return
	}
	respond(w, 200, struct {
		URL       string               `json:"url"`
		Runtime   *database.Derivative `json:"runtime,omitempty"`
		Streaming *chunkAdvertisement  `json:"streaming,omitempty"`
	}{url, a.runtimeAsset(r.Context(), asset, true), a.chunkAsset(r, asset, true)})
}
func (a *API) publicHotspots(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	if _, err := a.publication.GetPublicScene(r.Context(), database.GetPublicSceneParams{ID: id, Slug: r.PathValue("slug")}); err != nil {
		a.publicError(w, err)
		return
	}
	items, err := a.assets.ListHotspots(r.Context(), id)
	if err != nil {
		a.publicError(w, err)
		return
	}
	if items == nil {
		items = []database.Hotspot{}
	}
	respond(w, 200, items)
}
