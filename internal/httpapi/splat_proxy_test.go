package httpapi

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"testing"
	"virtual-tour/db"
	"virtual-tour/internal/database"
	"virtual-tour/internal/sceneconfig"
	"virtual-tour/internal/walkconfig"
)

func TestSplatProxyReferencesAndInvalidation(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("set TEST_DATABASE_URL")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	q := database.New(pool)
	p, err := q.CreateProject(ctx, database.CreateProjectParams{Name: "Proxy contracts"})
	if err != nil {
		t.Fatal(err)
	}
	defer q.DeleteProject(ctx, p.ID)
	other, _ := q.CreateProject(ctx, database.CreateProjectParams{Name: "Other proxy project"})
	defer q.DeleteProject(ctx, other.ID)
	makeAsset := func(project pgtype.UUID, kind string) database.Asset {
		asset, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: project, Name: "fixture", FileType: pgtype.Text{String: kind, Valid: true}, Size: 32, StorageKey: "proxy-test/" + project.String() + "/" + kind})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = q.CompleteAsset(ctx, asset.ID); err != nil {
			t.Fatal(err)
		}
		return asset
	}
	source, proxy, foreign := makeAsset(p.ID, "SPLAT"), makeAsset(p.ID, "GLB"), makeAsset(other.ID, "GLB")
	scene, err := q.CreateScene(ctx, database.CreateSceneParams{ProjectID: p.ID, ID: source.ID, Name: "Capture"})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewWithOptions(q, pool.Ping, Options{SplatSupport: SplatOn, SplatWalking: true}, &publicationObjects{})
	path := "/api/v1/scenes/" + scene.ID.String()
	settings := sceneconfig.DefaultSplat()
	settings.Splat.Proxy = &sceneconfig.SplatProxy{AssetID: foreign.ID.String(), Model: sceneconfig.Default().Model}
	save := func(status int) database.Scene {
		raw, _ := json.Marshal(map[string]any{"settings": settings})
		r := call(handler, "PATCH", path, string(raw))
		if r.Code != status {
			t.Fatal(r.Code, r.Body.String())
		}
		var result database.Scene
		json.Unmarshal(r.Body.Bytes(), &result)
		return result
	}
	save(400)
	pending, err := q.CreateAsset(ctx, database.CreateAssetParams{ProjectID: p.ID, Name: "Pending proxy", FileType: pgtype.Text{String: "GLB", Valid: true}, Size: 32, StorageKey: "proxy-test/" + p.ID.String() + "/pending"})
	if err != nil {
		t.Fatal(err)
	}
	settings.Splat.Proxy.AssetID = pending.ID.String()
	save(400)
	settings.Splat.Proxy.AssetID = source.ID.String()
	save(400)
	settings.Splat.Proxy.AssetID = proxy.ID.String()
	save(200)
	if r := call(handler, "DELETE", "/api/v1/assets/"+proxy.ID.String(), ""); r.Code != 409 {
		t.Fatal("proxy deletion was not protected")
	}
	settings.Splat.Proxy.Reviewed = true
	c := walkconfig.Default()
	c.Regions = []walkconfig.Region{{ID: "00000000-0000-0000-0000-000000000001", Name: "Reviewed", Left: -3, Right: 3, Top: -3, Bottom: 3, MinY: 0, MaxY: 0, FloorMeshes: []string{"0/0"}}}
	settings.Navigation = &c
	save(200)
	if r := call(handler, "POST", "/api/v1/projects/"+p.ID.String()+"/publish", ""); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	if r := call(handler, "GET", "/api/v1/public/tours/"+p.Slug+"/assets/"+proxy.ID.String(), ""); r.Code != 200 {
		t.Fatal("referenced proxy not delivered", r.Body.String())
	}
	settings.Appearance.Exposure = 1.4
	result := save(200)
	if !sceneconfig.WalkingProxy(sceneconfig.Decode(result.Settings)) {
		t.Fatal("appearance change invalidated review")
	}
	disabled := NewWithOptions(q, pool.Ping, Options{SplatSupport: SplatOn}, &publicationObjects{})
	raw, _ := json.Marshal(map[string]any{"settings": settings})
	if r := call(disabled, "PATCH", path, string(raw)); r.Code != 200 {
		t.Fatal("rollback blocked appearance metadata", r.Body.String())
	}
	settings.Navigation.Speed += .1
	raw, _ = json.Marshal(map[string]any{"settings": settings})
	if r := call(disabled, "PATCH", path, string(raw)); r.Code != 503 {
		t.Fatal("rollback allowed new walking settings")
	}
	settings.Navigation.Speed -= .1
	settings.Splat.Position[0] = 2
	result = save(200)
	cleared := sceneconfig.Decode(result.Settings)
	if cleared.Splat.Proxy.Reviewed || cleared.Navigation != nil || string(result.StartCamera) != "{}" {
		t.Fatal("capture transform retained stale proxy approval")
	}
	settings = cleared
	settings.Splat.Proxy.Reviewed = true
	settings.Navigation = &c
	save(200)
	settings.Splat.Proxy.Position[0] = 1
	direct, _ := json.Marshal(settings)
	if _, err = pool.Exec(ctx, "UPDATE scenes SET settings=$2 WHERE id=$1", scene.ID, direct); err != nil {
		t.Fatal(err)
	}
	directScene, _ := q.GetScene(ctx, scene.ID)
	directConfig := sceneconfig.Decode(directScene.Settings)
	if directConfig.Splat.Proxy.Reviewed || directConfig.Navigation != nil {
		t.Fatal("direct settings update retained stale alignment")
	}
	settings = directConfig
	settings.Splat.Proxy = nil
	save(200)
	if r := call(handler, "DELETE", "/api/v1/assets/"+proxy.ID.String(), ""); r.Code != 204 {
		t.Fatal("detached proxy stayed protected", r.Body.String())
	}
}
