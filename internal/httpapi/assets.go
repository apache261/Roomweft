package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"virtual-tour/internal/database"
	"virtual-tour/internal/layout"
	"virtual-tour/internal/sceneconfig"
	"virtual-tour/internal/storage"
)

type AssetStore interface {
	CreateAsset(context.Context, database.CreateAssetParams) (database.Asset, error)
	GetAsset(context.Context, pgtype.UUID) (database.Asset, error)
	ListAssets(context.Context, pgtype.UUID) ([]database.Asset, error)
	CompleteAsset(context.Context, pgtype.UUID) (database.Asset, error)
	CreateScene(context.Context, database.CreateSceneParams) (database.Scene, error)
	ListScenes(context.Context, pgtype.UUID) ([]database.Scene, error)
	GetScene(context.Context, pgtype.UUID) (database.Scene, error)
	UpdateSceneCamera(context.Context, database.UpdateSceneCameraParams) (database.Scene, error)
	ChangeScene(context.Context, database.SceneChange) (database.Scene, error)
	DeleteScene(context.Context, pgtype.UUID) error
	DeleteAsset(context.Context, pgtype.UUID) (int64, error)
	CreateHotspot(context.Context, database.CreateHotspotParams) (database.Hotspot, error)
	GetHotspot(context.Context, pgtype.UUID) (database.Hotspot, error)
	UpdateHotspot(context.Context, database.UpdateHotspotParams) (database.Hotspot, error)
	ListHotspots(context.Context, pgtype.UUID) ([]database.Hotspot, error)
	DeleteHotspot(context.Context, pgtype.UUID) (int64, error)
}
type ObjectStorage interface {
	PresignUpload(context.Context, string, int64) (storage.Upload, error)
	Confirm(context.Context, string, int64) error
	ReadURL(context.Context, string) (string, error)
}

func (a *API) assetRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/projects/{id}/uploads", a.upload)
	mux.HandleFunc("GET /api/v1/projects/{id}/assets", a.listAssets)
	mux.HandleFunc("GET /api/v1/assets/{id}", a.getAsset)
	mux.HandleFunc("POST /api/v1/assets/{id}/process", a.processAsset)
	a.registerChunks(mux, "/api/v1/assets/{id}")
	mux.HandleFunc("GET /api/v1/assets/{id}/partition", a.getPartition)
	mux.HandleFunc("POST /api/v1/assets/{id}/partition/inventory", a.inspectPartition)
	mux.HandleFunc("PUT /api/v1/assets/{id}/partition", a.putPartition)
	mux.HandleFunc("DELETE /api/v1/assets/{id}", a.deleteAsset)
	mux.HandleFunc("POST /api/v1/assets/{id}/complete", a.complete)
	mux.HandleFunc("GET /api/v1/projects/{id}/scenes", a.listScenes)
	mux.HandleFunc("POST /api/v1/projects/{id}/scenes", a.createScene)
	mux.HandleFunc("GET /api/v1/scenes/{id}", a.getScene)
	mux.HandleFunc("GET /api/v1/scenes/{id}/layout", a.getLayout)
	mux.HandleFunc("PUT /api/v1/scenes/{id}/layout", a.putLayout)
	mux.HandleFunc("PATCH /api/v1/scenes/{id}", a.updateScene)
	mux.HandleFunc("DELETE /api/v1/scenes/{id}", a.deleteScene)
	mux.HandleFunc("GET /api/v1/scenes/{id}/hotspots", a.listHotspots)
	mux.HandleFunc("POST /api/v1/scenes/{id}/hotspots", a.createHotspot)
	mux.HandleFunc("PATCH /api/v1/hotspots/{id}", a.updateHotspot)
	mux.HandleFunc("DELETE /api/v1/hotspots/{id}", a.deleteHotspot)
}

type cameraInput struct {
	Position []*float64 `json:"position,omitempty"`
	Yaw      *float64   `json:"yaw"`
	Pitch    *float64   `json:"pitch"`
}

