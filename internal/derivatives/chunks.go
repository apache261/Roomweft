package derivatives

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"virtual-tour/internal/chunking"
	"virtual-tour/internal/database"
)

func processChunks(ctx context.Context, store Store, objects Objects, script string, job database.DerivativeJob, source, dir string) error {
	var inventory chunking.Inventory
	var partition chunking.Partition
	if err := chunking.Decode(job.Inventory, &inventory); err != nil {
		return err
	}
	if err := chunking.Decode(job.Partition, &partition); err != nil {
		return err
	}
	if err := partition.Validate(inventory); err != nil {
		return err
	}
	digest, size, err := fileHash(source)
	if err != nil {
		return err
	}
	if digest != job.SourceHash || digest != inventory.SourceHash || size != inventory.SourceBytes {
		return errors.New("chunk source identity mismatch")
	}
	if partition.Policy != "reviewed-rooms" {
		return errors.New("partition requires complete-original fallback")
	}
	review, _ := json.Marshal(map[string]any{"parent_asset_id": job.AssetID.String(), "revision": job.PartitionRevision, "source_sha256": job.SourceHash, "document": partition})
	reviewFile := filepath.Join(dir, "review.json")
	if err = os.WriteFile(reviewFile, review, 0600); err != nil {
		return err
	}
	command := exec.CommandContext(ctx, "node", "--max-old-space-size=1024", script, source, dir, "CHUNKS", reviewFile)
	log := &processLog{}
	command.Stdout = log
	command.Stderr = log
	if err = command.Run(); err != nil {
		return fmt.Errorf("chunk processing failed; original remains usable: %s", strings.TrimSpace(string(log.data)))
	}
	return publishChunks(ctx, store, objects, job, inventory, partition, dir)
}

// Verify the entire set before uploading, then publish by attempt and revision CAS.
func publishChunks(ctx context.Context, store Store, objects Objects, job database.DerivativeJob, inventory chunking.Inventory, partition chunking.Partition, dir string) error {
	info, err := os.Stat(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return err
	}
	if info.Size() > 4*1024*1024 {
		return errors.New("chunk manifest exceeds 4 MiB")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return err
	}
	var m chunking.Manifest
	if err = chunking.Decode(raw, &m); err != nil {
		return err
	}
	if err = m.ValidateAgainst(inventory, partition, job.AssetID.String(), job.PartitionRevision); err != nil {
		return err
	}
	payloads := []*chunking.Payload{&m.Navigation.Payload, &m.Occlusion.Payload}
	allowed := map[string]bool{"exact/collision.glb": true, "exact/occlusion.glb": true}
	// Map values are copied back after rewriting private storage keys.
	for _, c := range m.Chunks {
		for _, tier := range []string{"low", "balanced", "hq"} {
			allowed[c.ID+"/"+tier+".glb"] = true
		}
	}
	for _, d := range m.Dependencies {
		if d.Kind != "texture" || len(d.Requires) != 0 || len(d.ID) != 70 || !strings.HasPrefix(d.ID, "image-") {
			return errors.New("unsupported chunk dependency")
		}
		p := d.Variants["low"]
		if p.Key != "images/"+p.SHA256+".bin" || d.ID != "image-"+p.SHA256 || d.Variants["balanced"] != p || d.Variants["hq"] != p {
			return errors.New("invalid image dependency identity")
		}
		allowed[p.Key] = true
		payloads = append(payloads, &p)
	}
	for i := range m.Chunks {
		for _, tier := range []string{"low", "balanced", "hq"} {
			v := m.Chunks[i].Variants[tier]
			payloads = append(payloads, &v)
		}
	}
	if len(payloads) > 512 {
		return errors.New("chunk output count exceeds 512")
	}
	total := int64(0)
	seen := map[string]bool{}
	for _, p := range payloads {
		if !allowed[p.Key] || seen[p.Key] {
			return errors.New("invalid or duplicate chunk output filename")
		}
		seen[p.Key] = true
		digest, size, err := fileHash(filepath.Join(dir, filepath.FromSlash(p.Key)))
		if err != nil || digest != p.SHA256 || size != p.Bytes {
			return errors.New("chunk output integrity mismatch")
		}
		total += size
		if total > 1024*1024*1024 {
			return errors.New("chunk products exceed 1 GiB")
		}
	}
	prefix := strings.TrimSuffix(job.Key, ".glb") + "/chunks-v1/" + job.SourceHash + fmt.Sprintf("/%d/", job.PartitionRevision) + job.Attempt.String() + "/"
	uploaded := []string{}
	published := false
	defer func() {
		if !published {
			cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			for _, key := range uploaded {
				retireFailedObject(cleanup, store, objects, key)
			}
		}
	}()
	for _, p := range payloads {
		file := filepath.Join(dir, filepath.FromSlash(p.Key))
		p.Key = prefix + p.Key
		if r, ok := store.(retirementStore); ok {
			if err = r.QueueStorageRetirement(ctx, p.Key); err != nil {
				return err
			}
		}
		uploaded = append(uploaded, p.Key)
		if err = objects.PutFile(ctx, p.Key, file, "model/gltf-binary"); err != nil {
			return err
		}
	}
	offset := 2 + len(m.Dependencies)
	for i := range m.Dependencies {
		p := *payloads[2+i]
		for _, tier := range []string{"low", "balanced", "hq"} {
			m.Dependencies[i].Variants[tier] = p
		}
	}
	for i := range m.Chunks {
		for _, tier := range []string{"low", "balanced", "hq"} {
			m.Chunks[i].Variants[tier] = *payloads[offset]
			offset++
		}
	}
	raw, err = json.Marshal(m)
	if err != nil {
		return err
	}
	published, err = store.FinishDerivative(ctx, job, raw, "")
	if err != nil {
		return err
	}
	if !published {
		return errors.New("chunk attempt or partition revision superseded; outputs discarded")
	}
	return nil
}
