# DEFERRED-049 — CLARIFY: resolveProjectIds resolver authz + project/group id-namespace conflation

**Date:** 2026-06-20 · **Branch:** `feature/actor-data-boundary` · **Size:** L (no skips) ·
**Status:** auth OFF (inert today); a F2g `MCP_AUTH_ENABLED`-flip prerequisite. **NOT live-exploitable today.**

## What the code actually does (verified, not assumed)

Three sub-issues, from the DEFERRED-046 adversary + `/review-impl` passes:

### 0. `listGroups` is unguarded (catalog metadata)
`listGroups()` (projectGroups.ts:74) has **no** `assertAuthorized` and returns `member_count` for ALL
groups cross-tenant. Backs `GET /api/groups` + MCP `list_project_groups` (the GUI group dropdown). The
per-group reads `getGroup` / `listGroupMembers` ARE gated on `read@group` (commit 8aa736f). The in-code
comment already documents it as "accepted shared-pool catalog metadata." Open question: is `member_count`
sensitive enough to filter/redact per-caller, or is the catalog legitimately shared-pool?

### 1. `resolveProjectIds` is not authz-aware — but no live leak
`resolveProjectIds(projectId, includeGroups)` (projectGroups.ts:370) folds a project's group ids into a
scope array `[projectId, ...groupIds]` with **no** authz. **Verified: every current consumer re-authorizes
each returned id**, so there is no live transitive leak:
- `searchLessonsMulti` (lessons.ts:1345-1346) loops `assertAuthorized(read, {project, id})` over every id.
- The two `search_lessons` callers (REST lessons.ts:89, MCP index.ts:1481) feed `searchLessonsMulti` → covered.
- The two `check_guardrails include_groups` callers (REST guardrails.ts:58, MCP index.ts:1819) loop
  `checkGuardrails(pid, …)` per id and **graceful-skip on NOT_FOUND** (authorize denies → NOT_FOUND).

**The risk is structural, not live:** the defense lives in the N consumers, not the resolver. A FUTURE
consumer that passes the expanded array straight into a `= ANY($1)` query without per-id authz reopens a
transitive cross-scope read. (Documented verbatim in the deferred.)

### 2. project/group id-namespace conflation
A group **is** a `projects`-table row (`createGroup` INSERTs into `projects` AND `project_groups`).
Authorization matches by pure string equality: `scopeCovers` (authorize.ts:90) →
`grant.scope_type==='project' && grant.scope_id === resource.project_id`. So:
- a grant on a **project** `acme` also covers a **group** `acme` (and vice-versa) — same row, same string;
- `createGroup`'s `ON CONFLICT (project_id) DO UPDATE SET name=…` (projectGroups.ts:37) can silently
  rename/take-over an existing `projects` row whose id collides with the new group id.

**Mitigating facts:** creating a group `acme` already requires `write@{project, id:acme}` (createGroup
authorizes first), so you cannot mint a colliding group without already holding authority on that id. ids
are admin-assigned. So this is a **soundness/modeling gap**, low practical risk — the `kind:'project'`-for-group
choice (DEFERRED-046) surfaced it.

## The two decisions for you

### Decision A — `resolveProjectIds` hardening (sub-issue 1)
- **A1 — Contract + guard test only (lighter).** Leave the resolver as pure data; add a doc-contract
  ("callers MUST re-authorize each returned id") + a test asserting all current consumers do. resolver
  unchanged; 0 consumer files touched.
- **A2 — Resolver self-defends (stronger, recommended).** Thread `actingPrincipalId` into
  `resolveProjectIds`; it authorizes `read` on the entry project (fail-closed) and **filters the returned
  group ids to those the caller can read**. Future naive consumers are safe by construction. Behavior-preserving
  for today's consumers (they already drop unreadable ids). Touches resolver + 3 consumer call sites.

### Decision B — namespace discriminator (sub-issue 2)
- **B1 — Minimal: collision-reject + EXISTS discriminator (recommended).** `createGroup` rejects when the
  `project_id` already exists in `projects` but is NOT already a group (no silent `DO UPDATE` takeover);
  "is this id a group?" is derived by `EXISTS (project_group_members/project_groups)` — no schema change,
  no lattice change. Closes the takeover vector; leaves the project-grant-covers-same-named-group equivalence
  as an accepted consequence of "a group is a project row" (creation is already gated).
- **B2 — Full: `group` scope_type in the grant lattice (heaviest).** Add a `group` scope level to
  `scope_type`, `scopeCovers`, grant validation + a migration, so a project grant and a group grant are
  never string-equal. Substantial authz-core change + migration + backfill of existing group grants. **L→XL.**
  Given creation is already gated and ids are admin-assigned, the added safety is marginal vs the blast radius.

### Sub-issue 0 (`listGroups`) — folds into the above
Recommend: **keep the catalog shared-pool, redact `member_count` to callers with no covering grant** (cheap,
removes the only arguably-sensitive field) OR keep fully open + firm the doc. I'll fold whichever you prefer
into the same pass.

## Recommendation
**A2 + B1** (+ redact `member_count`): closes the structural resolver risk and the silent-takeover vector
with no authz-lattice surgery or migration, stays behavior-preserving, and is honestly L (not XL). B2 is
available if you want the namespace split modeled formally, but it's a large authz-core change for a gap that
creation-gating already largely contains.

## Acceptance criteria
1. `resolveProjectIds` (if A2) fails closed on the entry project and returns only caller-readable group ids;
   a guard test proves a scoped caller gets `[ownProject]` not foreign groups (auth-on).
2. `createGroup` (B1) rejects a collision with an existing non-group project (test: FORBIDDEN/BAD_REQUEST, no
   name mutation of the victim row).
3. `listGroups` member_count handled per the chosen option; test.
4. Auth-OFF behavior unchanged (all new gates short-circuit via `hasGlobalGrant`/AUTH_DISABLED). Full suite green, tsc clean.
5. `MCP_AUTH_ENABLED` flip NOT touched.
