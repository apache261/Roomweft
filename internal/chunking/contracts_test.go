package chunking

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func fixture(t *testing.T, name string, target any) {
	t.Helper()
	data, err := os.ReadFile("../../tests/testdata/chunking/contracts/" + name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	if err = Decode(data, target); err != nil {
		t.Fatal(err)
	}
}
func TestReviewedOwnershipAndOpenings(t *testing.T) {
	var i Inventory
	var p Partition
	fixture(t, "inventory", &i)
	fixture(t, "partition", &p)
	if err := p.Validate(i); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*Partition){
		"stale source":        func(p *Partition) { p.SourceHash = "wrong" },
		"lost surface":        func(p *Partition) { p.GlobalNodes = nil },
		"duplicate ownership": func(p *Partition) { p.GlobalNodes = append(p.GlobalNodes, "0/0") },
		"crossing owner":      func(p *Partition) { p.GlobalNodes = nil; p.Rooms[0].NodePaths = append(p.Rooms[0].NodePaths, "0/2") },
		"inflated crossing owner": func(p *Partition) {
			p.GlobalNodes = nil
			p.Rooms[0].NodePaths = append(p.Rooms[0].NodePaths, "0/2")
			p.Rooms[0].Bounds.Min[2] = -9
		},
		"unknown room":       func(p *Partition) { v := "missing"; p.Openings[0].To = &v },
		"unreviewed opening": func(p *Partition) { p.Openings[0].Reviewed = false },
		"nonplanar opening":  func(p *Partition) { p.Openings[0].Corners[3][2] += 1 },
		"concave opening":    func(p *Partition) { p.Openings[0].Corners[2] = Vec3{0, .1, -3} },
		"self portal":        func(p *Partition) { v := p.Openings[0].From; p.Openings[0].To = &v },
		"missing region adjacency": func(p *Partition) {
			for j := range p.Openings[0].Corners {
				p.Openings[0].Corners[j][2] = 99
			}
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			var p Partition
			fixture(t, "partition", &p)
			change(&p)
			if p.Validate(i) == nil {
				t.Fatal("invalid author metadata accepted")
			}
		})
	}
	i.ConservativeReasons = []string{"skin joints require the complete hierarchy"}
	if p.Validate(i) == nil {
		t.Fatal("uncertain source partitioned")
	}
	if err := DefaultPartition(i).Validate(i); err != nil {
		t.Fatal(err)
	}
}
func TestManifestCoverageReadinessAndIdentity(t *testing.T) {
	var m Manifest
	fixture(t, "manifest", &m)
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	path, primitive, triangle, ok := m.SourceIdentity("room-b-geometry", "0/0", 0, 11)
	if !ok || path != "0/1" || primitive != 0 || triangle != 11 {
		t.Fatal("source mapping changed author identity")
	}
	if _, _, _, ok = m.SourceIdentity("room-b-geometry", "0/0", 0, 12); ok {
		t.Fatal("out-of-range triangle resolved")
	}
	changes := map[string]func(*Manifest){
		"runtime schema": func(m *Manifest) { m.Schema = "runtime-v1" }, "future schema": func(m *Manifest) { m.Schema = "streaming-v2" },
		"double wrapper":               func(m *Manifest) { m.Coordinates = "prepared-world" },
		"lost triangles":               func(m *Manifest) { m.Chunks[0].Surfaces[0].Count-- },
		"overlap triangles":            func(m *Manifest) { m.Chunks[1].Surfaces[0].SourcePath = "0/0" },
		"out of range":                 func(m *Manifest) { m.Chunks[0].Surfaces[0].SourceStart = 1 },
		"dependency cycle":             func(m *Manifest) { m.Dependencies[0].Requires = []string{"room-a-geometry"} },
		"unknown dependency":           func(m *Manifest) { m.Chunks[0].Dependencies = []string{"missing"} },
		"missing navigation readiness": func(m *Manifest) { m.Regions[0].Movement = m.Regions[0].Display },
		"missing visual readiness":     func(m *Manifest) { m.Regions[0].Display = []string{"global-beam"} },
		"wrong source owner":           func(m *Manifest) { m.Regions[0].Chunks = []string{"room-b-geometry"} },
		"invented floor":               func(m *Manifest) { m.Navigation.FloorPaths = []string{"0/99"} },
		"collision is not occlusion":   func(m *Manifest) { m.Occlusion.Strategy = "verified-exact-geometry" },
		"URL instead of storage key": func(m *Manifest) {
			v := m.Chunks[0].Variants["low"]
			v.Key = "https://example.invalid/source"
			m.Chunks[0].Variants["low"] = v
		},
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			var m Manifest
			fixture(t, "manifest", &m)
			change(&m)
			if m.Validate() == nil {
				t.Fatal("invalid manifest accepted")
			}
		})
	}
	// A retained surface can split into ranges without changing author paths.
	m.Chunks[0].Surfaces = []SurfaceMap{m.Chunks[0].Surfaces[0], m.Chunks[0].Surfaces[0]}
	m.Chunks[0].Surfaces[0].Count = 5
	m.Chunks[0].Surfaces[1].Count = 7
	m.Chunks[0].Surfaces[1].SourceStart = 5
	m.Chunks[0].Surfaces[1].ChunkStart = 5
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	_, _, triangle, ok = m.SourceIdentity("room-a-geometry", "0/0", 0, 6)
	if !ok || triangle != 6 {
		t.Fatal("range identity mapping failed")
	}
}
func TestStrictContractShapes(t *testing.T) {
	data, _ := os.ReadFile("../../tests/testdata/chunking/contracts/manifest.json")
	var raw map[string]any
	_ = json.Unmarshal(data, &raw)
	delete(raw, "coordinates")
	bytes, _ := json.Marshal(raw)
	var m Manifest
	if Decode(bytes, &m) == nil {
		t.Fatal("required coordinate convention omitted")
	}
	data, _ = os.ReadFile("../../tests/testdata/chunking/contracts/partition.json")
	_ = json.Unmarshal(data, &raw)
	raw["extra"] = true
	bytes, _ = json.Marshal(raw)
	var p Partition
	if Decode(bytes, &p) == nil {
		t.Fatal("unknown fields accepted")
	}
	var b Bounds
	if Decode([]byte(`{"min":[0,0],"max":[1,1,1]}`), &b) == nil {
		t.Fatal("truncated bounds accepted")
	}
}