func validNumber(value *float64) bool {
	return value != nil && !math.IsNaN(*value) && !math.IsInf(*value, 0) && math.Abs(*value) <= 1e6
}
func validAngles(yaw, pitch *float64) bool {
	return validNumber(yaw) && validNumber(pitch) && math.Abs(*yaw) <= math.Pi && math.Abs(*pitch) <= math.Pi/2-0.01
}
func (a *API) updateScene(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	var body struct {
		Name     *string               `json:"name"`
		Move     *string               `json:"move"`
		Camera   *cameraInput          `json:"start_camera"`
		Settings *sceneconfig.Settings `json:"settings"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.Name == nil && body.Move == nil && body.Camera == nil && body.Settings == nil {
		fail(w, 400, "name, move, start_camera or settings is required")
		return
	}
	change := database.SceneChange{ID: id}
	if body.Settings != nil {
		if err := body.Settings.Validate(); err != nil {
			fail(w, 400, err.Error())
			return
		}
		if body.Camera != nil {
			fail(w, 400, "save settings separately from start_camera")
			return
		}
		change.Settings, _ = json.Marshal(body.Settings)
	}
	if body.Name != nil {
		name := strings.TrimSpace(*body.Name)
		if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 120 {
			fail(w, 400, "scene name must contain 1–120 characters")
			return
		}
		change.Name = pgtype.Text{String: name, Valid: true}
	}
	if body.Move != nil {
		if *body.Move != "up" && *body.Move != "down" {
			fail(w, 400, "move must be up or down")
			return
		}
		change.Move = *body.Move
	}
	c := body.Camera
	if c != nil {
		if !validAngles(c.Yaw, c.Pitch) || (c.Position != nil && len(c.Position) != 3) {
			fail(w, 400, "camera requires valid yaw/pitch in radians and position [x,y,z] for 3D")
			return
		}
		for _, value := range c.Position {
			if !validNumber(value) {
				fail(w, 400, "camera position must contain finite numbers within supported bounds")
				return
			}
		}
	}
	scene, err := a.assets.GetScene(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if body.Settings != nil {
		if err := body.Settings.ValidateForScene(scene.Type); err != nil {
			fail(w, 400, err.Error())
			return
		}
	}
	if body.Settings != nil && scene.Type == "PANORAMA" {
		fail(w, 400, "appearance and model preparation are only supported for 3D scenes")
		return
	}
	if body.Settings != nil && scene.Type == "LAYOUT" && (body.Settings.Model != sceneconfig.Default().Model || body.Settings.Appearance.Tint != "" || body.Settings.Appearance.Roughness != nil || len(body.Settings.Materials) > 0 || len(body.Settings.SurfaceMaterials) > 0 || body.Settings.Navigation != nil) {
		fail(w, 400, "layout transforms and material overrides belong to individual elements")
		return
	}
	if c != nil {
		if (scene.Type != "PANORAMA" && len(c.Position) != 3) || (scene.Type == "PANORAMA" && c.Position != nil) {
			fail(w, 400, "3D cameras require position; panorama cameras use only yaw and pitch")
			return
		}
		change.Camera, _ = json.Marshal(c)
	}
	scene, err = a.assets.ChangeScene(r.Context(), change)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, 200, scene)
}
func readJSON(w http.ResponseWriter, r *http.Request, body any) bool {
	return readJSONLimit(w, r, body, 64*1024)
}
func readJSONLimit(w http.ResponseWriter, r *http.Request, body any, limit int64) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	d.DisallowUnknownFields()
	if err := d.Decode(body); err != nil {
		fail(w, 400, "invalid JSON body")
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		fail(w, 400, "expected one JSON object")
		return false
	}
	return true
}
func (a *API) resourceError(w http.ResponseWriter, err error) {
	if errors.Is(err, database.ErrLayoutConflict) || errors.Is(err, database.ErrLayoutAttachment) {
		fail(w, 409, err.Error())
		return
	}
	if errors.Is(err, database.ErrLayoutReference) || errors.Is(err, database.ErrTextureReference) || errors.Is(err, database.ErrPortalReference) || errors.Is(err, database.ErrWalkingStart) {
		fail(w, 400, err.Error())
		return
	}
	if errors.Is(err, sceneconfig.ErrTransformBounds) {
		fail(w, 400, err.Error())
		return
	}
	if referenceError(err) {
		fail(w, 400, "referenced scene or asset is unavailable")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "asset or scene not found")
		return
	}
	slog.Error("asset/scene operation failed", "error", err)
	fail(w, 500, "could not save or load assets and scenes")
}
func (a *API) storageReady(w http.ResponseWriter) bool {
	if a.storage == nil {
		fail(w, 503, "asset storage is not configured")
		return false
	}
	return true
}
func (a *API) upload(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	var body struct {
		Kind string `json:"file_type"`
		Name string `json:"name"`
		Size int64  `json:"size"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	kind, _, extension := storage.Format(body.Name)
	if kind == "" || utf8.RuneCountInString(body.Name) > 120 || strings.ContainsAny(body.Name, "/\\") {
		fail(w, 400, "choose a GLB, JPG, PNG or WebP file with a filename of at most 120 characters")
		return
	}
	if body.Kind != "" && body.Kind != "IMAGE" && body.Kind != "TEXTURE_BASE_COLOR" && body.Kind != "TEXTURE_NORMAL" && body.Kind != "TEXTURE_ROUGHNESS" && body.Kind != "TEXTURE_AO" && body.Kind != "TEXTURE_LIGHTMAP" && body.Kind != kind {
		fail(w, 400, "invalid file_type")
		return
	}
	prefix := ""
	if body.Kind == "IMAGE" || strings.HasPrefix(body.Kind, "TEXTURE_") {
		if kind != "PANORAMA" {
			fail(w, 400, "images must be JPG, PNG or WebP")
			return
		}
		kind = body.Kind
		prefix = "images/"
		if strings.HasPrefix(body.Kind, "TEXTURE_") {
			prefix = "textures/"
		}
	}
	limit := storage.UploadSizeLimit(kind)
	if body.Size < 20 || body.Size > limit {
		fail(w, 400, fmt.Sprintf("file size must be between 20 bytes and %d MiB", limit/(1024*1024)))
		return
	}
	if !a.storageReady(w) {
		return
	}
	if _, err := a.store.GetProject(r.Context(), id); err != nil {
		a.storeError(w, err)
		return
	}
	key := prefix + "projects/" + id.String() + "/" + uuid.NewString() + extension
	upload, err := a.storage.PresignUpload(r.Context(), key, body.Size)
	if err != nil {
		slog.Error("presign failed", "error", err)
		fail(w, 503, "could not start upload; check storage configuration")
		return
	}
	asset, err := a.assets.CreateAsset(r.Context(), database.CreateAssetParams{ProjectID: id, Name: body.Name, Size: body.Size, StorageKey: key, FileType: pgtype.Text{String: kind, Valid: true}})
	if err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, 201, struct {
		Asset  database.Asset `json:"asset"`
		Upload storage.Upload `json:"upload"`
	}{asset, upload})
}
func (a *API) listAssets(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	if _, err := a.store.GetProject(r.Context(), id); err != nil {
		a.storeError(w, err)
		return
	}
	assets, err := a.assets.ListAssets(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if assets == nil {
		assets = []database.Asset{}
	}
	respond(w, 200, assets)
}
func (a *API) getAsset(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	asset, err := a.assets.GetAsset(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	url := ""
	if asset.UploadStatus == "ready" {
		if !a.storageReady(w) {
			return
		}
		url, err = a.storage.ReadURL(r.Context(), asset.StorageKey)
		if err != nil {
			fail(w, 503, "could not load asset URL; try again")
			return
		}
	}
	respond(w, 200, struct {
		database.Asset
		URL       string               `json:"url"`
		Runtime   *database.Derivative `json:"runtime,omitempty"`
		Streaming *chunkAdvertisement  `json:"streaming,omitempty"`
	}{asset, url, a.runtimeAsset(r.Context(), asset, false), a.chunkAsset(r, asset, false)})
}
func (a *API) complete(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	asset, err := a.assets.GetAsset(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if asset.UploadStatus == "ready" {
		if err := a.queueDerivative(r.Context(), asset, false); err != nil {
			slog.Warn("queue derivative failed", "error", err)
		}
		respond(w, 200, asset)
		return
	}
	if !a.storageReady(w) {
		return
	}
	if err := a.storage.Confirm(r.Context(), asset.StorageKey, asset.Size); err != nil {
		slog.Warn("upload validation failed", "error", err)
		fail(w, 422, "upload could not be confirmed: "+err.Error())
		return
	}
	asset, err = a.assets.CompleteAsset(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if err := a.queueDerivative(r.Context(), asset, false); err != nil {
		slog.Warn("queue derivative failed", "error", err)
	}
	respond(w, 200, asset)
}
func (a *API) listScenes(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	if _, err := a.store.GetProject(r.Context(), id); err != nil {
		a.storeError(w, err)
		return
	}
	scenes, err := a.assets.ListScenes(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if scenes == nil {
		scenes = []database.Scene{}
	}
	respond(w, 200, scenes)
}
func (a *API) createScene(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	var body struct {
		Type    string           `json:"type"`
		Layout  *layout.Document `json:"layout"`
		AssetID pgtype.UUID      `json:"asset_id"`
		Name    string           `json:"name"`
	}
	if !readJSONLimit(w, r, &body, 256*1024) {
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Type == "LAYOUT" {
		if body.AssetID.Valid || body.Name == "" || utf8.RuneCountInString(body.Name) > 120 {
			fail(w, 400, "layout scenes require a name and no asset_id")
			return
		}
		doc := layout.Document{Version: 1, Elements: []layout.Element{}, Doors: []layout.Door{}}
		if body.Layout != nil {
			doc = *body.Layout
		}
		if err := doc.Validate(); err != nil {
			fail(w, 400, err.Error())
			return
		}
		if a.layouts == nil {
			fail(w, 503, "layout storage unavailable")
			return
		}
		scene, err := a.layouts.CreateLayout(r.Context(), id, body.Name, doc)
		if err != nil {
			a.resourceError(w, err)
			return
		}
		respond(w, 201, scene)
		return
	}
	if body.Type != "" || body.Layout != nil {
		fail(w, 400, "use type LAYOUT for a layout or asset_id for an imported scene")
		return
	}
	if !body.AssetID.Valid || utf8.RuneCountInString(body.Name) < 1 || utf8.RuneCountInString(body.Name) > 120 {
		fail(w, 400, "asset_id and a scene name of 1–120 characters are required")
		return
	}
	if _, err := a.store.GetProject(r.Context(), id); err != nil {
		a.storeError(w, err)
		return
	}
	scene, err := a.assets.CreateScene(r.Context(), database.CreateSceneParams{ProjectID: id, ID: body.AssetID, Name: body.Name})
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 400, "scene requires a completed asset from this project")
		return
	}
	if err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, 201, scene)
}
func (a *API) getScene(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	scene, err := a.assets.GetScene(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, 200, scene)
}
