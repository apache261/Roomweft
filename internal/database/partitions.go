package database

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgtype"
)

type AssetPartition struct {
	Revision   int64           `json:"revision"`
	SourceHash string          `json:"source_sha256"`
	Inventory  json.RawMessage `json:"inventory"`
	Document   json.RawMessage `json:"document"`
}

func (q *Queries) GetAssetPartition(ctx context.Context, id pgtype.UUID) (AssetPartition, error) {
	var p AssetPartition
	err := q.db.QueryRow(ctx, `SELECT revision,source_sha256,inventory,document FROM asset_partitions WHERE asset_id=$1`, id).Scan(&p.Revision, &p.SourceHash, &p.Inventory, &p.Document)
	return p, err
}

// A concurrent inventory refresh of immutable source bytes must preserve edits.
// A different source invalidates ownership, while incrementing the revision.
func (q *Queries) InitializeAssetPartition(ctx context.Context, id pgtype.UUID, hash string, inventory, document []byte) (AssetPartition, error) {
	var p AssetPartition
	err := q.db.QueryRow(ctx, `INSERT INTO asset_partitions(asset_id,source_sha256,inventory,document)
 SELECT id,$2,$3,$4 FROM assets WHERE id=$1 AND upload_status='ready' AND file_type='GLB'
 ON CONFLICT(asset_id) DO UPDATE SET
 inventory=EXCLUDED.inventory,
 document=CASE WHEN asset_partitions.source_sha256=EXCLUDED.source_sha256 THEN asset_partitions.document ELSE EXCLUDED.document END,
 revision=CASE WHEN asset_partitions.source_sha256=EXCLUDED.source_sha256 THEN asset_partitions.revision ELSE asset_partitions.revision+1 END,
 source_sha256=EXCLUDED.source_sha256,updated_at=now()
 RETURNING revision,source_sha256,inventory,document`, id, hash, inventory, document).Scan(&p.Revision, &p.SourceHash, &p.Inventory, &p.Document)
	return p, err
}
func (q *Queries) SaveAssetPartition(ctx context.Context, id pgtype.UUID, hash string, revision int64, document []byte) (AssetPartition, error) {
	var p AssetPartition
	err := q.db.QueryRow(ctx, `WITH saved AS (UPDATE asset_partitions SET document=$4,revision=revision+1,updated_at=now()
 WHERE asset_id=$1 AND source_sha256=$2 AND revision=$3 AND EXISTS(SELECT 1 FROM assets WHERE id=$1 AND upload_status='ready' AND file_type='GLB')
 RETURNING asset_id,revision,source_sha256,inventory,document), queued AS (
 INSERT INTO asset_derivatives(asset_id,version,partition_revision,source_sha256)
 SELECT asset_id,'chunks-v1',revision,source_sha256 FROM saved WHERE document->>'policy'='reviewed-rooms'
 ON CONFLICT(asset_id,version) DO UPDATE SET partition_revision=EXCLUDED.partition_revision,source_sha256=EXCLUDED.source_sha256,state='queued',manifest=NULL,error='',attempt=NULL,lease_until=NULL,updated_at=now())
 SELECT revision,source_sha256,inventory,document FROM saved`, id, hash, revision, document).Scan(&p.Revision, &p.SourceHash, &p.Inventory, &p.Document)
	return p, err
}
