package httpapi

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"testing"
	"virtual-tour/db"
	"virtual-tour/internal/database"
	"virtual-tour/internal/layout"
	"virtual-tour/internal/sceneconfig"
	"virtual-tour/internal/walkconfig"
)

func TestWalkingRegionsPortalReferencesAndPublication(t *testing.T) {
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
	project, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Walking integration"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := q.DeleteProject(ctx, project.ID); err != nil {
			t.Error("cascade", err)
		}
	}()
	handler := New(q, pool.Ping, &publicationObjects{})
	invoke := func(method, path string, body any, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		response := call(handler, method, path, string(raw))
		if response.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, response.Code, response.Body.String())
		}
		return response.Body.Bytes()
	}
	room := layout.Element{ID: uuid.NewString(), Kind: "LOBBY", Name: "Lobby", Width: 6, Depth: 6, Height: 3, Scale: 1, Collidable: true}
	floor := layout.Element{ID: uuid.NewString(), Kind: "FLOOR", Name: "Courtyard", X: 8, Width: 6, Depth: 6, Height: .2, Scale: 1, Collidable: true, Exterior: true}
	doc := layout.Document{Version: 1, Elements: []layout.Element{room, floor}, Doors: []layout.Door{}}
	create := func(name string) database.Scene {
		var scene database.Scene
		json.Unmarshal(invoke("POST", "/api/v1/projects/"+project.ID.String()+"/scenes", map[string]any{"type": "LAYOUT", "name": name, "layout": doc}, 201), &scene)
		return scene
	}
	scene := create("Inside")
	destination := create("Other building")
	path := "/api/v1/scenes/" + scene.ID.String()
	nav := walkconfig.Default()
	nav.Portals = []walkconfig.Portal{{ID: uuid.NewString(), Label: "Enter courtyard", Position: [3]float64{0, 1.65, 2}, Axis: "z", Width: 1.2, DestinationSceneID: destination.ID.String(), DestinationRegionID: floor.ID, Arrival: walkconfig.Pose{Position: [3]float64{8, 1.65, 0}}}}
	doc.Navigation = &nav
	invoke("PUT", path+"/layout", map[string]any{"revision": 1, "document": doc}, 200)
	invoke("DELETE", "/api/v1/scenes/"+destination.ID.String(), nil, 400) // durable same-project destination FK
	invoke("PATCH", path, map[string]any{"start_camera": walkconfig.Pose{Position: [3]float64{50, 1.65, 0}}}, 400)
	invoke("PATCH", path, map[string]any{"start_camera": walkconfig.Pose{Position: [3]float64{0, 1.65, 0}}}, 200)
	nav.Portals[0].Arrival.Position = [3]float64{50, 1.65, 0}
	invoke("PUT", path+"/layout", map[string]any{"revision": 2, "document": doc}, 400)
	nav.Portals[0].Arrival.Position = [3]float64{8, 1.65, 0}
	invoke("PUT", path+"/layout", map[string]any{"revision": 1, "document": doc}, 409)
	invoke("POST", "/api/v1/projects/"+project.ID.String()+"/publish", nil, 200)
	invoke("GET", "/api/v1/public/tours/"+project.Slug+"/scenes/"+scene.ID.String()+"/layout", nil, 200)
	// A destination edit can invalidate an older arrival; publication rechecks it.
	changed := layout.Document{Version: 1, Elements: []layout.Element{room}, Doors: []layout.Door{}}
	invoke("PUT", "/api/v1/scenes/"+destination.ID.String()+"/layout", map[string]any{"revision": 1, "document": changed}, 200)
	invoke("POST", "/api/v1/projects/"+project.ID.String()+"/publish", nil, 400)
	nav.Portals[0].DestinationSceneID = ""
	invoke("PUT", path+"/layout", map[string]any{"revision": 2, "document": doc}, 200)
	invoke("DELETE", "/api/v1/scenes/"+destination.ID.String(), nil, 204)
	asset, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: project.ID, Name: "Building.glb", Size: 20, StorageKey: uuid.NewString()})
	if err != nil {
		t.Fatal(err)
	}
	q.CompleteAsset(ctx, asset.ID)
	imported, err := q.CreateScene(ctx, database.CreateSceneParams{ProjectID: project.ID, ID: asset.ID, Name: "Imported"})
	if err != nil {
		t.Fatal(err)
	}
	settings := sceneconfig.Default()
	settings.Navigation = &walkconfig.Config{Speed: 2, EyeHeight: 1.65, StepHeight: .25, MaxSlope: 40, Regions: []walkconfig.Region{{ID: uuid.NewString(), Name: "Reviewed", Left: -2, Right: 2, Top: -2, Bottom: 2, MinY: 0, MaxY: .1, FloorMeshes: []string{"0/0"}}}, Portals: []walkconfig.Portal{}}
	importedPath := "/api/v1/scenes/" + imported.ID.String()
	invoke("PATCH", importedPath, map[string]any{"settings": settings}, 200)
	invoke("PATCH", importedPath, map[string]any{"start_camera": walkconfig.Pose{Position: [3]float64{0, 1.65, 0}}}, 200)
	settings.Model.Scale = 2
	invoke("PATCH", importedPath, map[string]any{"settings": settings}, 200)
	saved, _ := q.GetScene(ctx, imported.ID)
	if sceneconfig.Decode(saved.Settings).Navigation != nil || string(saved.StartCamera) != "{}" {
		t.Fatal("preparation retained obsolete reviewed walking coordinates")
	}
}
