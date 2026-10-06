package httpapi

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"testing"
	"virtual-tour/db"
	"virtual-tour/internal/database"
	"virtual-tour/internal/layout"
	"virtual-tour/internal/materials"
	"virtual-tour/internal/sceneconfig"
)

func TestTexturePersistenceRolesAndPublicAccess(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	q := database.New(pool)
	project, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Tiled materials test"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := q.DeleteProject(ctx, project.ID); err != nil {
			t.Error("cascade", err)
		}
	}()
	foreign, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Foreign texture test"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, foreign.ID)
	makeAsset := func(projectID pgtype.UUID, kind string, ready bool) database.Asset {
		t.Helper()
		a, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: projectID, Name: "map.png", Size: 20, StorageKey: uuid.NewString(), FileType: pgtype.Text{String: kind, Valid: true}})
		if err != nil {
			t.Fatal(err)
		}
		if ready {
			a, err = q.CompleteAsset(ctx, a.ID)
			if err != nil {
				t.Fatal(err)
			}
		}
		return a
	}
	color := makeAsset(project.ID, "TEXTURE_BASE_COLOR", true)
	normal := makeAsset(project.ID, "TEXTURE_NORMAL", true)
	rough := makeAsset(project.ID, "TEXTURE_ROUGHNESS", true)
	ao := makeAsset(project.ID, "TEXTURE_AO", true)
	lightmap := makeAsset(project.ID, "TEXTURE_LIGHTMAP", true)
	pending := makeAsset(project.ID, "TEXTURE_BASE_COLOR", false)
	unused := makeAsset(project.ID, "TEXTURE_BASE_COLOR", true)
	other := makeAsset(foreign.ID, "TEXTURE_BASE_COLOR", true)
	p := materials.Preset{ID: uuid.NewString(), Name: "Stone", BaseColor: color.ID.String(), Normal: normal.ID.String(), RoughnessMap: rough.ID.String(), AOMap: ao.ID.String(), LightMap: lightmap.ID.String(), BakeRevision: "bake-v1:0123456789abcdef0123456789abcdef", TileSize: 0.5, Repeat: [2]float64{1, 1}, Tint: "#ffffff", Roughness: 0.8}
	doc := layout.Document{Version: 1, Materials: []materials.Preset{p}, Elements: []layout.Element{{ID: uuid.NewString(), Kind: "LOBBY", Name: "Lobby", Width: 6, Depth: 6, Height: 3, Scale: 1, Collidable: true, FloorMaterial: p.ID}}, Doors: []layout.Door{}}
	handler := New(q, pool.Ping, &publicationObjects{})
	invoke := func(method, path string, body any, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := call(handler, method, path, string(raw))
		if r.Code != want {
			t.Fatalf("%s %s = %d: %s", method, path, r.Code, r.Body.String())
		}
		return r.Body.Bytes()
	}
	var scene database.Scene
	json.Unmarshal(invoke("POST", "/api/v1/projects/"+project.ID.String()+"/scenes", map[string]any{"type": "LAYOUT", "name": "Tiled lobby", "layout": doc}, 201), &scene)
	path := "/api/v1/scenes/" + scene.ID.String()
	save := func(doc layout.Document, want int) {
		invoke("PUT", path+"/layout", map[string]any{"revision": 1, "document": doc}, want)
	}
	for _, id := range []string{normal.ID.String(), pending.ID.String(), other.ID.String()} {
		bad := doc
		bad.Materials = append([]materials.Preset(nil), doc.Materials...)
		bad.Materials[0].BaseColor = id
		save(bad, 400)
	}
	invoke("PATCH", path, map[string]any{"settings": sceneconfig.Default()}, 200) // Lighting cannot clear layout texture references.
	for _, a := range []database.Asset{color, normal, rough, ao, lightmap} {
		invoke("DELETE", "/api/v1/assets/"+a.ID.String(), nil, 409)
	}
	loaded, _ := q.GetScene(ctx, scene.ID)
	if layout.Decode(loaded.Layout).Materials[0].TileSize != 0.5 || loaded.LayoutRevision != 1 {
		t.Fatal("failed save changed document")
	}
	invoke("POST", "/api/v1/projects/"+project.ID.String()+"/publish", nil, 200)
	prefix := "/api/v1/public/tours/" + project.Slug
	for _, a := range []database.Asset{color, normal, rough, ao, lightmap} {
		invoke("GET", prefix+"/assets/"+a.ID.String(), nil, 200)
	}
	for _, a := range []database.Asset{pending, unused, other} {
		invoke("GET", prefix+"/assets/"+a.ID.String(), nil, 404)
	}
	// Imported scenes persist the same presets through settings; each protects its references.
	glb := makeAsset(project.ID, "GLB", true)
	imported, err := q.CreateScene(ctx, database.CreateSceneParams{ProjectID: project.ID, ID: glb.ID, Name: "Imported"})
	if err != nil {
		t.Fatal(err)
	}
	settings := sceneconfig.Default()
	settings.Materials = []materials.Preset{p}
	settings.SurfaceMaterials = map[string]string{"0/0": p.ID}
	invoke("PATCH", "/api/v1/scenes/"+imported.ID.String(), map[string]any{"settings": settings}, 200)
	doc.Materials = nil
	doc.Elements[0].FloorMaterial = ""
	save(doc, 200)
	invoke("DELETE", "/api/v1/assets/"+color.ID.String(), nil, 409)
	invoke("DELETE", "/api/v1/scenes/"+imported.ID.String(), nil, 204)
	invoke("GET", prefix+"/assets/"+color.ID.String(), nil, 404)
	invoke("DELETE", "/api/v1/assets/"+color.ID.String(), nil, 204)
	// Keep referenced maps for whole-project cascade verification.
	p.BaseColor = ""
	doc.Materials = []materials.Preset{p}
	doc.Elements[0].WallMaterial = p.ID
	invoke("PUT", path+"/layout", map[string]any{"revision": 2, "document": doc}, 200)
	invoke("POST", "/api/v1/projects/"+project.ID.String()+"/unpublish", nil, 200)
	invoke("GET", prefix+"/assets/"+normal.ID.String(), nil, 404)
}
