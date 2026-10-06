package walkconfig

import (
	"encoding/json"
	"github.com/google/uuid"
	"math"
	"testing"
)

func TestWalkingConfigValidation(t *testing.T) {
	c := Default()
	r := Region{ID: uuid.NewString(), Name: "Lobby", Left: -2, Right: 2, Top: -2, Bottom: 2, MinY: 0, MaxY: 0.2, FloorMeshes: []string{"0/0"}}
	c.Regions = []Region{r}
	if err := c.Validate(true); err != nil {
		t.Fatal(err)
	}
	if c.Validate(false) == nil {
		t.Fatal("layout supplied imported regions")
	}
	for _, speed := range []float64{0, 7, math.NaN()} {
		bad := c
		bad.Speed = speed
		if bad.Validate(true) == nil {
			t.Fatal("invalid speed accepted")
		}
	}
	c.Portals = []Portal{{ID: uuid.NewString(), Label: "Exit", Position: [3]float64{0, 1.65, 1}, Axis: "z", Width: 1.2, DestinationRegionID: r.ID, Arrival: Pose{Position: [3]float64{0, 1.65, 0}}}}
	if err := c.Validate(true); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(c)
	var fields map[string]any
	json.Unmarshal(raw, &fields)
	fields["eye_height"] = nil
	raw, _ = json.Marshal(fields)
	if json.Unmarshal(raw, &Config{}) == nil {
		t.Fatal("null eye height accepted")
	}
	if json.Unmarshal([]byte(`{"position":[0,null,0],"yaw":0,"pitch":0}`), &Pose{}) == nil {
		t.Fatal("null arrival coordinate accepted")
	}
	if json.Unmarshal([]byte(`{"position":[0,0],"yaw":0,"pitch":0}`), &Pose{}) == nil {
		t.Fatal("short arrival accepted")
	}
}
