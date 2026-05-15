-- Phase 13 Sprint 13.3 — F2 core: extend lessons.status + review_requests table + activity_log event types
-- Three constraint operations, all idempotent per Sprint 13.2 pattern.

-- (a) lessons.status CHECK extension
DO $$
DECLARE
  current_def TEXT;
  pre_types TEXT[] := ARRAY['draft', 'active', 'superseded', 'archived'];
  post_types TEXT[] := pre_types || ARRAY['pending-review'];
  parsed TEXT[];
  array_segment TEXT;
  matches_pre BOOLEAN;
  matches_post BOOLEAN;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint WHERE conname='lessons_status_check' AND conrelid='lessons'::regclass;
  IF current_def IS NULL THEN
    RAISE EXCEPTION 'lessons_status_check constraint not found';
  END IF;
  SELECT (regexp_matches(current_def, 'ARRAY\[([^\]]+)\]', 'i'))[1] INTO array_segment;
  SELECT array_agg(m[1]) INTO parsed FROM regexp_matches(array_segment, '''([^'']+)''', 'g') AS m;
  matches_pre := NOT EXISTS (SELECT 1 FROM unnest(pre_types) t WHERE NOT (t = ANY (parsed))) AND array_length(parsed,1)=array_length(pre_types,1);
  matches_post := NOT EXISTS (SELECT 1 FROM unnest(post_types) t WHERE NOT (t = ANY (parsed))) AND array_length(parsed,1)=array_length(post_types,1);
  IF matches_post THEN
    RAISE NOTICE 'migration 0049 (a): lessons_status_check already extended — idempotent no-op';
  ELSIF matches_pre THEN
    EXECUTE 'ALTER TABLE lessons DROP CONSTRAINT lessons_status_check';
    EXECUTE $cst$ALTER TABLE lessons ADD CONSTRAINT lessons_status_check CHECK (status IN ('draft', 'pending-review', 'active', 'superseded', 'archived'))$cst$;
  ELSE
    RAISE EXCEPTION 'lessons_status_check has unexpected shape: %', current_def;
  END IF;
END $$;

-- (b) review_requests table
CREATE TABLE IF NOT EXISTS review_requests (
  request_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          TEXT        NOT NULL,
  lesson_id           UUID        NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  submitter_agent_id  TEXT        NOT NULL,
  reviewer_note       TEXT,
  intended_reviewer   TEXT,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'returned')),
  resolved_at         TIMESTAMPTZ,
  resolved_by         TEXT,
  resolution_note     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_requests_project_status_idx
  ON review_requests (project_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS review_requests_lesson_pending_uniq
  ON review_requests (lesson_id)
  WHERE status = 'pending';

-- (c) activity_log.event_type CHECK extension
DO $$
DECLARE
  current_def TEXT;
  pre_types TEXT[] := ARRAY[
    'lesson.created', 'lesson.updated', 'lesson.status_changed', 'lesson.deleted',
    'guardrail.triggered', 'guardrail.passed',
    'job.queued', 'job.succeeded', 'job.failed',
    'document.uploaded', 'document.deleted',
    'group.created', 'group.deleted', 'comment.added'
  ];
  post_types TEXT[] := pre_types || ARRAY['review.submitted', 'review.approved', 'review.returned'];
  parsed TEXT[];
  array_segment TEXT;
  matches_pre BOOLEAN;
  matches_post BOOLEAN;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint WHERE conname='activity_log_event_type_check' AND conrelid='activity_log'::regclass;
  IF current_def IS NULL THEN
    RAISE EXCEPTION 'activity_log_event_type_check constraint not found';
  END IF;
  SELECT (regexp_matches(current_def, 'ARRAY\[([^\]]+)\]', 'i'))[1] INTO array_segment;
  SELECT array_agg(m[1]) INTO parsed FROM regexp_matches(array_segment, '''([^'']+)''', 'g') AS m;
  matches_pre := NOT EXISTS (SELECT 1 FROM unnest(pre_types) t WHERE NOT (t = ANY (parsed))) AND array_length(parsed,1)=array_length(pre_types,1);
  matches_post := NOT EXISTS (SELECT 1 FROM unnest(post_types) t WHERE NOT (t = ANY (parsed))) AND array_length(parsed,1)=array_length(post_types,1);
  IF matches_post THEN
    RAISE NOTICE 'migration 0049 (c): activity_log_event_type_check already extended — idempotent no-op';
  ELSIF matches_pre THEN
    EXECUTE 'ALTER TABLE activity_log DROP CONSTRAINT activity_log_event_type_check';
    EXECUTE $cst$ALTER TABLE activity_log ADD CONSTRAINT activity_log_event_type_check
      CHECK (event_type IN (
        'lesson.created', 'lesson.updated', 'lesson.status_changed', 'lesson.deleted',
        'guardrail.triggered', 'guardrail.passed',
        'job.queued', 'job.succeeded', 'job.failed',
        'document.uploaded', 'document.deleted',
        'group.created', 'group.deleted', 'comment.added',
        'review.submitted', 'review.approved', 'review.returned'
      ))$cst$;
  ELSE
    RAISE EXCEPTION 'activity_log_event_type_check has unexpected shape: %', current_def;
  END IF;
END $$;
