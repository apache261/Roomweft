package db

import (
	"context"
	"embed"
	"io/fs"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var schemas embed.FS

// Migrate applies ordered, idempotent schema migrations before serving requests.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	entries, err := fs.Glob(schemas, "migrations/*.sql")
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(734821902)"); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations (path TEXT PRIMARY KEY)"); err != nil {
		return err
	}
	for _, path := range entries {
		var applied bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE path=$1)", path).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		schema, err := schemas.ReadFile(path)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(schema)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations(path) VALUES ($1)", path); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
