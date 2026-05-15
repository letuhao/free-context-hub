-- Phase 12 Sprint 12.1c: lesson access log for salience-weighted retrieval.
--
-- Append-only log of lesson-access events. Every search-consideration,
-- reflect-consumption, and direct-read writes a row here. The read path
-- (src/services/salience.ts computeSalience) aggregates these rows with
-- weighted exponential decay to produce a per-lesson salience score that
-- blends into the hybrid semantic+FTS ranking.
--
-- Schema decisions (from docs/specs/2026-04-18-phase-12-sprint-1c-spec.md):
--   - Append-only, not denormalized. Per-event `weight` and `accessed_at`
--     give us the flexibility to re-tune decay half-life without backfill.
--   - `weight` column supports the rank-weighted search-consideration model
--     (weight = 1.0 / rank for search hits; 1.0 for consumption events).
--   - `context` distinguishes signal classes for future analysis without
--     requiring new tables.
--
-- Write paths (Sprint 12.1c T6-T9):
--   context='consideration-search'   weight=1/rank   searchLessons / searchLessonsMulti
--   context='consumption-reflect'    weight=1.0      reflect MCP tool
--   context='consumption-read'       weight=1.0      GET /api/lessons/:id
--   context='audit-bootstrap'        weight=1.0      one-time backfill from guardrail_audit_logs

CREATE TABLE IF NOT EXISTS lesson_access_log (
  access_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id   UUID        NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  project_id  TEXT        NOT NULL,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context     TEXT        NOT NULL,
  weight      REAL        NOT NULL DEFAULT 1.0,
  metadata    JSONB
);

CREATE INDEX IF NOT EXISTS idx_lesson_access_lesson_time
  ON lesson_access_log (lesson_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_access_project_time
  ON lesson_access_log (project_id, accessed_at DESC);

-- Bootstrap salience from existing guardrail audit events.
-- A guardrail firing is exactly a "flashbulb memory" event — the kind of
-- biologically-salient moment we want the retriever to weight up. By seeding
-- access entries at the audit timestamps, the first A/B baseline run already
-- has signal rather than starting from a cold-zero.
--
-- `guardrail_audit_logs.rule_id` references the guardrail lesson in `lessons`
-- (guardrails are stored as lesson_type='guardrail'). Verified 2026-04-18:
-- 90 of 228 audit rows have a rule_id that resolves to an existing lesson.
INSERT INTO lesson_access_log (lesson_id, project_id, accessed_at, context, weight)
SELECT gal.rule_id, gal.project_id, gal.created_at, 'audit-bootstrap', 1.0
FROM guardrail_audit_logs gal
WHERE gal.rule_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM lessons l WHERE l.lesson_id = gal.rule_id);
