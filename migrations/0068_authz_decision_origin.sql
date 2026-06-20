-- Actor Data Boundary F2 (review-impl #3) — distinguish REAL resource-access decisions from the
-- internal permission-checks that the management paths make.
--
-- Wrapped in a single transaction by the migration runner.
--
-- authorize() is called both (a) by handlers to gate a real resource access ('access'), and (b)
-- internally — grant_capability's delegation invariant ('delegation_check') and the management tools'
-- own self-authorization ('tool_auth'). Without a discriminator the FE "decision log" can't tell a
-- user-facing access denial from an internal delegate check. Default 'access' so existing rows + the
-- common path need no change.

ALTER TABLE authz_decisions
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'access';

COMMENT ON COLUMN authz_decisions.origin IS
  'access = a real resource-access decision (the FE decision log filters on this); delegation_check = grant_capability invariant; tool_auth = a management tool self-authorizing.';

-- FE decision-log query: real access decisions, newest first.
CREATE INDEX IF NOT EXISTS authz_decisions_origin_ts_idx ON authz_decisions (origin, ts DESC);
