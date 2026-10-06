-- chunks-v1 is independent of legacy runtime-v1 products.
ALTER TABLE asset_derivatives ADD COLUMN partition_revision BIGINT;
ALTER TABLE asset_derivatives ADD COLUMN source_sha256 TEXT;
ALTER TABLE asset_derivatives ADD CONSTRAINT chunk_revision_identity CHECK
 (version <> 'chunks-v1' OR (partition_revision IS NOT NULL AND source_sha256 IS NOT NULL AND partition_revision > 0 AND source_sha256 ~ '^[a-f0-9]{64}$'));
