// Package materials defines reusable, role-aware surface materials.
package materials

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"math"
	"regexp"
	"strings"
)

type Preset struct {
	LightMap     string     `json:"light_map,omitempty"`
	AOMap        string     `json:"ao_map,omitempty"`
	BakeRevision string     `json:"bake_revision,omitempty"`
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	BaseColor    string     `json:"base_color,omitempty"`
	Normal       string     `json:"normal,omitempty"`
	RoughnessMap string     `json:"roughness_map,omitempty"`
	TileSize     float64    `json:"tile_size"`
	Repeat       [2]float64 `json:"repeat"`
	Offset       [2]float64 `json:"offset"`
	Rotation     float64    `json:"rotation"`
	Tint         string     `json:"tint"`
	Roughness    float64    `json:"roughness"`
}
type Reference struct{ ID, Kind string }

func References(presets []Preset) []Reference {
	refs := []Reference{}
	for _, p := range presets {
		for _, r := range []Reference{{p.BaseColor, "TEXTURE_BASE_COLOR"}, {p.Normal, "TEXTURE_NORMAL"}, {p.RoughnessMap, "TEXTURE_ROUGHNESS"}, {p.AOMap, "TEXTURE_AO"}, {p.LightMap, "TEXTURE_LIGHTMAP"}} {
			if r.ID != "" {
				refs = append(refs, r)
			}
		}
	}
	return refs
}

var bakeRevision = regexp.MustCompile(`^bake-v1:[0-9a-f]{32}$`)
var color = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
var path = regexp.MustCompile(`^0(/[0-9]+)*$`)

func number(n, lo, hi float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= lo && n <= hi }
func Validate(presets []Preset, assignments ...map[string]string) error {
	if len(presets) > 100 {
		return fmt.Errorf("at most 100 material presets allowed")
	}
	ids := map[string]bool{}
	for _, p := range presets {
		if _, err := uuid.Parse(p.ID); err != nil || ids[p.ID] {
			return fmt.Errorf("material IDs must be unique UUIDs")
		}
		ids[p.ID] = true
		if p.BakeRevision != "" && !bakeRevision.MatchString(p.BakeRevision) {
			return fmt.Errorf("baked maps require a valid reviewed revision")
		}
		if strings.TrimSpace(p.Name) == "" || len([]rune(p.Name)) > 120 || !color.MatchString(p.Tint) || !number(p.Roughness, 0, 1) || !number(p.TileSize, 0.01, 100) || !number(p.Rotation, -360, 360) {
			return fmt.Errorf("material requires a name, #RRGGBB tint, roughness 0–1, tile size 0.01–100 m and rotation -360–360")
		}
		for i := 0; i < 2; i++ {
			if !number(p.Repeat[i], 0.01, 100) || !number(p.Offset[i], -1000, 1000) {
				return fmt.Errorf("material repeat must be 0.01–100 and offset within 1000")
			}
		}
	}
	for _, r := range References(presets) {
		if _, err := uuid.Parse(r.ID); err != nil {
			return fmt.Errorf("texture references must be asset UUIDs")
		}
	}
	for _, a := range assignments {
		if len(a) > 200 {
			return fmt.Errorf("at most 200 imported surface assignments allowed")
		}
		for key, id := range a {
			if !path.MatchString(key) || len(key) > 512 || !ids[id] {
				return fmt.Errorf("surface assignment requires a stable mesh path and existing material")
			}
		}
	}
	return nil
}
func Has(presets []Preset, id string) bool {
	if id == "" {
		return true
	}
	for _, p := range presets {
		if p.ID == id {
			return true
		}
	}
	return false
}

// Numeric arrays must contain exactly two real values, never null or an
// implicitly padded zero. Old documents may omit the entire presets array.
func (p *Preset) UnmarshalJSON(raw []byte) error {
	type plain Preset
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for _, key := range []string{"id", "name", "tile_size", "repeat", "offset", "rotation", "tint", "roughness"} {
		if v, ok := fields[key]; !ok || string(v) == "null" {
			return fmt.Errorf("material %s is required", key)
		}
	}
	for _, key := range []string{"repeat", "offset"} {
		var v []*float64
		if json.Unmarshal(fields[key], &v) != nil || len(v) != 2 || v[0] == nil || v[1] == nil {
			return fmt.Errorf("material %s requires two numbers", key)
		}
	}
	var result plain
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&result); err != nil {
		return err
	}
	*p = Preset(result)
	return nil
}
