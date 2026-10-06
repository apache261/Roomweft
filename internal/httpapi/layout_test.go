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
)

func TestLayoutPersistenceReferencesRevisionAndAttachments(t *testing.T) {
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
	p, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Layout integration"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := q.DeleteProject(ctx, p.ID); err != nil {
			t.Error("project cleanup:", err)
		}
	}()
	foreign, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Other layout project"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, foreign.ID)
	asset, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: p.ID, Name: "chair.glb", Size: 20, StorageKey: uuid.NewString()})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = q.CompleteAsset(ctx, asset.ID)
	other, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: foreign.ID, Name: "private.glb", Size: 20, StorageKey: uuid.NewString()})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = q.CompleteAsset(ctx, other.ID)
	room := layout.Element{ID: uuid.NewString(), Kind: "LOBBY", Name: "Lobby", Width: 6, Depth: 6, Height: 3, Scale: 1, Collidable: true}
	instance := layout.Element{ID: uuid.NewString(), Kind: "INSTANCE", Name: "Chair", X: 1, Width: 1, Depth: 1, Height: 1, Scale: 1, Collidable: true, AssetID: asset.ID.String()}
	doc := layout.Document{Version: 1, Elements: []layout.Element{room, instance}, Doors: []layout.Door{}}
	handler := New(q, pool.Ping, &publicationObjects{})
	invoke := func(method, path string, body any, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		response := call(handler, method, path, string(raw))
		if response.Code != want {
			t.Fatalf("%s %s: %d: %s", method, path, response.Code, response.Body.String())
		}
		return response.Body.Bytes()
	}
	var scene database.Scene
	raw := invoke("POST", "/api/v1/projects/"+p.ID.String()+"/scenes", map[string]any{"type": "LAYOUT", "name": "Layout", "layout": doc}, 201)
	if err = json.Unmarshal(raw, &scene); err != nil {
		t.Fatal(err)
	}
	if scene.AssetID.Valid || scene.Type != "LAYOUT" || scene.LayoutRevision != 1 {
		t.Fatal(scene)
	}
	path := "/api/v1/scenes/" + scene.ID.String()
	invoke("GET", path+"/layout", nil, 200)
	invoke("DELETE", "/api/v1/assets/"+asset.ID.String(), nil, 409)
	local := layout.Attachment{ElementID: instance.ID, Local: [3]float64{0, 1, 0}}
	point := layout.Point{X: 1, Y: 1, Z: 0, Attachment: &local}
	var h database.Hotspot
	raw = invoke("POST", path+"/hotspots", map[string]any{"type": "INFO", "title": "Chair details", "position": point}, 201)
	_ = json.Unmarshal(raw, &h)
	invoke("PATCH", path, map[string]any{"start_camera": map[string]any{"position": []float64{0, 1.65, 0}, "yaw": 0, "pitch": 0}}, 200)
	doc.Elements[1].X = 2
	doc.Elements[1].Scale = 2
	doc.Elements[1].Rotation = 90
	raw = invoke("PUT", path+"/layout", map[string]any{"revision": 1, "document": doc}, 200)
	_ = json.Unmarshal(raw, &scene)
	if scene.LayoutRevision != 2 || string(scene.StartCamera) != "{}" {
		t.Fatal(scene)
	}
	updated, err := q.GetHotspot(ctx, h.ID)
	if err != nil {
		t.Fatal(err)
	}
	var moved layout.Point
	_ = json.Unmarshal(updated.Position, &moved)
	if moved.X != 2 || moved.Y != 2 || moved.Z != 0 || moved.Attachment.ElementID != instance.ID {
		t.Fatal(moved)
	}
	// Stale writers cannot overwrite a newer document or its references.
	invoke("PUT", path+"/layout", map[string]any{"revision": 1, "document": doc}, 409)
	doc.Elements[1].AssetID = other.ID.String()
	invoke("PUT", path+"/layout", map[string]any{"revision": 2, "document": doc}, 400)
	doc.Elements[1].AssetID = asset.ID.String()
	doc.Elements = doc.Elements[:1]
	invoke("PUT", path+"/layout", map[string]any{"revision": 2, "document": doc}, 409)
	current, _ := q.GetScene(ctx, scene.ID)
	if current.LayoutRevision != 2 {
		t.Fatal("failed saves changed revision")
	}
	invoke("POST", "/api/v1/projects/"+p.ID.String()+"/publish", nil, 200)
	prefix := "/api/v1/public/tours/" + p.Slug
	invoke("GET", prefix+"/scenes/"+scene.ID.String()+"/layout", nil, 200)
	invoke("GET", prefix+"/assets/"+asset.ID.String(), nil, 200)
	invoke("GET", prefix+"/assets/"+other.ID.String(), nil, 404)
	// A hotspot must be explicitly detached before deleting its attached instance.
	moved.Attachment = nil
	invoke("PATCH", "/api/v1/hotspots/"+h.ID.String(), map[string]any{"type": "INFO", "title": "Chair details", "position": moved}, 200)
	invoke("PUT", path+"/layout", map[string]any{"revision": 2, "document": doc}, 200)
	invoke("GET", prefix+"/assets/"+asset.ID.String(), nil, 404)
	invoke("DELETE", "/api/v1/assets/"+asset.ID.String(), nil, 204)
	loaded, _ := database.New(pool).GetScene(ctx, scene.ID)
	if layout.Decode(loaded.Layout).Elements[0].ID != room.ID || loaded.LayoutRevision != 3 {
		t.Fatal(loaded)
	}
	// Keep a referenced instance for cleanup, proving whole-project cascade
	// works while individual asset deletion remains protected.
	doc.Elements = append(doc.Elements, layout.Element{ID: uuid.NewString(), Kind: "INSTANCE", Name: "Private chair", Width: 1, Depth: 1, Height: 1, Scale: 1, Collidable: true, AssetID: other.ID.String()})
	// Foreign references are still rejected even after removing other references.
	invoke("PUT", path+"/layout", map[string]any{"revision": 3, "document": doc}, 400)
	retained, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: p.ID, Name: "retained.glb", Size: 20, StorageKey: uuid.NewString()})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = q.CompleteAsset(ctx, retained.ID)
	doc.Elements[1].AssetID = retained.ID.String()
	invoke("PUT", path+"/layout", map[string]any{"revision": 3, "document": doc}, 200)
	invoke("DELETE", "/api/v1/assets/"+retained.ID.String(), nil, 409)
	invoke("POST", "/api/v1/projects/"+p.ID.String()+"/unpublish", nil, 200)
	invoke("GET", prefix+"/scenes/"+scene.ID.String()+"/layout", nil, 404)
}
