-- Raw splat-v1 is bounded by decoded count, independently of mesh/image limits.
ALTER TABLE assets DROP CONSTRAINT assets_file_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_file_type_check CHECK (file_type IN ('GLB','PANORAMA','SPLAT','IMAGE','TEXTURE_BASE_COLOR','TEXTURE_NORMAL','TEXTURE_ROUGHNESS','TEXTURE_AO','TEXTURE_LIGHTMAP'));
ALTER TABLE assets DROP CONSTRAINT assets_size_check;
ALTER TABLE assets ADD CONSTRAINT assets_size_check CHECK (size >= 20 AND size <= CASE WHEN file_type='GLB' THEN 1048576000::BIGINT WHEN file_type='SPLAT' THEN 64000000::BIGINT ELSE 104857600::BIGINT END AND (file_type<>'SPLAT' OR (size>=32 AND size%32=0)));
ALTER TABLE scenes DROP CONSTRAINT scenes_type_check;
ALTER TABLE scenes ADD CONSTRAINT scenes_type_check CHECK (type IN ('3D','PANORAMA','LAYOUT','SPLAT'));

-- Enforce kind/readiness for new or changed sources without rewriting legacy rows.
CREATE FUNCTION validate_scene_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type <> 'LAYOUT' AND NOT EXISTS (
    SELECT 1 FROM assets a WHERE a.id=NEW.asset_id AND a.project_id=NEW.project_id AND a.upload_status='ready'
    AND a.file_type=CASE NEW.type WHEN '3D' THEN 'GLB' ELSE NEW.type END
  ) THEN
    RAISE EXCEPTION 'scene requires a ready same-project asset of matching kind' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scenes_validate_source BEFORE INSERT OR UPDATE OF type,asset_id,project_id ON scenes FOR EACH ROW EXECUTE FUNCTION validate_scene_source();