func TestManifestBoundToAuthoritativeSourceAndReview(t *testing.T) {
	var i Inventory
	var p Partition
	var m Manifest
	fixture(t, "inventory", &i)
	fixture(t, "partition", &p)
	fixture(t, "manifest", &m)
	if err := m.ValidateAgainst(i, p, m.ParentID, 1); err != nil {
		t.Fatal(err)
	}
	if m.ValidateAgainst(i, p, m.ParentID, 2) == nil {
		t.Fatal("stale partition revision accepted")
	}
	// Internal coverage alone cannot prove that a worker used the original source.
	m.SourceSurfaces[0].Triangles++
	m.Chunks[0].TriangleCount++
	m.Chunks[0].Surfaces[0].Count++
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
	if m.ValidateAgainst(i, p, m.ParentID, 1) == nil {
		t.Fatal("invented source contribution accepted")
	}
}
func TestDeliveryTypesDoNotSerializePrivateDescriptors(t *testing.T) {
	var m Manifest
	fixture(t, "manifest", &m)
	convert := func(p Payload) DeliveredPayload {
		return DeliveredPayload{URL: "https://assets.example/" + p.Key + "?expires=1", SHA256: p.SHA256, Bytes: p.Bytes, TextureBytes: p.TextureBytes, MaxTexture: p.MaxTexture}
	}
	variants := func(v map[string]Payload) map[string]DeliveredPayload {
		result := map[string]DeliveredPayload{}
		for t, p := range v {
			result[t] = convert(p)
		}
		return result
	}
	d := DeliveredManifest{Manifest: m, Chunks: []DeliveredChunk{}, Dependencies: []DeliveredDependency{}, Navigation: DeliveredIndex{ExactIndex: m.Navigation, Payload: convert(m.Navigation.Payload)}, Occlusion: DeliveredIndex{ExactIndex: m.Occlusion, Payload: convert(m.Occlusion.Payload)}}
	for _, c := range m.Chunks {
		d.Chunks = append(d.Chunks, DeliveredChunk{Chunk: c, Variants: variants(c.Variants)})
	}
	for _, dependency := range m.Dependencies {
		d.Dependencies = append(d.Dependencies, DeliveredDependency{ResourceDependency: dependency, Variants: variants(dependency.Variants)})
	}
	if err := d.Validate(); err != nil {
		t.Fatal(err)
	}
	bytes, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	_ = json.Unmarshal(bytes, &raw)
	if strings.Contains(string(bytes), `"key":`) || len(raw["chunks"].([]any)) != len(m.Chunks) {
		t.Fatal("delivery lost fields or exposed durable keys")
	}
	payload := d.Chunks[0].Variants["low"]
	payload.URL = "javascript:invalid"
	d.Chunks[0].Variants["low"] = payload
	if d.Validate() == nil {
		t.Fatal("invalid signed URL accepted")
	}
}
