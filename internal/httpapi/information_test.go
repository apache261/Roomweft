package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"testing"
	"virtual-tour/db"
	"virtual-tour/internal/database"
)

func TestInformationPersistence(t *testing.T) {
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
	p, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Information test"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, p.ID)
	other, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Other"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, other.ID)
	asset := func(project pgtype.UUID, kind string) database.Asset {
		t.Helper()
		a, e := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: project, Name: "fixture", StorageKey: p.ID.String() + kind + project.String(), Size: 100, FileType: pgtype.Text{String: kind, Valid: true}})
		if e != nil {
			t.Fatal(e)
		}
		a, e = q.CompleteAsset(ctx, a.ID)
		if e != nil {
			t.Fatal(e)
		}
		return a
	}
	im := asset(p.ID, "IMAGE")
	foreign := asset(other.ID, "IMAGE")
	pano := asset(p.ID, "PANORAMA")
	model := asset(p.ID, "GLB")
	handler := New(q, pool.Ping)
	for _, a := range []database.Asset{pano, model} {
		scene, e := q.CreateScene(ctx, database.CreateSceneParams{ProjectID: p.ID, ID: a.ID, Name: "Room"})
		if e != nil {
			t.Fatal(e)
		}
		position := `{"yaw":0,"pitch":0}`
		if a.FileType == "GLB" {
			position = `{"x":0,"y":1,"z":-2}`
		}
		body := func(image string, link string) string {
			return fmt.Sprintf(`{"type":"INFO","title":"Painting","description":"Artist\nPlain <b>text</b>","position":%s,"image_asset_id":%q,"external_link":%q}`, position, image, link)
		}
		path := "/api/v1/scenes/" + scene.ID.String() + "/hotspots"
		for _, input := range []string{body(foreign.ID.String(), ""), body(pano.ID.String(), ""), body(im.ID.String(), "javascript:alert(1)")} {
			if r := call(handler, "POST", path, input); r.Code != 400 {
				t.Fatalf("invalid reference/link: %d %s", r.Code, r.Body.String())
			}
		}
		r := call(handler, "POST", path, body(im.ID.String(), "https://example.com/art"))
		if r.Code != 201 {
			t.Fatal(r.Body.String())
		}
		var h database.Hotspot
		json.Unmarshal(r.Body.Bytes(), &h)
		if r = call(handler, "DELETE", "/api/v1/assets/"+im.ID.String(), ""); r.Code != 409 {
			t.Fatalf("image deletion: %d", r.Code)
		}
		position = `{"yaw":0.4,"pitch":0.2}`
		if a.FileType == "GLB" {
			position = `{"x":0.5,"y":1.5,"z":-3}`
		}
		if r = call(handler, "PATCH", "/api/v1/hotspots/"+h.ID.String(), body(im.ID.String(), "https://example.com/updated")); r.Code != 200 {
			t.Fatal(r.Body.String())
		}
		if err = db.Migrate(ctx, pool); err != nil {
			t.Fatal("repeat migration", err)
		}
		fresh, e := pgxpool.New(ctx, url)
		if e != nil {
			t.Fatal(e)
		}
		loaded, e := database.New(fresh).GetHotspot(ctx, h.ID)
		fresh.Close()
		if e != nil || loaded.ExternalLink != "https://example.com/updated" || loaded.ImageAssetID != im.ID || string(loaded.Position) == string(h.Position) || loaded.Description != "Artist\nPlain <b>text</b>" {
			t.Fatalf("persisted: %+v %v", loaded, e)
		}
		if r = call(handler, "DELETE", "/api/v1/hotspots/"+h.ID.String(), ""); r.Code != 204 {
			t.Fatal(r.Body.String())
		}
	}
	scenes, err := q.ListScenes(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	input := `{"type":"INFO","title":"No image","position":{"yaw":0,"pitch":0}}`
	r := call(handler, "POST", "/api/v1/scenes/"+scenes[0].ID.String()+"/hotspots", input)
	if r.Code != 201 {
		t.Fatal(r.Body.String())
	}
	var optional database.Hotspot
	json.Unmarshal(r.Body.Bytes(), &optional)
	if optional.ImageAssetID.Valid || optional.DestinationSceneID.Valid {
		t.Fatal("unexpected optional references")
	}
	nav := fmt.Sprintf(`{"type":"NAVIGATION","title":"Next","position":{"yaw":0.2,"pitch":0},"destination_scene_id":%q}`, scenes[1].ID.String())
	if r = call(handler, "PATCH", "/api/v1/hotspots/"+optional.ID.String(), nav); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if r = call(handler, "PATCH", "/api/v1/hotspots/"+optional.ID.String(), input); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	json.Unmarshal(r.Body.Bytes(), &optional)
	if optional.Type != "INFO" || optional.DestinationSceneID.Valid {
		t.Fatal("destination not cleared on type change")
	}

	if r := call(handler, "POST", "/api/v1/projects/"+p.ID.String()+"/scenes", fmt.Sprintf(`{"asset_id":%q,"name":"invalid"}`, im.ID.String())); r.Code != 400 {
		t.Fatalf("image scene: %d", r.Code)
	}
	if r := call(handler, "DELETE", "/api/v1/assets/"+im.ID.String(), ""); r.Code != 204 {
		t.Fatal(r.Body.String())
	}
}
