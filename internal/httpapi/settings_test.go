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
	"virtual-tour/internal/sceneconfig"
)

func TestInvalidSceneSettings(t *testing.T) {
	handler := New(nil, func(context.Context) error { return nil })
	for _, body := range []string{`{"settings":{}}`, `{"settings":{"appearance":{"exposure":1,"background":"javascript:red"}}}`, `{"settings":{"extra":1}}`, `{"settings":null}`} {
		response := call(handler, "PATCH", "/api/v1/scenes/00000000-0000-0000-0000-000000000001", body)
		if response.Code != 400 {
			t.Fatalf("%s: %d", body, response.Code)
		}
	}
}
func TestSceneSettingsPersistence(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to test scene settings")
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
	project, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Scene settings test"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, project.ID)
	asset, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: project.ID, Name: "house.glb", StorageKey: uuid.NewString(), Size: 20})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = q.CompleteAsset(ctx, asset.ID); err != nil {
		t.Fatal(err)
	}
	scene, err := q.CreateScene(ctx, database.CreateSceneParams{ProjectID: project.ID, ID: asset.ID, Name: "Lobby"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = q.CreateHotspot(ctx, database.CreateHotspotParams{SceneID: scene.ID, Type: "INFO", Title: "Artwork", Position: json.RawMessage(`{"x":1,"y":2,"z":3}`)})
	if err != nil {
		t.Fatal(err)
	}
	handler := New(q, pool.Ping)
	path := "/api/v1/scenes/" + scene.ID.String()
	camera := `{"start_camera":{"position":[1,2,3],"yaw":0,"pitch":0}}`
	if response := call(handler, "PATCH", path, camera); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	settings := sceneconfig.Default()
	settings.Appearance.Exposure = 1.4
	settings.Model = sceneconfig.Model{Scale: 2, UpAxis: "Z", Rotation: 0}
	raw, _ := json.Marshal(map[string]any{"settings": settings})
	response := call(handler, "PATCH", path, string(raw))
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	persisted, err := q.GetScene(ctx, scene.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sceneconfig.Decode(persisted.Settings).Appearance.Exposure != 1.4 || string(persisted.StartCamera) != "{}" {
		t.Fatalf("settings/start mismatch: %+v", persisted)
	}
	hotspots, err := q.ListHotspots(ctx, scene.ID)
	if err != nil {
		t.Fatal(err)
	}
	var point map[string]float64
	json.Unmarshal(hotspots[0].Position, &point)
	if point["x"] != 2 || point["y"] != 6 || point["z"] != -4 {
		t.Fatalf("hotspot not transformed: %v", point)
	}
	// Appearance-only changes retain an explicitly saved camera.
	if r := call(handler, "PATCH", path, camera); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	settings.Appearance.Background = "#102030"
	settings.Appearance.HQShadows = true
	raw, _ = json.Marshal(map[string]any{"settings": settings})
	if r := call(handler, "PATCH", path, string(raw)); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	persisted, _ = q.GetScene(ctx, scene.ID)
	if !sceneconfig.Decode(persisted.Settings).Appearance.HQShadows {
		t.Fatal("HQ shadow preference not persisted")
	}
	if string(persisted.StartCamera) == "{}" {
		t.Fatal("appearance cleared camera")
	}
	_, err = q.SetStartScene(ctx, database.SetStartSceneParams{ID: project.ID, SceneID: scene.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = q.PublishProject(ctx, project.ID); err != nil {
		t.Fatal(err)
	}
	public := call(handler, "GET", "/api/v1/public/tours/"+project.Slug, "")
	if public.Code != 200 {
		t.Fatal(public.Body.String())
	}
	var tour struct {
		Scenes []database.Scene `json:"scenes"`
	}
	json.Unmarshal(public.Body.Bytes(), &tour)
	if len(tour.Scenes) != 1 || sceneconfig.Decode(tour.Scenes[0].Settings).Appearance.Background != "#102030" {
		t.Fatal("public settings missing")
	}
	// A transform that moves a hotspot out of range rolls back the whole save.
	before := persisted
	oversized := settings
	oversized.Model.Scale = 1000000
	invalid, _ := json.Marshal(map[string]any{"settings": oversized})
	if r := call(handler, "PATCH", path, string(invalid)); r.Code != 400 {
		t.Fatalf("out-of-range transform accepted: %d %s", r.Code, r.Body.String())
	}
	after, _ := q.GetScene(ctx, scene.ID)
	if string(after.Settings) != string(before.Settings) || string(after.StartCamera) != string(before.StartCamera) {
		t.Fatal("failed transform partially saved scene")
	}
	afterHotspots, _ := q.ListHotspots(ctx, scene.ID)
	if string(afterHotspots[0].Position) != string(hotspots[0].Position) {
		t.Fatal("failed transform partially moved hotspot")
	}
	// Full settings are not accepted on panoramas.
	_, err = pool.Exec(ctx, "UPDATE assets SET file_type='PANORAMA' WHERE id=$1", asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, "UPDATE scenes SET type='PANORAMA' WHERE id=$1", scene.ID)
	if err != nil {
		t.Fatal(err)
	}
	if r := call(handler, "PATCH", path, string(raw)); r.Code != 400 {
		t.Fatalf("panorama settings accepted: %d", r.Code)
	}
}
