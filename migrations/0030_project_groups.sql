-- Project Groups: many-to-many relationship between projects.
-- A project can belong to multiple groups or none.
-- Groups own shared lessons (lessons stored with project_id = group_id).

CREATE TABLE IF NOT EXISTS project_groups (
  group_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_group_members (
  group_id   TEXT NOT NULL REFERENCES project_groups(group_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(project_id)     ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, project_id)
);

-- Fast lookup: "which groups does project X belong to?"
CREATE INDEX IF NOT EXISTS idx_pgm_project ON project_group_members(project_id);
