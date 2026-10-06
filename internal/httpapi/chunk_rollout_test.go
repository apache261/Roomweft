package httpapi

import (
	"encoding/json"
	"github.com/jackc/pgx/v5/pgtype"
	"os"
	"testing"
	"virtual-tour/internal/chunking"
	"virtual-tour/internal/database"
)

func TestChunkRolloutGates(t *testing.T) {
	for _, input := range []string{"", "off", "reviewed", "spatial"} {
		if _, err := ParseChunkRollout(input); err != nil {
			t.Fatal(err)
		}
	}
	if mode, err := ParseChunkRollout(""); err != nil || mode != ChunkOff {
		t.Fatal("startup must default off")
	}
	if _, err := ParseChunkRollout("enable-everything"); err == nil {
		t.Fatal("invalid rollout accepted")
	}
	raw, err := os.ReadFile("../../tests/testdata/chunking/contracts/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var m chunking.Manifest
	if err = chunking.Decode(raw, &m); err != nil {
		t.Fatal(err)
	}
	var id pgtype.UUID
	_ = id.Scan(m.ParentID)
	store := &chunkTestStore{asset: database.Asset{ID: id, FileType: "GLB", UploadStatus: "ready"}, derivative: database.Derivative{State: "ready", Manifest: raw}, revision: 1, published: true}
	objects := &chunkTestObjects{}
	for _, mode := range []ChunkRollout{ChunkOff, ChunkReviewed, ChunkSpatial} {
		a := &API{store: store, chunkStreaming: mode}
		if a.allowsChunks(m) != (mode != ChunkOff) {
			t.Fatal("intact gate")
		}
		spatial := m
		spatial.Partition.SpatialCellSize = 4
		if a.allowsChunks(spatial) != (mode == ChunkSpatial) {
			t.Fatal("spatial gate")
		}
		handler := NewWithOptions(store, nil, Options{ChunkStreaming: mode}, objects)
		for _, base := range []string{"/api/v1/assets/" + m.ParentID, "/api/v1/public/tours/published/assets/" + m.ParentID} {
			response := call(handler, "GET", base+"/chunks/room-a-geometry?tier=balanced", "")
			expected := 200
			if mode == ChunkOff {
				expected = 404
			}
			if response.Code != expected {
				t.Fatalf("%s: %d", mode, response.Code)
			}
			descriptor := call(handler, "GET", base, "")
			var body map[string]json.RawMessage
			_ = json.Unmarshal(descriptor.Body.Bytes(), &body)
			if mode == ChunkOff && body["streaming"] != nil {
				t.Fatal("disabled advertisement exposed")
			}
		}
	}
	if (&API{chunkStreaming: ChunkRollout("invalid")}).allowsChunks(m) {
		t.Fatal("unknown options must fail closed")
	}
	calls := objects.calls
	handler := NewWithOptions(store, nil, Options{}, objects)
	if r := call(handler, "GET", "/api/v1/assets/"+m.ParentID+"/chunk-dependencies/shared-image?tier=low", ""); r.Code != 404 || objects.calls != calls {
		t.Fatal("disabled dependency signed")
	}
}
