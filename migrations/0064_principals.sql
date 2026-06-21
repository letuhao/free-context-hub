-- Actor Data Boundary F1 — identity substrate (principals + api_keys binding).
--
-- Wrapped in a single transaction by the migration runner
-- (src/db/applyMigrations.ts — BEGIN/COMMIT per file, ROLLBACK on error).
--
-- The principal is the single subject of every action — it replaces the *asserted*
-- actor_id string that MCP/REST callers currently send in payloads. A credential
-- (api_keys row) authenticates TO a principal; the principal is what gets authorized.
-- See docs/specs/2026-06-19-actor-data-boundary-FOUNDATION.md and -mcp-fe-design.md §1.

-- A. principals — opaque identity. principal_id is UUID (codebase convention; the spec's
--    "ULID" label means opaque/un-spoofable/never-human-typed, all of which UUID satisfies).
CREATE TABLE IF NOT EXISTS principals (
  principal_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'system')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'retired')),
  display_name  TEXT NOT NULL,
  -- is_root: the one seeded out-of-band trust anchor (F1). Set ONLY by the bootstrap path;
  -- never exposed as a grantable field in any API. The partial unique index below enforces
  -- "at most one root" — it is a guarded marker, not a privilege you can grant.
  is_root       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE principals IS
  'Actor Data Boundary F1 — the single subject of every action. Replaces asserted actor_id. A credential authenticates to a principal; the principal is authorized.';
COMMENT ON COLUMN principals.kind IS
  'human | agent | system — an ATTRIBUTE, not the authz axis (FOUNDATION line 4). The axis is delegated role/scope (F2).';
COMMENT ON COLUMN principals.status IS
  'active | suspended | retired — suspended/retired => all authorize() deny (F2).';
COMMENT ON COLUMN principals.is_root IS
  'The one out-of-band trust anchor (FOUNDATION line 1). Set only by bootstrap:root; never grantable. Partial unique index enforces at most one.';

-- At most one root principal across the deployment.
CREATE UNIQUE INDEX IF NOT EXISTS principals_single_root_uniq
  ON principals (is_root) WHERE is_root = true;

-- B. api_keys.principal_id — bind a credential to its principal. Nullable: legacy/env-token
--    keys (and pre-F1 rows) stay NULL for back-compat; auth-off resolves to root/dev separately.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS principal_id UUID NULL REFERENCES principals(principal_id) ON DELETE RESTRICT;
COMMENT ON COLUMN api_keys.principal_id IS
  'Actor Data Boundary F1 — the principal this credential authenticates to. NULL = legacy/env-token key (pre-F1). ON DELETE RESTRICT: revoke keys before retiring a principal.';

CREATE INDEX IF NOT EXISTS api_keys_principal_idx ON api_keys (principal_id) WHERE principal_id IS NOT NULL;
