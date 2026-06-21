-- Actor Data Boundary F2g / DEFERRED-048 (full closure) — provenance for indexed filesystem roots.
--
-- Wrapped in a single transaction by the migration runner (BEGIN/COMMIT per file).
--
-- Pointing the worker at a filesystem path to index is a CROSS-TENANT, GLOBAL capability. The explicit
-- `payload.root` / `root` arg is gated at resolveProjectRoot, but the worker ultimately indexes whatever
-- is STORED in project_sources.repo_root / project_workspaces.root_path. So those stored paths get an
-- authorizer stamp: WHO (a globally-privileged principal) caused this path to be stored. resolveProjectRoot
-- re-verifies the stamp still holds global write at resolve time (catches a revoked authorizer, and a
-- pre-flip / auth-OFF row whose stamp is NULL → not honored under enforcement → operator re-authorizes).
--
-- INERT until MCP_AUTH_ENABLED flips: under auth-off the setters stamp null and resolveProjectRoot honors
-- stored paths as today.

ALTER TABLE project_sources
  ADD COLUMN IF NOT EXISTS repo_root_authorized_by UUID NULL REFERENCES principals(principal_id) ON DELETE SET NULL;
COMMENT ON COLUMN project_sources.repo_root_authorized_by IS
  'F2g/DEFERRED-048 — the principal who authorized this repo_root (a global-write principal). Set by configure_project_source / prepare_repo; re-verified at resolveProjectRoot under enforcement. NULL = unauthorized/legacy (auth-off) → not honored once auth is on.';

ALTER TABLE project_workspaces
  ADD COLUMN IF NOT EXISTS root_path_authorized_by UUID NULL REFERENCES principals(principal_id) ON DELETE SET NULL;
COMMENT ON COLUMN project_workspaces.root_path_authorized_by IS
  'F2g/DEFERRED-048 — the principal who authorized this workspace root_path (a global-write principal). Set by register_workspace_root; re-verified at resolveProjectRoot under enforcement. NULL = unauthorized/legacy → not honored once auth is on.';
