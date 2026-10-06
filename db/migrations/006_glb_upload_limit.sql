ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_size_check;
ALTER TABLE assets ADD CONSTRAINT assets_size_check CHECK (
    size >= 20 AND size <= CASE
        WHEN file_type = 'GLB' THEN 1048576000::BIGINT
        ELSE 104857600::BIGINT
    END
);
