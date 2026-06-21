# DEFERRED-049 — DESIGN (A2 + B2 + redact)

**Date:** 2026-06-20 · **Size:** XL · auth OFF (every new gate short-circuits via AUTH_DISABLED / `hasGlobalGrant`).
**Safety-sensitive:** adds a scope level to the authorization lattice → cold-start adversary at REVIEW-DESIGN + REVIEW-CODE.

## The model: `group` is its own scope level

Today the lattice is `global ⊃ project ⊃ topic ⊃ task` and a group is authorized as `{kind:'project', id:group_id}`
— pure string equality, so a `project` grant and a same-named group collide. B2 makes **`group` a parallel leaf
under global**: `global ⊃ {project ⊃ topic ⊃ task, group}`. A group is NOT an ancestor of its member projects
(membership is a knowledge-sharing relation, not scope nesting) — so a `group` grant covers ONLY that group's own
resources (its topology + group-shared lessons), never the member projects.

Disjointness is by **discriminated union**: a `group` ResourceScope carries `group_id` and NO `project_id`; a
`project` ResourceScope carries `project_id` and NO `group_id`. So `scopeCovers` for a `project` grant tests
`grant.scope_id === resource.project_id` → `undefined` for a group resource → never matches (and vice-versa).
`global` still covers everything.

### Changes to `src/services/authorize.ts`
- `ResourceScope`: add `| { kind: 'group'; group_id: string }`.
- `ResourceRef.kind`: add `'group'`.
- `resolveResourceScope`: `if (ref.kind === 'group') return { ok: { kind: 'group', group_id: id } }` — trusts the
  id with NO existence check (mirrors `project`, so authorizing a not-yet-created group in `createGroup` works).
- `scopeCovers`: add `case 'group': return resource.kind === 'group' && grant.scope_id === resource.group_id;`
  and ensure `case 'project'` only matches a `project`/`topic`/`task` resource (it already keys on
  `resource.project_id`, which a group resource lacks — explicit `resource.kind` guard added for clarity).

### Changes to `src/services/grants.ts`
- `ScopeType`: add `'group'`; `SCOPE_TYPES` array gains `'group'`. `normalizeScope` then accepts it (requires a
  scope_id, like project/topic/task). `grantCapability`/`revokeGrantAuthorized` pass `kind: scope_type` straight
  through → `'group'` flows as a ResourceRef kind with no further change.

### Migration `0070_group_scope_type.sql`
- Drop + recreate the `grants.scope_type` CHECK to include `'group'` (constraint is auto-named
  `grants_scope_type_check`; `ALTER TABLE … DROP CONSTRAINT IF EXISTS … ADD CONSTRAINT … CHECK (scope_type IN
  ('global','project','topic','task','group'))`). `grants_scope_shape` already covers `'group'` (non-global ⇒ id).
