package derivatives

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"virtual-tour/internal/database"
	"virtual-tour/internal/splattiles"
	"virtual-tour/internal/storage"
)

// Exact input records are assigned once to deterministic spatial cells. No GLB contracts or reconstruction are involved.
func processSplatTiles(ctx context.Context, store Store, objects Objects, job database.DerivativeJob, source, dir string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if info.Size() != job.Size || job.Size < 32 || job.Size > storage.MaxSplatSize || job.Size%32 != 0 {
		return fmt.Errorf("splat tile source size identity mismatch")
	}
	raw, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err = storage.ValidateSplat(ctx, bytes.NewReader(raw), int64(len(raw))); err != nil {
		return err
	}
	digest, size, err := fileHash(source)
	if err != nil {
		return err
	}
	cells := map[[3]int][]byte{}
	bounds := map[[3]int][6]float64{}
	for offset := 0; offset < len(raw); offset += 32 {
		if offset%32768 == 0 {
			if err = ctx.Err(); err != nil {
				return err
			}
		}
		record := raw[offset : offset+32]
		p := [3]float64{}
		radius := 0.0
		for i := 0; i < 3; i++ {
			p[i] = float64(math.Float32frombits(binary.LittleEndian.Uint32(record[i*4:])))
			if i > 0 {
				p[i] = -p[i]
			}
			radius = math.Max(radius, float64(math.Float32frombits(binary.LittleEndian.Uint32(record[(i+3)*4:])))*3)
		}
		cell := [3]int{int(math.Floor(p[0] / splattiles.CellSize)), int(math.Floor(p[1] / splattiles.CellSize)), int(math.Floor(p[2] / splattiles.CellSize))}
		box, exists := bounds[cell]
		if !exists {
			for i := 0; i < 3; i++ {
				box[i] = p[i] - radius
				box[i+3] = p[i] + radius
			}
		} else {
			for i := 0; i < 3; i++ {
				box[i] = math.Min(box[i], p[i]-radius)
				box[i+3] = math.Max(box[i+3], p[i]+radius)
			}
		}
		bounds[cell] = box
		cells[cell] = append(cells[cell], record...)
		if len(cells) > splattiles.MaxTiles {
			return fmt.Errorf("capture exceeds 512 spatial cells; raw source remains available")
		}
	}
	keys := make([][3]int, 0, len(cells))
	for key := range cells {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		for axis := 0; axis < 3; axis++ {
			if keys[i][axis] != keys[j][axis] {
				return keys[i][axis] < keys[j][axis]
			}
		}
		return false
	})
	manifest := splattiles.Manifest{AttemptID: job.Attempt.String(), Version: splattiles.Version, ParentID: job.AssetID.String(), SourceHash: digest, SourceBytes: size, Count: size / 32, CellSize: splattiles.CellSize}
	prefix := strings.TrimSuffix(job.Key, ".splat") + "/" + splattiles.Version + "/" + digest + "/" + job.Attempt.String() + "/"
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
	for i, cell := range keys {
		id := fmt.Sprintf("tile-%03d", i)
		path := filepath.Join(dir, id+".splat")
		if err = os.WriteFile(path, cells[cell], 0600); err != nil {
			return err
		}
		tileHash, tileSize, err := fileHash(path)
		if err != nil {
			return err
		}
		tile := splattiles.Tile{ID: id, Key: prefix + id + ".splat", SHA256: tileHash, Bytes: tileSize, Count: tileSize / 32, Bounds: bounds[cell]}
		manifest.Tiles = append(manifest.Tiles, tile)
	}
	if err = manifest.Validate(); err != nil {
		return err
	}
	for _, tile := range manifest.Tiles {
		if r, ok := store.(retirementStore); ok {
			if err = r.QueueStorageRetirement(ctx, tile.Key); err != nil {
				return err
			}
		}
		uploaded = append(uploaded, tile.Key)
		if err = objects.PutFile(ctx, tile.Key, filepath.Join(dir, tile.ID+".splat"), "application/octet-stream"); err != nil {
			return err
		}
	}
	encoded, _ := json.Marshal(manifest)
	published, err = store.FinishDerivative(ctx, job, encoded, "")
	if err != nil {
		return err
	}
	if !published {
		return fmt.Errorf("splat tile claim expired; unpublished outputs retired")
	}
	return nil
}
