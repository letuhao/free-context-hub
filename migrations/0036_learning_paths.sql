-- 0036: Learning paths for onboarding

CREATE TABLE IF NOT EXISTS learning_paths (
  path_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  section TEXT NOT NULL,
  lesson_id UUID NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_paths_project ON learning_paths(project_id, section, sort_order);

CREATE TABLE IF NOT EXISTS learning_progress (
  user_id TEXT NOT NULL,
  path_id UUID NOT NULL REFERENCES learning_paths(path_id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path_id)
);
