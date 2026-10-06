// Package layout defines the versioned, single-level authoring document.
package layout

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
	"virtual-tour/internal/materials"
	"virtual-tour/internal/walkconfig"
)

var floorPath = regexp.MustCompile(`^0(/[0-9]+)*$`)

type Element struct {
	RoomID        string            `json:"room_id,omitempty"`
	FloorMeshes   []string          `json:"floor_meshes,omitempty"`
	Exterior      bool              `json:"exterior,omitempty"`
	FloorMaterial string            `json:"floor_material,omitempty"`
	WallMaterial  string            `json:"wall_material,omitempty"`
	MeshMaterials map[string]string `json:"mesh_materials,omitempty"`
	ID            string            `json:"id"`
	Kind          string            `json:"kind"`
	Name          string            `json:"name"`
	X             float64           `json:"x"`
	Z             float64           `json:"z"`
	Width         float64           `json:"width"`
	Depth         float64           `json:"depth"`
	Height        float64           `json:"height"`
	Rotation      float64           `json:"rotation"`
	AssetID       string            `json:"asset_id,omitempty"`
	Scale         float64           `json:"scale"`
	Collidable    bool              `json:"collidable"`
	Tint          string            `json:"tint"`
	Roughness     *float64          `json:"roughness"`
}
type Door struct {
	ID     string  `json:"id"`
	A      string  `json:"a"`
	B      string  `json:"b"`
	At     float64 `json:"at"` // World coordinate along the shared edge.
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}
type Document struct {
	Navigation *walkconfig.Config `json:"navigation,omitempty"`
	Materials  []materials.Preset `json:"materials,omitempty"`
	Version    int                `json:"version"`
	Elements   []Element          `json:"elements"`
	Doors      []Door             `json:"doors"`
}
type Attachment struct {
	ElementID string     `json:"element_id"`
	Local     [3]float64 `json:"local"`
}
type Point struct {
	X          float64     `json:"x"`
	Y          float64     `json:"y"`
	Z          float64     `json:"z"`
	Attachment *Attachment `json:"attachment,omitempty"`
}

func Decode(raw json.RawMessage) Document { var d Document; _ = json.Unmarshal(raw, &d); return d }
func room(e Element) bool                 { return e.Kind == "ROOM" || e.Kind == "LOBBY" || e.Kind == "CORRIDOR" }
func finite(n, limit float64) bool {
	return !math.IsNaN(n) && !math.IsInf(n, 0) && math.Abs(n) <= limit
}
func (e Element) Bounds() (float64, float64, float64, float64) {
	w, d := e.Width, e.Depth
	if int(math.Abs(e.Rotation))%180 == 90 {
		w, d = d, w
	}
	return e.X - w/2, e.X + w/2, e.Z - d/2, e.Z + d/2
}

