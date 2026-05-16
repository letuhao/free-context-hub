-- 0053_coordination_substrate.sql — Phase 15 Sprint 15.1
-- Coordination substrate: the append-only event log + Topic/Actor/participant model.
-- See docs/specs/2026-05-16-phase-15-sprint-15.1-design.md §1.
--
-- All CREATE ... IF NOT EXISTS — idempotent, no existing constraint to alter
-- (the 0048 pattern, not the 0049 DO-block pattern).

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- Topics — chartered initiatives. topic_id is a global TEXT PK (service-generated UUID).
-- next_seq is the per-topic event-sequence counter (design D1): appendEvent bumps it
-- transactionally, so per-topic seq is monotonic and gap-free.
CREATE TABLE IF NOT EXISTS topics (
  topic_id   TEXT        PRIMARY KEY,
  project_id TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  charter    TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'chartered'
                CHECK (status IN ('chartered','active','closing','closed')),
  next_seq   BIGINT      NOT NULL DEFAULT 0,
  created_by TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS topics_project_idx ON topics (project_id, created_at DESC);

-- Actors — project-scoped identity. Auto-registered on first join.
CREATE TABLE IF NOT EXISTS actors (
  project_id   TEXT        NOT NULL,
  actor_id     TEXT        NOT NULL,
  type         TEXT        NOT NULL CHECK (type IN ('human','ai')),
  display_name TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, actor_id)
);

-- Topic participants — actor ⋈ topic, with a chain-of-command level.
CREATE TABLE IF NOT EXISTS topic_participants (
  topic_id  TEXT        NOT NULL REFERENCES topics(topic_id) ON DELETE CASCADE,
  actor_id  TEXT        NOT NULL,
  level     TEXT        NOT NULL CHECK (level IN ('authority','coordination','execution')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, actor_id)
);

-- The event log — append-only spine. Replay cursor is (topic_id, seq).
-- topic_id REFERENCES topics WITHOUT cascade: topics are never deleted (closed != deleted);
-- a delete attempt on a topic that has events MUST fail loud — the log is permanent.
-- `type` has NO CHECK (design D3) — the event-type set grows every sprint; it is
-- validated service-side against the EVENT_TYPES catalog instead of by a DB constraint
-- that would force a migration each sprint. `subject_type` is a small stable set ⇒ CHECK.
CREATE TABLE IF NOT EXISTS coordination_events (
  topic_id     TEXT        NOT NULL REFERENCES topics(topic_id),
  seq          BIGINT      NOT NULL,
  event_id     UUID        NOT NULL DEFAULT gen_random_uuid(),
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id     TEXT        NOT NULL,
  type         TEXT        NOT NULL,
  subject_type TEXT        NOT NULL
                 CHECK (subject_type IN ('task','artifact','request','motion','dispute','intake','topic')),
  subject_id   TEXT        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}',
  PRIMARY KEY (topic_id, seq)
);

-- event_id is globally unique for cross-topic dedup (e.g. a future A2A bridge / export).
CREATE UNIQUE INDEX IF NOT EXISTS coordination_events_event_id_uniq
  ON coordination_events (event_id);
