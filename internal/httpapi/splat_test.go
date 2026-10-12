package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"virtual-tour/db"
	"virtual-tour/internal/database"
	"virtual-tour/internal/sceneconfig"
	"virtual-tour/internal/storage"
)

type failSplatCompletion struct {
	*database.Queries
	fail bool
}

func (q *failSplatCompletion) CompleteAsset(ctx context.Context, id pgtype.UUID) (database.Asset, error) {
	if q.fail {
		q.fail = false
		return database.Asset{}, errors.New("simulated database failure after promotion")
	}
	return q.Queries.CompleteAsset(ctx, id)
}

func TestSplatAdmission(t *testing.T) {
	handler := New(nil, func(context.Context) error { return nil })
	for _, body := range []string{`{"name":"room.splat","size":31}`, `{"name":"room.splat","size":33}`, `{"name":"room.splat","size":64000032}`, `{"name":"room.ply","size":32}`, `{"name":"room.splat","size":32,"file_type":"GLB"}`, `{"name":"room.splat","size":32,"file_type":"IMAGE"}`} {
		if result := call(handler, "POST", "/api/v1/projects/00000000-0000-0000-0000-000000000001/uploads", body); result.Code != 400 {
			t.Fatal(result.Code, result.Body.String())
		}
	}
	if result := call(handler, "POST", "/api/v1/projects/00000000-0000-0000-0000-000000000001/uploads", `{"name":"room.splat","size":32}`); result.Code != 503 {
		t.Fatal(result.Code)
	}
}

