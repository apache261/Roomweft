package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"virtual-tour/db"
	"virtual-tour/internal/database"
	"virtual-tour/internal/storage"
)

func TestNavigationInvalidInput(t *testing.T) {
	handler := New(nil, func(context.Context) error { return nil })
	path := "/api/v1/scenes/00000000-0000-0000-0000-000000000001"
	for _, body := range []string{`{}`, `null`, `{"name":" "}`, `{"move":"sideways"}`, `{"name":"ok","unknown":1}`} {
		if result := call(handler, "PATCH", path, body); result.Code != 400 {
			t.Fatalf("%s: %d", body, result.Code)
		}
	}
	for _, body := range []string{`{}`, `null`, `{"title":"Link","position":{"yaw":0,"pitch":0}}`, `{"title":"Link","destination_scene_id":"00000000-0000-0000-0000-000000000002","position":{"x":0,"y":1}}`, `{"type":"INFO","title":"Link","destination_scene_id":"00000000-0000-0000-0000-000000000002","position":{"yaw":0,"pitch":0}}`, `{"title":"Link","destination_scene_id":"00000000-0000-0000-0000-000000000002","position":{"yaw":0,"pitch":2}}`} {
		if result := call(handler, "POST", path+"/hotspots", body); result.Code != 400 {
			t.Fatalf("%s: %d", body, result.Code)
		}
	}
}