// SharedEdge returns the varying axis, fixed coordinate, and shared interval.
func SharedEdge(a, b Element) (string, float64, float64, float64, bool) {
	ax, ar, az, ab := a.Bounds()
	bx, br, bz, bb := b.Bounds()
	lo, hi := math.Max(az, bz), math.Min(ab, bb)
	if hi-lo > 0.01 && (math.Abs(ar-bx) < 1e-5 || math.Abs(br-ax) < 1e-5) {
		line := ar
		if math.Abs(br-ax) < 1e-5 {
			line = ax
		}
		return "z", line, lo, hi, true
	}
	lo, hi = math.Max(ax, bx), math.Min(ar, br)
	if hi-lo > 0.01 && (math.Abs(ab-bz) < 1e-5 || math.Abs(bb-az) < 1e-5) {
		line := ab
		if math.Abs(bb-az) < 1e-5 {
			line = az
		}
		return "x", line, lo, hi, true
	}
	return "", 0, 0, 0, false
}
func (d Document) Validate() error {
	if err := d.Navigation.Validate(false); err != nil {
		return err
	}
	if d.Version != 1 || d.Elements == nil || d.Doors == nil || len(d.Elements) > 200 || len(d.Doors) > 200 {
		return fmt.Errorf("layout requires version 1, elements and doors arrays (maximum 200 each)")
	}
	if err := materials.Validate(d.Materials); err != nil {
		return err
	}
	ids := map[string]bool{}
	elements := map[string]Element{}
	for _, e := range d.Elements {
		if len(e.FloorMeshes) > 0 {
			if e.Kind != "INSTANCE" || !e.Collidable || len(e.FloorMeshes) > 200 {
				return fmt.Errorf("approved room floors require a collidable imported instance (maximum 200 meshes)")
			}
			seen := map[string]bool{}
			for _, path := range e.FloorMeshes {
				if len(path) > 512 || !floorPath.MatchString(path) || seen[path] {
					return fmt.Errorf("room floors require unique stable mesh paths")
				}
				seen[path] = true
			}
		}
		if e.Exterior && e.Kind != "FLOOR" {
			return fmt.Errorf("only standalone floors can be exterior regions")
		}
		if (e.FloorMaterial != "" && !(room(e) || e.Kind == "FLOOR")) || (e.WallMaterial != "" && !(room(e) || e.Kind == "WALL")) {
			return fmt.Errorf("floor and wall materials require matching structural surfaces")
		}
		if !materials.Has(d.Materials, e.FloorMaterial) || !materials.Has(d.Materials, e.WallMaterial) {
			return fmt.Errorf("surface requires an existing material preset")
		}
		if err := materials.Validate(d.Materials, e.MeshMaterials); err != nil {
			return err
		}
		if e.Kind != "INSTANCE" && len(e.MeshMaterials) > 0 {
			return fmt.Errorf("mesh assignments require an imported instance")
		}
		if _, err := uuid.Parse(e.ID); err != nil || ids[e.ID] {
			return fmt.Errorf("element IDs must be unique UUIDs")
		}
		ids[e.ID] = true
		elements[e.ID] = e
		if strings.TrimSpace(e.Name) == "" || utf8.RuneCountInString(e.Name) > 120 {
			return fmt.Errorf("element name must contain 1–120 characters")
		}
		if !finite(e.X, 1000) || !finite(e.Z, 1000) || !finite(e.Rotation, 360) || !finite(e.Width, 100) || !finite(e.Depth, 100) || !finite(e.Height, 10) || e.Width < 0.1 || e.Depth < 0.1 || e.Height < 0.1 {
			return fmt.Errorf("dimensions must be 0.1–100 metres, height at most 10, coordinates within 1000 metres")
		}
		if !finite(e.Scale, 100) || e.Scale < 0.001 {
			return fmt.Errorf("instance scale must be 0.001–100")
		}
		if e.Tint != "" {
			var value uint32
			if len(e.Tint) != 7 || e.Tint[0] != '#' {
				return fmt.Errorf("tint must be #RRGGBB")
			}
			if _, err := fmt.Sscanf(e.Tint, "#%06x", &value); err != nil {
				return fmt.Errorf("invalid tint")
			}
			for _, c := range e.Tint[1:] {
				if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
					return fmt.Errorf("invalid tint")
				}
			}
		}
		if e.Roughness != nil && (!finite(*e.Roughness, 1) || *e.Roughness < 0) {
			return fmt.Errorf("roughness must be 0–1")
		}
		if e.Kind == "INSTANCE" {
			if _, err := uuid.Parse(e.AssetID); err != nil {
				return fmt.Errorf("instance requires a GLB asset UUID")
			}
		} else {
			if !(room(e) || e.Kind == "FLOOR" || e.Kind == "WALL") || e.AssetID != "" || e.Scale != 1 || e.Rotation/90 != math.Trunc(e.Rotation/90) || !e.Collidable {
				return fmt.Errorf("structural elements require quarter-turn rotations and collision")
			}
			if room(e) && (e.Width < 1 || e.Depth < 1 || e.Height < 2.2) {
				return fmt.Errorf("rooms require dimensions at least 1 metre and height at least 2.2")
			}
			if e.Kind == "WALL" && e.Depth != 0.12 {
				return fmt.Errorf("wall thickness must be 0.12 metres")
			}
		}
	}
	for _, e := range d.Elements {
		if e.RoomID != "" && (e.Kind != "INSTANCE" || !room(elements[e.RoomID])) {
			return fmt.Errorf("streaming room must reference a template room")
		}
	}
	for i, a := range d.Elements {
		if !room(a) {
			continue
		}
		ax, ar, az, ab := a.Bounds()
		for _, b := range d.Elements[i+1:] {
			if !room(b) {
				continue
			}
			bx, br, bz, bb := b.Bounds()
			if math.Min(ar, br)-math.Max(ax, bx) > 1e-5 && math.Min(ab, bb)-math.Max(az, bz) > 1e-5 {
				return fmt.Errorf("rooms overlap: %s and %s", a.Name, b.Name)
			}
		}
	}
	// Merge coincident edges in the renderer, but reject nearly parallel walls
	// whose thicknesses would overlap at different centre lines.
	type edge struct {
		axis         string
		line, lo, hi float64
	}
	edges := []edge{}
	for _, e := range d.Elements {
		x, r, z, b := e.Bounds()
		if room(e) {
			edges = append(edges, edge{"x", z, x, r}, edge{"x", b, x, r}, edge{"z", x, z, b}, edge{"z", r, z, b})
		} else if e.Kind == "WALL" {
			if int(math.Abs(e.Rotation))%180 == 90 {
				edges = append(edges, edge{"z", e.X, z, b})
			} else {
				edges = append(edges, edge{"x", e.Z, x, r})
			}
		}
	}
	for i, a := range edges {
		for _, b := range edges[i+1:] {
			distance := math.Abs(a.line - b.line)
			if a.axis == b.axis && distance > 1e-5 && distance < 0.12-1e-5 && math.Min(a.hi, b.hi)-math.Max(a.lo, b.lo) > 1e-5 {
				return fmt.Errorf("parallel wall thicknesses overlap; align their edges or leave at least 0.12 metres")
			}
		}
	}
	for i, door := range d.Doors {
		if _, err := uuid.Parse(door.ID); err != nil || ids[door.ID] {
			return fmt.Errorf("door IDs must be unique UUIDs")
		}
		ids[door.ID] = true
		a, aok := elements[door.A]
		b, bok := elements[door.B]
		axis, line, lo, hi, shared := SharedEdge(a, b)
		if !aok || !bok || !room(a) || !room(b) || door.A == door.B || !shared || !finite(door.At, 1100) || !finite(door.Width, 10) || door.Width < 0.8 || !finite(door.Height, 10) || door.Height < 2 || door.Height > math.Min(a.Height, b.Height) || door.At-door.Width/2 < lo+0.12-1e-5 || door.At+door.Width/2 > hi-0.12+1e-5 {
			return fmt.Errorf("doorway requires adjacent room edges, at least 0.8 m width / 2 m height, and 0.12 m end clearance")
		}
		for _, prior := range d.Doors[:i] {
			pa, pb := elements[prior.A], elements[prior.B]
			px, pl, _, _, _ := SharedEdge(pa, pb)
			if px == axis && math.Abs(pl-line) < 1e-5 && math.Abs(prior.At-door.At) < (prior.Width+door.Width)/2+0.12 {
				return fmt.Errorf("doorway openings overlap")
			}
		}
		for _, e := range d.Elements {
			if e.Kind != "WALL" {
				continue
			}
			x, r, z, b := e.Bounds()
			if (axis == "x" && line >= z-0.12 && line <= b+0.12 && r > door.At-door.Width/2 && x < door.At+door.Width/2) || (axis == "z" && line >= x-0.12 && line <= r+0.12 && b > door.At-door.Width/2 && z < door.At+door.Width/2) {
				return fmt.Errorf("standalone wall blocks a doorway")
			}
		}
	}
	return nil
}
func (d Document) Element(id string) (Element, bool) {
	for _, e := range d.Elements {
		if e.ID == id {
			return e, true
		}
	}
	return Element{}, false
}
func (d Document) Position(a Attachment) (Point, error) {
	e, ok := d.Element(a.ElementID)
	if !ok {
		return Point{}, fmt.Errorf("attached element no longer exists; detach or delete its hotspots before deleting it")
	}
	for _, n := range a.Local {
		if !finite(n, 1000) {
			return Point{}, fmt.Errorf("attachment local coordinates must be finite and within 1000 metres")
		}
	}
	s := 1.0
	if e.Kind == "INSTANCE" {
		s = e.Scale
	}
	angle := e.Rotation * math.Pi / 180
	c, sn := math.Cos(angle), math.Sin(angle)
	p := Point{X: e.X + s*(c*a.Local[0]+sn*a.Local[2]), Y: s * a.Local[1], Z: e.Z + s*(-sn*a.Local[0]+c*a.Local[2]), Attachment: &a}
	if !finite(p.X, 1e6) || !finite(p.Y, 1e6) || !finite(p.Z, 1e6) {
		return Point{}, fmt.Errorf("attachment outside supported bounds")
	}
	return p, nil
}

