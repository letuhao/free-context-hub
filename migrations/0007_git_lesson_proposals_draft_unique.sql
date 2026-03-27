-- Backfill for existing databases: ensure idempotent draft proposal upsert key exists.

CREATE UNIQUE INDEX IF NOT EXISTS uq_git_lesson_proposals_draft_per_commit
  ON git_lesson_proposals(project_id, source_commit_sha)
  WHERE status = 'draft' AND source_commit_sha IS NOT NULL;

