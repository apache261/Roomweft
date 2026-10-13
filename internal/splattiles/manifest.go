package splattiles

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"math"
	"regexp"
)

const Version = "splat-tiles-v1"
const CellSize = 8.0
const MaxTiles = 512

var hash = regexp.MustCompile(`^[a-f0-9]{64}$`)
var tileID = regexp.MustCompile(`^tile-[0-9]{3}$`)

type Tile struct {
	ID     string     `json:"id"`
	Key    string     `json:"key,omitempty"`
	SHA256 string     `json:"sha256"`
	Bytes  int64      `json:"bytes"`
	Count  int64      `json:"count"`
	Bounds [6]float64 `json:"bounds"`
}
type Manifest struct {
	Version     string  `json:"version"`
	AttemptID   string  `json:"attempt_id"`
	ParentID    string  `json:"parent_asset_id"`
	SourceHash  string  `json:"source_sha256"`
	SourceBytes int64   `json:"source_bytes"`
	Count       int64   `json:"count"`
	CellSize    float64 `json:"cell_size"`
	Tiles       []Tile  `json:"tiles"`
}

func Decode(raw []byte, m *Manifest) error {
	if len(raw) > 256*1024 {
		return fmt.Errorf("tile manifest exceeds limit")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	return d.Decode(m)
}
func (m Manifest) Validate() error {
	if _, err := uuid.Parse(m.AttemptID); err != nil {
		return err
	}
	if _, err := uuid.Parse(m.ParentID); err != nil {
		return err
	}
	if m.Version != Version || !hash.MatchString(m.SourceHash) || m.Count < 1 || m.Count > 2_000_000 || m.SourceBytes != m.Count*32 || m.CellSize != CellSize || len(m.Tiles) == 0 || len(m.Tiles) > MaxTiles {
		return fmt.Errorf("invalid splat tile manifest identity or limits")
	}
	seen := map[string]bool{}
	var total int64
	for _, t := range m.Tiles {
		if !tileID.MatchString(t.ID) || seen[t.ID] || !hash.MatchString(t.SHA256) || t.Count < 1 || t.Count > 2_000_000 || t.Bytes != t.Count*32 {
			return fmt.Errorf("invalid splat tile")
		}
		seen[t.ID] = true
		total += t.Count
		for _, n := range t.Bounds {
			if math.IsNaN(n) || math.IsInf(n, 0) || math.Abs(n) > 1_010_000 {
				return fmt.Errorf("invalid tile bounds")
			}
		}
		for i := 0; i < 3; i++ {
			if t.Bounds[i] > t.Bounds[i+3] {
				return fmt.Errorf("inverted tile bounds")
			}
		}
	}
	if total != m.Count {
		return fmt.Errorf("tile coverage count mismatch")
	}
	return nil
}
