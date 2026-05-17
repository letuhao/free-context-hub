-- 0056_request_approval.sql — Phase 15 Sprint 15.3
-- Request-Approval: requests + request_steps multi-level routing + the DoA matrix.
-- Design ref: docs/specs/2026-05-17-phase-15-sprint-15.3-design.md §1
-- Spec hash: 6f79057f9e42e4fc

-- The Delegation-of-Authority matrix (D1). topic_id NULL = a project-level row;
-- topic_id set = a topic override. project_id='__default__' = the seeded fallback.
CREATE TABLE IF NOT EXISTS doa_matrix (
  matrix_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     TEXT        NOT NULL,
  topic_id       TEXT,                              -- NULL = project-level; set = topic override
  kind           TEXT        NOT NULL,
  weight_min     INT         NOT NULL DEFAULT 0,
  weight_max     INT         NOT NULL DEFAULT 2147483647,
  required_level TEXT        NOT NULL CHECK (required_level IN ('execution','coordination','authority')),
  route_shape    TEXT        NOT NULL CHECK (route_shape IN ('counter_sign','escalate_to_authority')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (weight_min <= weight_max)
);
CREATE INDEX IF NOT EXISTS doa_matrix_lookup_idx
  ON doa_matrix (project_id, kind, weight_min, weight_max);

-- requests — evolves review_requests (the Request-Approval primitive).
CREATE TABLE IF NOT EXISTS requests (
  request_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id     TEXT        NOT NULL REFERENCES topics(topic_id),
  subject_type TEXT        NOT NULL,                -- 'artifact' in 15.3 (D7)
  subject_id   TEXT        NOT NULL,
  kind         TEXT        NOT NULL,
  weight       INT         NOT NULL,
  procedure    TEXT        NOT NULL CHECK (procedure IN ('unilateral','collective')),
  route_shape  TEXT        NOT NULL CHECK (route_shape IN ('counter_sign','escalate_to_authority')),
  status       TEXT        NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','approved','returned','rejected','escalation_exhausted')),
  current_step INT         NOT NULL DEFAULT 0,      -- the active request_steps.step_index
  submitted_by TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_topic_status_idx ON requests (topic_id, status);

-- request_steps — the materialized, frozen route (B.7).
CREATE TABLE IF NOT EXISTS request_steps (
  request_id    UUID        NOT NULL REFERENCES requests(request_id),
  step_index    INT         NOT NULL,
  target_office TEXT        NOT NULL CHECK (target_office IN ('execution','coordination','authority')),
  doa_snapshot  TEXT        NOT NULL,                -- D4 — frozen matrix_id:tier
  procedure     TEXT        NOT NULL DEFAULT 'unilateral',
  deadline      TIMESTAMPTZ NOT NULL,                -- meaningful while status='pending'; reset on activation
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','endorsed','returned','rejected','escalated')),
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  PRIMARY KEY (request_id, step_index)
);
-- the escalation-sweep scan predicate
CREATE INDEX IF NOT EXISTS request_steps_sweep_idx ON request_steps (status, deadline);

-- Seed the __default__ matrix (idempotent) — covers kind='artifact_review' totally.
INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
SELECT '__default__', NULL, 'artifact_review', 0,  49,         'coordination', 'counter_sign'
 WHERE NOT EXISTS (SELECT 1 FROM doa_matrix WHERE project_id='__default__' AND kind='artifact_review');
INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
SELECT '__default__', NULL, 'artifact_review', 50, 2147483647, 'authority',    'escalate_to_authority'
 WHERE NOT EXISTS (SELECT 1 FROM doa_matrix WHERE project_id='__default__' AND kind='artifact_review' AND weight_min=50);
