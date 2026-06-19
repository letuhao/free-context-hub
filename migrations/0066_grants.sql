-- Actor Data Boundary F2 — delegation grants (the data boundary made of rows).
--
-- Wrapped in a single transaction by the migration runner
-- (src/db/applyMigrations.ts — BEGIN/COMMIT per file, ROLLBACK on error).
--
-- A grant is one edge of the delegation tree: principal `grantee_principal` holds `capability` over
-- everything at-or-below `scope`. authorize(principal, action, resource) = ∃ active grant whose
-- capability covers the action AND whose scope covers the resource (F2b). Root is the origin of the
-- tree and short-circuits authorize() — it needs no grant row. See
-- docs/specs/2026-06-19-actor-data-boundary-mcp-fe-design.md §1 and -F2-clarify.md.
--
-- INERT until F2f wires authorize() into the handlers; creating this table changes no runtime
-- behavior. grant_id is UUID (codebase convention, per F1) — the spec's "ULID" means opaque/ordered,
-- which gen_random_uuid satisfies for our purposes.

CREATE TABLE IF NOT EXISTS grants (
  grant_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  grantee_principal UUID        NOT NULL REFERENCES principals(principal_id) ON DELETE CASCADE,
  -- scope = (scope_type, scope_id): global has NO id; project/topic/task carry the resource id.
  scope_type        TEXT        NOT NULL CHECK (scope_type IN ('global', 'project', 'topic', 'task')),
  scope_id          TEXT,
  capability        TEXT        NOT NULL CHECK (capability IN ('read', 'write', 'admin', 'delegate')),
  -- granted_by = the delegator (root = origin). ON DELETE RESTRICT: a principal that granted authority
  -- cannot be hard-deleted out from under the audit chain (retire it instead).
  granted_by        UUID        NOT NULL REFERENCES principals(principal_id) ON DELETE RESTRICT,
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,                    -- NULL = active
  -- global ⇒ no scope_id; every other scope ⇒ a scope_id. Enforced so coverage logic never has to
  -- reason about a malformed (global, <id>) or (project, NULL) row.
  CONSTRAINT grants_scope_shape CHECK (
    (scope_type = 'global' AND scope_id IS NULL) OR
    (scope_type <> 'global' AND scope_id IS NOT NULL)
  )
);

COMMENT ON TABLE grants IS
  'Actor Data Boundary F2 — delegation edges. authorize() = ∃ active grant covering (action, resource). Root short-circuits and needs no row.';
COMMENT ON COLUMN grants.capability IS
  'read ⊂ write ⊂ admin (each covers the ones before); delegate is orthogonal (re-grant a subset of own authority).';
COMMENT ON COLUMN grants.scope_type IS
  'global | project | topic | task. A scope covers a resource at-or-below it (global ⊃ project ⊃ its topics/tasks).';

-- authorize() hot path: all ACTIVE grants for a grantee.
CREATE INDEX IF NOT EXISTS grants_grantee_active_idx
  ON grants (grantee_principal) WHERE revoked_at IS NULL;

-- list_grants by scope.
CREATE INDEX IF NOT EXISTS grants_scope_idx
  ON grants (scope_type, scope_id) WHERE revoked_at IS NULL;

-- At most ONE active grant per (grantee, scope, capability) — makes createGrant idempotent and keeps
-- the tree a set of edges, not a multiset. NULLS NOT DISTINCT so two global grants for the same
-- grantee+capability collide (scope_id is NULL for global). [PG15+, same pattern as 0050]
CREATE UNIQUE INDEX IF NOT EXISTS grants_active_edge_uniq
  ON grants (grantee_principal, scope_type, scope_id, capability) NULLS NOT DISTINCT
  WHERE revoked_at IS NULL;
