package httpapi

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"virtual-tour/internal/database"
)

type splatRolloutStore struct{ *chunkTestStore }

func (s *splatRolloutStore) GetProject(context.Context, pgtype.UUID) (database.Project, error) {
	return database.Project{}, nil
}

func TestSplatRolloutParsing(t *testing.T) {
	for _, value := range []string{"", "off", "viewer", "on"} {
		if _, err := ParseSplatRollout(value); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []string{"true", "ON", "unknown"} {
		if _, err := ParseSplatRollout(value); err == nil {
			t.Fatal("invalid rollout accepted")
		}
	}
}
func TestSplatRolloutGates(t *testing.T) {
	id := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	store := &splatRolloutStore{&chunkTestStore{asset: database.Asset{ID: id, FileType: "SPLAT", UploadStatus: "ready"}, published: true}}
	for _, mode := range []SplatRollout{SplatOff, SplatViewer, SplatOn} {
		handler := NewWithOptions(store, func(context.Context) error { return nil }, Options{SplatSupport: mode}, &publicationObjects{})
		caps := call(handler, "GET", "/api/v1/capabilities", "")
		var body map[string]bool
		json.Unmarshal(caps.Body.Bytes(), &body)
		if body["splat_viewer"] != (mode != SplatOff) || body["splat_authoring"] != (mode == SplatOn) {
			t.Fatal(body)
		}
		// Off blocks private/public signing before storage; viewer allows signing.
		if mode == SplatOff {
			for _, path := range []string{"/api/v1/assets/" + id.String(), "/api/v1/public/tours/published/assets/" + id.String()} {
				if r := call(handler, "GET", path, ""); r.Code != 503 {
					t.Fatal(r.Code, r.Body.String())
				}
			}
		}
		if mode != SplatOn {
			if r := call(handler, "POST", "/api/v1/projects/"+id.String()+"/uploads", `{"name":"room.splat","size":32}`); r.Code != 503 {
				t.Fatal(r.Code, r.Body.String())
			}
			if r := call(handler, "POST", "/api/v1/projects/"+id.String()+"/scenes", `{"name":"Room","asset_id":"`+id.String()+`"}`); r.Code != 503 {
				t.Fatal(r.Code, r.Body.String())
			}
		}
	}
}