func TestSplatContractsAndPrivateDelivery(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" || os.Getenv("TEST_S3") == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_S3 with local storage")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	q := database.New(pool)
	objects, err := storage.FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	failing := &failSplatCompletion{Queries: q}
	handler := New(failing, pool.Ping, objects)
	p, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Splat integration"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(context.Background(), p.ID)
	other, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Other splat project"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(context.Background(), other.ID)
	data, err := os.ReadFile("../../web/public/splat-fixtures/small.splat")
	if err != nil {
		t.Fatal(err)
	}
	var ticket struct {
		Asset  database.Asset `json:"asset"`
		Upload storage.Upload `json:"upload"`
	}
	result := call(handler, "POST", "/api/v1/projects/"+p.ID.String()+"/uploads", fmt.Sprintf(`{"name":"room.splat","size":%d,"file_type":"SPLAT"}`, len(data)))
	if result.Code != 201 {
		t.Fatal(result.Body.String())
	}
	if err = json.Unmarshal(result.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	defer objects.Delete(context.Background(), ticket.Asset.StorageKey)
	if ticket.Asset.FileType != "SPLAT" || ticket.Upload.Fields["Content-Type"] != "application/octet-stream" {
		t.Fatal("wrong ticket", ticket.Asset.FileType)
	}
	sourcePath := "/api/v1/assets/" + ticket.Asset.ID.String()
	scenePath := "/api/v1/projects/" + p.ID.String() + "/scenes"
	sceneBody := fmt.Sprintf(`{"asset_id":"%s","name":"Room"}`, ticket.Asset.ID.String())
	if result = call(handler, "POST", scenePath, sceneBody); result.Code != 400 {
		t.Fatal("pending source accepted")
	}
	send := func(payload []byte) {
		t.Helper()
		var buffer bytes.Buffer
		form := multipart.NewWriter(&buffer)
		for key, value := range ticket.Upload.Fields {
			if err := form.WriteField(key, value); err != nil {
				t.Fatal(err)
			}
		}
		part, err := form.CreateFormFile("file", "room.splat")
		if err != nil {
			t.Fatal(err)
		}
		part.Write(payload)
		form.Close()
		req, _ := http.NewRequestWithContext(ctx, "POST", ticket.Upload.URL, &buffer)
		req.Header.Set("Content-Type", form.FormDataContentType())
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal("storage POST failed")
		}
		defer response.Body.Close()
		if response.StatusCode >= 300 {
			t.Fatal("storage POST rejected", response.StatusCode)
		}
	}
	bad := bytes.Clone(data)
	clear(bad[12:16])
	send(bad)
	if result = call(handler, "POST", sourcePath+"/complete", ""); result.Code != 422 {
		t.Fatal("invalid source accepted", result.Code)
	}
	send(data)
	failing.fail = true
	if result = call(handler, "POST", sourcePath+"/complete", ""); result.Code != 500 {
		t.Fatal("expected post-promotion database failure", result.Code)
	}
	// The signed pending POST remains usable, but a post-promotion DB retry
	// must retain the already validated original rather than replacing it.
	changed := bytes.Clone(data)
	changed[24] = 42
	send(changed)
	for range 2 {
		if result = call(handler, "POST", sourcePath+"/complete", ""); result.Code != 200 {
			t.Fatal("retry failed", result.Body.String())
		}
	}
	if result = call(handler, "POST", "/api/v1/projects/"+other.ID.String()+"/scenes", sceneBody); result.Code != 400 {
		t.Fatal("foreign source accepted")
	}
	if result = call(handler, "POST", scenePath, sceneBody); result.Code != 201 {
		t.Fatal(result.Body.String())
	}
	var scene database.Scene
	json.Unmarshal(result.Body.Bytes(), &scene)
	if scene.Type != "SPLAT" || sceneconfig.Decode(scene.Settings).ValidateForScene("SPLAT") != nil {
		t.Fatal("invalid scene defaults")
	}
	// Database trigger independently rejects an incorrect source kind.
	if _, err = pool.Exec(ctx, "INSERT INTO scenes(project_id,asset_id,name,type) VALUES($1,$2,'wrong','3D')", p.ID, ticket.Asset.ID); err == nil {
		t.Fatal("database accepted incorrect kind")
	}
	camera := `{"start_camera":{"position":[1,2,3],"yaw":0.2,"pitch":-0.3}}`
	path := "/api/v1/scenes/" + scene.ID.String()
	if result = call(handler, "PATCH", path, camera); result.Code != 200 {
		t.Fatal(result.Body.String())
	}
	persisted, err := q.GetScene(ctx, scene.ID)
	if err != nil {
		t.Fatal(err)
	}
	var view struct {
		Position   [3]float64
		Yaw, Pitch float64
	}
	json.Unmarshal(persisted.StartCamera, &view)
	if view.Position != [3]float64{1, 2, 3} || view.Yaw != .2 || view.Pitch != -.3 {
		t.Fatal("camera drift")
	}
	settings := sceneconfig.DefaultSplat()
	settings.Model.Scale = 2
	settings.Splat.Position = [3]float64{5, 0, 0}
	if _, err = q.CreateHotspot(ctx, database.CreateHotspotParams{SceneID: scene.ID, Type: "INFO", Title: "Marker", Position: json.RawMessage(`{"x":1,"y":2,"z":3}`)}); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"settings": settings})
	if result = call(handler, "PATCH", path, string(raw)); result.Code != 200 {
		t.Fatal(result.Body.String())
	}
	persisted, _ = q.GetScene(ctx, scene.ID)
	if string(persisted.StartCamera) != "{}" {
		t.Fatal("transform retained stale start view")
	}
	spots, err := q.ListHotspots(ctx, scene.ID)
	if err != nil {
		t.Fatal(err)
	}
	var point struct{ X, Y, Z float64 }
	json.Unmarshal(spots[0].Position, &point)
	if point.X != 7 || point.Y != 4 || point.Z != 6 {
		t.Fatal("hotspot transform", point)
	}
	settings.Appearance.LightIntensity = 1
	raw, _ = json.Marshal(map[string]any{"settings": settings})
	if result = call(handler, "PATCH", path, string(raw)); result.Code != 400 {
		t.Fatal("mesh settings accepted")
	}
	if result = call(handler, "DELETE", sourcePath, ""); result.Code != 409 {
		t.Fatal("referenced source deleted")
	}
	// Ready source download is byte-identical; unsigned bucket GET is private.
	result = call(handler, "GET", sourcePath, "")
	var read struct {
		URL string `json:"url"`
	}
	json.Unmarshal(result.Body.Bytes(), &read)
	response, err := http.Get(read.URL)
	if err != nil {
		t.Fatal("signed read failed")
	}
	download, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if !bytes.Equal(download, data) {
		t.Fatal("source changed")
	}
	unsigned := read.URL
	for i, c := range unsigned {
		if c == '?' {
			unsigned = unsigned[:i]
			break
		}
	}
	response, err = http.Get(unsigned)
	if err != nil {
		t.Fatal("private read check failed")
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("source is publicly readable", response.StatusCode)
	}
	publicPath := "/api/v1/public/tours/" + p.Slug + "/assets/" + ticket.Asset.ID.String()
	if result = call(handler, "GET", publicPath, ""); result.Code != 404 {
		t.Fatal("unpublished read accepted")
	}
	if result = call(handler, "POST", "/api/v1/projects/"+p.ID.String()+"/publish", ""); result.Code != 200 {
		t.Fatal("publication failed", result.Body.String())
	}
	if result = call(handler, "GET", publicPath, ""); result.Code != 200 {
		t.Fatal("published source unavailable")
	}
	// Runtime rollback must preserve published metadata and persisted scene identity.
	for _, mode := range []SplatRollout{SplatOff, SplatViewer} {
		rolled := NewWithOptions(q, pool.Ping, Options{SplatSupport: mode}, objects)
		if result = call(rolled, "GET", "/api/v1/public/tours/"+p.Slug, ""); result.Code != 200 {
			t.Fatal("rollback hid tour metadata", result.Body.String())
		}
		want := 200
		if mode == SplatOff {
			want = 503
		}
		for _, read := range []string{sourcePath, publicPath} {
			if result = call(rolled, "GET", read, ""); result.Code != want {
				t.Fatal("rollback signing", result.Code, result.Body.String())
			}
		}
		if result = call(rolled, "POST", "/api/v1/projects/"+p.ID.String()+"/scenes", `{"name":"Blocked capture","asset_id":"`+ticket.Asset.ID.String()+`"}`); result.Code != 503 {
			t.Fatal("rollback allowed new scene", result.Body.String())
		}
		if result = call(rolled, "GET", path, ""); result.Code != 200 {
			t.Fatal("rollback hid persisted scene")
		}
		var intact database.Scene
		json.Unmarshal(result.Body.Bytes(), &intact)
		if intact.Type != "SPLAT" || intact.AssetID != ticket.Asset.ID {
			t.Fatal("rollback changed scene identity")
		}
	}
	if result = call(handler, "GET", publicPath, ""); result.Code != 200 {
		t.Fatal("re-enable failed")
	}
	unused, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: p.ID, Name: "unused.splat", FileType: pgtype.Text{String: "SPLAT", Valid: true}, Size: 32, StorageKey: "unused/" + p.ID.String() + ".splat"})
	if err != nil {
		t.Fatal(err)
	}
	q.CompleteAsset(ctx, unused.ID)
	if result = call(handler, "GET", "/api/v1/public/tours/"+p.Slug+"/assets/"+unused.ID.String(), ""); result.Code != 404 {
		t.Fatal("unreferenced source signed")
	}
	if result = call(handler, "POST", "/api/v1/projects/"+p.ID.String()+"/unpublish", ""); result.Code != 200 {
		t.Fatal(result.Body.String())
	}
	if result = call(handler, "GET", publicPath, ""); result.Code != 404 {
		t.Fatal("unpublished source signed")
	}
	// Delete protection releases after the scene is removed.
	if result = call(handler, "DELETE", path, ""); result.Code != 204 {
		t.Fatal(result.Body.String())
	}
	if result = call(handler, "DELETE", sourcePath, ""); result.Code != 204 {
		t.Fatal(result.Body.String())
	}
}

