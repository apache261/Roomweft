-- Proxies are independent assets; visual captures never confer floor permission.
CREATE TABLE scene_splat_proxy_refs (
 scene_id UUID PRIMARY KEY,
 project_id UUID NOT NULL,
 source_asset_id UUID NOT NULL,
 proxy_asset_id UUID NOT NULL,
 FOREIGN KEY(project_id,scene_id) REFERENCES scenes(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,source_asset_id) REFERENCES assets(project_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(project_id,proxy_asset_id) REFERENCES assets(project_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX scene_splat_proxy_refs_asset_idx ON scene_splat_proxy_refs(proxy_asset_id);
CREATE FUNCTION sync_splat_proxy_ref() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proxy UUID;
BEGIN
 DELETE FROM scene_splat_proxy_refs WHERE scene_id=NEW.id;
 IF NEW.type='SPLAT' AND NEW.settings->'splat'->'proxy' IS NOT NULL AND NEW.settings->'splat'->'proxy' <> 'null'::jsonb THEN
  proxy := (NEW.settings->'splat'->'proxy'->>'asset_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM assets WHERE id=proxy AND project_id=NEW.project_id AND file_type='GLB' AND upload_status='ready') THEN
   RAISE EXCEPTION 'proxy requires a ready same-project GLB' USING ERRCODE='23503';
  END IF;
  INSERT INTO scene_splat_proxy_refs VALUES(NEW.id,NEW.project_id,NEW.asset_id,proxy);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scenes_splat_proxy_ref AFTER INSERT OR UPDATE OF settings,asset_id,type ON scenes FOR EACH ROW EXECUTE FUNCTION sync_splat_proxy_ref();
