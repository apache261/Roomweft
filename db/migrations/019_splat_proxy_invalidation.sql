-- Preserve the same approval invalidation rule for direct persistence callers.
CREATE FUNCTION invalidate_splat_proxy_alignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.type='SPLAT' AND NEW.type='SPLAT' AND (
  OLD.asset_id IS DISTINCT FROM NEW.asset_id OR
  OLD.settings->'model' IS DISTINCT FROM NEW.settings->'model' OR
  OLD.settings->'splat'->'position' IS DISTINCT FROM NEW.settings->'splat'->'position' OR
  OLD.settings->'splat'->'proxy'->'asset_id' IS DISTINCT FROM NEW.settings->'splat'->'proxy'->'asset_id' OR
  OLD.settings->'splat'->'proxy'->'model' IS DISTINCT FROM NEW.settings->'splat'->'proxy'->'model' OR
  OLD.settings->'splat'->'proxy'->'position' IS DISTINCT FROM NEW.settings->'splat'->'proxy'->'position'
 ) THEN
  NEW.settings := NEW.settings - 'navigation';
  IF NEW.settings->'splat'->'proxy' IS NOT NULL AND NEW.settings->'splat'->'proxy'<>'null'::jsonb THEN
   NEW.settings := jsonb_set(NEW.settings,'{splat,proxy,reviewed}','false'::jsonb);
  END IF;
  NEW.start_camera := '{}'::jsonb;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scenes_splat_proxy_invalidation BEFORE UPDATE OF settings,asset_id ON scenes FOR EACH ROW EXECUTE FUNCTION invalidate_splat_proxy_alignment();
