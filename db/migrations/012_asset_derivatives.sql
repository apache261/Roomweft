CREATE TABLE asset_derivatives (
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','ready','failed')),
    error TEXT NOT NULL DEFAULT '',
    manifest JSONB,
    attempt UUID,
    lease_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, version),
    CHECK ((state = 'ready') = (manifest IS NOT NULL))
);
CREATE INDEX asset_derivatives_pending ON asset_derivatives(updated_at) WHERE state IN ('queued','processing');
