package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"virtual-tour/db"
	"virtual-tour/internal/database"
	"virtual-tour/internal/storage"
)

type publicationObjects struct{ reads int }

func (s *publicationObjects) PresignUpload(context.Context, string, int64) (storage.Upload, error) {
	return storage.Upload{}, nil
}
func (s *publicationObjects) Confirm(context.Context, string, int64) error { return nil }
func (s *publicationObjects) ReadURL(_ context.Context, key string) (string, error) {
	s.reads++
	return fmt.Sprintf("https://assets.example/%s?fresh=%d", key, s.reads), nil
}

func TestPublicationAccessAndPersistence(t *testing.T) {
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
	objects := &publicationObjects{}
	handler := New(q, pool.Ping, objects)
	p, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Publication test"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, p.ID)
	other, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Other publication"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, other.ID)
	if p.Slug == "" || p.Slug == other.Slug || p.Published {
		t.Fatalf("slugs/initial visibility: %+v %+v", p, other)
	}
	projectPath := "/api/v1/projects/" + p.ID.String()
	publicPath := "/api/v1/public/tours/" + p.Slug
	check := func(method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		r := call(handler, method, path, body)
		if r.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, r.Code, r.Body.String())
		}
		return r
	}
	check("GET", publicPath, "", 404)
	check("GET", "/api/v1/public/tours/missing", "", 404)
	check("POST", projectPath+"/publish", "", 400)
	makeAsset := func(project pgtype.UUID, kind string) database.Asset {
		t.Helper()
		a, e := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: project, Name: kind, FileType: pgtype.Text{String: kind, Valid: true}, StorageKey: project.String() + kind, Size: 100})
		if e != nil {
			t.Fatal(e)
		}
		a, e = q.CompleteAsset(ctx, a.ID)
		if e != nil {
			t.Fatal(e)
		}
		return a
	}
	model := makeAsset(p.ID, "GLB")
	image := makeAsset(p.ID, "IMAGE")
	unused := makeAsset(p.ID, "PANORAMA")
	foreign := makeAsset(other.ID, "GLB")
	scene, err := q.CreateScene(ctx, database.CreateSceneParams{ProjectID: p.ID, ID: model.ID, Name: "House"})
	if err != nil {
		t.Fatal(err)
	}
	// A completed IMAGE cannot be used for a scene, and publication validates the saved scene format/status.
	for _, sql := range []string{"UPDATE assets SET upload_status='pending' WHERE id=$1", "UPDATE assets SET upload_status='ready',file_type='PANORAMA' WHERE id=$1"} {
		if _, err = pool.Exec(ctx, sql, model.ID); err != nil {
			t.Fatal(err)
		}
		check("POST", projectPath+"/publish", "", 400)
	}
	if _, err = pool.Exec(ctx, "UPDATE assets SET file_type='GLB' WHERE id=$1", model.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = q.SetStartScene(ctx, database.SetStartSceneParams{ID: p.ID}); err != nil {
		t.Fatal(err)
	}
	check("POST", projectPath+"/publish", "", 400)
	if _, err = q.SetStartScene(ctx, database.SetStartSceneParams{ID: p.ID, SceneID: scene.ID}); err != nil {
		t.Fatal(err)
	}
	check("POST", "/api/v1/scenes/"+scene.ID.String()+"/hotspots", fmt.Sprintf(`{"type":"INFO","title":"Art","position":{"x":0,"y":1,"z":-2},"image_asset_id":%q}`, image.ID.String()), 201)
	assetPath := publicPath + "/assets/" + model.ID.String()
	hotspotPath := publicPath + "/scenes/" + scene.ID.String() + "/hotspots"
	check("GET", assetPath, "", 404)
	check("GET", hotspotPath, "", 404)
	r := check("POST", projectPath+"/publish", "", 200)
	var published database.Project
	json.Unmarshal(r.Body.Bytes(), &published)
	if !published.Published || published.Slug != p.Slug {
		t.Fatal("publication did not preserve slug")
	}
	check("POST", projectPath+"/publish", "", 200)
	tour := check("GET", publicPath, "", 200)
	if tour.Header().Get("Cache-Control") != "no-store" || strings.Contains(tour.Body.String(), "storage_key") {
		t.Fatal("public metadata cache/internal keys")
	}
	first := check("GET", assetPath, "", 200)
	second := check("GET", assetPath, "", 200)
	if first.Body.String() == second.Body.String() || strings.Contains(first.Body.String(), "storage_key") {
		t.Fatal("asset URLs not refreshed or internal metadata leaked")
	}
	check("GET", publicPath+"/assets/"+image.ID.String(), "", 200)
	check("GET", publicPath+"/assets/"+unused.ID.String(), "", 404)
	check("GET", publicPath+"/assets/"+foreign.ID.String(), "", 404)
	check("GET", "/api/v1/public/tours/"+other.Slug+"/scenes/"+scene.ID.String()+"/hotspots", "", 404)
	check("GET", hotspotPath, "", 200)
	check("PATCH", projectPath, `{"name":"Saved live edits"}`, 200)
	if !strings.Contains(check("GET", publicPath, "", 200).Body.String(), "Saved live edits") {
		t.Fatal("saved edits not visible")
	}
	fresh, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := database.New(fresh).GetPublicProject(ctx, p.Slug)
	fresh.Close()
	if err != nil || !restored.Published || restored.Slug != p.Slug {
		t.Fatal("publication did not persist", err)
	}
	check("POST", projectPath+"/unpublish", "", 200)
	check("POST", projectPath+"/unpublish", "", 200)
	check("GET", publicPath, "", 404)
	check("GET", assetPath, "", 404)
	check("GET", publicPath+"/assets/"+image.ID.String(), "", 404)
	check("GET", hotspotPath, "", 404)
	r = check("POST", projectPath+"/publish", "", 200)
	json.Unmarshal(r.Body.Bytes(), &published)
	if published.Slug != p.Slug {
		t.Fatal("republish changed slug")
	}
	if err = q.DeleteScene(ctx, scene.ID); err != nil {
		t.Fatal(err)
	}
	check("POST", projectPath+"/publish", "", 400)
}
