package derivatives

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgtype"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"virtual-tour/internal/chunking"
	"virtual-tour/internal/database"
)

func TestChunkPublicationIntegrityAndCleanup(t *testing.T) {
	load := func(name string, target any) {
		b, err := os.ReadFile("../../tests/testdata/chunking/contracts/" + name + ".json")
		if err != nil {
			t.Fatal(err)
		}
		if err = chunking.Decode(b, target); err != nil {
			t.Fatal(err)
		}
	}
	var inventory chunking.Inventory
	var partition chunking.Partition
	var reference chunking.Manifest
	load("inventory", &inventory)
	load("partition", &partition)
	load("manifest", &reference)
	var id, attempt pgtype.UUID
	_ = id.Scan(reference.ParentID)
	_ = attempt.Scan("00000000-0000-4000-9000-000000000003")
	job := database.DerivativeJob{AssetID: id, Attempt: attempt, Version: chunking.ProcessorVersion, PartitionRevision: 1, SourceHash: inventory.SourceHash, Key: "private/source.glb"}
	for _, scenario := range []string{"success", "write failure", "superseded", "corrupt output", "revision mismatch", "unsafe filename", "shared image"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			raw, _ := json.Marshal(reference)
			var m chunking.Manifest
			_ = json.Unmarshal(raw, &m)
			m.Dependencies = []chunking.ResourceDependency{}
			data := []byte("verified test output bytes for publication")
			digest := sha256.Sum256(data)
			payload := func(key string) chunking.Payload {
				path := filepath.Join(dir, key)
				_ = os.MkdirAll(filepath.Dir(path), 0700)
				_ = os.WriteFile(path, data, 0600)
				return chunking.Payload{Key: key, SHA256: hex.EncodeToString(digest[:]), Bytes: int64(len(data))}
			}
			for i := range m.Chunks {
				m.Chunks[i].Dependencies = []string{}
				for _, tier := range []string{"low", "balanced", "hq"} {
					m.Chunks[i].Variants[tier] = payload(m.Chunks[i].ID + "/" + tier + ".glb")
				}
			}
			m.Navigation.Payload = payload("exact/collision.glb")
			m.Occlusion.Payload = payload("exact/occlusion.glb")
			switch scenario {
			case "shared image":
				hash := hex.EncodeToString(digest[:])
				p := payload("images/" + hash + ".bin")
				m.Dependencies = []chunking.ResourceDependency{{ID: "image-" + hash, Kind: "texture", Requires: []string{}, SourceNodes: []string{}, SourceClips: []int{}, SourceSkins: []int{}, Variants: map[string]chunking.Payload{"low": p, "balanced": p, "hq": p}}}
				for i := range m.Chunks {
					m.Chunks[i].Dependencies = []string{"image-" + hash}
				}
			case "corrupt output":
				_ = os.WriteFile(filepath.Join(dir, m.Navigation.Payload.Key), []byte("broken"), 0600)
			case "revision mismatch":
				m.PartitionRevision++
			case "unsafe filename":
				v := m.Chunks[0].Variants["low"]
				v.Key = "unexpected.glb"
				m.Chunks[0].Variants["low"] = v
			}
			raw, _ = json.Marshal(m)
			_ = os.WriteFile(filepath.Join(dir, "manifest.json"), raw, 0600)
			store := &fakeStore{accept: scenario != "superseded"}
			objects := &fakeObjects{}
			if scenario == "write failure" {
				objects.failAt = 3
			}
			err := publishChunks(context.Background(), store, objects, job, inventory, partition, dir)
			if scenario == "success" || scenario == "shared image" {
				expected := 11
				if scenario == "shared image" {
					expected++
				}
				if err != nil || !store.published || objects.puts != expected || objects.deletes != 0 {
					t.Fatalf("publication: %v %+v %+v", err, store, objects)
				}
			} else {
				if err == nil || store.published || objects.puts != objects.deletes {
					t.Fatalf("unsafe publication or missing cleanup: %v %+v %+v", err, store, objects)
				}
			}
		})
	}
}

func TestNativeChunkProcessorContract(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("Node required")
	}
	script, _ := filepath.Abs("../../asset-tools/process.mjs")
	if _, err := os.Stat(filepath.Join(filepath.Dir(script), "node_modules")); err != nil {
		t.Skip("asset-tools dependencies required")
	}
	source, _ := filepath.Abs("../../tests/testdata/chunking/giant-static.glb")
	inventoryPath := filepath.Join(t.TempDir(), "inventory.json")
	if output, err := exec.Command("node", filepath.Join(filepath.Dir(script), "inventory.mjs"), source, inventoryPath).CombinedOutput(); err != nil {
		t.Fatalf("inventory: %v %s", err, output)
	}
	raw, _ := os.ReadFile(inventoryPath)
	var inventory chunking.Inventory
	if err := chunking.Decode(raw, &inventory); err != nil {
		t.Fatal(err)
	}
	p := chunking.DefaultPartition(inventory)
	p.Policy = "reviewed-rooms"
	paths := p.GlobalNodes
	p.GlobalNodes = []string{}
	p.Rooms = []chunking.Room{{ID: "static", Name: "Static room", Bounds: inventory.Bounds, NodePaths: paths}}
	partition, _ := json.Marshal(p)
	var id, attempt pgtype.UUID
	_ = id.Scan("00000000-0000-4000-9000-000000000002")
	_ = attempt.Scan("00000000-0000-4000-9000-000000000003")
	job := database.DerivativeJob{AssetID: id, Attempt: attempt, Version: chunking.ProcessorVersion, PartitionRevision: 1, SourceHash: inventory.SourceHash, Key: "private/source.glb", Size: inventory.SourceBytes, Inventory: raw, Partition: partition}
	store := &fakeStore{accept: true}
	objects := &fakeObjects{source: source}
	if err := Process(context.Background(), store, objects, script, job); err != nil {
		t.Fatal(err)
	}
	if !store.published || objects.puts != 5 || objects.deletes != 0 {
		t.Fatal("native complete output not published")
	}
}
