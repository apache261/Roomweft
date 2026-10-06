// Package chunking defines contracts independently of runtime-v1 delivery.
package chunking

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"io"
	"math"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const ManifestSchema = "streaming-v1"
const ProcessorVersion = "chunks-v1"
const PartitionSchema = "partition-v1"
const InventorySchema = "source-inventory-v1"
const MaxRecords = 10000
const maxSafeInteger int64 = 9007199254740991

func count(n int64, min int64) bool { return n >= min && n <= maxSafeInteger }

var digest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var identifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$`)
var sourcePath = regexp.MustCompile(`^0(/(0|[1-9][0-9]*))*$`)

type Vec3 [3]float64

func (v *Vec3) UnmarshalJSON(data []byte) error {
	var values []float64
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	if len(values) != 3 {
		return errors.New("expected three coordinates")
	}
	copy(v[:], values)
	return nil
}

type Matrix [16]float64

func (v *Matrix) UnmarshalJSON(data []byte) error {
	var values []float64
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	if len(values) != 16 {
		return errors.New("expected 16 matrix entries")
	}
	copy(v[:], values)
	return nil
}

type Quad [4]Vec3

func (v *Quad) UnmarshalJSON(data []byte) error {
	var values []Vec3
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}
	if len(values) != 4 {
		return errors.New("expected four opening corners")
	}
	copy(v[:], values)
	return nil
}

type Bounds struct {
	Min Vec3 `json:"min"`
	Max Vec3 `json:"max"`
}
type Node struct {
	Path               string  `json:"path"`
	Name               string  `json:"name"`
	Parent             string  `json:"parent,omitempty"`
	SourceNode         *int    `json:"source_node,omitempty"`
	SourcePrimitive    *int    `json:"source_primitive,omitempty"`
	Bounds             *Bounds `json:"bounds"`
	Matrix             Matrix  `json:"matrix"`
	Renderable         bool    `json:"renderable"`
	Triangles          int64   `json:"triangles"`
	GeometryBytes      int64   `json:"geometry_bytes"`
	EmbeddedImageBytes int64   `json:"embedded_image_bytes"`
	DependencyGroup    string  `json:"dependency_group,omitempty"`
}
type Dependency struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"`
	NodePaths []string `json:"node_paths"`
}
type Inventory struct {
	ClipCount           int          `json:"clip_count"`
	SkinCount           int          `json:"skin_count"`
	Schema              string       `json:"schema"`
	Coordinates         string       `json:"coordinates"`
	SourceHash          string       `json:"source_sha256"`
	SourceBytes         int64        `json:"source_bytes"`
	Bounds              Bounds       `json:"bounds"`
	Nodes               []Node       `json:"nodes"`
	Dependencies        []Dependency `json:"dependencies"`
	ConservativeReasons []string     `json:"conservative_reasons"`
}
type Room struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Bounds    Bounds   `json:"bounds"`
	NodePaths []string `json:"node_paths"`
}
type Opening struct {
	ID       string  `json:"id"`
	From     string  `json:"from"`
	To       *string `json:"to"` // null denotes an exterior view, never walking permission.
	Kind     string  `json:"kind"`
	Corners  Quad    `json:"corners"`
	Reviewed bool    `json:"reviewed"`
}
type Partition struct {
	SpatialCellSize float64   `json:"spatial_cell_size,omitempty"`
	Schema          string    `json:"schema"`
	SourceHash      string    `json:"source_sha256"`
	Policy          string    `json:"policy"`     // complete or reviewed-rooms
	Visibility      string    `json:"visibility"` // conservative or reviewed-openings
	Rooms           []Room    `json:"rooms"`
	GlobalNodes     []string  `json:"global_node_paths"`
	Openings        []Opening `json:"openings"`
}
type Payload struct {
	Key          string `json:"key"`
	SHA256       string `json:"sha256"`
	Bytes        int64  `json:"bytes"`
	TextureBytes int64  `json:"texture_rgba8_bytes"`
	MaxTexture   int    `json:"max_texture"`
}
type Surface struct {
	Bounds    Bounds `json:"bounds"`
	Path      string `json:"path"`
	Primitive int    `json:"primitive"`
	Triangles int64  `json:"triangles"`
}
type SurfaceMap struct {
	SourcePath      string `json:"source_path"`
	SourcePrimitive int    `json:"source_primitive"`
	SourceStart     int64  `json:"source_triangle_start"`
	ChunkPath       string `json:"chunk_path"`
	ChunkPrimitive  int    `json:"chunk_primitive"`
	ChunkStart      int64  `json:"chunk_triangle_start"`
	Count           int64  `json:"triangle_count"`
}
type Chunk struct {
	ID             string             `json:"id"`
	Bounds         Bounds             `json:"bounds"`
	PrimitiveCount int                `json:"primitive_count"`
	TriangleCount  int64              `json:"triangle_count"`
	LocalToSource  Matrix             `json:"local_to_source"`
	Dependencies   []string           `json:"dependencies"`
	Surfaces       []SurfaceMap       `json:"surface_map"`
	Variants       map[string]Payload `json:"variants"`
}
type ResourceDependency struct {
	SourceNodes []string           `json:"source_node_paths"`
	SourceClips []int              `json:"source_clip_indices"`
	SourceSkins []int              `json:"source_skin_indices"`
	ID          string             `json:"id"`
	Kind        string             `json:"kind"`
	Requires    []string           `json:"requires"`
	Variants    map[string]Payload `json:"variants"`
}
type Region struct {
	ID       string   `json:"id"`
	Chunks   []string `json:"chunks"`
	Display  []string `json:"display_requires"`
	Movement []string `json:"movement_requires"`
}
type ExactIndex struct {
	Payload           Payload  `json:"payload"`
	Strategy          string   `json:"strategy"`
	FloorPaths        []string `json:"floor_source_paths"`
	AuthoredSemantics string   `json:"authored_semantics"`
}
type Manifest struct {
	SourceNodes       []string             `json:"source_node_paths"`
	ClipCount         int                  `json:"source_clip_count"`
	SkinCount         int                  `json:"source_skin_count"`
	Schema            string               `json:"schema"`
	Processor         string               `json:"processor_version"`
	ParentID          string               `json:"parent_asset_id"`
	SourceHash        string               `json:"source_sha256"`
	PartitionRevision int64                `json:"partition_revision"`
	Coordinates       string               `json:"coordinates"`
	Partition         Partition            `json:"partition"`
	SourceSurfaces    []Surface            `json:"source_surfaces"`
	GlobalChunks      []string             `json:"global_chunks"`
	Regions           []Region             `json:"regions"`
	Chunks            []Chunk              `json:"chunks"`
	Dependencies      []ResourceDependency `json:"dependencies"`
	Navigation        ExactIndex           `json:"navigation"`
	Occlusion         ExactIndex           `json:"occlusion"`
	Fallback          string               `json:"fallback"`
}

