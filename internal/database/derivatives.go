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
	Kind    string
	AssetID pgtype.UUID
	Key     string
	Size    int64
	Attempt pgtype.UUID
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
 SELECT asset_id,version FROM asset_derivatives WHERE version=$1 AND
 (state='queued' OR (state='processing' AND lease_until<now())) ORDER BY updated_at
 FOR UPDATE SKIP LOCKED LIMIT 1), claimed AS (
 UPDATE asset_derivatives d SET state='processing',attempt=gen_random_uuid(),lease_until=now()+interval '15 minutes',updated_at=now()
 FROM candidate c WHERE d.asset_id=c.asset_id AND d.version=c.version RETURNING d.asset_id,d.attempt)
 SELECT a.id,a.storage_key,a.size,c.attempt,a.file_type FROM claimed c JOIN assets a ON a.id=c.asset_id`, DerivativeVersion).Scan(&j.AssetID, &j.Key, &j.Size, &j.Attempt, &j.Kind)
	return j, err
}
func (q *Queries) FinishDerivative(ctx context.Context, j DerivativeJob, manifest []byte, message string) (bool, error) {
	state := "ready"
	if len(manifest) == 0 {
		state = "failed"
		manifest = nil
	}
	tag, err := q.db.Exec(ctx, `UPDATE asset_derivatives SET state=$4,manifest=$5,error=$6,lease_until=NULL,updated_at=now()
 WHERE asset_id=$1 AND version=$2 AND attempt=$3 AND state='processing'`, j.AssetID, DerivativeVersion, j.Attempt, state, manifest, message)
	return tag.RowsAffected() == 1, err
}