func TestSplatSceneContracts(t *testing.T) {
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
	p, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Splat contracts"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, p.ID)
	asset, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: p.ID, Name: "room.splat", Size: 32, StorageKey: "contract/" + p.ID.String(), FileType: pgtype.Text{String: "SPLAT", Valid: true}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = q.CreateScene(ctx, database.CreateSceneParams{ProjectID: p.ID, ID: asset.ID, Name: "Pending"}); err == nil {
		t.Fatal("pending splat accepted")
	}
	if _, err = q.CompleteAsset(ctx, asset.ID); err != nil {
		t.Fatal(err)
	}
	scene, err := q.CreateScene(ctx, database.CreateSceneParams{ProjectID: p.ID, ID: asset.ID, Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	if scene.Type != "SPLAT" {
		t.Fatal(scene.Type)
	}
	handler := New(q, pool.Ping)
	path := "/api/v1/scenes/" + scene.ID.String()
	for _, body := range []string{`{"settings":{"appearance":{"exposure":1,"environment_intensity":0,"light_intensity":0,"background":"#ffffff"},"model":{"scale":1,"up_axis":"Y","rotation":0}}}`, `{"settings":{"splat":{"version":1,"position":[1,2,3,4],"controls":"orbit","min_distance":0.1,"max_distance":100}}}`} {
		if result := call(handler, "PATCH", path, body); result.Code != 400 {
			t.Fatal("invalid splat settings accepted", result.Code)
		}
	}
	// A matching ready source is enforced even for direct SQL callers.
	if _, err = pool.Exec(ctx, "UPDATE scenes SET type='3D' WHERE id=$1", scene.ID); err == nil {
		t.Fatal("wrong source kind accepted")
	}
	if err = db.Migrate(ctx, pool); err != nil {
		t.Fatal("migration rerun", err)
	}
}
