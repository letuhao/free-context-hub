-- 0048_artifact_leases.sql — Phase 13 Sprint 13.1
-- Artifact ownership / leasing protocol for multi-agent coordination.
-- See docs/phase-13-design.md Feature 1 and docs/artifact-id-convention.md.
--
-- BUILD-phase fix (2026-05-15): the design called for partial indexes with
-- `WHERE expires_at > now()` predicates. PostgreSQL rejects these because
-- `now()` is STABLE, not IMMUTABLE, and index predicates require IMMUTABLE
-- functions. The semantics ("uniqueness only among active leases") are
-- preserved by the service-layer atomic transaction in src/services/
-- artifactLeases.ts:
--   step 1: DELETE expired rows for this artifact (uses now() — OK in WHERE)
--   step 4: INSERT — UNIQUE constraint catches concurrent active claims
--           and the 23505 handler distinguishes "still active conflict" from
--           "expired but uncleaned" cases via a re-SELECT.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

CREATE TABLE IF NOT EXISTS artifact_leases (
  lease_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        TEXT        NOT NULL,
  agent_id          TEXT        NOT NULL,
  artifact_type     TEXT        NOT NULL,
  artifact_id       TEXT        NOT NULL,
  task_description  TEXT        NOT NULL,
  ttl_minutes       INT         NOT NULL DEFAULT 30,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique on (project_id, artifact_type, artifact_id). Expired rows are
-- still constrained (would block new claims) — service step 1 DELETE
-- removes them BEFORE step 4 INSERT to avoid false conflicts.
CREATE UNIQUE INDEX IF NOT EXISTS artifact_leases_active_uniq
  ON artifact_leases (project_id, artifact_type, artifact_id);

-- Sweep index for background cleanup (Sprint 13.2 job).
CREATE INDEX IF NOT EXISTS artifact_leases_expires_at_idx
  ON artifact_leases (expires_at);

-- Per-agent index for rate-limit COUNT(*) queries. The service filters
-- by `expires_at > now()` in the WHERE clause; this index makes the
-- (project_id, agent_id) lookup fast and Postgres adds the expires_at
-- filter as a heap-condition.
CREATE INDEX IF NOT EXISTS artifact_leases_agent_project_idx
  ON artifact_leases (project_id, agent_id);
