# DEFERRED-049 — PLAN (A2 + B2 + redact)

XL · TDD where logic, build+verify where schema. auth OFF. Each task: file, intent, verify.

## T1 — `group` in the grants type layer (no DB yet)
- `src/services/grants.ts`: `ScopeType` += `'group'`; `SCOPE_TYPES` array += `'group'`. `normalizeScope`
  needs no change (any non-global requires an id). 
- Verify: `npx tsc --noEmit` clean.

## T2 — `group` in the authorization lattice (pure core, TDD)
- RED: extend `src/services/authorize.pure.test.ts` — a `project` grant does NOT cover `{kind:'group',group_id}`;
  a `group` grant covers its group by id, not a different id; `global` covers a group; a `group` grant does NOT
  cover a `project`/`topic`/`task` resource.
- GREEN: `src/services/authorize.ts` — `ResourceScope` += `{kind:'group';group_id}`; `ResourceRef.kind` += `'group'`;
  `scopeCovers` add `case 'group'` + keep `case 'project'` keyed on `resource.project_id` (group resource lacks it);
  `resolveResourceScope` add `if (ref.kind==='group') return {ok:{kind:'group',group_id:id}}` (no existence check).
- Verify: `npx tsx --test src/services/authorize.pure.test.ts src/services/authorize.test.ts`.

## T3 — migration 0070 + backfill
- `migrations/0070_group_scope_type.sql`: `ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_scope_type_check`,
  then `ADD CONSTRAINT grants_scope_type_check CHECK (scope_type IN ('global','project','topic','task','group'))`;
  then the exact backfill INSERT…SELECT from DESIGN (EXISTS project_groups predicate, granted_by→active root via
  COALESCE, ON CONFLICT DO NOTHING).
- Verify: query the predicate count BEFORE (`SELECT count(*) FROM grants g WHERE scope_type='project' AND
  revoked_at IS NULL AND EXISTS(SELECT 1 FROM project_groups pg WHERE pg.group_id=g.scope_id)`), apply
  `npx tsx src/db/migrate.ts`, confirm CHECK accepts a `group` grant insert + the constraint name.

## T4 — `createGroup` collision-reject (TDD)
- RED: new test `src/services/groups-namespace-authz.test.ts` — `createGroup` on an id that is an existing
  NON-group project → BAD_REQUEST, victim row name unchanged; `createGroup` idempotent-update of an existing
  group still OK; `createProject` on an existing group id → BAD_REQUEST (23505 path).
- GREEN: `src/services/projectGroups.ts createGroup` — before the upsert, `SELECT` whether `group_id` exists in
  `projects` and whether in `project_groups`; if in projects but NOT a group → throw BAD_REQUEST (no DO UPDATE).
- Verify: `npx tsx --test src/services/groups-namespace-authz.test.ts`.

## T5 — `resolveProjectIds` A2 + lessons-read union (TDD)
- GREEN: `src/services/projectGroups.ts resolveProjectIds(projectId, includeGroups, actingPrincipalId?)` —
  assertAuthorized read@project entry (throw on deny); per group keep if `authorize(read,{project,id}).allow ||
  authorize(read,{group,id}).allow`. Export a small helper `canReadLessonsPartition(principalId, id)` reused by T6.
- `src/services/lessons.ts searchLessonsMulti` — replace the per-id `assertAuthorized(read,{project,id})` loop with
  the union: allow id if `read@project(id) OR read@group(id)`; deny → throw NOT_FOUND as today (so the guardrails/
  search graceful-skip still works). Keep the dedupe.
- RED first: `src/services/groups-namespace-authz.test.ts` adds — scoped caller with read on entry + a group →
  resolveProjectIds returns `[entry,group]`; read on entry only (foreign group) → `[entry]`; no read on entry →
  throws; searchLessonsMulti: a `read@group` grant returns a group's lessons; a grant on a different id does not.
- Verify: `npx tsx --test src/services/groups-namespace-authz.test.ts src/services/lessons-authz.test.ts`.

## T6 — thread actingPrincipalId into the 4 resolveProjectIds call sites
- `src/api/routes/lessons.ts:81`, `src/api/routes/guardrails.ts:46`, `src/mcp/index.ts:1472`, `:1813` — pass
  `callerPrincipalOf(req)` / `actingPrincipalId` as the 3rd arg.
- Verify: tsc clean; grep confirms no remaining 2-arg `resolveProjectIds(` in non-test code.

## T7 — `listGroups` redact member_count (TDD)
- GREEN: `src/services/projectGroups.ts listGroups(actingPrincipalId?)` — after fetching, for each row
  `authorize(read,{kind:'group',id})`; on deny set `member_count = null`. Type `member_count: number | null`.
  auth-off → all visible.
- `src/api/routes/projectGroups.ts` (GET /api/groups) + `src/mcp/index.ts` (list_project_groups) thread the
  principal.
- RED: test — non-grant caller sees the group name but `member_count === null`; grant caller sees the count;
  auth-off sees the count.
- Verify: `npx tsx --test src/services/groups-namespace-authz.test.ts`.

## T8 — package.json + full suite
- Add `src/services/groups-namespace-authz.test.ts` to the test list.
- Verify: full `npm test` + `npx tsc --noEmit` clean.

## T9 — REVIEW-CODE cold-start adversary (safety-sensitive), fix, re-verify; then POST-REVIEW human gate.
