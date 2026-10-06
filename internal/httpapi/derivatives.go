package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"log/slog"
	"net/http"
	"strings"
	"virtual-tour/internal/database"
	"virtual-tour/internal/derivatives"
)

type DerivativeStore interface {
	QueueDerivative(context.Context, pgtype.UUID, bool) error
	GetDerivative(context.Context, pgtype.UUID) (database.Derivative, error)
}

func (a *API) queueDerivative(ctx context.Context, asset database.Asset, retry bool) error {
	if (asset.FileType != "GLB" && !strings.HasPrefix(asset.FileType, "TEXTURE_")) || asset.UploadStatus != "ready" {
		return nil
	}
	if store, ok := a.store.(DerivativeStore); ok {
		return store.QueueDerivative(ctx, asset.ID, retry)
	}
	return nil
}
func (a *API) runtimeAsset(ctx context.Context, asset database.Asset, public bool) *database.Derivative {
	if asset.FileType != "GLB" && !strings.HasPrefix(asset.FileType, "TEXTURE_") {
		return nil
	}
	store, ok := a.store.(DerivativeStore)
	if !ok {
		return nil
	}
	d, err := store.GetDerivative(ctx, asset.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &database.Derivative{State: "unavailable"}
	}
	if err != nil {
		slog.Warn("derivative lookup failed", "error", err)
		return &database.Derivative{State: "unavailable"}
	}
	if public {
		d.Error = ""
	}
	if d.State != "ready" {
		d.Manifest = nil
		return &d
	}
	var manifest derivatives.Manifest
	if err = json.Unmarshal(d.Manifest, &manifest); err != nil || manifest.Version != database.DerivativeVersion {
		return &database.Derivative{State: "unavailable"}
	}
	for tier, v := range manifest.Variants {
		if a.storage != nil {
			v.URL, _ = a.storage.ReadURL(ctx, v.Key)
		}
		v.Key = ""
		v.File = ""
		manifest.Variants[tier] = v
	}
	if a.storage != nil && manifest.Collision != nil {
		manifest.Collision.URL, _ = a.storage.ReadURL(ctx, manifest.Collision.Key)
	}
	if manifest.Collision != nil {
		manifest.Collision.Key = ""
		manifest.Collision.File = ""
	}
	d.Manifest, _ = json.Marshal(manifest)
	return &d
}
func (a *API) processAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := projectID(w, r)
	if !ok {
		return
	}
	asset, err := a.assets.GetAsset(r.Context(), id)
	if err != nil {
		a.resourceError(w, err)
		return
	}
	if (asset.FileType != "GLB" && !strings.HasPrefix(asset.FileType, "TEXTURE_")) || asset.UploadStatus != "ready" {
		fail(w, 400, "processing requires a completed GLB or material texture asset")
		return
	}
	if _, ok := a.store.(DerivativeStore); !ok {
		fail(w, 503, "asset processing is unavailable")
		return
	}
	if err = a.queueDerivative(r.Context(), asset, true); err != nil {
		a.resourceError(w, err)
		return
	}
	respond(w, 202, a.runtimeAsset(r.Context(), asset, false))
}
