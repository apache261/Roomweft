package sceneconfig

import (
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"virtual-tour/internal/materials"
	"virtual-tour/internal/walkconfig"
)

var ErrTransformBounds = errors.New("transformed hotspot exceeds supported bounds; reduce model scale")

type Appearance struct {
	HQShadows            bool     `json:"hq_shadows,omitempty"`
	Exposure             float64  `json:"exposure"`
	EnvironmentIntensity float64  `json:"environment_intensity"`
	LightIntensity       float64  `json:"light_intensity"`
	Background           string   `json:"background"`
	Tint                 string   `json:"tint"`
	Roughness            *float64 `json:"roughness"`
}
type Model struct {
	Scale    float64 `json:"scale"`
	UpAxis   string  `json:"up_axis"`
	Rotation float64 `json:"rotation"`
}
type Settings struct {
	Navigation       *walkconfig.Config `json:"navigation,omitempty"`
	Materials        []materials.Preset `json:"materials,omitempty"`
	SurfaceMaterials map[string]string  `json:"surface_materials,omitempty"`
	Appearance       Appearance         `json:"appearance"`
	Model            Model              `json:"model"`
}

func Default() Settings {
	return Settings{Appearance: Appearance{Exposure: 1, EnvironmentIntensity: 1, LightIntensity: 1, Background: "#edf1e8"}, Model: Model{Scale: 1, UpAxis: "Y"}}
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func bounded(n, low, high float64) bool {
	return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= low && n <= high
}
func (s Settings) Validate() error {
	if err := s.Navigation.Validate(true); err != nil {
		return err
	}
	if err := materials.Validate(s.Materials, s.SurfaceMaterials); err != nil {
		return err
	}
	a, m := s.Appearance, s.Model
	if !bounded(a.Exposure, 0.1, 4) || !bounded(a.EnvironmentIntensity, 0, 3) || !bounded(a.LightIntensity, 0, 5) || !hexColor.MatchString(a.Background) || (a.Tint != "" && !hexColor.MatchString(a.Tint)) || (a.Roughness != nil && !bounded(*a.Roughness, 0, 1)) {
		return errors.New("invalid appearance: exposure 0.1–4, environment 0–3, light 0–5, #RRGGBB colors, roughness null or 0–1 required")
	}
	if !bounded(m.Scale, 0.000001, 1000000) || (m.UpAxis != "Y" && m.UpAxis != "Z") || !bounded(m.Rotation, -180, 180) {
		return errors.New("invalid model preparation: positive scale 0.000001–1000000, up_axis Y or Z, rotation -180–180 degrees required")
	}
	return nil
}
func Decode(raw json.RawMessage) Settings { s := Default(); _ = json.Unmarshal(raw, &s); return s }

// Convert a world point through the old wrapper inverse and the new wrapper.
// The renderer applies scale, then Z-up correction, then yaw in the same order.
func Reposition(p [3]float64, old, next Model) [3]float64 {
	yaw := -old.Rotation * math.Pi / 180
	x, z := p[0]*math.Cos(yaw)+p[2]*math.Sin(yaw), -p[0]*math.Sin(yaw)+p[2]*math.Cos(yaw)
	p = [3]float64{x, p[1], z}
	if old.UpAxis == "Z" {
		p = [3]float64{p[0], -p[2], p[1]}
	}
	for i := range p {
		p[i] *= next.Scale / old.Scale
	}
	if next.UpAxis == "Z" {
		p = [3]float64{p[0], p[2], -p[1]}
	}
	yaw = next.Rotation * math.Pi / 180
	return [3]float64{p[0]*math.Cos(yaw) + p[2]*math.Sin(yaw), p[1], -p[0]*math.Sin(yaw) + p[2]*math.Cos(yaw)}
}