func TestPanoramaNavigationPersistence(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" || os.Getenv("TEST_S3") == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_S3 with storage configuration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	objects, err := storage.FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	handler := New(database.New(pool), pool.Ping, objects)
	projectResult := call(handler, "POST", "/api/v1/projects", `{"name":"Phase 4 integration"}`)
	var project database.Project
	json.Unmarshal(projectResult.Body.Bytes(), &project)
	if projectResult.Code != 201 {
		t.Fatal(projectResult.Body.String())
	}
	defer database.New(pool).DeleteProject(context.Background(), project.ID)
	base := "/api/v1/projects/" + project.ID.String()
	upload := func(name string, data []byte, expected int) database.Asset {
		t.Helper()
		result := call(handler, "POST", base+"/uploads", fmt.Sprintf(`{"name":%q,"size":%d}`, name, len(data)))
		if result.Code != 201 {
			t.Fatal(result.Body.String())
		}
		var ticket struct {
			Asset  database.Asset `json:"asset"`
			Upload storage.Upload `json:"upload"`
		}
		json.Unmarshal(result.Body.Bytes(), &ticket)
		deferCleanupKey := ticket.Asset.StorageKey
		t.Cleanup(func() { objects.Delete(context.Background(), deferCleanupKey) })
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		for key, value := range ticket.Upload.Fields {
			form.WriteField(key, value)
		}
		part, _ := form.CreateFormFile("file", name)
		part.Write(data)
		form.Close()
		req, _ := http.NewRequestWithContext(ctx, "POST", ticket.Upload.URL, &body)
		req.Header.Set("Content-Type", form.FormDataContentType())
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		responseBody, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode >= 300 {
			t.Fatalf("upload: %d %s", response.StatusCode, responseBody)
		}
		complete := call(handler, "POST", "/api/v1/assets/"+ticket.Asset.ID.String()+"/complete", "")
		if complete.Code != expected {
			t.Fatalf("complete %s: %d %s", name, complete.Code, complete.Body.String())
		}
		if expected == 200 {
			json.Unmarshal(complete.Body.Bytes(), &ticket.Asset)
		}
		return ticket.Asset
	}
	var square bytes.Buffer
	png.Encode(&square, image.NewRGBA(image.Rect(0, 0, 128, 128)))
	bad := upload("square.png", square.Bytes(), 422)
	if result := call(handler, "POST", base+"/scenes", fmt.Sprintf(`{"asset_id":"%s","name":"Bad"}`, bad.ID.String())); result.Code != 400 {
		t.Fatal("created a scene from an invalid panorama")
	}
	pngBytes, _ := os.ReadFile("../../tests/testdata/panorama-a.png")
	upload("wrong.jpg", pngBytes, 422)
	upload("truncated.png", pngBytes[:len(pngBytes)/2], 422)
	scenes := []database.Scene{}
	for _, name := range []string{"panorama-a.png", "panorama-b.jpg", "panorama.webp", "house.glb"} {
		data, err := os.ReadFile("../../tests/testdata/" + name)
		if err != nil {
			t.Fatal(err)
		}
		asset := upload(name, data, 200)
		result := call(handler, "POST", base+"/scenes", fmt.Sprintf(`{"asset_id":"%s","name":%q}`, asset.ID.String(), name))
		if result.Code != 201 {
			t.Fatal(result.Body.String())
		}
		var scene database.Scene
		json.Unmarshal(result.Body.Bytes(), &scene)
		scenes = append(scenes, scene)
		expected := "PANORAMA"
		if name == "house.glb" {
			expected = "3D"
		}
		if scene.Type != expected {
			t.Fatalf("scene type %s", scene.Type)
		}
		assetResponse := call(handler, "GET", "/api/v1/assets/"+asset.ID.String(), "")
		var loaded struct {
			URL string `json:"url"`
		}
		json.Unmarshal(assetResponse.Body.Bytes(), &loaded)
		response, err := http.Get(loaded.URL)
		if err != nil {
			t.Fatal(err)
		}
		original, _ := io.ReadAll(response.Body)
		response.Body.Close()
		_, mime, _ := storage.Format(name)
		if response.Header.Get("Content-Type") != mime || !bytes.Equal(original, data) {
			t.Fatalf("original or MIME mismatch: %s", name)
		}
	}
	path := func(i int) string { return "/api/v1/scenes/" + scenes[i].ID.String() }
	check := func(method, route, body string, status int) []byte {
		t.Helper()
		result := call(handler, method, route, body)
		if result.Code != status {
			t.Fatalf("%s %s: %d %s", method, route, result.Code, result.Body.String())
		}
		return result.Body.Bytes()
	}
	var defaultProject database.Project
	json.Unmarshal(check("GET", base, "", 200), &defaultProject)
	if defaultProject.StartSceneID != scenes[0].ID {
		t.Fatal("first scene is not the default start")
	}
	check("PATCH", path(0), `{"name":"Entry","start_camera":{"yaw":0.3,"pitch":-0.2}}`, 200)
	check("PATCH", path(1), `{"move":"up"}`, 200)
	check("PATCH", path(1), `{"move":"up"}`, 200) // first-position boundary is a no-op
	check("PATCH", base, fmt.Sprintf(`{"start_scene_id":"%s"}`, scenes[1].ID.String()), 200)
	check("PATCH", path(0), `{"start_camera":{"position":[0,0,0],"yaw":0,"pitch":0}}`, 400)
	check("PATCH", path(3), `{"start_camera":{"yaw":0,"pitch":0}}`, 400)
	link := func(from, to int, position string) database.Hotspot {
		t.Helper()
		var h database.Hotspot
		json.Unmarshal(check("POST", path(from)+"/hotspots", fmt.Sprintf(`{"type":"NAVIGATION","title":"Link %d to %d","position":%s,"destination_scene_id":"%s"}`, from, to, position, scenes[to].ID.String()), 201), &h)
		return h
	}
	link(0, 1, `{"yaw":0,"pitch":0}`)
	link(1, 0, `{"yaw":0.5,"pitch":0.1}`)
	link(1, 3, `{"yaw":1,"pitch":0}`)
	link(3, 0, `{"x":0,"y":1.5,"z":-2.3}`)
	removable := link(2, 3, `{"yaw":0,"pitch":0}`)
	check("DELETE", "/api/v1/hotspots/"+removable.ID.String(), "", 204)
	check("DELETE", "/api/v1/hotspots/"+removable.ID.String(), "", 404)
	otherResult := check("POST", "/api/v1/projects", `{"name":"Other navigation project"}`, 201)
	var other database.Project
	json.Unmarshal(otherResult, &other)
	defer database.New(pool).DeleteProject(context.Background(), other.ID)
	check("PATCH", "/api/v1/projects/"+other.ID.String(), fmt.Sprintf(`{"start_scene_id":"%s"}`, scenes[0].ID.String()), 400)
	check("POST", path(0)+"/hotspots", fmt.Sprintf(`{"title":"Self","position":{"yaw":0,"pitch":0},"destination_scene_id":"%s"}`, scenes[0].ID.String()), 400)
	check("POST", path(0)+"/hotspots", fmt.Sprintf(`{"title":"Missing","position":{"yaw":0,"pitch":0},"destination_scene_id":"%s"}`, uuid.NewString()), 400)
	check("POST", path(0)+"/hotspots", fmt.Sprintf(`{"title":"Wrong coordinates","position":{"x":0,"y":0,"z":0},"destination_scene_id":"%s"}`, scenes[1].ID.String()), 400)
	// Create an actual destination in a different project to test reference isolation.
	foreignAsset, err := database.New(pool).CreateAsset(ctx, database.CreateAssetParams{ProjectID: other.ID, Name: "foreign.glb", StorageKey: uuid.NewString(), Size: 20})
	if err != nil {
		t.Fatal(err)
	}
	database.New(pool).CompleteAsset(ctx, foreignAsset.ID)
	foreignScene, err := database.New(pool).CreateScene(ctx, database.CreateSceneParams{ProjectID: other.ID, ID: foreignAsset.ID, Name: "Foreign"})
	if err != nil {
		t.Fatal(err)
	}
	check("POST", path(0)+"/hotspots", fmt.Sprintf(`{"title":"Foreign","position":{"yaw":0,"pitch":0},"destination_scene_id":"%s"}`, foreignScene.ID.String()), 400)
	check("DELETE", "/api/v1/assets/"+scenes[0].AssetID.String(), "", 409)
	fresh, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	handler = New(database.New(fresh), fresh.Ping, objects)
	var persisted []database.Scene
	json.Unmarshal(check("GET", base+"/scenes", "", 200), &persisted)
	if len(persisted) != 4 || persisted[0].ID != scenes[1].ID || persisted[1].Name != "Entry" || !bytes.Contains(persisted[1].StartCamera, []byte("0.3")) {
		t.Fatalf("scene changes not persisted: %+v", persisted)
	}
	var projectReload database.Project
	json.Unmarshal(check("GET", base, "", 200), &projectReload)
	if projectReload.StartSceneID != scenes[1].ID {
		t.Fatal("start scene did not persist")
	}
	var links []database.Hotspot
	json.Unmarshal(check("GET", path(1)+"/hotspots", "", 200), &links)
	if len(links) != 2 {
		t.Fatal("links did not persist")
	}
	check("DELETE", path(0), "", 204)
	json.Unmarshal(check("GET", path(1)+"/hotspots", "", 200), &links)
	if len(links) != 1 || links[0].DestinationSceneID != scenes[3].ID {
		t.Fatal("incoming links were not removed correctly")
	}
	json.Unmarshal(check("GET", path(3)+"/hotspots", "", 200), &links)
	if len(links) != 0 {
		t.Fatal("3D incoming link was not removed")
	}
	check("DELETE", "/api/v1/assets/"+scenes[0].AssetID.String(), "", 204)
	check("DELETE", path(1), "", 204)
	json.Unmarshal(check("GET", base, "", 200), &projectReload)
	if projectReload.StartSceneID != scenes[2].ID {
		t.Fatal("deleted start scene was not replaced by the first remaining scene")
	}
	link(2, 3, `{"yaw":0,"pitch":0}`)
	check("DELETE", path(3), "", 204)
	check("DELETE", path(2), "", 204)
	json.Unmarshal(check("GET", base, "", 200), &projectReload)
	if projectReload.StartSceneID.Valid {
		t.Fatal("deleting the last scene did not clear the start")
	}
	// Recreate a linked pair to also verify project cascade deletion.
	var pair [2]database.Scene
	for i, source := range scenes[2:] {
		json.Unmarshal(check("POST", base+"/scenes", fmt.Sprintf(`{"asset_id":"%s","name":"Recreated %d"}`, source.AssetID.String(), i), 201), &pair[i])
	}
	check("POST", "/api/v1/scenes/"+pair[0].ID.String()+"/hotspots", fmt.Sprintf(`{"title":"House","position":{"yaw":0,"pitch":0},"destination_scene_id":"%s"}`, pair[1].ID.String()), 201)
	check("DELETE", base, "", 204) // circular project/start-scene references and linked scenes cascade cleanly
	check("GET", base, "", 404)
}
