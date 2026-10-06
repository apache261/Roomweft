-- Check asset references at transaction completion so deleting a whole
-- project can cascade through scenes, layouts and assets in any trigger order.
-- Deleting an individual referenced asset still fails with a foreign-key error.
ALTER TABLE layout_asset_refs DROP CONSTRAINT layout_asset_refs_project_id_asset_id_fkey;
ALTER TABLE layout_asset_refs ADD CONSTRAINT layout_asset_refs_project_id_asset_id_fkey
 FOREIGN KEY (project_id,asset_id) REFERENCES assets(project_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
