package httpapi

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"virtual-tour/db"
	"virtual-tour/internal/database"
	"virtual-tour/internal/layout"
	"virtual-tour/internal/walkconfig"
)

func TestImportedRoomAssemblyPublication(t *testing.T) {
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
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	q := database.New(pool)
	project, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Imported assembly publication"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, project.ID)
	asset, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: project.ID, Name: "lobby.glb", Size: 20, StorageKey: uuid.NewString()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := q.CompleteAsset(ctx, asset.ID); err != nil {
		t.Fatal(err)
	}
	handler := New(q, pool.Ping, &publicationObjects{})
	invoke := func(method, path string, body any, status int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		response := call(handler, method, path, string(raw))
		if response.Code != status {
			t.Fatalf("%s %s: %d: %s", method, path, response.Code, response.Body.String())
		}
		return response.Body.Bytes()
	}
	projectPath := "/api/v1/projects/" + project.ID.String()
	doc := layout.Document{Version: 1, Elements: []layout.Element{{ID: uuid.NewString(), Kind: "INSTANCE", Name: "Lobby", Width: 1, Depth: 1, Height: 1, Scale: 1, Collidable: true, AssetID: asset.ID.String()}}, Doors: []layout.Door{}}
	var scene database.Scene
	if err := json.Unmarshal(invoke("POST", projectPath+"/scenes", map[string]any{"type": "LAYOUT", "name": "Imported house", "layout": doc}, 201), &scene); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/scenes/" + scene.ID.String()
	// Imported decoration alone must not become a publishable walking scene.
	invoke("POST", projectPath+"/publish", nil, 400)
	pose := walkconfig.Pose{Position: [3]float64{24, 1.65, 2}, Yaw: .7, Pitch: -.2}
	invoke("PATCH", path, map[string]any{"start_camera": pose}, 400)
	doc.Elements[0].FloorMeshes = []string{"0/0/0"}
	doc.Elements[0].X = 24
	invoke("PUT", path+"/layout", map[string]any{"revision": 1, "document": doc}, 200)
	// Actual mesh floors extend beyond the INSTANCE's 1m editor placeholders.
	// Save the position and orientation, then fetch them through fresh requests.
	invoke("PATCH", path, map[string]any{"start_camera": pose}, 200)
	assertStart := func(raw []byte) {
		t.Helper()
		var saved database.Scene
		if err := json.Unmarshal(raw, &saved); err != nil {
			t.Fatal(err)
		}
		var got walkconfig.Pose
		if err := json.Unmarshal(saved.StartCamera, &got); err != nil || got != pose {
			t.Fatalf("start view did not persist: %s (error: %v)", saved.StartCamera, err)
		}
	}
	assertStart(invoke("GET", path, nil, 200))
	// A reviewed imported room is usable without a generated ROOM/FLOOR element.
	invoke("POST", projectPath+"/publish", nil, 200)
	publicPath := "/api/v1/public/tours/" + project.Slug
	var public struct {
		Scenes []json.RawMessage `json:"scenes"`
	}
	if err := json.Unmarshal(invoke("GET", publicPath, nil, 200), &public); err != nil || len(public.Scenes) != 1 {
		t.Fatalf("public scene missing: %v", err)
	}
	assertStart(public.Scenes[0])
	invoke("GET", publicPath+"/scenes/"+scene.ID.String()+"/layout", nil, 200)
	invoke("GET", publicPath+"/assets/"+asset.ID.String(), nil, 200)
	invoke("POST", projectPath+"/unpublish", nil, 200)
	// Existing reference readiness checks still apply to reviewed assemblies.
	if _, err := pool.Exec(ctx, "UPDATE assets SET upload_status='pending' WHERE id=$1", asset.ID); err != nil {
		t.Fatal(err)
	}
	invoke("POST", projectPath+"/publish", nil, 400)
	if _, err := q.CompleteAsset(ctx, asset.ID); err != nil {
		t.Fatal(err)
	}
	doc.Elements[0].FloorMeshes = nil
	invoke("PUT", path+"/layout", map[string]any{"revision": 2, "document": doc}, 200)
	invoke("PATCH", path, map[string]any{"start_camera": pose}, 400)
	invoke("POST", projectPath+"/publish", nil, 400)
	// Exterior-only floors still cannot supply an interior start.
	doc.Elements = []layout.Element{{ID: uuid.NewString(), Kind: "FLOOR", Name: "Courtyard", X: 24, Width: 6, Depth: 6, Height: .2, Scale: 1, Collidable: true, Exterior: true}}
	invoke("PUT", path+"/layout", map[string]any{"revision": 3, "document": doc}, 200)
	invoke("PATCH", path, map[string]any{"start_camera": pose}, 400)
}