// Decode numeric author input strictly: null/short coordinate arrays must not
// silently become zero coordinates through encoding/json's numeric defaults.
func strictFields(raw []byte, target any, required []string, nullable map[string]bool) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for _, key := range required {
		value, ok := fields[key]
		if !ok || (!nullable[key] && string(value) == "null") {
			return fmt.Errorf("%s is required and cannot be null", key)
		}
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}
func (e *Element) UnmarshalJSON(raw []byte) error {
	type plain Element
	var value plain
	if err := strictFields(raw, &value, []string{"id", "kind", "name", "x", "z", "width", "depth", "height", "rotation", "scale", "collidable", "tint", "roughness"}, map[string]bool{"roughness": true}); err != nil {
		return err
	}
	*e = Element(value)
	return nil
}
func (d *Door) UnmarshalJSON(raw []byte) error {
	type plain Door
	var value plain
	if err := strictFields(raw, &value, []string{"id", "a", "b", "at", "width", "height"}, nil); err != nil {
		return err
	}
	*d = Door(value)
	return nil
}
func (a *Attachment) UnmarshalJSON(raw []byte) error {
	var value struct {
		ElementID string     `json:"element_id"`
		Local     []*float64 `json:"local"`
	}
	if err := strictFields(raw, &value, []string{"element_id", "local"}, nil); err != nil {
		return err
	}
	if len(value.Local) != 3 {
		return fmt.Errorf("local position requires three numbers")
	}
	for i, n := range value.Local {
		if n == nil || !finite(*n, 1000) {
			return fmt.Errorf("local position requires three finite numbers within 1000 metres")
		}
		a.Local[i] = *n
	}
	a.ElementID = value.ElementID
	return nil
}
