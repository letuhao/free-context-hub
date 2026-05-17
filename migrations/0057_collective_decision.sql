-- 0057_collective_decision.sql — Phase 15 Sprint 15.4
-- Collective decision: decision bodies + weighted membership + motions + votes.
-- Design ref: docs/specs/2026-05-18-phase-15-sprint-15.4-design.md §1
-- Spec hash: a12f419578588e6d

-- Decision bodies — a project-scoped electorate governed by a voting rule (B.6).
CREATE TABLE IF NOT EXISTS decision_bodies (
  body_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  quorum       NUMERIC     NOT NULL DEFAULT 0,        -- absolute participating-weight floor
  threshold    NUMERIC     NOT NULL,                  -- fraction in (0,1] of the for+against base
  veto_holders TEXT[]      NOT NULL DEFAULT '{}',
  created_by   TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (quorum >= 0),
  CHECK (threshold > 0 AND threshold <= 1)
);
CREATE INDEX IF NOT EXISTS decision_bodies_project_idx ON decision_bodies (project_id, created_at DESC);

-- Body membership — weighted (B.6: vote weight is orthogonal to chain-of-command level).
CREATE TABLE IF NOT EXISTS body_members (
  body_id     UUID        NOT NULL REFERENCES decision_bodies(body_id),
  actor_id    TEXT        NOT NULL,
  vote_weight NUMERIC     NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (body_id, actor_id),
  CHECK (vote_weight > 0)
);

-- Motions — a topic-scoped proposition put to a body.
CREATE TABLE IF NOT EXISTS motions (
  motion_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  body_id     UUID        NOT NULL REFERENCES decision_bodies(body_id),
  topic_id    TEXT        NOT NULL REFERENCES topics(topic_id),
  subject_ref TEXT        NOT NULL,                   -- the proposition reference (free text, ≤256)
  status      TEXT        NOT NULL DEFAULT 'proposed'
                CHECK (status IN ('proposed','seconded','balloting','carried','failed','lapsed','vetoed')),
  proposed_by TEXT        NOT NULL,
  seconded_by TEXT,
  deadline    TIMESTAMPTZ NOT NULL,
  tally       JSONB,                                  -- the frozen count result; NULL until a count happens
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS motions_topic_status_idx ON motions (topic_id, status);
CREATE INDEX IF NOT EXISTS motions_sweep_idx ON motions (status, deadline);

-- Votes — principal-keyed: one row per member; a proxy ballot IS the principal's row.
CREATE TABLE IF NOT EXISTS votes (
  motion_id UUID        NOT NULL REFERENCES motions(motion_id),
  actor_id  TEXT        NOT NULL,                     -- ALWAYS the principal whose vote it is
  choice    TEXT        NOT NULL CHECK (choice IN ('for','against','abstain')),
  weight    NUMERIC     NOT NULL,                     -- snapshotted from body_members at cast time (D7)
  proxy_for TEXT,                                     -- non-null = cast by proxy-holder <proxy_for>
  cast_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (motion_id, actor_id),
  CHECK (weight > 0)
);
