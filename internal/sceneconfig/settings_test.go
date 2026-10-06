package sceneconfig

import (
	"math"
	"testing"
)

func TestModelTransformRoundTrip(t *testing.T) {
	old := Model{Scale: 100, UpAxis: "Z", Rotation: 90}
	identity := Default().Model
	point := [3]float64{1, 2, 3}
	transformed := Reposition(point, identity, old)
	result := Reposition(transformed, old, identity)
	for i := range point {
		if math.Abs(result[i]-point[i]) > 1e-9 {
			t.Fatalf("transform drift: %v", result)
		}
	}
	expected := Reposition([3]float64{100, 200, 300}, Model{Scale: 1, UpAxis: "Y"}, Model{Scale: .01, UpAxis: "Z"})
	if expected != [3]float64{1, 3, -2} {
		t.Fatalf("axis/scale mismatch: %v", expected)
	}
}
func TestSettingsValidation(t *testing.T) {
	if err := Default().Validate(); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*Settings){
		func(s *Settings) { s.Model.Scale = 0 }, func(s *Settings) { s.Model.UpAxis = "X" }, func(s *Settings) { s.Model.Rotation = 181 },
		func(s *Settings) { s.Appearance.Exposure = math.Inf(1) }, func(s *Settings) { s.Appearance.Background = "red" },
		func(s *Settings) { v := 2.0; s.Appearance.Roughness = &v }, func(s *Settings) { s.Appearance.EnvironmentIntensity = -1 },
	} {
		s := Default()
		mutate(&s)
		if s.Validate() == nil {
			t.Fatal("accepted invalid settings")
		}
	}
}
