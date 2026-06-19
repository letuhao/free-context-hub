-- Actor Data Boundary F2b — authz decision log (append-only audit + the FE "decision log").
--
-- Wrapped in a single transaction by the migration runner.
--
-- Every authorize() decision (allow + deny, incl. the root short-circuit) appends one row here.
-- A DEDICATED table rather than coordination_events because that log is hard topic-scoped
-- (topic_id NOT NULL, PK (topic_id, seq)) and a global/project authz decision has no topic.
--
-- NO foreign keys by design: this is immutable audit. Logging must never fail a decision, and
-- retiring/deleting a principal must never be blocked by (or rewrite) its historical decisions.
-- principal_id / matched_grant_id are stored as TEXT for the same fail-open reason (a stray
-- non-UUID can never raise 22P02 on the audit path).

CREATE TABLE IF NOT EXISTS authz_decisions (
  decision_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ts               TIMESTAMPTZ NOT NULL DEFAULT now(),
  principal_id     TEXT,                          -- NULL for a NO_PRINCIPAL (unauthenticated) deny
  action           TEXT        NOT NULL,          -- read | write | admin | delegate
  resource_kind    TEXT        NOT NULL,          -- global | project | topic | task
  resource_id      TEXT,                          -- NULL for global
  allow            BOOLEAN     NOT NULL,
  reason           TEXT        NOT NULL,          -- ROOT|GRANT|AUTH_DISABLED|NO_PRINCIPAL|...
  matched_grant_id TEXT                           -- the grant that allowed (NULL on deny / root / auth-off)
);

COMMENT ON TABLE authz_decisions IS
  'Actor Data Boundary F2 — append-only authorize() decision log (and the FE decision log). No FKs: immutable audit, fail-open logging.';

-- FE decision log + per-principal "why" history.
CREATE INDEX IF NOT EXISTS authz_decisions_ts_idx ON authz_decisions (ts DESC);
CREATE INDEX IF NOT EXISTS authz_decisions_principal_ts_idx ON authz_decisions (principal_id, ts DESC);
