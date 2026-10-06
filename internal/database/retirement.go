package database

import "context"

func (q *Queries) QueueStorageRetirement(ctx context.Context, key string) error {
	_, err := q.db.Exec(ctx, `INSERT INTO storage_retirements(storage_key) VALUES($1) ON CONFLICT(storage_key) DO NOTHING`, key)
	return err
}
func (q *Queries) ClaimStorageRetirement(ctx context.Context) (string, error) {
	var key string
	err := q.db.QueryRow(ctx, `WITH candidate AS (
 SELECT storage_key FROM storage_retirements r WHERE retire_after<=now() AND (lease_until IS NULL OR lease_until<now())
 AND NOT EXISTS(SELECT 1 FROM assets a WHERE a.storage_key=r.storage_key)
 AND NOT EXISTS(SELECT 1 FROM asset_derivatives d, LATERAL jsonb_path_query(d.manifest::jsonb,'$.**.key') v WHERE v #>> '{}' = r.storage_key)
 ORDER BY retire_after FOR UPDATE OF r SKIP LOCKED LIMIT 1)
 UPDATE storage_retirements r SET lease_until=now()+interval '5 minutes',attempts=attempts+1 FROM candidate c WHERE r.storage_key=c.storage_key RETURNING r.storage_key`).Scan(&key)
	return key, err
}
func (q *Queries) FinishStorageRetirement(ctx context.Context, key, message string) error {
	if message == "" {
		_, err := q.db.Exec(ctx, `DELETE FROM storage_retirements WHERE storage_key=$1`, key)
		return err
	}
	_, err := q.db.Exec(ctx, `UPDATE storage_retirements SET last_error=$2,lease_until=NULL,retire_after=now()+least(attempts,24)*interval '1 hour' WHERE storage_key=$1`, key, message)
	return err
}
