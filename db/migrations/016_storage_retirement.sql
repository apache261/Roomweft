-- Outlives parents and attempts. One day exceeds the current signed URL lifetime.
CREATE TABLE storage_retirements (
 storage_key TEXT PRIMARY KEY,
 retire_after TIMESTAMPTZ NOT NULL DEFAULT now()+interval '1 day',
 attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT NOT NULL DEFAULT '',
 lease_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION retire_derivative_objects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.manifest IS NOT NULL AND (TG_OP='DELETE' OR OLD.manifest IS DISTINCT FROM NEW.manifest) THEN
  INSERT INTO storage_retirements(storage_key)
  SELECT DISTINCT v #>> '{}' FROM jsonb_path_query(OLD.manifest::jsonb,'$.**.key') v
  WHERE jsonb_typeof(v)='string' AND v #>> '{}' <> ''
  ON CONFLICT(storage_key) DO UPDATE SET retire_after=GREATEST(storage_retirements.retire_after,now()+interval '1 day');
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER retire_derivative_outputs AFTER UPDATE OR DELETE ON asset_derivatives FOR EACH ROW EXECUTE FUNCTION retire_derivative_objects();
CREATE FUNCTION retire_asset_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO storage_retirements(storage_key) VALUES(OLD.storage_key)
 ON CONFLICT(storage_key) DO UPDATE SET retire_after=GREATEST(storage_retirements.retire_after,now()+interval '1 day');
 RETURN OLD;
END $$;
CREATE TRIGGER retire_original_upload AFTER DELETE ON assets FOR EACH ROW EXECUTE FUNCTION retire_asset_object();
-- Complete-original reviews also retire the prior chunk set.
CREATE FUNCTION invalidate_partition_products() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE asset_derivatives SET manifest=NULL,state='failed',error='Partition revision superseded',attempt=NULL,lease_until=NULL,updated_at=now()
 WHERE asset_id=NEW.asset_id AND version='chunks-v1' AND
 (partition_revision<>NEW.revision OR source_sha256<>NEW.source_sha256);
 RETURN NEW;
END $$;
CREATE TRIGGER invalidate_partition_products AFTER UPDATE ON asset_partitions FOR EACH ROW EXECUTE FUNCTION invalidate_partition_products();
