package database

import (
	"context"
	"encoding/json"
	"errors"
	"virtual-tour/internal/sceneconfig"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type SceneChange struct {
	ID       pgtype.UUID
	Name     pgtype.Text
	Camera   json.RawMessage
	Move     string
	Settings json.RawMessage
}

func (q *Queries) sceneTransaction(ctx context.Context, id pgtype.UUID) (pgx.Tx, *Queries, Scene, error) {
	source, ok := q.db.(interface {
		Begin(context.Context) (pgx.Tx, error)
	})
	if !ok {
		return nil, nil, Scene{}, errors.New("database does not support transactions")
	}
	tx, err := source.Begin(ctx)
	if err != nil {
		return nil, nil, Scene{}, err
	}
	queries := q.WithTx(tx)
	scene, err := queries.GetScene(ctx, id)
	if err == nil {
		_, err = queries.LockProject(ctx, scene.ProjectID)
	}
	// Re-read after taking the project lock: another request could have deleted it.
	if err == nil {
		scene, err = queries.GetScene(ctx, id)
	}
	if err != nil {
		tx.Rollback(ctx)
		return nil, nil, Scene{}, err
	}
	return tx, queries, scene, nil
}

func (q *Queries) ChangeScene(ctx context.Context, change SceneChange) (Scene, error) {
	tx, queries, scene, err := q.sceneTransaction(ctx, change.ID)
	if err != nil {
		return Scene{}, err
	}
	defer tx.Rollback(ctx)
	if change.Move != "" {
		scenes, err := queries.ListScenes(ctx, scene.ProjectID)
		if err != nil {
			return Scene{}, err
		}
		for i, item := range scenes {
			if item.ID != scene.ID {
				continue
			}
			j := i + 1
			if change.Move == "up" {
				j = i - 1
			}
			if j >= 0 && j < len(scenes) {
				other := scenes[j]
				if err := queries.SwapSceneOrder(ctx, SwapSceneOrderParams{FirstID: scene.ID, SecondID: other.ID, FirstOrder: scene.SortOrder, SecondOrder: other.SortOrder}); err != nil {
					return Scene{}, err
				}
			}
			break
		}
	}
	if change.Settings != nil {
		old, next := sceneconfig.Decode(scene.Settings), sceneconfig.Decode(change.Settings)
		if err := next.Validate(); err != nil {
			return Scene{}, err
		}
		if old.Model != next.Model && next.Navigation != nil {
			next.Navigation = nil
			change.Settings, _ = json.Marshal(next)
		}
		if scene.Type == "3D" {
			candidate := scene
			candidate.Settings = change.Settings
			if err := queries.portalRefs(ctx, candidate); err != nil {
				return Scene{}, err
			}
			if err := queries.textureRefs(ctx, scene, next.Materials); err != nil {
				return Scene{}, err
			}
		}
		if navigationChanged(scene.Settings, change.Settings) {
			change.Camera = json.RawMessage(`{}`)
		}
		if old.Model != next.Model {
			hotspots, err := queries.LockSceneHotspots(ctx, scene.ID)
			if err != nil {
				return Scene{}, err
			}
			for _, h := range hotspots {
				var point struct {
					X float64 `json:"x"`
					Y float64 `json:"y"`
					Z float64 `json:"z"`
				}
				if err := json.Unmarshal(h.Position, &point); err != nil {
					return Scene{}, err
				}
				p := sceneconfig.Reposition([3]float64{point.X, point.Y, point.Z}, old.Model, next.Model)
				point.X, point.Y, point.Z = p[0], p[1], p[2]
				for _, n := range p {
					if n < -1e6 || n > 1e6 {
						return Scene{}, sceneconfig.ErrTransformBounds
					}
				}
				position, err := json.Marshal(point)
				if err != nil {
					return Scene{}, err
				}
				if err := queries.UpdateHotspotPosition(ctx, UpdateHotspotPositionParams{ID: h.ID, Position: position}); err != nil {
					return Scene{}, err
				}
			}
			change.Camera = json.RawMessage(`{}`)
		}
		if _, err := queries.UpdateSceneSettings(ctx, UpdateSceneSettingsParams{ID: scene.ID, Settings: change.Settings}); err != nil {
			return Scene{}, err
		}
	}
	candidate := scene
	if change.Settings != nil {
		candidate.Settings = change.Settings
	}
	if err := validateWalkingStart(candidate, change.Camera); err != nil {
		return Scene{}, err
	}
	camera := change.Camera
	if camera == nil {
		camera = json.RawMessage(`{}`)
	}
	result, err := queries.EditScene(ctx, EditSceneParams{ID: scene.ID, Name: change.Name, SaveCamera: change.Camera != nil, Camera: camera})
	if err != nil {
		return Scene{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Scene{}, err
	}
	return result, nil
}

func (q *Queries) DeleteScene(ctx context.Context, id pgtype.UUID) error {
	tx, queries, scene, err := q.sceneTransaction(ctx, id)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	project, err := queries.GetProject(ctx, scene.ProjectID)
	if err != nil {
		return err
	}
	if project.StartSceneID == scene.ID {
		scenes, err := queries.ListScenes(ctx, scene.ProjectID)
		if err != nil {
			return err
		}
		var next pgtype.UUID
		for _, item := range scenes {
			if item.ID != id {
				next = item.ID
				break
			}
		}
		if _, err := queries.SetStartScene(ctx, SetStartSceneParams{ID: scene.ProjectID, SceneID: next}); err != nil {
			return err
		}
	}
	if _, err := queries.RemoveScene(ctx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