func Decode(data []byte, target any) error {
	if len(data) > 4*1024*1024 {
		return errors.New("contract exceeds 4 MiB")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if err := requiredFields(raw, reflect.TypeOf(target).Elem()); err != nil {
		return err
	}
	if err := d.Decode(target); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("expected one contract object")
	}
	return nil
}

func contractFields(t reflect.Type) map[string]reflect.StructField {
	fields := map[string]reflect.StructField{}
	for j := 0; j < t.NumField(); j++ {
		field := t.Field(j)
		if field.Anonymous {
			for name, f := range contractFields(field.Type) {
				fields[name] = f
			}
		}
	}
	for j := 0; j < t.NumField(); j++ {
		field := t.Field(j)
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if name != "" && name != "-" {
			fields[name] = field
		}
	}
	return fields
}

// Struct tags are the schema's required-field boundary; maps are descriptors keyed by ID.
func requiredFields(raw any, t reflect.Type) error {
	if raw == nil && (t.Kind() != reflect.Pointer || t.Elem().Kind() == reflect.Int) {
		return errors.New("null field is not permitted")
	}
	if t.Kind() == reflect.Pointer {
		if raw == nil {
			return nil
		}
		return requiredFields(raw, t.Elem())
	}
	switch t.Kind() {
	case reflect.Struct:
		object, ok := raw.(map[string]any)
		if !ok {
			return errors.New("expected contract object")
		}
		for _, field := range contractFields(t) {
			tag := strings.Split(field.Tag.Get("json"), ",")
			if tag[0] == "" || tag[0] == "-" {
				continue
			}
			value, present := object[tag[0]]
			optional := len(tag) > 1 && tag[1] == "omitempty"
			if !present {
				if optional {
					continue
				}
				return fmt.Errorf("missing field %s", tag[0])
			}
			if err := requiredFields(value, field.Type); err != nil {
				return fmt.Errorf("%s: %w", tag[0], err)
			}
		}
	case reflect.Slice, reflect.Array:
		values, ok := raw.([]any)
		if !ok {
			return errors.New("expected array")
		}
		if t.Kind() == reflect.Array && len(values) != t.Len() {
			return errors.New("incorrect array length")
		}
		for _, v := range values {
			if err := requiredFields(v, t.Elem()); err != nil {
				return err
			}
		}
	case reflect.Map:
		values, ok := raw.(map[string]any)
		if !ok {
			return errors.New("expected descriptor map")
		}
		for _, v := range values {
			if err := requiredFields(v, t.Elem()); err != nil {
				return err
			}
		}
	}
	return nil
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func (b Bounds) Valid() bool {
	for i := 0; i < 3; i++ {
		if !finite(b.Min[i]) || !finite(b.Max[i]) || b.Min[i] > b.Max[i] {
			return false
		}
	}
	return true
}
func (b Bounds) Contains(other Bounds) bool {
	for i := 0; i < 3; i++ {
		if other.Min[i] < b.Min[i]-1e-5 || other.Max[i] > b.Max[i]+1e-5 {
			return false
		}
	}
	return true
}
func matrixValid(m Matrix) bool {
	for _, v := range m {
		if !finite(v) {
			return false
		}
	}
	return m[3] == 0 && m[7] == 0 && m[11] == 0 && m[15] == 1
}
func (i Inventory) Validate() error {
	if i.Schema != InventorySchema || i.Coordinates != "source-space" || !digest.MatchString(i.SourceHash) || !count(i.SourceBytes, 20) || !i.Bounds.Valid() || i.ClipCount < 0 || i.ClipCount > MaxRecords || i.SkinCount < 0 || i.SkinCount > MaxRecords || len(i.Nodes) == 0 || len(i.Nodes) > MaxRecords || len(i.Dependencies) > MaxRecords || len(i.ConservativeReasons) > MaxRecords {
		return errors.New("invalid source inventory identity or bounds")
	}
	nodes := map[string]Node{}
	groups := map[string]bool{}
	for _, d := range i.Dependencies {
		if !identifier.MatchString(d.ID) || groups[d.ID] || d.Kind != "authored-hierarchy" || len(d.NodePaths) == 0 {
			return errors.New("invalid authored dependency group")
		}
		groups[d.ID] = true
	}
	for _, n := range i.Nodes {
		if !sourcePath.MatchString(n.Path) || nodes[n.Path].Path != "" || !matrixValid(n.Matrix) || n.SourceNode != nil && *n.SourceNode < 0 || n.SourcePrimitive != nil && *n.SourcePrimitive < 0 || !count(n.Triangles, 0) || !count(n.GeometryBytes, 0) || !count(n.EmbeddedImageBytes, 0) || n.Bounds != nil && !n.Bounds.Valid() || n.DependencyGroup != "" && !groups[n.DependencyGroup] {
			return errors.New("invalid inventory node")
		}
		if n.Renderable && (n.Bounds == nil || n.Triangles == 0 || !i.Bounds.Contains(*n.Bounds)) {
			return errors.New("renderable node lacks geometry")
		}
		nodes[n.Path] = n
	}
	for _, n := range i.Nodes {
		if n.Path == "0" {
			if n.Parent != "" {
				return errors.New("root cannot have a parent")
			}
		} else {
			at := strings.LastIndex(n.Path, "/")
			if n.Parent != n.Path[:at] || nodes[n.Parent].Path == "" {
				return errors.New("invalid source hierarchy")
			}
		}
	}
	for _, d := range i.Dependencies {
		seen := map[string]bool{}
		for _, p := range d.NodePaths {
			if !nodes[p].Renderable || nodes[p].DependencyGroup != d.ID || seen[p] {
				return errors.New("invalid dependency membership")
			}
			seen[p] = true
		}
		for _, n := range i.Nodes {
			if n.DependencyGroup == d.ID && n.Renderable && !seen[n.Path] {
				return errors.New("incomplete dependency group")
			}
		}
	}
	return nil
}
func DefaultPartition(i Inventory) Partition {
	p := Partition{Schema: PartitionSchema, SourceHash: i.SourceHash, Policy: "complete", Visibility: "conservative", Rooms: []Room{}, GlobalNodes: []string{}, Openings: []Opening{}}
	for _, n := range i.Nodes {
		if n.Renderable {
			p.GlobalNodes = append(p.GlobalNodes, n.Path)
		}
	}
	return p
}
func (p Partition) Validate(i Inventory) error {
	if err := i.Validate(); err != nil {
		return err
	}
	if p.SpatialCellSize != 0 && (math.IsNaN(p.SpatialCellSize) || math.IsInf(p.SpatialCellSize, 0) || p.SpatialCellSize < .5 || p.SpatialCellSize > 64 || p.Policy != "reviewed-rooms" || p.Visibility != "conservative") {
		return errors.New("spatial splitting requires conservative reviewed static groups and cell size 0.5–64")
	}
	if p.Schema != PartitionSchema || p.SourceHash != i.SourceHash || (p.Policy != "complete" && p.Policy != "reviewed-rooms") || (p.Visibility != "conservative" && p.Visibility != "reviewed-openings") || len(p.Rooms) > 512 || len(p.Openings) > 2048 || len(p.GlobalNodes) > MaxRecords {
		return errors.New("invalid partition identity, policy or limits")
	}
	nodes := map[string]Node{}
	for _, n := range i.Nodes {
		if n.Renderable {
			nodes[n.Path] = n
		}
	}
	owners := map[string]string{}
	rooms := map[string]Room{}
	assign := func(paths []string, owner string, b *Bounds) error {
		for _, path := range paths {
			n, ok := nodes[path]
			if !ok || owners[path] != "" {
				return fmt.Errorf("unknown or duplicate source owner: %s", path)
			}
			if owner != "global" && (n.DependencyGroup != "" || b == nil || !b.Contains(*n.Bounds)) {
				return fmt.Errorf("crossing/dependent node %s must remain global", path)
			}
			owners[path] = owner
		}
		return nil
	}
	if err := assign(p.GlobalNodes, "global", nil); err != nil {
		return err
	}
	for _, r := range p.Rooms {
		if !identifier.MatchString(r.ID) || r.ID == "global" || rooms[r.ID].ID != "" || len(strings.TrimSpace(r.Name)) == 0 || utf8.RuneCountInString(r.Name) > 120 || !r.Bounds.Valid() || len(r.NodePaths) == 0 {
			return errors.New("invalid reviewed room")
		}
		rooms[r.ID] = r
		if err := assign(r.NodePaths, r.ID, &r.Bounds); err != nil {
			return err
		}
	}
	if len(owners) != len(nodes) {
		return errors.New("every source surface requires exactly one owner")
	}
	for path, owner := range owners {
		if owner == "global" {
			continue
		}
		for _, room := range rooms {
			if room.ID != owner && contributionOverlaps(*nodes[path].Bounds, room.Bounds) {
				return fmt.Errorf("cross-room node %s must remain global", path)
			}
		}
	}
	if p.Policy == "complete" && (len(p.Rooms) > 0 || len(p.Openings) > 0 || p.Visibility != "conservative") {
		return errors.New("complete policy requires global ownership and conservative visibility")
	}
	if p.Policy == "reviewed-rooms" && (len(p.Rooms) == 0 || (len(i.ConservativeReasons) > 0 || i.ClipCount+i.SkinCount > 0 || len(i.Dependencies) > 0)) {
		return errors.New("uncertain source requires complete-scene fallback")
	}
	ids := map[string]bool{}
	for _, o := range p.Openings {
		if !identifier.MatchString(o.ID) || ids[o.ID] || !o.Reviewed || (o.Kind != "doorway" && o.Kind != "window") || rooms[o.From].ID == "" || o.To != nil && (rooms[*o.To].ID == "" || *o.To == o.From) || !openingValid(o, rooms) {
			return errors.New("invalid reviewed visibility opening")
		}
		ids[o.ID] = true
	}
	if p.Visibility == "reviewed-openings" && len(p.Openings) == 0 {
		return errors.New("reviewed visibility requires openings; otherwise use conservative visibility")
	}
	return nil
}

// Nonzero source axes need positive overlap; flat authored surfaces still
// contribute at their plane and must not vanish from a neighboring room.
func contributionOverlaps(node, room Bounds) bool {
	for axis := 0; axis < 3; axis++ {
		lo, hi := math.Max(node.Min[axis], room.Min[axis]), math.Min(node.Max[axis], room.Max[axis])
		if node.Max[axis]-node.Min[axis] <= 1e-5 {
			if hi < lo-1e-5 {
				return false
			}
		} else if hi-lo <= 1e-5 {
			return false
		}
	}
	return true
}
func openingValid(o Opening, rooms map[string]Room) bool {
	sub := func(a, b Vec3) Vec3 { return Vec3{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
	cross := func(a, b Vec3) Vec3 { return Vec3{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]} }
	dot := func(a, b Vec3) float64 { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
	b := Bounds{Min: o.Corners[0], Max: o.Corners[0]}
	for _, v := range o.Corners {
		for j := 0; j < 3; j++ {
			if !finite(v[j]) {
				return false
			}
			b.Min[j] = math.Min(b.Min[j], v[j])
			b.Max[j] = math.Max(b.Max[j], v[j])
		}
	}
	n := cross(sub(o.Corners[1], o.Corners[0]), sub(o.Corners[2], o.Corners[0]))
	length := math.Sqrt(dot(n, n))
	if length < 1e-6 || math.Abs(dot(n, sub(o.Corners[3], o.Corners[0]))) > 1e-5*length {
		return false
	}
	for j := 0; j < 4; j++ {
		a := o.Corners[j]
		next := o.Corners[(j+1)%4]
		last := o.Corners[(j+2)%4]
		if dot(n, cross(sub(next, a), sub(last, next))) <= 1e-10 {
			return false
		}
	}
	intersects := func(r Bounds) bool {
		for j := 0; j < 3; j++ {
			if b.Min[j] > r.Max[j]+1e-5 || b.Max[j] < r.Min[j]-1e-5 {
				return false
			}
		}
		return true
	}
	return intersects(rooms[o.From].Bounds) && (o.To == nil || intersects(rooms[*o.To].Bounds))
}
func validPayload(p Payload) bool {
	return p.Key != "" && !strings.Contains(p.Key, "..") && !strings.HasPrefix(p.Key, "/") && !strings.ContainsAny(p.Key, "\\?:#") && len(p.Key) <= 1024 && digest.MatchString(p.SHA256) && count(p.Bytes, 20) && count(p.TextureBytes, 0) && count(int64(p.MaxTexture), 0)
}
func validVariants(v map[string]Payload) bool {
	if len(v) != 3 {
		return false
	}
	for _, t := range []string{"low", "balanced", "hq"} {
		if !validPayload(v[t]) {
			return false
		}
	}
	return true
}
func (m Manifest) Validate() error {
	if m.Schema != ManifestSchema || m.Processor != ProcessorVersion || uuid.Validate(m.ParentID) != nil || len(m.ParentID) != 36 || !digest.MatchString(m.SourceHash) || !count(m.PartitionRevision, 1) || m.Coordinates != "source-space" || m.Partition.SourceHash != m.SourceHash || m.Fallback != "complete-original" || m.ClipCount < 0 || m.ClipCount > MaxRecords || m.SkinCount < 0 || m.SkinCount > MaxRecords || len(m.SourceNodes) == 0 || len(m.SourceNodes) > MaxRecords || len(m.Chunks) == 0 || len(m.Chunks) > MaxRecords || len(m.SourceSurfaces) == 0 || len(m.SourceSurfaces) > MaxRecords || len(m.Dependencies) > MaxRecords || len(m.Regions) > 512 {
		return errors.New("invalid streaming manifest identity, version or limits")
	}
	// Revalidate partition against declared source inventory. Output publication must
	// additionally compare this coverage against the processor's original inventory.
	inv := Inventory{Schema: InventorySchema, Coordinates: "source-space", SourceHash: m.SourceHash, SourceBytes: 20, Bounds: Bounds{}, Nodes: []Node{{Path: "0", Matrix: Matrix{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}}}}
	sourceCounts := map[string]int64{}
	sourceNodes := map[string]bool{"0": true}
	var ranges = map[string][][2]int64{}
	for _, s := range m.SourceSurfaces {
		key := fmt.Sprintf("%s:%d", s.Path, s.Primitive)
		if !sourcePath.MatchString(s.Path) || s.Primitive < 0 || !count(s.Triangles, 1) || !s.Bounds.Valid() || sourceCounts[key] > 0 {
			return errors.New("invalid source surface inventory")
		}
		sourceCounts[key] = s.Triangles
		parts := strings.Split(s.Path, "/")
		for j := 1; j <= len(parts); j++ {
			path := strings.Join(parts[:j], "/")
			if !sourceNodes[path] {
				parent := strings.Join(parts[:j-1], "/")
				inv.Nodes = append(inv.Nodes, Node{Path: path, Parent: parent, Matrix: inv.Nodes[0].Matrix})
				sourceNodes[path] = true
			}
		}
	}
	declaredNodes := map[string]bool{}
	for _, path := range m.SourceNodes {
		if !sourcePath.MatchString(path) || declaredNodes[path] {
			return errors.New("invalid source node hierarchy")
		}
		declaredNodes[path] = true
	}
	if !declaredNodes["0"] {
		return errors.New("source hierarchy lacks root")
	}
	for path := range declaredNodes {
		if path != "0" && !declaredNodes[path[:strings.LastIndex(path, "/")]] {
			return errors.New("source hierarchy lacks parent")
		}
	}
	for _, surface := range m.SourceSurfaces {
		if !declaredNodes[surface.Path] {
			return errors.New("source mapping references missing node")
		}
	}
	// Partition rooms own source surface paths, independent of local chunk paths.
	nodeIndices := map[string]int{}
	for j, n := range inv.Nodes {
		nodeIndices[n.Path] = j
	}
	for _, surface := range m.SourceSurfaces {
		j := nodeIndices[surface.Path]
		node := &inv.Nodes[j]
		node.Renderable = true
		node.Triangles += surface.Triangles
		if node.Bounds == nil {
			b := surface.Bounds
			node.Bounds = &b
		} else {
			for axis := 0; axis < 3; axis++ {
				node.Bounds.Min[axis] = math.Min(node.Bounds.Min[axis], surface.Bounds.Min[axis])
				node.Bounds.Max[axis] = math.Max(node.Bounds.Max[axis], surface.Bounds.Max[axis])
			}
		}
	}
	if len(m.SourceSurfaces) > 0 {
		inv.Bounds = m.SourceSurfaces[0].Bounds
		for _, surface := range m.SourceSurfaces[1:] {
			for axis := 0; axis < 3; axis++ {
				inv.Bounds.Min[axis] = math.Min(inv.Bounds.Min[axis], surface.Bounds.Min[axis])
				inv.Bounds.Max[axis] = math.Max(inv.Bounds.Max[axis], surface.Bounds.Max[axis])
			}
		}
	}
	if err := m.Partition.Validate(inv); err != nil {
		return err
	}
	refs := map[string][]string{}
	chunks := map[string]Chunk{}
	keys := map[string]string{}
	checkKeys := func(v map[string]Payload) bool {
		if !validVariants(v) {
			return false
		}
		for _, p := range v {
			if h := keys[p.Key]; h != "" && h != p.SHA256 {
				return false
			}
			keys[p.Key] = p.SHA256
		}
		return true
	}
	for _, d := range m.Dependencies {
		if !identifier.MatchString(d.ID) || d.ID == "navigation" || d.ID == "occlusion" || refs[d.ID] != nil || !checkKeys(d.Variants) || (d.Kind != "texture" && d.Kind != "animation" && d.Kind != "shared-contributor") {
			return errors.New("invalid resource dependency")
		}
		refs[d.ID] = append([]string{}, d.Requires...)
	}
	animationGroups := 0
	for _, d := range m.Dependencies {
		if d.Kind != "animation" {
			if len(d.SourceNodes)+len(d.SourceClips)+len(d.SourceSkins) > 0 {
				return errors.New("non-animation dependency has animation identities")
			}
			continue
		}
		animationGroups++
		members := map[string]bool{}
		for _, path := range d.SourceNodes {
			if !declaredNodes[path] || members[path] {
				return errors.New("invalid animation source membership")
			}
			members[path] = true
		}
		if len(members) != len(declaredNodes) || len(d.SourceClips) != m.ClipCount || len(d.SourceSkins) != m.SkinCount {
			return errors.New("animation group must retain the complete authored hierarchy")
		}
		for _, values := range [][]int{d.SourceClips, d.SourceSkins} {
			seen := map[int]bool{}
			for _, v := range values {
				if v < 0 || v >= len(values) || seen[v] {
					return errors.New("invalid animation/skin source identity")
				}
				seen[v] = true
			}
		}
	}
	if m.ClipCount+m.SkinCount > 0 {
		if animationGroups != 1 || m.Partition.Policy != "complete" {
			return errors.New("animated source requires one complete global dependency group")
		}
	} else if animationGroups != 0 {
		return errors.New("animation dependency has no source clips/skins")
	}
	for _, c := range m.Chunks {
		if !identifier.MatchString(c.ID) || c.ID == "navigation" || c.ID == "occlusion" || refs[c.ID] != nil || !c.Bounds.Valid() || !matrixValid(c.LocalToSource) || c.PrimitiveCount < 1 || !count(c.TriangleCount, 1) || len(c.Surfaces) == 0 || len(c.Surfaces) > MaxRecords || !checkKeys(c.Variants) {
			return errors.New("invalid chunk inventory")
		}
		refs[c.ID] = append([]string{}, c.Dependencies...)
		chunks[c.ID] = c
		count := int64(0)
		locals := map[string][][2]int64{}
		for _, s := range c.Surfaces {
			key := fmt.Sprintf("%s:%d", s.SourcePath, s.SourcePrimitive)
			if sourceCounts[key] == 0 || s.SourceStart < 0 || s.Count < 1 || s.Count > sourceCounts[key]-s.SourceStart || !sourcePath.MatchString(s.ChunkPath) || s.ChunkPrimitive < 0 || s.ChunkStart < 0 || s.ChunkStart > c.TriangleCount-s.Count {
				return errors.New("invalid source triangle mapping")
			}
			ranges[key] = append(ranges[key], [2]int64{s.SourceStart, s.SourceStart + s.Count})
			local := fmt.Sprintf("%s:%d", s.ChunkPath, s.ChunkPrimitive)
			locals[local] = append(locals[local], [2]int64{s.ChunkStart, s.ChunkStart + s.Count})
			count += s.Count
		}
		if count != c.TriangleCount || len(locals) != c.PrimitiveCount {
			return errors.New("chunk primitive/triangle inventory does not match mappings")
		}
		for _, v := range locals {
			if !coverage(v, -1) {
				return errors.New("overlapping or gapped chunk-local triangles")
			}
		}
	}
	for key, count := range sourceCounts {
		if !coverage(ranges[key], count) {
			return errors.New("lost or duplicated source triangles")
		}
	}
	visiting, visited := map[string]bool{}, map[string]bool{}
	var visit func(string) bool
	visit = func(id string) bool {
		edges, ok := refs[id]
		if !ok || visiting[id] {
			return false
		}
		if visited[id] {
			return true
		}
		visiting[id] = true
		seen := map[string]bool{}
		for _, r := range edges {
			if seen[r] || !visit(r) {
				return false
			}
			seen[r] = true
		}
		visiting[id] = false
		visited[id] = true
		return true
	}
	for id := range refs {
		if !visit(id) {
			return errors.New("unknown, duplicate or cyclic resource dependencies")
		}
	}
	global := map[string]bool{}
	if animationGroups == 1 {
		for _, c := range m.Chunks {
			required := false
			for _, id := range c.Dependencies {
				for _, d := range m.Dependencies {
					if d.ID == id && d.Kind == "animation" {
						required = true
					}
				}
			}
			if !required {
				return errors.New("global chunk omits authored animation dependency")
			}
		}
	}
	for _, id := range m.GlobalChunks {
		if chunks[id].ID == "" || global[id] {
			return errors.New("invalid global chunk ownership")
		}
		global[id] = true
	}
	regions := map[string]bool{}
	owned := map[string]bool{}
	rooms := map[string]bool{}
	ownerByPath := map[string]string{}
	for _, r := range m.Partition.Rooms {
		rooms[r.ID] = true
		for _, p := range r.NodePaths {
			ownerByPath[p] = r.ID
		}
	}
	for _, p := range m.Partition.GlobalNodes {
		ownerByPath[p] = "global"
	}
	for _, id := range m.GlobalChunks {
		owned[id] = true
		for _, s := range chunks[id].Surfaces {
			if ownerByPath[s.SourcePath] != "global" {
				return errors.New("global chunk contains room-owned source")
			}
		}
	}
	for _, r := range m.Regions {
		if !rooms[r.ID] || regions[r.ID] || len(r.Chunks) == 0 {
			return errors.New("invalid region ownership")
		}
		regions[r.ID] = true
		for _, id := range r.Chunks {
			if chunks[id].ID == "" || owned[id] {
				return errors.New("unknown or multiply owned chunk")
			}
			owned[id] = true
			for _, s := range chunks[id].Surfaces {
				if ownerByPath[s.SourcePath] != r.ID {
					return errors.New("chunk violates reviewed source ownership")
				}
			}
		}
		display := map[string]bool{}
		for _, id := range r.Display {
			if _, ok := refs[id]; !ok || display[id] {
				return errors.New("invalid display readiness")
			}
			display[id] = true
		}
		movement := map[string]bool{}
		for _, id := range r.Movement {
			if _, ok := refs[id]; !ok && id != "navigation" && id != "occlusion" || movement[id] {
				return errors.New("invalid movement readiness")
			}
			movement[id] = true
		}
		for _, id := range append(append([]string{}, r.Chunks...), m.GlobalChunks...) {
			if !display[id] || !movement[id] {
				return errors.New("region omits required visual contributors")
			}
		}
		for id := range display {
			if !movement[id] {
				return errors.New("movement omits a display prerequisite")
			}
		}
		if !movement["navigation"] || !movement["occlusion"] {
			return errors.New("movement requires exact navigation and occlusion")
		}
	}
	if len(owned) != len(chunks) || len(regions) != len(rooms) {
		return errors.New("unowned chunks or missing regions")
	}
	paths := map[string]bool{}
	for _, s := range m.SourceSurfaces {
		paths[s.Path] = true
	}
	if !validPayload(m.Navigation.Payload) || !validPayload(m.Occlusion.Payload) || m.Navigation.Strategy != "verified-exact-geometry" || m.Navigation.AuthoredSemantics != "authored-only-floors" || m.Occlusion.Strategy != "verified-authored-occluders" || m.Occlusion.AuthoredSemantics != "authored-material-visibility-sidedness" || len(m.Occlusion.FloorPaths) != 0 {
		return errors.New("invalid exact index semantics")
	}
	floors := map[string]bool{}
	for _, p := range m.Navigation.FloorPaths {
		if !paths[p] || floors[p] {
			return errors.New("invalid retained floor identity")
		}
		floors[p] = true
	}
	return nil
}
func coverage(ranges [][2]int64, count int64) bool {
	sort.Slice(ranges, func(a, b int) bool { return ranges[a][0] < ranges[b][0] })
	end := int64(0)
	for _, r := range ranges {
		if r[0] != end || r[1] <= r[0] {
			return false
		}
		end = r[1]
	}
	return len(ranges) > 0 && (count < 0 || end == count)
}

// SourceIdentity resolves a chunk-local triangle without changing author references.
func (m Manifest) SourceIdentity(chunkID, path string, primitive int, triangle int64) (string, int, int64, bool) {
	for _, c := range m.Chunks {
		if c.ID == chunkID {
			for _, s := range c.Surfaces {
				if s.ChunkPath == path && s.ChunkPrimitive == primitive && triangle >= s.ChunkStart && triangle < s.ChunkStart+s.Count {
					return s.SourcePath, s.SourcePrimitive, s.SourceStart + triangle - s.ChunkStart, true
				}
			}
		}
	}
	return "", 0, 0, false
}

// ValidateAgainst prevents self-consistent worker output from inventing source
// coverage, ownership, or a newer author revision. Invoke before publication.
func (m Manifest) ValidateAgainst(i Inventory, p Partition, parent string, revision int64) error {
	if err := m.Validate(); err != nil {
		return err
	}
	if err := p.Validate(i); err != nil {
		return err
	}
	if m.ParentID != parent || m.SourceHash != i.SourceHash || m.PartitionRevision != revision || m.ClipCount != i.ClipCount || m.SkinCount != i.SkinCount {
		return errors.New("manifest does not match parent/source/partition revision")
	}
	expected, _ := json.Marshal(p)
	actual, _ := json.Marshal(m.Partition)
	if !bytes.Equal(expected, actual) {
		return errors.New("manifest changed reviewed ownership")
	}
	nodes := map[string]bool{}
	surfaces := map[string]Node{}
	for _, n := range i.Nodes {
		nodes[n.Path] = true
		if n.Renderable {
			primitive := 0
			if n.SourcePrimitive != nil {
				primitive = *n.SourcePrimitive
			}
			surfaces[fmt.Sprintf("%s:%d", n.Path, primitive)] = n
		}
	}
	if len(m.SourceNodes) != len(nodes) || len(m.SourceSurfaces) != len(surfaces) {
		return errors.New("source inventory coverage mismatch")
	}
	for _, path := range m.SourceNodes {
		if !nodes[path] {
			return errors.New("source node identity mismatch")
		}
	}
	for _, surface := range m.SourceSurfaces {
		node, ok := surfaces[fmt.Sprintf("%s:%d", surface.Path, surface.Primitive)]
		if !ok || surface.Triangles != node.Triangles || node.Bounds == nil || !node.Bounds.Contains(surface.Bounds) || !surface.Bounds.Contains(*node.Bounds) {
			return errors.New("source surface inventory mismatch")
		}
	}
	return nil
}
