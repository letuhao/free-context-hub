-- Phase 3: lesson intelligence + lifecycle columns

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS quick_action TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS superseded_by UUID;

-- Backfill constraint: only allow known statuses.
ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_status_check;
ALTER TABLE lessons
  ADD CONSTRAINT lessons_status_check
  CHECK (status IN ('draft', 'active', 'superseded', 'archived'));

ALTER TABLE lessons
  ADD CONSTRAINT lessons_superseded_by_fk
  FOREIGN KEY (superseded_by) REFERENCES lessons(lesson_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lessons_project_status ON lessons(project_id, status);
