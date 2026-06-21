-- Actor Data Boundary F2g / DEFERRED-049 (B2) — add `group` as a scope level in the grant lattice.
--
-- Wrapped in a single transaction by the migration runner (BEGIN/COMMIT per file, ROLLBACK on error).
--
-- Before this, a group was authorized as a `project` scope (pure string equality on the projects-table
-- row id), so a `project` grant and a same-named group collided. `group` becomes a PARALLEL leaf under
-- global: global ⊃ {project ⊃ topic ⊃ task, group}. A group grant covers ONLY that group's own
-- resources (its topology + group-shared lessons); it never reaches into member projects (membership is
-- knowledge-sharing, not scope nesting). Disjointness is enforced in scopeCovers via the discriminated
-- union (a group resource carries group_id, not project_id). See
-- docs/specs/2026-06-20-actor-data-boundary-F2g-DEFERRED-049-DESIGN.md.
--
-- INERT until the MCP_AUTH_ENABLED flip — authorize() short-circuits ALLOW while auth is OFF.

-- 1) Allow `group` in the scope_type CHECK (auto-named grants_scope_type_check). grants_scope_shape
--    already covers it (non-global ⇒ scope_id required).
ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_scope_type_check;
ALTER TABLE grants ADD CONSTRAINT grants_scope_type_check
  CHECK (scope_type IN ('global', 'project', 'topic', 'task', 'group'));

COMMENT ON COLUMN grants.scope_type IS
  'global | project | topic | task | group. global ⊃ project ⊃ topic ⊃ task; group is a parallel leaf under global (a group grant covers only that group). [DEFERRED-049]';

-- 2) Backfill (additive, non-lossy, idempotent). A pre-existing (project, <id that is a group>) grant
--    covered BOTH the project-row and the group under the old model; a group_id also doubles as a
--    lessons.project_id partition, so RECLASSIFYING could strip load-bearing project access. Instead
--    MIRROR each such active grant into a parallel (group, <id>) grant — preserving exactly the pre-flip
--    coverage. The namespace SPLIT then applies to all NEW grants; the two become separately revocable.
--
--    granted_by is re-attributed to the ACTIVE ROOT (the delegation-tree origin) rather than copied from
--    the source grant, whose granter may since have been RETIRED (principals are retired, not deleted, so
--    the FK ON DELETE RESTRICT would not catch it) — minting a fresh granted_at=now() edge under a
--    retired actor would corrupt the audit chain. COALESCE keeps the INSERT FK-safe if no root exists (in
--    which case there are no grants to mirror on a fresh DB anyway). [adv REVIEW-DESIGN #1]
--
--    On this repo the predicate matches ZERO rows (verified at build time) → this is a logged no-op.
--    RESOURCE capabilities only (read/write/admin). `delegate` is deliberately EXCLUDED: the model makes
--    project and group separately-revocable, disjoint namespaces, so re-grant authority over the NEW group
--    namespace must be granted explicitly — mirroring a delegate@project would silently hand a principal the
--    power to mint group grants it was never delegated. [adv REVIEW-CODE #2]
INSERT INTO grants (grantee_principal, scope_type, scope_id, capability, granted_by)
SELECT g.grantee_principal, 'group', g.scope_id, g.capability,
       COALESCE((SELECT principal_id FROM principals WHERE is_root = true AND status = 'active' LIMIT 1),
                g.granted_by)
  FROM grants g
 WHERE g.scope_type = 'project' AND g.revoked_at IS NULL
   AND g.capability <> 'delegate'
   AND EXISTS (SELECT 1 FROM project_groups pg WHERE pg.group_id = g.scope_id)
ON CONFLICT (grantee_principal, scope_type, scope_id, capability) WHERE revoked_at IS NULL
DO NOTHING;
