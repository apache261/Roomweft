package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"virtual-tour/internal/layout"
)

var ErrLayoutConflict = errors.New("layout was changed in another session; reload before saving")
var ErrLayoutAttachment = errors.New("detach or delete attached hotspots before removing their element")
var ErrLayoutReference = errors.New("instances require ready GLB assets from this project")

func (q *Queries) layoutRefs(ctx context.Context, scene Scene, doc layout.Document) error {
	scene.Layout, _ = json.Marshal(doc)
	if err := q.portalRefs(ctx, scene); err != nil {
		return err
	}
	if err := q.textureRefs(ctx, scene, doc.Materials); err != nil {
		return err
	}
	if err := q.ClearLayoutAssetRefs(ctx, scene.ID); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, e := range doc.Elements {
		if e.Kind != "INSTANCE" || seen[e.AssetID] {
			continue
		}
		seen[e.AssetID] = true
		var asset pgtype.UUID
		_ = asset.Scan(e.AssetID)
		count, err := q.AddLayoutAssetRef(ctx, AddLayoutAssetRefParams{ID: scene.ID, ID_2: asset})
		if err != nil {
			return err
		}
		if count != 1 {
			return ErrLayoutReference
		}
	}
	return nil
}
func (q *Queries) CreateLayout(ctx context.Context, project pgtype.UUID, name string, doc layout.Document) (Scene, error) {
	if err := doc.Validate(); err != nil {
		return Scene{}, err
	}
	source, ok := q.db.(interface {
		Begin(context.Context) (pgx.Tx, error)
	})
	if !ok {
		return Scene{}, errors.New("database does not support transactions")
	}
	tx, err := source.Begin(ctx)
	if err != nil {
		return Scene{}, err
	}
	defer tx.Rollback(ctx)
	queries := q.WithTx(tx)
	if _, err = queries.LockProject(ctx, project); err != nil {
		return Scene{}, err
	}
	raw, _ := json.Marshal(doc)
	scene, err := queries.CreateLayoutScene(ctx, CreateLayoutSceneParams{ProjectID: project, Name: name, Layout: raw})
	if err != nil {
		return Scene{}, err
	}
	if err = queries.layoutRefs(ctx, scene, doc); err != nil {
		return Scene{}, err
	}
	return scene, tx.Commit(ctx)
}
func (q *Queries) SaveLayout(ctx context.Context, id pgtype.UUID, revision int32, doc layout.Document) (Scene, error) {
	if err := doc.Validate(); err != nil {
		return Scene{}, err
	}
	tx, queries, scene, err := q.sceneTransaction(ctx, id)
	if err != nil {
		return Scene{}, err
	}
	defer tx.Rollback(ctx)
	if scene.Type != "LAYOUT" {
		return Scene{}, pgx.ErrNoRows
	}
	if revision != scene.LayoutRevision || revision == 2147483647 {
		return Scene{}, ErrLayoutConflict
	}
	if err = queries.layoutRefs(ctx, scene, doc); err != nil {
		return Scene{}, err
	}
	hotspots, err := queries.LockSceneHotspots(ctx, id)
	if err != nil {
		return Scene{}, err
	}
	for _, h := range hotspots {
		var p layout.Point
		if err = json.Unmarshal(h.Position, &p); err != nil {
			return Scene{}, err
		}
		if p.Attachment == nil {
			continue
		}
		next, err := doc.Position(*p.Attachment)
		if err != nil {
			return Scene{}, fmt.Errorf("%w: %s", ErrLayoutAttachment, h.Title)
		}
		raw, _ := json.Marshal(next)
		if err = queries.UpdateHotspotPosition(ctx, UpdateHotspotPositionParams{ID: h.ID, Position: raw}); err != nil {
			return Scene{}, err
		}
	}
	raw, _ := json.Marshal(doc)
	result, err := queries.SaveLayoutDocument(ctx, SaveLayoutDocumentParams{ID: id, Layout: raw})
	if err != nil {
		return Scene{}, err
	}
	return result, tx.Commit(ctx)
}

// Hotspot writes take the same project lock as layout saves, preventing orphaned attachments.
func (q *Queries) WriteLayoutHotspot(ctx context.Context, sceneID pgtype.UUID, create CreateHotspotParams, update *UpdateHotspotParams) (Hotspot, error) {
	tx, queries, scene, err := q.sceneTransaction(ctx, sceneID)
	if err != nil {
		return Hotspot{}, err
	}
	defer tx.Rollback(ctx)
	raw := create.Position
	if update != nil {
		raw = update.Position
	}
	var p layout.Point
	if err = json.Unmarshal(raw, &p); err != nil {
		return Hotspot{}, err
	}
	if p.Attachment != nil {
		p, err = layout.Decode(scene.Layout).Position(*p.Attachment)
		if err != nil {
			return Hotspot{}, ErrLayoutAttachment
		}
		raw, _ = json.Marshal(p)
	}
	var result Hotspot
	if update != nil {
		update.Position = raw
		result, err = queries.UpdateHotspot(ctx, *update)
	} else {
		create.Position = raw
		result, err = queries.CreateHotspot(ctx, create)
	}
	if err != nil {
		return Hotspot{}, err
	}
	return result, tx.Commit(ctx)
}
