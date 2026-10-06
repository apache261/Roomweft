package httpapi

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"virtual-tour/db"
	"virtual-tour/internal/database"
)

func TestInvalidCameraInput(t *testing.T) {
	handler := New(nil, func(context.Context) error { return nil })
	for _, body := range []string{
		`{"start_camera":{"position":[null,2,3],"yaw":0,"pitch":0}}`, `null`, `{}`, `{"start_camera":null}`, `{"start_camera":{}}`,
		`{"start_camera":{"position":[1,2],"yaw":0,"pitch":0}}`,
		`{"start_camera":{"position":[1,2,3],"yaw":0}}`,
		`{"start_camera":{"position":[1,2,3],"yaw":4,"pitch":0}}`,
		`{"start_camera":{"position":[1,2,3],"yaw":0,"pitch":1.57}}`,
		`{"start_camera":{"position":[1e7,2,3],"yaw":0,"pitch":0}}`,
		`{"start_camera":{"position":[1,2,3],"yaw":0,"pitch":0,"extra":1}}`,
		`{"start_camera":{"position":[1,2,3],"yaw":null,"pitch":0}}`,
		`{"start_camera":{"position":[1,2,3],"yaw":0,"pitch":0}} {}`,
	} {
		result := call(handler, "PATCH", "/api/v1/scenes/00000000-0000-0000-0000-000000000001", body)
		if result.Code != 400 {
			t.Fatalf("%s: %d %s", body, result.Code, result.Body.String())
		}
	}
}

func TestCameraPersistence(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to test camera persistence")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	queries := database.New(pool)
	project, err := queries.CreateProject(ctx, database.CreateProjectParams{Name: "Camera test"})
	if err != nil {
		t.Fatal(err)
	}
	defer queries.DeleteProject(context.Background(), project.ID)
	asset, err := queries.CreateAsset(ctx, database.CreateAssetParams{ProjectID: project.ID, Name: "house.glb", StorageKey: uuid.NewString(), Size: 20})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := queries.CompleteAsset(ctx, asset.ID); err != nil {
		t.Fatal(err)
	}
	scene, err := queries.CreateScene(ctx, database.CreateSceneParams{ProjectID: project.ID, ID: asset.ID, Name: "House"})
	if err != nil {
		t.Fatal(err)
	}
	body := `{"start_camera":{"position":[0.5,1.75,1],"yaw":0.4,"pitch":-0.1}}`
	path := "/api/v1/scenes/" + scene.ID.String()
	result := call(New(queries, pool.Ping), "PATCH", path, body)
	if result.Code != 200 {
		t.Fatal(result.Body.String())
	}
	fresh, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	restarted := New(database.New(fresh), fresh.Ping)
	for _, route := range []string{path, "/api/v1/projects/" + project.ID.String() + "/scenes"} {
		result := call(restarted, "GET", route, "")
		var scenes []database.Scene
		if route == path {
			var s database.Scene
			json.Unmarshal(result.Body.Bytes(), &s)
			scenes = append(scenes, s)
		} else {
			json.Unmarshal(result.Body.Bytes(), &scenes)
		}
		if result.Code != 200 || len(scenes) != 1 {
			t.Fatal(result.Body.String())
		}
		var camera struct {
			Position []float64
			Yaw      float64
			Pitch    float64
		}
		if err := json.Unmarshal(scenes[0].StartCamera, &camera); err != nil {
			t.Fatal(err)
		}
		if len(camera.Position) != 3 || camera.Position[0] != 0.5 || math.Abs(camera.Yaw-0.4) > 1e-9 || camera.Pitch != -0.1 {
			t.Fatalf("camera did not persist: %s", scenes[0].StartCamera)
		}
	}
	if result := call(restarted, "PATCH", "/api/v1/scenes/"+uuid.NewString(), body); result.Code != 404 {
		t.Fatalf("missing scene: %d", result.Code)
	}
}
