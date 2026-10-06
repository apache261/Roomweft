package walkconfig

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"math"
	"regexp"
	"strings"
)

type Region struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Left        float64  `json:"left"`
	Right       float64  `json:"right"`
	Top         float64  `json:"top"`
	Bottom      float64  `json:"bottom"`
	MinY        float64  `json:"min_y"`
	MaxY        float64  `json:"max_y"`
	FloorMeshes []string `json:"floor_meshes,omitempty"`
	Exterior    bool     `json:"exterior,omitempty"`
}
type Pose struct {
	Position [3]float64 `json:"position"`
	Yaw      float64    `json:"yaw"`
	Pitch    float64    `json:"pitch"`
}
type Portal struct {
	ID                  string     `json:"id"`
	Label               string     `json:"label"`
	Position            [3]float64 `json:"position"`
	Axis                string     `json:"axis"`
	Width               float64    `json:"width"`
	DestinationSceneID  string     `json:"destination_scene_id,omitempty"`
	DestinationRegionID string     `json:"destination_region_id"`
	Arrival             Pose       `json:"arrival"`
}
type Config struct {
	Speed      float64  `json:"speed"`
	EyeHeight  float64  `json:"eye_height"`
	StepHeight float64  `json:"step_height"`
	MaxSlope   float64  `json:"max_slope"`
	Regions    []Region `json:"regions"`
	Portals    []Portal `json:"portals"`
}

func Default() Config {
	return Config{Speed: 2, EyeHeight: 1.65, StepHeight: 0.25, MaxSlope: 40, Regions: []Region{}, Portals: []Portal{}}
}
func finite(n, lo, hi float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= lo && n <= hi }

var meshPath = regexp.MustCompile(`^0(/[0-9]+)*$`)

func (c *Config) Validate(imported bool) error {
	if c == nil {
		return nil
	}
	if !finite(c.Speed, 0.25, 6) || !finite(c.EyeHeight, 1, 2.2) || !finite(c.StepHeight, 0.01, 0.4) || !finite(c.MaxSlope, 0, 50) || len(c.Regions) > 100 || len(c.Portals) > 100 || c.Regions == nil || c.Portals == nil {
		return fmt.Errorf("walking requires speed 0.25–6, eye height 1–2.2, step height 0.01–0.4, slope 0–50, regions and portals arrays (maximum 100)")
	}
	if !imported && len(c.Regions) > 0 {
		return fmt.Errorf("layout walking regions derive from structural floors")
	}
	ids := map[string]bool{}
	for _, r := range c.Regions {
		if _, err := uuid.Parse(r.ID); err != nil || ids[r.ID] || strings.TrimSpace(r.Name) == "" || len([]rune(r.Name)) > 120 {
			return fmt.Errorf("regions require unique UUIDs and names")
		}
		ids[r.ID] = true
		for _, n := range []float64{r.Left, r.Right, r.Top, r.Bottom, r.MinY, r.MaxY} {
			if !finite(n, -1000, 1000) {
				return fmt.Errorf("walking region coordinates must be finite within 1000 metres")
			}
		}
		if r.Right-r.Left < 0.5 || r.Bottom-r.Top < 0.5 || r.MinY > r.MaxY || len(r.FloorMeshes) == 0 || len(r.FloorMeshes) > 200 {
			return fmt.Errorf("reviewed regions require at least 0.5 metre sides, a floor height band, and selected floor meshes")
		}
		for _, path := range r.FloorMeshes {
			if len(path) > 512 || !meshPath.MatchString(path) {
				return fmt.Errorf("floor mesh paths must be stable child-index paths")
			}
		}
	}
	for _, p := range c.Portals {
		if _, err := uuid.Parse(p.ID); err != nil || ids[p.ID] || strings.TrimSpace(p.Label) == "" || len([]rune(p.Label)) > 120 || (p.Axis != "x" && p.Axis != "z") || !finite(p.Width, 0.8, 10) {
			return fmt.Errorf("portals require unique UUIDs, labels, x/z threshold axis and width 0.8–10")
		}
		ids[p.ID] = true
		if _, err := uuid.Parse(p.DestinationRegionID); err != nil {
			return fmt.Errorf("portal destination requires a region UUID")
		}
		if p.DestinationSceneID != "" {
			if _, err := uuid.Parse(p.DestinationSceneID); err != nil {
				return fmt.Errorf("portal destination scene must be a UUID")
			}
		}
		for _, n := range p.Position {
			if !finite(n, -1000, 1000) {
				return fmt.Errorf("portal activation must contain finite coordinates")
			}
		}
		if err := p.Arrival.Validate(); err != nil {
			return err
		}
	}
	return nil
}
func (p Pose) Validate() error {
	for _, n := range p.Position {
		if !finite(n, -1000, 1000) {
			return fmt.Errorf("arrival requires finite coordinates within 1000 metres")
		}
	}
	if !finite(p.Yaw, -math.Pi, math.Pi) || !finite(p.Pitch, -math.Pi/2+0.01, math.Pi/2-0.01) {
		return fmt.Errorf("arrival angles must be valid radians")
	}
	return nil
}
func (r Region) Contains(p Pose, eye float64) bool {
	return p.Position[0] >= r.Left && p.Position[0] <= r.Right && p.Position[2] >= r.Top && p.Position[2] <= r.Bottom && p.Position[1]-eye >= r.MinY-0.05 && p.Position[1]-eye <= r.MaxY+0.05
}
func strict(raw []byte, target any, keys []string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for _, key := range keys {
		if v, ok := fields[key]; !ok || string(v) == "null" {
			return fmt.Errorf("%s is required and cannot be null", key)
		}
	}
	for _, key := range []string{"position"} {
		if v, ok := fields[key]; ok {
			var values []*float64
			if json.Unmarshal(v, &values) != nil || len(values) != 3 || values[0] == nil || values[1] == nil || values[2] == nil {
				return fmt.Errorf("position requires three numbers")
			}
		}
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	return d.Decode(target)
}
func (c *Config) UnmarshalJSON(raw []byte) error {
	type plain Config
	var v plain
	if err := strict(raw, &v, []string{"speed", "eye_height", "step_height", "max_slope", "regions", "portals"}); err != nil {
		return err
	}
	*c = Config(v)
	return nil
}
func (r *Region) UnmarshalJSON(raw []byte) error {
	type plain Region
	var v plain
	if err := strict(raw, &v, []string{"id", "name", "left", "right", "top", "bottom", "min_y", "max_y", "floor_meshes"}); err != nil {
		return err
	}
	*r = Region(v)
	return nil
}
func (p *Portal) UnmarshalJSON(raw []byte) error {
	type plain Portal
	var v plain
	if err := strict(raw, &v, []string{"id", "label", "position", "axis", "width", "destination_region_id", "arrival"}); err != nil {
		return err
	}
	*p = Portal(v)
	return nil
}
func (p *Pose) UnmarshalJSON(raw []byte) error {
	type plain Pose
	var v plain
	if err := strict(raw, &v, []string{"position", "yaw", "pitch"}); err != nil {
		return err
	}
	*p = Pose(v)
	return nil
}
