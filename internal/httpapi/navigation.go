package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"virtual-tour/internal/database"
	"virtual-tour/internal/layout"
)

func referenceError(err error) bool {
	var pgerr *pgconn.PgError
	return errors.As(err, &pgerr) && (pgerr.Code == "23503" || pgerr.Code == "23001")
}
func (a *API) deleteScene(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	if err := a.assets.DeleteScene(r.Context(), id); err != nil {
		a.resourceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) deleteAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	count, err := a.assets.DeleteAsset(r.Context(), id)
	if referenceError(err) {
		fail(w, 409, "asset is still used by a scene or hotspot")
		return
	}
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if count == 0 {
		fail(w, 404, "asset not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) listHotspots(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	if _, err := a.assets.GetScene(r.Context(), id); err != nil {
		a.resourceError(w, err)
		return
	}
	hotspots, err := a.assets.ListHotspots(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if hotspots == nil {
		hotspots = []database.Hotspot{}
	}
	respond(w, 200, hotspots)
}

type hotspotPosition struct {
	Attachment *layout.Attachment `json:"attachment,omitempty"`
	X          *float64           `json:"x,omitempty"`
	Y          *float64           `json:"y,omitempty"`
	Z          *float64           `json:"z,omitempty"`
	Yaw        *float64           `json:"yaw,omitempty"`
	Pitch      *float64           `json:"pitch,omitempty"`
}

func (a *API) createHotspot(w http.ResponseWriter, r *http.Request) { a.writeHotspot(w, r, false) }
func (a *API) updateHotspot(w http.ResponseWriter, r *http.Request) { a.writeHotspot(w, r, true) }
func (a *API) writeHotspot(w http.ResponseWriter, r *http.Request, update bool) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	sceneID := id
	if update {
		h, err := a.assets.GetHotspot(r.Context(), id)
		if err != nil {
			a.resourceError(w, err)
			return
		}
		sceneID = h.SceneID
	}
	var body struct {
		Description  string           `json:"description"`
		ExternalLink string           `json:"external_link"`
		Image        pgtype.UUID      `json:"image_asset_id"`
		Type         string           `json:"type"`
		Title        string           `json:"title"`
		Position     *hotspotPosition `json:"position"`
		Destination  pgtype.UUID      `json:"destination_scene_id"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	body.Title = strings.TrimSpace(body.Title)
	if body.Type == "" {
		body.Type = "NAVIGATION"
	}
	link, err := url.Parse(body.ExternalLink)
	if (body.Type != "NAVIGATION" && body.Type != "INFO") || body.Position == nil || utf8.RuneCountInString(body.Title) < 1 || utf8.RuneCountInString(body.Title) > 120 || utf8.RuneCountInString(body.Description) > 5000 || len(body.ExternalLink) > 2048 || (body.ExternalLink != "" && (err != nil || (link.Scheme != "https" && link.Scheme != "http") || link.Host == "" || link.User != nil)) ||
		(body.Type == "NAVIGATION" && (!body.Destination.Valid || body.Destination == sceneID || body.Image.Valid || body.Description != "" || body.ExternalLink != "")) || (body.Type == "INFO" && body.Destination.Valid) {
		fail(w, 400, "provide a title, valid position and content for NAVIGATION or INFO; external links must use HTTP(S)")
		return
	}
	p := body.Position
	world := p.X != nil || p.Y != nil || p.Z != nil
	angles := p.Yaw != nil || p.Pitch != nil
	if world == angles || (world && (!validNumber(p.X) || !validNumber(p.Y) || !validNumber(p.Z))) || (angles && !validAngles(p.Yaw, p.Pitch)) {
		fail(w, 400, "position must be finite x/y/z for 3D or yaw/pitch in radians for panoramas")
		return
	}
	scene, err := a.assets.GetScene(r.Context(), sceneID)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if (scene.Type != "PANORAMA" && !world) || (scene.Type == "PANORAMA" && !angles) {
		fail(w, 400, "hotspot position does not match the scene type")
		return
	}
	if p.Attachment != nil && scene.Type != "LAYOUT" {
		fail(w, 400, "attachments require a layout scene")
		return
	}
	if p.Attachment != nil {
		if _, err := layout.Decode(scene.Layout).Position(*p.Attachment); err != nil {
			fail(w, 400, err.Error())
			return
		}
	}
	position, _ := json.Marshal(p)
	var hotspot database.Hotspot
	status := 201
	if scene.Type == "LAYOUT" && a.layouts != nil {
		create := database.CreateHotspotParams{SceneID: sceneID, Type: body.Type, Title: body.Title, Position: position, Destination: body.Destination, Description: body.Description, ExternalLink: body.ExternalLink, Image: body.Image}
		var change *database.UpdateHotspotParams
		if update {
			status = 200
			change = &database.UpdateHotspotParams{ID: id, Type: body.Type, Title: body.Title, Position: position, Destination: body.Destination, Description: body.Description, ExternalLink: body.ExternalLink, Image: body.Image}
		}
		hotspot, err = a.layouts.WriteLayoutHotspot(r.Context(), sceneID, create, change)
	} else if update {
		status = 200
		hotspot, err = a.assets.UpdateHotspot(r.Context(), database.UpdateHotspotParams{ID: id, Type: body.Type, Title: body.Title, Position: position, Destination: body.Destination, Description: body.Description, ExternalLink: body.ExternalLink, Image: body.Image})
	} else {
		hotspot, err = a.assets.CreateHotspot(r.Context(), database.CreateHotspotParams{SceneID: sceneID, Type: body.Type, Title: body.Title, Position: position, Destination: body.Destination, Description: body.Description, ExternalLink: body.ExternalLink, Image: body.Image})
	}
	if errors.Is(err, pgx.ErrNoRows) || referenceError(err) {
		fail(w, 400, "destination or ready image must belong to this project")
		return
	}
	if err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, status, hotspot)
}
func (a *API) deleteHotspot(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	count, err := a.assets.DeleteHotspot(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if count == 0 {
		fail(w, 404, "hotspot not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
