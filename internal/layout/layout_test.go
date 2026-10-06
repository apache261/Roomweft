package layout

import (
	"encoding/json"
	"github.com/google/uuid"
	"math"
	"testing"
)

func TestImportedRoomFloorReview(t *testing.T) {
	e := Element{ID: uuid.NewString(), Kind: "INSTANCE", Name: "Lobby prefab", AssetID: uuid.NewString(), Width: 4, Depth: 6, Height: 3, Scale: 1, Collidable: true, FloorMeshes: []string{"0/0/0"}}
	d := Document{Version: 1, Elements: []Element{e}, Doors: []Door{}}
	raw, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	var restored Document
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if err = restored.Validate(); err != nil {
		t.Fatal(err)
	}
	if len(restored.Elements[0].FloorMeshes) != 1 || restored.Elements[0].FloorMeshes[0] != "0/0/0" {
		t.Fatal("floor review lost on round trip")
	}
	for _, change := range []func(*Element){func(e *Element) { e.Collidable = false }, func(e *Element) { e.FloorMeshes = []string{"Floor"} }, func(e *Element) { e.FloorMeshes = []string{"0/0", "0/0"} }, func(e *Element) { e.Kind = "ROOM" }} {
		invalid := e
		change(&invalid)
		if err = (Document{Version: 1, Elements: []Element{invalid}, Doors: []Door{}}).Validate(); err == nil {
			t.Fatal("invalid floor review accepted", invalid)
		}
	}
}

func TestValidationAndAttachmentTransforms(t *testing.T) {
	a := Element{ID: uuid.NewString(), Name: "Lobby", Kind: "LOBBY", Width: 6, Depth: 6, Height: 3, Scale: 1, Collidable: true}
	b := Element{ID: uuid.NewString(), Name: "Corridor", Kind: "CORRIDOR", Z: -5, Width: 2, Depth: 4, Height: 3, Scale: 1, Collidable: true}
	door := Door{ID: uuid.NewString(), A: a.ID, B: b.ID, Width: 0.8, Height: 2.2}
	d := Document{Version: 1, Elements: []Element{a, b}, Doors: []Door{door}}
	if err := d.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Document){func(d *Document) { d.Elements[1].Z = 0 }, func(d *Document) { d.Elements[1].Rotation = 45 }, func(d *Document) { d.Elements[0].Collidable = false }, func(d *Document) { d.Doors[0].Width = 0.5 }, func(d *Document) { d.Doors[0].At = 2 }, func(d *Document) { d.Elements[0].X = math.NaN() }, func(d *Document) { d.Doors[0].B = uuid.NewString() }, func(d *Document) { d.Elements[0].Tint = "#00z000" }} {
		next := Document{Version: 1, Elements: append([]Element{}, d.Elements...), Doors: append([]Door{}, d.Doors...)}
		change(&next)
		if err := next.Validate(); err == nil {
			t.Fatal("invalid document accepted", next)
		}
	}
	a.Kind = "INSTANCE"
	a.Scale = 2
	a.Rotation = 90
	a.X = 3
	a.Z = 4
	d.Elements = []Element{a}
	p, err := d.Position(Attachment{ElementID: a.ID, Local: [3]float64{1, 2, 3}})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(p.X-9) > 1e-8 || p.Y != 4 || math.Abs(p.Z-2) > 1e-8 {
		t.Fatal(p)
	}
	if _, err = d.Position(Attachment{ElementID: uuid.NewString()}); err == nil {
		t.Fatal("missing attachment allowed")
	}
}

func TestStrictLayoutJSON(t *testing.T) {
	for _, raw := range []string{`{"element_id":"id","local":[1]}`, `{"element_id":"id","local":[1,null,3]}`, `{"element_id":"id","local":[1,2,3,4]}`, `{"element_id":"id","local":[1,2,3],"unknown":1}`} {
		var a Attachment
		if err := json.Unmarshal([]byte(raw), &a); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	e := Element{ID: uuid.NewString(), Name: "Floor", Kind: "FLOOR", Width: 4, Depth: 4, Height: 0.2, Scale: 1, Collidable: true}
	raw, _ := json.Marshal(e)
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	fields["x"] = json.RawMessage(`null`)
	raw, _ = json.Marshal(fields)
	if err := json.Unmarshal(raw, &e); err == nil {
		t.Fatal("null coordinate accepted")
	}
	fields["x"] = json.RawMessage(`0`)
	fields["extra"] = json.RawMessage(`true`)
	raw, _ = json.Marshal(fields)
	if err := json.Unmarshal(raw, &e); err == nil {
		t.Fatal("unknown element field accepted")
	}
}

func TestStreamingRoomAssignment(t *testing.T) {
	room := Element{ID: uuid.NewString(), Kind: "ROOM", Name: "Room", Width: 4, Depth: 4, Height: 3, Scale: 1, Collidable: true}
	item := Element{ID: uuid.NewString(), Kind: "INSTANCE", Name: "Furniture", AssetID: uuid.NewString(), RoomID: room.ID, Width: 1, Depth: 1, Height: 1, Scale: 1, Collidable: true}
	doc := Document{Version: 1, Elements: []Element{room, item}, Doors: []Door{}}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	var restored Document
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if err = restored.Validate(); err != nil {
		t.Fatal(err)
	}
	if restored.Elements[1].RoomID != room.ID {
		t.Fatal("room assignment lost")
	}
	restored.Elements[1].RoomID = uuid.NewString()
	if restored.Validate() == nil {
		t.Fatal("unknown streaming room accepted")
	}
	restored.Elements[1].RoomID = item.ID
	if restored.Validate() == nil {
		t.Fatal("instance used as streaming room")
	}
}
