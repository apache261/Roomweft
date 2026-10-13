package database

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"virtual-tour/internal/layout"
	"virtual-tour/internal/sceneconfig"
	"virtual-tour/internal/walkconfig"
)

var ErrPortalReference = errors.New("exit requires a same-project 3D destination, an approved region and an arrival inside that region; edit invalid exits before publishing")

func sceneWalking(scene Scene) (walkconfig.Config, []walkconfig.Region) {
	c := walkconfig.Default()
	if scene.Type == "LAYOUT" {
		doc := layout.Decode(scene.Layout)
		if doc.Navigation != nil {
			c = *doc.Navigation
		}
		regions := []walkconfig.Region{}
		for _, e := range doc.Elements {
			if e.Kind == "LOBBY" || e.Kind == "ROOM" || e.Kind == "CORRIDOR" || e.Kind == "FLOOR" {
				left, right, top, bottom := e.Bounds()
				regions = append(regions, walkconfig.Region{ID: e.ID, Name: e.Name, Left: left, Right: right, Top: top, Bottom: bottom, MinY: -0.01, MaxY: 0.01, Exterior: e.Exterior})
			}
		}
		return c, regions
	}
	settings := sceneconfig.Decode(scene.Settings)
	if scene.Type == "SPLAT" && !sceneconfig.WalkingProxy(settings) {
		return c, nil
	}
	if settings.Navigation != nil {
		c = *settings.Navigation
	}
	return c, c.Regions
}
func validRegion(regions []walkconfig.Region, id string, p walkconfig.Pose, eye float64) bool {
	for _, r := range regions {
		if r.ID == id && r.Contains(p, eye) {
			return true
		}
	}
	return false
}
func (q *Queries) checkPortals(ctx context.Context, scene Scene) error {
	config, regions := sceneWalking(scene)
	for _, p := range config.Portals {
		source := walkconfig.Pose{Position: p.Position}
		sourceOK := false
		for _, r := range regions {
			if r.Contains(source, config.EyeHeight) {
				sourceOK = true
			}
		}
		if !sourceOK {
			return ErrPortalReference
		}
		destination := scene
		if p.DestinationSceneID != "" && p.DestinationSceneID != scene.ID.String() {
			var id pgtype.UUID
			_ = id.Scan(p.DestinationSceneID)
			var err error
			destination, err = q.GetScene(ctx, id)
			if err != nil || destination.ProjectID != scene.ProjectID || (destination.Type != "3D" && destination.Type != "LAYOUT" && destination.Type != "SPLAT") {
				return ErrPortalReference
			}
		}
		dc, dr := sceneWalking(destination)
		if !validRegion(dr, p.DestinationRegionID, p.Arrival, dc.EyeHeight) {
			return ErrPortalReference
		}
	}
	return nil
}
func (q *Queries) portalRefs(ctx context.Context, scene Scene) error {
	if err := q.checkPortals(ctx, scene); err != nil {
		return err
	}
	if err := q.ClearPortalRefs(ctx, scene.ID); err != nil {
		return err
	}
	config, _ := sceneWalking(scene)
	for _, p := range config.Portals {
		var dest, portal pgtype.UUID
		dest = scene.ID
		if p.DestinationSceneID != "" {
			_ = dest.Scan(p.DestinationSceneID)
		}
		_ = portal.Scan(p.ID)
		count, err := q.AddPortalRef(ctx, AddPortalRefParams{ID: scene.ID, ID_2: dest, PortalID: portal})
		if err != nil {
			return err
		}
		if count != 1 {
			return ErrPortalReference
		}
	}
	return nil
}
func (q *Queries) ValidateWalkingProject(ctx context.Context, id pgtype.UUID) error {
	scenes, err := q.ListScenes(ctx, id)
	if err != nil {
		return err
	}
	for _, s := range scenes {
		if err := q.checkPortals(ctx, s); err != nil {
			return err
		}
	}
	return nil
}

// Publication rechecks regions as well as durable scene references. Collision
// and standing clearance are checked from the exact meshes before activation.
func (q *Queries) PublishProject(ctx context.Context, id pgtype.UUID) (Project, error) {
	source, ok := q.db.(interface {
		Begin(context.Context) (pgx.Tx, error)
	})
	if !ok {
		return Project{}, errors.New("database does not support transactions")
	}
	tx, err := source.Begin(ctx)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback(ctx)
	queries := q.WithTx(tx)
	if _, err = queries.LockProject(ctx, id); err != nil {
		return Project{}, err
	}
	if err = queries.ValidateWalkingProject(ctx, id); err != nil {
		return Project{}, err
	}
	result, err := queries.PublishProjectUnchecked(ctx, id)
	if err != nil {
		return Project{}, err
	}
	return result, tx.Commit(ctx)
}

func navigationChanged(old, next json.RawMessage) bool {
	a, b := sceneconfig.Decode(old), sceneconfig.Decode(next)
	ar, _ := json.Marshal(a.Navigation)
	br, _ := json.Marshal(b.Navigation)
	return string(ar) != string(br)
}

var ErrWalkingStart = errors.New("saved start must be inside an approved interior floor region at the configured eye height")

func validateWalkingStart(scene Scene, raw json.RawMessage) error {
	if (scene.Type == "PANORAMA" || scene.Type == "SPLAT" && sceneconfig.Decode(scene.Settings).Navigation == nil) || len(raw) == 0 || string(raw) == "{}" {
		return nil
	}
	config, regions := sceneWalking(scene)
	if scene.Type == "3D" && sceneconfig.Decode(scene.Settings).Navigation == nil {
		return nil
	}
	var pose walkconfig.Pose
	if json.Unmarshal(raw, &pose) != nil {
		return ErrWalkingStart
	}
	for _, region := range regions {
		if !region.Exterior && region.Contains(pose, config.EyeHeight) {
			return nil
		}
	}
	if scene.Type == "LAYOUT" {
		// Imported floor bounds come from the selected GLB meshes in the viewer.
		// INSTANCE width/depth are editor placeholders, not their walking bounds.
		// Permit persistence for reviewed interior modules; the viewer checks the
		// saved pose against exact floors and standing clearance before using it.
		for _, element := range layout.Decode(scene.Layout).Elements {
			if element.Kind == "INSTANCE" && element.Collidable && !element.Exterior && len(element.FloorMeshes) > 0 {
				return nil
			}
		}
	}
	return ErrWalkingStart
}
