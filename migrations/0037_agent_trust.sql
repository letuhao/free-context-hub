-- 0037: Agent trust levels for review workflow

CREATE TABLE IF NOT EXISTS agent_trust_levels (
  agent_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  trust_level TEXT NOT NULL DEFAULT 'new' CHECK (trust_level IN ('new', 'standard', 'trusted')),
  auto_approve BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, project_id)
);
