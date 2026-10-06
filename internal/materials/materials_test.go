package materials

import (
	"encoding/json"
	"github.com/google/uuid"
	"math"
	"testing"
)

func TestMaterialValidation(t *testing.T) {
	p := Preset{ID: uuid.NewString(), Name: "Stone", TileSize: 0.5, Repeat: [2]float64{1, 1}, Tint: "#ffffff", Roughness: 0.8}
	if err := Validate([]Preset{p}, map[string]string{"0/1": p.ID}); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []Preset{func() Preset { v := p; v.TileSize = math.NaN(); return v }(), func() Preset { v := p; v.Normal = "foreign"; return v }(), func() Preset { v := p; v.Repeat[0] = 0; return v }()} {
		if Validate([]Preset{bad}) == nil {
			t.Fatal("invalid material accepted")
		}
	}
	if Validate([]Preset{p}, map[string]string{"mesh-name": p.ID}) == nil {
		t.Fatal("unstable mesh path accepted")
	}
	raw, _ := json.Marshal(p)
	var fields map[string]any
	json.Unmarshal(raw, &fields)
	for _, invalid := range []any{nil, []any{0}, []any{0, nil}, []any{0, 0, 0}} {
		fields["offset"] = invalid
		raw, _ = json.Marshal(fields)
		if json.Unmarshal(raw, &Preset{}) == nil {
			t.Fatal("invalid numeric input accepted", invalid)
		}
	}
}

func TestBakedLightingRolesAndRevision(t *testing.T) {
	p := Preset{ID: uuid.NewString(), Name: "Baked", TileSize: 1, Repeat: [2]float64{1, 1}, Tint: "#ffffff", Roughness: 0.8, AOMap: uuid.NewString(), LightMap: uuid.NewString(), BakeRevision: "bake-v1:0123456789abcdef0123456789abcdef"}
	if err := Validate([]Preset{p}); err != nil {
		t.Fatal(err)
	}
	refs := References([]Preset{p})
	if len(refs) != 2 || refs[0].Kind != "TEXTURE_AO" || refs[1].Kind != "TEXTURE_LIGHTMAP" {
		t.Fatal(refs)
	}
	p.BakeRevision = "stale invalid data"
	if Validate([]Preset{p}) == nil {
		t.Fatal("invalid baked revision accepted")
	}
}
