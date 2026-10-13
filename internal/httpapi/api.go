package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"virtual-tour/internal/database"
)

type Store interface {
	ListProjects(context.Context) ([]database.Project, error)
	GetProject(context.Context, pgtype.UUID) (database.Project, error)
	CreateProject(context.Context, database.CreateProjectParams) (database.Project, error)
	UpdateProject(context.Context, database.UpdateProjectParams) (database.Project, error)
	DeleteProject(context.Context, pgtype.UUID) (int64, error)
	PatchProject(context.Context, database.PatchProjectParams) (database.Project, error)
}

type API struct {
	chunkStreaming ChunkRollout
	splatSupport   SplatRollout
	splatWalking   bool
	splatStreaming bool
	layouts        LayoutStore
	publication    PublicationStore
	store          Store
	ping           func(context.Context) error
	assets         AssetStore
	storage        ObjectStorage
}

func New(store Store, ping func(context.Context) error, storage ...ObjectStorage) http.Handler {
	return NewWithOptions(store, ping, Options{ChunkStreaming: ChunkReviewed, SplatSupport: SplatOn}, storage...)
}
func NewWithOptions(store Store, ping func(context.Context) error, options Options, storage ...ObjectStorage) http.Handler {
	if options.SplatSupport == "" {
		options.SplatSupport = SplatOff
	}
	if options.ChunkStreaming == "" {
		options.ChunkStreaming = ChunkOff
	}
	a := &API{store: store, ping: ping, chunkStreaming: options.ChunkStreaming, splatSupport: options.SplatSupport, splatWalking: options.SplatWalking, splatStreaming: options.SplatStreaming}
	a.assets, _ = store.(AssetStore)
	a.layouts, _ = store.(LayoutStore)
	a.publication, _ = store.(PublicationStore)
	if len(storage) > 0 {
		a.storage = storage[0]
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/capabilities", a.splatCapabilities)
	mux.HandleFunc("GET /health", a.health)
	mux.HandleFunc("GET /api/v1/projects", a.list)
	mux.HandleFunc("POST /api/v1/projects", a.create)
	mux.HandleFunc("GET /api/v1/projects/{id}", a.get)
	mux.HandleFunc("PATCH /api/v1/projects/{id}", a.update)
	mux.HandleFunc("DELETE /api/v1/projects/{id}", a.delete)
	a.assetRoutes(mux)
	a.publicationRoutes(mux)
	return mux
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if value != nil {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func fail(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"error": message})
}
func (a *API) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := a.ping(ctx); err != nil {
		fail(w, 503, "database unavailable")
		return
	}
	respond(w, 200, map[string]string{"status": "ok"})
}
func (a *API) list(w http.ResponseWriter, r *http.Request) {
	projects, err := a.store.ListProjects(r.Context())
	if err != nil {
		a.storeError(w, err)
		return
	}
	if projects == nil {
		projects = []database.Project{}
	}
	respond(w, 200, projects)
}
func projectID(w http.ResponseWriter, r *http.Request) (pgtype.UUID, bool) {
	var id pgtype.UUID
	if err := id.Scan(r.PathValue("id")); err != nil {
		fail(w, 400, "invalid project ID")
		return id, false
	}
	return id, true
}
func (a *API) get(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	project, err := a.store.GetProject(r.Context(), id)
	if err != nil {
		a.storeError(w, err)
		return
	}
	respond(w, 200, project)
}

type input struct {
	Name         *string      `json:"name"`
	Description  *string      `json:"description"`
	StartSceneID *pgtype.UUID `json:"start_scene_id"`
}

func decode(w http.ResponseWriter, r *http.Request) (input, bool) {
	var body *input
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
	d.DisallowUnknownFields()
	if err := d.Decode(&body); err != nil || body == nil {
		fail(w, 400, "invalid JSON body")
		return input{}, false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		fail(w, 400, "expected one JSON object")
		return input{}, false
	}
	if body.Name != nil {
		name := strings.TrimSpace(*body.Name)
		if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 120 {
			fail(w, 400, "name must contain 1–120 characters")
			return input{}, false
		}
		body.Name = &name
	}
	if body.Description != nil && utf8.RuneCountInString(*body.Description) > 5000 {
		fail(w, 400, "description must be at most 5000 characters")
		return input{}, false
	}
	if body.StartSceneID != nil && !body.StartSceneID.Valid {
		fail(w, 400, "start_scene_id must be a scene UUID")
		return input{}, false
	}
	return *body, true
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	body, ok := decode(w, r)
	if !ok {
		return
	}
	if body.Name == nil || body.StartSceneID != nil {
		fail(w, 400, "name is required; choose a start scene after creating the project")
		return
	}
	desc := ""
	if body.Description != nil {
		desc = *body.Description
	}
	project, err := a.store.CreateProject(r.Context(), database.CreateProjectParams{Name: *body.Name, Description: desc})
	if err != nil {
		a.storeError(w, err)
		return
	}
	w.Header().Set("Location", "/api/v1/projects/"+project.ID.String())
	respond(w, 201, project)
}
func (a *API) update(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	body, ok := decode(w, r)
	if !ok {
		return
	}
	if body.Name == nil && body.Description == nil && body.StartSceneID == nil {
		fail(w, 400, "name, description or start_scene_id is required")
		return
	}
	if _, err := a.store.GetProject(r.Context(), id); err != nil {
		a.storeError(w, err)
		return
	}
	params := database.PatchProjectParams{ID: id}
	if body.Name != nil {
		params.Name = pgtype.Text{String: *body.Name, Valid: true}
	}
	if body.Description != nil {
		params.Description = pgtype.Text{String: *body.Description, Valid: true}
	}
	if body.StartSceneID != nil {
		params.SetStart = true
		params.StartSceneID = *body.StartSceneID
	}
	project, err := a.store.PatchProject(r.Context(), params)
	if errors.Is(err, pgx.ErrNoRows) && params.SetStart {
		fail(w, 400, "start scene must belong to this project")
		return
	}
	if err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, 200, project)
}
func (a *API) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	count, err := a.store.DeleteProject(r.Context(), id)
	if err != nil {
		a.storeError(w, err)
		return
	}
	if count == 0 {
		fail(w, 404, "project not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *API) storeError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "project not found")
		return
	}
	slog.Error("database operation failed", "error", err)
	fail(w, 500, "could not save or load project")
}
