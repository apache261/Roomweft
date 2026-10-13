package derivatives

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgtype"
	"os"
	"path/filepath"
	"testing"
	"virtual-tour/internal/database"
	"virtual-tour/internal/splattiles"
)

type tileTestStore struct {
	fakeStore
	manifest []byte
}

func (s *tileTestStore) FinishDerivative(_ context.Context, _ database.DerivativeJob, raw []byte, _ string) (bool, error) {
	s.manifest = append([]byte{}, raw...)
	return s.accept, nil
}
func TestSplatTileAtomicPublication(t *testing.T) {
	source, _ := filepath.Abs("../../web/public/splat-fixtures/small.splat")
	info, _ := os.Stat(source)
	var id, attempt pgtype.UUID
	id.Scan("00000000-0000-0000-0000-000000000001")
	attempt.Scan("00000000-0000-0000-0000-000000000002")
	job := database.DerivativeJob{AssetID: id, Attempt: attempt, Kind: "SPLAT", Version: splattiles.Version, Key: "private/room.splat", Size: info.Size()}
	for _, test := range []struct {
		accept bool
		fail   int
	}{{true, 0}, {false, 0}, {true, 2}} {
		store := &tileTestStore{fakeStore: fakeStore{accept: test.accept}}
		objects := &fakeObjects{source: source, failAt: test.fail}
		err := Process(context.Background(), store, objects, "", job)
		if (err != nil) != (test.fail > 0 || !test.accept) {
			t.Fatal(err)
		}
		if err != nil && objects.puts > 0 && objects.deletes == 0 {
			t.Fatal("unpublished tile output not retired")
		}
		if err == nil {
			var m splattiles.Manifest
			json.Unmarshal(store.manifest, &m)
			if m.Validate() != nil || m.Count != 441 || m.SourceBytes != info.Size() {
				t.Fatal("invalid complete manifest")
			}
			for _, tile := range m.Tiles {
				if tile.Key == "" {
					t.Fatal("missing durable key")
				}
			}
		}
	}
}
