package derivatives

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgtype"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"virtual-tour/internal/database"
)

type fakeStore struct {
	published bool
	accept    bool
}

func (f *fakeStore) ClaimDerivative(context.Context) (database.DerivativeJob, error) {
	return database.DerivativeJob{}, errors.New("unused")
}
func (f *fakeStore) FinishDerivative(_ context.Context, _ database.DerivativeJob, manifest []byte, _ string) (bool, error) {
	f.published = len(manifest) > 0 && f.accept
	return f.published, nil
}

type fakeObjects struct {
	puts, deletes int
	failAt        int
	source        string
}

func (f *fakeObjects) Download(_ context.Context, _ string, target string, _ int64) error {
	bytes, err := os.ReadFile(f.source)
	if err != nil {
		return err
	}
	return os.WriteFile(target, bytes, 0600)
}
func (f *fakeObjects) PutFile(_ context.Context, _ string, _ string, _ string) error {
	f.puts++
	if f.puts == f.failAt {
		return errors.New("storage unavailable")
	}
	return nil
}
func (f *fakeObjects) Delete(_ context.Context, _ string) error { f.deletes++; return nil }
func TestProcessNeverPublishesPartialOutput(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("Node required for processor integration")
	}
	script, _ := filepath.Abs("../../asset-tools/process.mjs")
	source, _ := filepath.Abs("../../tests/testdata/house.glb")
	if _, err := os.Stat(filepath.Join(filepath.Dir(script), "node_modules")); err != nil {
		t.Skip("npm --prefix asset-tools ci required")
	}
	var id, attempt pgtype.UUID
	_ = id.Scan("00000000-0000-0000-0000-000000000001")
	_ = attempt.Scan("00000000-0000-0000-0000-000000000002")
	info, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	job := database.DerivativeJob{AssetID: id, Attempt: attempt, Key: "private/source.glb", Size: info.Size()}
	for _, test := range []struct {
		failAt    int
		accept    bool
		wantError bool
	}{{2, true, true}, {0, false, true}, {0, true, false}} {
		store := &fakeStore{accept: test.accept}
		objects := &fakeObjects{source: source, failAt: test.failAt}
		err := Process(context.Background(), store, objects, script, job)
		if (err != nil) != test.wantError {
			t.Fatalf("unexpected result: %v", err)
		}
		if test.wantError && (store.published || objects.deletes != objects.puts) {
			t.Fatal("partial output published or cleanup omitted")
		}
		if !test.wantError && (!store.published || objects.puts != 4 || objects.deletes != 0) {
			t.Fatal("complete output was not published")
		}
	}
}