- **Backfill (additive, non-lossy, idempotent) — EXACT SQL [adv REVIEW-DESIGN #1]:**
  ```sql
  INSERT INTO grants (grantee_principal, scope_type, scope_id, capability, granted_by)
  SELECT g.grantee_principal, 'group', g.scope_id, g.capability,
         COALESCE((SELECT principal_id FROM principals WHERE is_root = true AND status = 'active' LIMIT 1),
                  g.granted_by)
    FROM grants g
   WHERE g.scope_type = 'project' AND g.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM project_groups pg WHERE pg.group_id = g.scope_id)
  ON CONFLICT (grantee_principal, scope_type, scope_id, capability) WHERE revoked_at IS NULL DO NOTHING;
  ```
  Predicate is **`EXISTS project_groups`** (a project id that is also a group) — NOT "all project grants".
  `granted_by` is re-attributed to the **active root** (the delegation-tree origin) rather than copying the
  original grant's granter, which may since have been *retired* (principals are retired, not deleted, so the
  FK wouldn't catch it) — fabricating a fresh `granted_at=now()` edge under a retired actor would corrupt the
  audit chain. `COALESCE(... , g.granted_by)` keeps the INSERT FK-safe if no root exists (in which case there
  are no grants to mirror anyway on a fresh DB). Mirrors `delegate` grants too (they covered the group under
  the old model). Rationale for mirror-not-reclassify: a `(project,<group-id>)` grant covered BOTH the
  project-row and the group; a group_id doubles as a `lessons.project_id` partition, so reclassifying could
  STRIP load-bearing project access. Mirroring preserves exactly the pre-flip coverage; the namespace SPLIT
  applies to all NEW grants. The two become separately revocable (documented behavior change). Expected to be
  a **no-op on this solo repo** (verified in BUILD by querying the predicate); the fact is logged either way.

## A2 — `resolveProjectIds` self-defends
`resolveProjectIds(projectId, includeGroups, actingPrincipalId?)`:
- auth-off → `authorize` short-circuits ALLOW → returns `[projectId, ...allGroups]` (today's behavior, unchanged).
- `assertAuthorized(actingPrincipalId, 'read', {kind:'project', id: projectId})` — the caller's OWN entry project;
  denial is a real error → **throw** (NOT_FOUND/FORBIDDEN), consistent with the existing consumers which already
  re-authorize the entry id as `projectIds[0]` / the guardrails loop's first iteration. [adv #3]
- for each group the project belongs to: keep it if the caller can read it **at the lessons boundary** —
  `read@group(id) OR read@project(id)` (see the union rule below; a group_id legitimately doubles as a lessons
  partition). Unreadable/foreign groups are silently dropped (best-effort enrichment, matching today's
  graceful-skip). Returns `[projectId, ...readableGroupIds]` — **safe to feed directly into `= ANY($1)`**.
- **[adv #3] Plumbing contract:** all 4 call sites (REST lessons.ts:81, MCP index.ts:1472, REST guardrails.ts:46,
  MCP index.ts:1813) thread the REAL acting principal (`callerPrincipalOf(req)` / `actingPrincipalId`). Under
  auth-ON an unplumbed `undefined` → null principal → `NO_PRINCIPAL` deny → throw — i.e. a missing-plumbing bug
  fails LOUD (fail-closed), never a silent broaden. A test asserts each site passes a non-undefined principal
  under auth-ON.

## Lessons-read namespace soundness (the A2×B2 seam) — a deliberate UNION [adv REVIEW-DESIGN #2]
`searchLessonsMulti(projectIds, …)` re-authorizes each id. The naive "classify each id as group-XOR-project and
authorize as that one kind" is WRONG for a **both-namespace** row: a group ALWAYS has a `projects` row, and a
group_id is also a `lessons.project_id` partition for group-shared lessons. Classifying as group-only would
(a) strip a legacy `read@project` holder's access (availability regression) and (b) hand the rows to any
`read@group` holder who never had project read. Collision-reject only makes NEW ids single-kind; legacy rows can
be both.
**Rule (lessons-read surface ONLY):** an id's lessons are readable iff `read@project(id) OR read@group(id)`. This
is a deliberate, documented READ union — the id is a *data partition*, and lesson data under an id is that id's
data in whichever namespace(s) it occupies. It preserves all legacy project-read access AND enables group-sharing
(a group read grant suffices for group-shared lessons). Implementation: `authorize(read,{project,id})`; on deny,
`authorize(read,{group,id})`; allow if either. Applies uniformly to the resolver's group ids, the explicit
`project_ids`, and the explicit `group_id` search inputs.
**The union is NOT applied to group TOPOLOGY** (`getGroup` / `listGroupMembers` / `member_count` / add/remove) —
those stay STRICT `{kind:'group'}` (group composition is the sensitive cross-project structure B2 protects). So
the split lands exactly where it matters (topology) while shared knowledge (lessons) stays reachable as designed.

## B1-within-B2 — `createGroup` collision-reject
`createGroup` must not silently `ON CONFLICT (project_id) DO UPDATE` over an existing NON-group project row. New
logic: if a `projects` row with `group_id` already exists AND it is NOT already a group (no `project_groups` row),
reject `BAD_REQUEST` ("id already names a project; choose another group id"). If it IS already a group, the
`DO UPDATE` (rename/describe) is the legitimate idempotent update. Symmetrically `createProject` already throws on
an existing id (23505) — verify it also rejects a group id (a group has a `projects` row, so the INSERT hits
23505 → already rejected; add a test to pin it).

## Sub-issue 0 — `listGroups` redact `member_count`
`listGroups(actingPrincipalId?)`: keep returning the full name catalog (the dropdown needs it), but set
`member_count = null` for any group the caller lacks a covering grant on. Implementation: fetch rows, then for
each `authorize(read, {kind:'group', id})` — null the count on deny. auth-off → all counts visible (unchanged).
`ProjectGroupWithMembers.member_count` becomes `number | null`. The 2 callers (`GET /api/groups`, MCP
`list_project_groups`) thread the acting principal.

## Acceptance criteria
1. `scopeCovers`: a `project` grant does NOT cover a `group` resource and vice-versa; `global` covers `group`;
   a `group` grant covers its `group` by id. (pure unit tests, no DB.)
2. `resolveProjectIds` (auth-on): a caller with read on entry but NOT on a foreign group gets `[entry]` only;
   with read on the group gets `[entry, group]`; no read on entry → throws.
3. `createGroup` rejects a collision with an existing non-group project (no name mutation of the victim); an
   idempotent update of an existing group still works.
4. `searchLessonsMulti` lessons-read UNION: a `read@group(id)` grant suffices for a group id's lessons, AND a
   legacy `read@project(id)` holder still reads them (both-namespace row, no availability regression); a grant on
   a DIFFERENT id covers neither. Group TOPOLOGY ops (member_count/members) require strict `{kind:'group'}`.
5. `listGroups` nulls `member_count` for callers without a strict `read@group` grant (member_count is topology);
   names still listed.
6. Migration applies; backfill mirrors any active project→group grant (or no-ops + logs zero). Existing grants’
   effective access is unchanged across a hypothetical flip.
7. auth-OFF behavior fully unchanged. Full unit suite green, tsc clean. `MCP_AUTH_ENABLED` NOT touched.

## Out of scope / deferred
- Topic/task under a group (groups stay leaf). - Per-member-project authorization of group membership beyond the
  existing write@{project,group} on add/remove. - The `MCP_AUTH_ENABLED` flip itself.
