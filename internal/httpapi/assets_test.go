package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"virtual-tour/db"
	"virtual-tour/internal/database"
	"virtual-tour/internal/storage"
)

func TestInvalidUploadInput(t *testing.T) {
	handler := New(nil, func(context.Context) error { return nil })
	for _, body := range []string{`null`, `{}`, `{"name":"house.obj","size":40}`, `{"name":"../house.glb","size":40}`, `{"name":"house.glb","size":1048576001}`, `{"name":"room.png","size":104857601}`, `{"name":"art.png","file_type":"IMAGE","size":104857601}`, `{"name":"house.glb","size":0}`, `{"name":"house.glb","size":40,"key":"mine"}`} {
		if result := call(handler, "POST", "/api/v1/projects/00000000-0000-0000-0000-000000000001/uploads", body); result.Code != 400 {
			t.Fatalf("%s: %d %s", body, result.Code, result.Body.String())
		}
	}
}
func TestGLBSizeAdmission(t *testing.T) {
	handler := New(nil, func(context.Context) error { return nil })
	for _, size := range []int64{104857601, storage.MaxSize} {
		body := fmt.Sprintf(`{"name":"large.glb","size":%d}`, size)
		result := call(handler, "POST", "/api/v1/projects/00000000-0000-0000-0000-000000000001/uploads", body)
		// Storage is intentionally absent; reaching that check proves size admission.
		if result.Code != 503 {
			t.Fatalf("size %d rejected before storage: %d %s", size, result.Code, result.Body.String())
		}
	}
}

