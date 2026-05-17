-- 0054_coordination_board.sql — Phase 15 Sprint 15.2
-- The Board: tasks, derived-identity artifacts + versioning, claims + fencing.
-- See docs/specs/2026-05-16-phase-15-sprint-15.2-design.md.

-- Global monotonic fencing-token source (design C.2). nextval is non-transactional
-- and strictly increasing — any later claim's token strictly exceeds any earlier one's.
CREATE SEQUENCE IF NOT EXISTS coordination_fencing_seq AS BIGINT START 1;

-- FK note [r3-fix §0.3]: tasks/artifacts/claims reference topics with NO ON DELETE clause
-- by design — a topics row is permanent (closeTopic is a status flip; Phase 15 has no
-- delete-topic operation). If a hard-delete path is ever added, these FKs + postTask's
-- existence check (§2.1) must be revisited.
CREATE TABLE IF NOT EXISTS tasks (
  task_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id   TEXT        NOT NULL REFERENCES topics(topic_id),
  title      TEXT        NOT NULL,
  topology   TEXT        NOT NULL CHECK (topology IN ('parallel','sequential','rolling')),
  depends_on UUID[]      NOT NULL DEFAULT '{}',
  raci       JSONB       NOT NULL DEFAULT '{}',
  status     TEXT        NOT NULL DEFAULT 'posted'
               CHECK (status IN ('posted','claimed','in_progress','completed','disputed')),
  created_by TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_topic_status_idx ON tasks (topic_id, status, created_at);

-- artifact_id is DERIVED <topic_id>:<task_id>:<slot> — never free-text (closes Run 1 #1).
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id            TEXT        PRIMARY KEY,
  topic_id               TEXT        NOT NULL REFERENCES topics(topic_id),
  task_id                UUID        NOT NULL REFERENCES tasks(task_id),
  slot                   TEXT        NOT NULL,
  kind                   TEXT        NOT NULL,
  state                  TEXT        NOT NULL DEFAULT 'draft'
                           CHECK (state IN ('draft','working','baselined','for_review','final','superseded')),
  version                INT         NOT NULL DEFAULT 1,
  accepted_fencing_token BIGINT      NOT NULL DEFAULT 0,
  content_ref            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artifacts_task_idx ON artifacts (task_id);

-- Append-only artifact history — one row per version (writes, baselines, sweep reverts).
CREATE TABLE IF NOT EXISTS artifact_versions (
  artifact_id   TEXT        NOT NULL REFERENCES artifacts(artifact_id),
  version       INT         NOT NULL,
  state         TEXT        NOT NULL,
  content_ref   TEXT,
  fencing_token BIGINT,                       -- the write's token; NULL for create / baseline / revert
  note          TEXT        NOT NULL,         -- 'created' | 'write' | 'baselined' | 'reverted to vN' | …
  created_by    TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (artifact_id, version)
);

-- claims — evolves Phase 13 artifact_leases. Rows are ephemeral (deleted on
-- release / complete / expiry-sweep); the lifecycle is in the event log.
CREATE TABLE IF NOT EXISTS claims (
  claim_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id      TEXT        NOT NULL,
  task_id       UUID        NOT NULL REFERENCES tasks(task_id),
  artifact_id   TEXT        NOT NULL REFERENCES artifacts(artifact_id),
  actor_id      TEXT        NOT NULL,
  fencing_token BIGINT      NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- PLAIN unique index (NOT partial — `WHERE now()` is invalid, migration 0048 documents this).
-- An INTEGRITY INVARIANT — "one claim row per artifact". claimTask never relies on it as a
-- race arbiter (the task-row FOR UPDATE lock is the serializer — §2.3); it stands to catch a
-- future code path that inserted a claim without that lock.
CREATE UNIQUE INDEX IF NOT EXISTS claims_active_uniq ON claims (artifact_id);
CREATE INDEX IF NOT EXISTS claims_expires_idx ON claims (expires_at);
