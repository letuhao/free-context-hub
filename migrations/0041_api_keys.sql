-- 0041: API keys for role-based access control

CREATE TABLE IF NOT EXISTS api_keys (
  key_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,              -- first 12 chars of the key (for display: chub_sk_...xxxx)
  key_hash     TEXT NOT NULL UNIQUE,       -- SHA-256 hash of the full key
  role         TEXT NOT NULL DEFAULT 'writer' CHECK (role IN ('admin', 'writer', 'reader')),
  project_scope TEXT,                      -- NULL = all projects, or specific project_id
  expires_at   TIMESTAMPTZ,               -- NULL = never expires
  last_used_at TIMESTAMPTZ,
  revoked      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash) WHERE revoked = false;