func TestAssetScenePersistence(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" || os.Getenv("TEST_S3") == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_S3=1 with S3 environment to test uploads")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, os.Getenv("TEST_DATABASE_URL"))
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
	created := call(handler, "POST", "/api/v1/projects", `{"name":"Phase 2 integration"}`)
	var project database.Project
	json.Unmarshal(created.Body.Bytes(), &project)
	if created.Code != 201 {
		t.Fatal(created.Body.String())
	}
	defer database.New(pool).DeleteProject(context.Background(), project.ID)
	data, err := os.ReadFile("../../tests/testdata/house.glb")
	if err != nil {
		t.Fatal(err)
	}
	uploadPath := "/api/v1/projects/" + project.ID.String() + "/uploads"
	ticketResponse := call(handler, "POST", uploadPath, fmt.Sprintf(`{"name":"house.glb","size":%d}`, len(data)))
	if ticketResponse.Code != 201 {
		t.Fatal(ticketResponse.Body.String())
	}
	var ticket struct {
		Asset  database.Asset `json:"asset"`
		Upload storage.Upload `json:"upload"`
	}
	json.Unmarshal(ticketResponse.Body.Bytes(), &ticket)
	defer objects.Delete(context.Background(), ticket.Asset.StorageKey)
	scenePath := "/api/v1/projects/" + project.ID.String() + "/scenes"
	sceneBody := fmt.Sprintf(`{"asset_id":"%s","name":"House"}`, ticket.Asset.ID.String())
	if result := call(handler, "POST", scenePath, sceneBody); result.Code != 400 {
		t.Fatalf("pending asset: %d", result.Code)
	}
	completePath := "/api/v1/assets/" + ticket.Asset.ID.String() + "/complete"
	if result := call(handler, "POST", completePath, ""); result.Code != 422 {
		t.Fatalf("missing upload: %d", result.Code)
	}
	send := func(payload []byte) int {
		t.Helper()
		var buf bytes.Buffer
		form := multipart.NewWriter(&buf)
		for key, value := range ticket.Upload.Fields {
			form.WriteField(key, value)
		}
		part, _ := form.CreateFormFile("file", "house.glb")
		part.Write(payload)
		form.Close()
		req, _ := http.NewRequestWithContext(ctx, "POST", ticket.Upload.URL, &buf)
		req.Header.Set("Content-Type", form.FormDataContentType())
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode >= 400 {
			t.Log(string(body))
		}
		return resp.StatusCode
	}
	if code := send(append(bytes.Clone(data), 0)); code < 400 {
		t.Fatal("storage accepted wrong size")
	}
	invalid := bytes.Clone(data)
	invalid[0] = 0
	if code := send(invalid); code >= 300 {
		t.Fatalf("invalid-file upload: %d", code)
	}
	if result := call(handler, "POST", completePath, ""); result.Code != 422 {
		t.Fatalf("invalid-file completion: %d", result.Code)
	}
	if code := send(data); code >= 300 {
		t.Fatalf("upload: %d", code)
	}
	for range 2 {
		if result := call(handler, "POST", completePath, ""); result.Code != 200 {
			t.Fatalf("completion: %d %s", result.Code, result.Body.String())
		}
	}
	result := call(handler, "POST", scenePath, sceneBody)
	if result.Code != 201 {
		t.Fatal(result.Body.String())
	}
	var scene database.Scene
	json.Unmarshal(result.Body.Bytes(), &scene)
	// Another project must not reference this asset.
	otherResponse := call(handler, "POST", "/api/v1/projects", `{"name":"Other project"}`)
	var other database.Project
	json.Unmarshal(otherResponse.Body.Bytes(), &other)
	defer database.New(pool).DeleteProject(context.Background(), other.ID)
	if result := call(handler, "POST", "/api/v1/projects/"+other.ID.String()+"/scenes", sceneBody); result.Code != 400 {
		t.Fatalf("cross-project asset: %d", result.Code)
	}
	fresh, err := pgxpool.New(ctx, os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	restarted := New(database.New(fresh), fresh.Ping, objects)
	for _, path := range []string{scenePath, "/api/v1/scenes/" + scene.ID.String(), "/api/v1/projects/" + project.ID.String() + "/assets"} {
		result := call(restarted, "GET", path, "")
		if result.Code != 200 || !strings.Contains(result.Body.String(), project.ID.String()) {
			t.Fatalf("reload %s: %s", path, result.Body.String())
		}
	}
	assetResult := call(restarted, "GET", "/api/v1/assets/"+ticket.Asset.ID.String(), "")
	var asset struct {
		URL string `json:"url"`
	}
	json.Unmarshal(assetResult.Body.Bytes(), &asset)
	// Reusing the upload ticket cannot overwrite the confirmed original.
	send(invalid)
	response, err := http.Get(asset.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	original, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 || !bytes.Equal(original, data) {
		t.Fatal("original not preserved")
	}
	if result := call(restarted, "DELETE", "/api/v1/projects/"+project.ID.String(), ""); result.Code != 204 {
		t.Fatalf("project cascade delete: %d %s", result.Code, result.Body.String())
	}
}

func TestUploadSizeConstraints(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to test upload size migration")
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
	var projectID string
	if err := pool.QueryRow(ctx, "INSERT INTO projects(name) VALUES ('Upload size migration test') RETURNING id").Scan(&projectID); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, "DELETE FROM projects WHERE id=$1", projectID)
	for index, scenario := range []struct {
		kind  string
		size  int64
		valid bool
	}{
		{"GLB", 104857601, true}, {"GLB", storage.MaxSize, true}, {"GLB", storage.MaxSize + 1, false},
		{"PANORAMA", storage.MaxImageSize, true}, {"PANORAMA", storage.MaxImageSize + 1, false},
		{"IMAGE", storage.MaxImageSize, true}, {"IMAGE", storage.MaxImageSize + 1, false}, {"GLB", 19, false},
	} {
		_, err := pool.Exec(ctx, "INSERT INTO assets(project_id,name,file_type,storage_key,size) VALUES ($1,'size test',$2,$3,$4)", projectID, scenario.kind, fmt.Sprintf("size-test/%s/%d", projectID, index), scenario.size)
		if (err == nil) != scenario.valid {
			t.Fatalf("%s size %d, expected valid=%t: %v", scenario.kind, scenario.size, scenario.valid, err)
		}
	}
}
