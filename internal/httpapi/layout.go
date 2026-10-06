package httpapi

import (
	"context"
	"github.com/jackc/pgx/v5/pgtype"
	"net/http"
	"virtual-tour/internal/database"
	"virtual-tour/internal/layout"
)

type LayoutStore interface {
	CreateLayout(context.Context, pgtype.UUID, string, layout.Document) (database.Scene, error)
	SaveLayout(context.Context, pgtype.UUID, int32, layout.Document) (database.Scene, error)
	WriteLayoutHotspot(context.Context, pgtype.UUID, database.CreateHotspotParams, *database.UpdateHotspotParams) (database.Hotspot, error)
}

func (a *API) getLayout(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	var scene database.Scene
	var err error
	if r.PathValue("slug") != "" {
		scene, err = a.publication.GetPublicScene(r.Context(), database.GetPublicSceneParams{ID: id, Slug: r.PathValue("slug")})
	} else {
		scene, err = a.assets.GetScene(r.Context(), id)
	}
	if err != nil {
		a.publicError(w, err)
		return
	}
	if scene.Type != "LAYOUT" {
		fail(w, 404, "layout scene not found")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respond(w, 200, map[string]any{"document": scene.Layout, "revision": scene.LayoutRevision})
}
func (a *API) putLayout(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	var body struct {
		Revision int32           `json:"revision"`
		Document layout.Document `json:"document"`
	}
	if !readJSONLimit(w, r, &body, 256*1024) {
		return
	}
	if body.Revision < 1 {
		fail(w, 400, "revision must be a positive integer")
		return
	}
	if err := body.Document.Validate(); err != nil {
		fail(w, 400, err.Error())
		return
	}
	if a.layouts == nil {
		fail(w, 503, "layout storage unavailable")
		return
	}
	scene, err := a.layouts.SaveLayout(r.Context(), id, body.Revision, body.Document)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, 200, scene)
}
