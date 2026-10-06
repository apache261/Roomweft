package database

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgtype"
)

const DerivativeVersion = "runtime-v1"

type Derivative struct {
	State    string          `json:"state"`
	Error    string          `json:"error,omitempty"`
	Manifest json.RawMessage `json:"manifest,omitempty"`
}
type DerivativeJob struct {
	Kind              string
	AssetID           pgtype.UUID
	Key               string
	Size              int64
	Attempt           pgtype.UUID
	Version           string
	PartitionRevision int64
	SourceHash        string
	Inventory         json.RawMessage
	Partition         json.RawMessage
}

func (q *Queries) QueueDerivative(ctx context.Context, id pgtype.UUID, retry bool) error {
	_, err := q.db.Exec(ctx, `INSERT INTO asset_derivatives(asset_id,version)
 SELECT id,$2 FROM assets WHERE id=$1 AND (file_type='GLB' OR file_type LIKE 'TEXTURE_%') AND upload_status='ready'
 ON CONFLICT(asset_id,version) DO UPDATE SET state='queued',error='',updated_at=now()
 WHERE $3 AND asset_derivatives.state='failed'`, id, DerivativeVersion, retry)
	return err
}
func (q *Queries) GetDerivative(ctx context.Context, id pgtype.UUID) (Derivative, error) {
	var d Derivative
	err := q.db.QueryRow(ctx, `SELECT state,error,manifest FROM asset_derivatives WHERE asset_id=$1 AND version=$2`, id, DerivativeVersion).Scan(&d.State, &d.Error, &d.Manifest)
	return d, err
}

// A leased, atomic claim permits multiple API processes without duplicate publication.
func (q *Queries) ClaimDerivative(ctx context.Context) (DerivativeJob, error) {
	var j DerivativeJob
	err := q.db.QueryRow(ctx, `WITH candidate AS (
 SELECT asset_id,version FROM asset_derivatives WHERE version IN ($1,'chunks-v1') AND (version=$1 OR EXISTS(SELECT 1 FROM asset_partitions p WHERE p.asset_id=asset_derivatives.asset_id AND p.revision=asset_derivatives.partition_revision AND p.source_sha256=asset_derivatives.source_sha256 AND p.document->>'policy'='reviewed-rooms')) AND
 (state='queued' OR (state='processing' AND lease_until<now())) ORDER BY updated_at
 FOR UPDATE SKIP LOCKED LIMIT 1), claimed AS (
 UPDATE asset_derivatives d SET state='processing',attempt=gen_random_uuid(),lease_until=now()+interval '15 minutes',updated_at=now()
 FROM candidate c WHERE d.asset_id=c.asset_id AND d.version=c.version RETURNING d.asset_id,d.attempt,d.version,d.partition_revision,d.source_sha256)
 SELECT a.id,a.storage_key,a.size,c.attempt,a.file_type,c.version,COALESCE(c.partition_revision,0),COALESCE(c.source_sha256,''),p.inventory,p.document FROM claimed c JOIN assets a ON a.id=c.asset_id LEFT JOIN asset_partitions p ON p.asset_id=c.asset_id`, DerivativeVersion).Scan(&j.AssetID, &j.Key, &j.Size, &j.Attempt, &j.Kind, &j.Version, &j.PartitionRevision, &j.SourceHash, &j.Inventory, &j.Partition)
	return j, err
}
func (q *Queries) FinishDerivative(ctx context.Context, j DerivativeJob, manifest []byte, message string) (bool, error) {
	version := j.Version
	if version == "" {
		version = DerivativeVersion
	}
	state := "ready"
	if len(manifest) == 0 {
		state = "failed"
		manifest = nil
	}
	tag, err := q.db.Exec(ctx, `UPDATE asset_derivatives SET state=$4,manifest=$5,error=$6,lease_until=NULL,updated_at=now()
 WHERE asset_id=$1 AND version=$2 AND attempt=$3 AND state='processing' AND lease_until>now() AND (version<>'chunks-v1' OR EXISTS(SELECT 1 FROM asset_partitions p WHERE p.asset_id=$1 AND p.revision=$7 AND p.source_sha256=$8 AND p.revision=asset_derivatives.partition_revision AND p.source_sha256=asset_derivatives.source_sha256))`, j.AssetID, version, j.Attempt, state, manifest, message, j.PartitionRevision, j.SourceHash)
	return tag.RowsAffected() == 1, err
}

// Current revision joins prevent stale products from being exposed even between
// an author edit and a worker claim.
func (q *Queries) GetChunkDerivative(ctx context.Context, id pgtype.UUID) (Derivative, error) {
	var d Derivative
	err := q.db.QueryRow(ctx, `SELECT d.state,d.error,d.manifest FROM asset_derivatives d JOIN asset_partitions p ON p.asset_id=d.asset_id AND p.revision=d.partition_revision AND p.source_sha256=d.source_sha256 WHERE d.asset_id=$1 AND d.version='chunks-v1' AND p.document->>'policy'='reviewed-rooms'`, id).Scan(&d.State, &d.Error, &d.Manifest)
	return d, err
}
func (q *Queries) QueueChunks(ctx context.Context, id pgtype.UUID, retry bool) error {
	_, err := q.db.Exec(ctx, `INSERT INTO asset_derivatives(asset_id,version,partition_revision,source_sha256)
 SELECT p.asset_id,'chunks-v1',p.revision,p.source_sha256 FROM asset_partitions p JOIN assets a ON a.id=p.asset_id WHERE p.asset_id=$1 AND p.document->>'policy'='reviewed-rooms' AND a.upload_status='ready' AND a.file_type='GLB'
 ON CONFLICT(asset_id,version) DO UPDATE SET partition_revision=EXCLUDED.partition_revision,source_sha256=EXCLUDED.source_sha256,state='queued',manifest=NULL,error='',attempt=NULL,lease_until=NULL,updated_at=now()
 WHERE asset_derivatives.partition_revision<>EXCLUDED.partition_revision OR asset_derivatives.source_sha256<>EXCLUDED.source_sha256 OR ($2 AND asset_derivatives.state='failed')`, id, retry)
	return err
}
