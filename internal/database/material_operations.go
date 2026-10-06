package database

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgtype"
	"virtual-tour/internal/materials"
)

var ErrTextureReference = errors.New("texture maps require ready assets from this project with the matching map role")

func (q *Queries) textureRefs(ctx context.Context, scene Scene, presets []materials.Preset) error {
	if err := q.ClearSceneTextureRefs(ctx, scene.ID); err != nil {
		return err
	}
	seen := map[string]string{}
	for _, r := range materials.References(presets) {
		if role, ok := seen[r.ID]; ok {
			if role != r.Kind {
				return ErrTextureReference
			}
			continue
		}
		seen[r.ID] = r.Kind
		var id pgtype.UUID
		_ = id.Scan(r.ID)
		count, err := q.AddSceneTextureRef(ctx, AddSceneTextureRefParams{ID: scene.ID, ID_2: id, FileType: r.Kind})
		if err != nil {
			return err
		}
		if count != 1 {
			return ErrTextureReference
		}
	}
	return nil
}
