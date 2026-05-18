-- Phase 15 Sprint 15.5 — Intake mailbox + Dispute resolution
-- Design ref: docs/specs/2026-05-18-phase-15-sprint-15.5-design.md §1

-- Intake mailbox: inbound channel for items belonging to no current task (design B.8).
-- topic_id is null until triaged; routed_to holds the ID of the entity the item became.
CREATE TABLE intake_items (
  intake_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   TEXT        NOT NULL,
  topic_id     TEXT,
  kind         TEXT        NOT NULL
                 CHECK (kind IN ('violation_report', 'suggestion', 'request')),
  body         TEXT        NOT NULL,
  submitted_by TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'received'
                 CHECK (status IN ('received', 'triaged', 'dismissed')),
  routed_to    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX intake_items_project_id_idx ON intake_items (project_id, status);

-- Dispute resolution: a Request-Approval item routed to an arbiter (unilateral)
-- or tribunal (collective). resolution_request_id references requests(request_id).
-- Design lifecycle: open → [under_resolution →] resolved (§6 D2: under_resolution deferred to 15.6).
CREATE TABLE disputes (
  dispute_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id              TEXT        NOT NULL,
  subject_ref           TEXT        NOT NULL,
  parties               TEXT[]      NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'under_resolution', 'resolved')),
  resolution_request_id UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX disputes_topic_id_idx ON disputes (topic_id, status);
