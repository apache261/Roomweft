package sceneconfig

import (
	"bytes"
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
type Splat struct {
	Version     int        `json:"version"`
	Position    [3]float64 `json:"position"`
	Controls    string     `json:"controls"`
	MinDistance float64    `json:"min_distance"`
	MaxDistance float64    `json:"max_distance"`
}

func DefaultSplat() Settings {
	s := Default()
	s.Appearance.EnvironmentIntensity = 0
	s.Appearance.LightIntensity = 0
	s.Splat = &Splat{Version: 1, Controls: "orbit", MinDistance: 0.1, MaxDistance: 1000}
	return s
}

type Settings struct {
	Splat            *Splat             `json:"splat,omitempty"`
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
	if s.Splat != nil {
		v := s.Splat
		if v.Version != 1 || v.Controls != "orbit" || !bounded(v.MinDistance, 0.01, 1e6) || !bounded(v.MaxDistance, v.MinDistance, 1e6) {
			return errors.New("invalid splat v1 inspection bounds or controls")
		}
		for _, n := range v.Position {
			if !bounded(n, -1e6, 1e6) {
				return errors.New("invalid splat position")
			}
		}
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

// ValidateForScene prevents mesh/walking controls from being persisted on splats.
func (s Settings) ValidateForScene(kind string) error {
	if err := s.Validate(); err != nil {
		return err
	}
	if kind != "SPLAT" {
		if s.Splat != nil {
			return errors.New("splat settings require a SPLAT scene")
		}
		return nil
	}
	if s.Splat == nil || s.Navigation != nil || len(s.Materials) > 0 || len(s.SurfaceMaterials) > 0 || s.Appearance.HQShadows || s.Appearance.EnvironmentIntensity != 0 || s.Appearance.LightIntensity != 0 || s.Appearance.Tint != "" || s.Appearance.Roughness != nil {
		return errors.New("SPLAT requires versioned inspection settings; mesh materials, lighting and walking are unavailable")
	}
	return nil
}
func SourceTransformChanged(a, b Settings) bool {
	if a.Model != b.Model {
		return true
	}
	return a.Splat != nil && b.Splat != nil && a.Splat.Position != b.Splat.Position
}
func RepositionForSettings(p [3]float64, a, b Settings) [3]float64 {
	if a.Splat != nil {
		for i := range p {
			p[i] -= a.Splat.Position[i]
		}
	}
	p = Reposition(p, a.Model, b.Model)
	if b.Splat != nil {
		for i := range p {
			p[i] += b.Splat.Position[i]
		}
	}
	return p
}

func (v *Splat) UnmarshalJSON(raw []byte) error {
	type wire struct {
		Version     int        `json:"version"`
		Position    []*float64 `json:"position"`
		Controls    string     `json:"controls"`
		MinDistance float64    `json:"min_distance"`
		MaxDistance float64    `json:"max_distance"`
	}
	var w wire
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&w); err != nil {
		return err
	}
	if len(w.Position) != 3 || w.Position[0] == nil || w.Position[1] == nil || w.Position[2] == nil {
		return errors.New("splat position requires exactly three coordinates")
	}
	*v = Splat{Version: w.Version, Position: [3]float64{*w.Position[0], *w.Position[1], *w.Position[2]}, Controls: w.Controls, MinDistance: w.MinDistance, MaxDistance: w.MaxDistance}
	return nil
}
