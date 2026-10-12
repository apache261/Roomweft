package sceneconfig

import (
	"encoding/json"
	"math"
	"testing"
)

func TestSplatSettings(t *testing.T) {
	s := DefaultSplat()
	if err := s.ValidateForScene("SPLAT"); err != nil {
		t.Fatal(err)
	}
	if s.ValidateForScene("3D") == nil {
		t.Fatal("mesh accepted splat settings")
	}
	for _, change := range []func(*Settings){func(s *Settings) { s.Splat = nil }, func(s *Settings) { s.Splat.Version = 2 }, func(s *Settings) { s.Splat.Position[0] = math.Inf(1) }, func(s *Settings) { s.Splat.Controls = "walk" }, func(s *Settings) { s.Splat.MaxDistance = 0 }, func(s *Settings) { s.Appearance.LightIntensity = 1 }, func(s *Settings) { s.Appearance.Tint = "#ffffff" }} {
		s := DefaultSplat()
		change(&s)
		if s.ValidateForScene("SPLAT") == nil {
			t.Fatal("accepted invalid settings")
		}
	}
	for _, raw := range []string{`{"version":1,"position":[null,2,3]}`, `{"version":1,"position":[1,2]}`, `{"version":1,"position":[1,2,3,4]}`, `{"version":1,"position":[1,2,3],"unknown":true}`} {
		var v Splat
		if json.Unmarshal([]byte(raw), &v) == nil {
			t.Fatal("accepted invalid position/schema")
		}
	}
	old, next := DefaultSplat(), DefaultSplat()
	old.Splat.Position = [3]float64{10, 0, 0}
	next.Splat.Position = [3]float64{20, 0, 0}
	next.Model.Scale = 2
	p := RepositionForSettings([3]float64{11, 2, 3}, old, next)
	if p != [3]float64{22, 4, 6} {
		t.Fatal(p)
	}
	if got := RepositionForSettings(p, next, old); got != [3]float64{11, 2, 3} {
		t.Fatal(got)
	}
}
