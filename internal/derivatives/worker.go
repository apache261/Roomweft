package derivatives

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"virtual-tour/internal/database"
)

type Store interface {
	ClaimDerivative(context.Context) (database.DerivativeJob, error)
	FinishDerivative(context.Context, database.DerivativeJob, []byte, string) (bool, error)
}
type Objects interface {
	Download(context.Context, string, string, int64) error
	PutFile(context.Context, string, string, string) error
	Delete(context.Context, string) error
}
type Variant struct {
	File         string `json:"file,omitempty"`
	Key          string `json:"key,omitempty"`
	URL          string `json:"url,omitempty"`
	SHA256       string `json:"sha256"`
	Bytes        int64  `json:"bytes"`
	TextureBytes int64  `json:"texture_rgba8_bytes"`
	MaxTexture   int    `json:"max_texture"`
}
type Collision struct {
	Variant
	GeometryHash  string `json:"geometry_sha256"`
	Strategy      string `json:"strategy"`
	FloorApproval string `json:"floor_approval"`
}
type Manifest struct {
	Version          string             `json:"version"`
	SourceHash       string             `json:"source_sha256"`
	SourceMaxTexture int                `json:"source_max_texture,omitempty"`
	SourceBytes      int64              `json:"source_bytes"`
	Bounds           json.RawMessage    `json:"bounds"`
	Surfaces         json.RawMessage    `json:"surfaces"`
	Collision        *Collision         `json:"collision,omitempty"`
	Variants         map[string]Variant `json:"variants"`
}

// Process never changes the source key. Outputs remain undiscoverable until one
// compare-and-swap DB update publishes the complete manifest.
func Process(ctx context.Context, store Store, objects Objects, script string, job database.DerivativeJob) error {
	dir, err := os.MkdirTemp("", "tour-derivatives-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	if job.Size > 256*1024*1024 {
		return errors.New("model exceeds the 256 MiB processing limit; original remains usable; use a smaller GLB and retry")
	}
	source := filepath.Join(dir, "source.glb")
	if err = objects.Download(ctx, job.Key, source, job.Size); err != nil {
		return fmt.Errorf("could not read original; retry processing: %w", err)
	}
	command := exec.CommandContext(ctx, "node", "--max-old-space-size=1024", script, source, dir, job.Kind)
	// Input filenames are generated locally, never user-controlled shell commands.
	output := &processLog{}
	command.Stdout = output
	command.Stderr = output
	err = command.Run()
	if err != nil {
		message := strings.TrimSpace(string(output.data))
		if len(message) > 1200 {
			message = message[len(message)-1200:]
		}
		return fmt.Errorf("processing failed; original remains usable; re-export a valid GLB or retry: %s", message)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return err
	}
	var manifest Manifest
	if err = json.Unmarshal(raw, &manifest); err != nil {
		return err
	}
	sourceHash, sourceBytes, err := fileHash(source)
	if err != nil {
		return err
	}
	if manifest.SourceHash != sourceHash || manifest.SourceBytes != sourceBytes {
		return errors.New("processor source identity mismatch")
	}
	if manifest.Version != database.DerivativeVersion || len(manifest.SourceHash) != 64 || len(manifest.Variants) != 3 {
		return errors.New("processor produced an invalid manifest")
	}
	prefix := strings.TrimSuffix(job.Key, ".glb") + "/" + database.DerivativeVersion + "/" + manifest.SourceHash + "/" + job.Attempt.String() + "/"
	uploaded := []string{}
	published := false
	defer func() {
		if !published {
			cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			for _, key := range uploaded {
				_ = objects.Delete(cleanup, key)
			}
		}
	}()
	texture := strings.HasPrefix(job.Kind, "TEXTURE_")
	extension := ".glb"
	contentType := "model/gltf-binary"
	if texture {
		extension = ".png"
		contentType = "image/png"
	}
	for _, tier := range []string{"low", "balanced", "hq"} {
		v, ok := manifest.Variants[tier]
		if !ok || v.File != tier+extension || v.Bytes < 20 || len(v.SHA256) != 64 {
			return errors.New("processor produced an invalid variant")
		}
		digest, size, err := fileHash(filepath.Join(dir, v.File))
		if err != nil || digest != v.SHA256 || size != v.Bytes {
			return errors.New("processor variant integrity mismatch")
		}
		v.Key = prefix + v.File
		// Include attempted keys so interrupted multipart uploads/completed writes are cleaned too.
		uploaded = append(uploaded, v.Key)
		if err = objects.PutFile(ctx, v.Key, filepath.Join(dir, v.File), contentType); err != nil {
			return err
		}
		v.File = ""
		manifest.Variants[tier] = v
	}
	if !texture {
		if manifest.Collision == nil || manifest.Collision.File != "collision.glb" || manifest.Collision.Strategy != "verified-exact-geometry" || manifest.Collision.FloorApproval != "authored-only" || len(manifest.Collision.SHA256) != 64 {
			return errors.New("processor produced an invalid collision proxy")
		}
		digest, size, err := fileHash(filepath.Join(dir, "collision.glb"))
		if err != nil || digest != manifest.Collision.SHA256 || size != manifest.Collision.Bytes {
			return errors.New("processor collision integrity mismatch")
		}
		manifest.Collision.Key = prefix + "collision.glb"
		uploaded = append(uploaded, manifest.Collision.Key)
		if err = objects.PutFile(ctx, manifest.Collision.Key, filepath.Join(dir, "collision.glb"), "model/gltf-binary"); err != nil {
			return err
		}
		manifest.Collision.File = ""
	}
	raw, err = json.Marshal(manifest)
	if err != nil {
		return err
	}
	published, err = store.FinishDerivative(ctx, job, raw, "")
	if err != nil {
		return err
	}
	if !published {
		return errors.New("processing claim expired or asset was deleted; outputs discarded")
	}
	return nil
}
func Run(ctx context.Context, store Store, objects Objects, script string) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		job, err := store.ClaimDerivative(ctx)
		if err == nil {
			task, cancel := context.WithTimeout(ctx, 10*time.Minute)
			err = Process(task, store, objects, script, job)
			cancel()
			if err != nil {
				slog.Warn("asset derivative failed", "asset", job.AssetID.String(), "error", err)
				finish, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				_, _ = store.FinishDerivative(finish, job, nil, err.Error())
				cancel()
			}
			if ctx.Err() != nil {
				return
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) && ctx.Err() == nil {
			slog.Warn("asset derivative queue failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func fileHash(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	return hex.EncodeToString(hash.Sum(nil)), size, err
}

// Bound processor logs independently of the Node heap and source file limit.
type processLog struct {
	mu   sync.Mutex
	data []byte
}

func (l *processLog) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := len(p)
	if len(p) > 4096 {
		p = p[len(p)-4096:]
	}
	if len(l.data)+len(p) > 4096 {
		l.data = l.data[len(l.data)+len(p)-4096:]
	}
	l.data = append(l.data, p...)
	return n, nil
}
