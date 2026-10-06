-- Reviewed source ownership is independent of whole-file derivative jobs.
CREATE TABLE asset_partitions (
 asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
 source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
 inventory JSONB NOT NULL,
 document JSONB NOT NULL,
 revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
