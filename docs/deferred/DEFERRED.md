# Deferred Items

<!-- Managed by Scribe. Do not edit manually. -->
<!-- Next ID: 055 -->

## DEFERRED-054

- **Title:** F2g/DEFERRED-048 — suspending the system principal nulls authorization for every root it stamped
- **Status:** **RESOLVED (2026-06-21)** — `setPrincipalStatus` (principals.ts) now guards `is_system = false`
  alongside `is_root = false`, so the singleton worker identity cannot be suspended/retired through the normal
  path (a typed CONFLICT explains rotation = explicit delete+reseed). Test in `system-identity-authz.test.ts`.
  Part of the F2g-flip least-privilege batch (051-054). OPEN write-up:
- **Context:** under enforcement a stored `repo_root` / `root_path` is honored only if its
  `*_authorized_by` stamp still `hasGlobalGrant`. If the dedicated system principal (which stamps the
  worker's own prepared roots) is suspended/retired, `hasGlobalGrant` returns false for it, so EVERY root
  it authorized stops resolving at once → the index/embed/knowledge pipeline breaks worker-wide. This is
  fail-CLOSED (secure, not a leak) but an availability fragility: `setPrincipalStatus` protects `is_root`
  from suspension but not `is_system`. Mirrors DEFERRED-053's least-privilege theme (the system principal
  is a singleton load-bearing identity that needs the same guardrails as root).
- **Scope when picked up:** protect `is_system` status the way `is_root` is protected (refuse to suspend
  the last active system principal, or require an explicit `--force`), and/or have the flip's runbook
  re-stamp via a fresh global principal before retiring the old one.
- **Trigger:** the `MCP_AUTH_ENABLED` flip's least-privilege / runbook pass, or any system-principal rotation.

## DEFERRED-053

- **Title:** F2g — `hasUsableSystemIdentity` ensures write EXISTS but does not forbid a hand-granted admin
- **Status:** **RESOLVED (2026-06-21)** — `hasUsableSystemIdentity` (bootstrap.ts) now also requires the
  system principal hold NO active grant beyond the single `global write` (`NOT EXISTS` clause), so a
  hand-granted admin/delegate fails enforce-ready. **Flip-runbook note:** a deployment whose system principal
  carries extra grants will fail enforce-ready (the worker refuses to start) until trimmed to exactly
  global-write. Test in `system-identity-authz.test.ts`. Part of the 051-054 batch. OPEN write-up:
- **Context:** `hasUsableSystemIdentity` (src/services/bootstrap.ts) was tightened to require the system
  principal hold a `global write` grant EXACTLY (not `admin`), so an admin-only system principal is not
  accepted as ready. But it does not also assert the system principal LACKS a broader (admin/delegate/
  global) grant. Bounded-ness is guaranteed at CREATION (bootstrapSystem only ever grants `write`), so the
  supported flow stays bounded (proven by the admin/delegate-DENY test); an operator who manually grants
  the system principal admin takes an explicit privileged action outside the gate's scope.
- **Scope when picked up:** the flip's least-privilege pass should audit the system principal's grants and
  refuse enforce-ready (or warn) if it holds anything beyond the single `global write`.
- **Trigger:** the `MCP_AUTH_ENABLED` flip's least-privilege review.

## DEFERRED-052

- **Title:** F2g — `loadLeafBodiesFromDb` is an unguarded raw read of `generated_documents`
- **Status:** **RESOLVED (2026-06-21)** — `loadLeafBodiesFromDb` (builderMemoryLarge.ts) now threads
  `actingPrincipalId` and `assertAuthorized(read, {project})` before its raw `generated_documents` read (it was
  the first, unguarded DB op of a resumed build). Both `buildLargeRepoProjectMemory` call sites in jobExecutor
  pass the principal (verified), so the worker's resume path is unaffected. Construction-verified (private
  worker-only). Part of the 051-054 batch. OPEN write-up:
- **Context:** `loadLeafBodiesFromDb` (src/services/builderMemoryLarge.ts:~205) issues a raw
  `SELECT … FROM generated_documents` with NO `assertAuthorized`. It is called only by
  `buildLargeRepoProjectMemory` (the background worker, system principal, reading its OWN run's leaves),
  so it is not caller-exposed — but it would bypass authorization if ever invoked from a request path.
- **Scope when picked up:** add a project read guard (thread `actingPrincipalId`) if this helper is ever
  reused outside the worker, or document it as worker-internal-only.
- **Trigger:** if `loadLeafBodiesFromDb` is reused from a request/MCP path, or the flip's authz audit.

## DEFERRED-051

- **Title:** F2g — `runJobById` gate runs AFTER claim (claims-then-strands a job on denial)
- **Status:** **RESOLVED (2026-06-21)** — `runJobById` (jobExecutor.ts) now peeks the job's `project_id` with
  a non-claiming SELECT and authorizes BEFORE `claimQueuedJobById`, so a denied caller no longer strands the job
  in `running` (it stays `queued`). Test asserts the not-stranded invariant in `system-identity-authz.test.ts`.
  Part of the 051-054 batch. OPEN write-up:
- **Context:** `runJobById` (src/services/jobExecutor.ts) claims the job (`claimQueuedJobById` → marks it
  `running`) BEFORE its authorization gate throws, so a denied caller leaves the job stranded in `running`
  rather than requeued. `runJobById` is invoked ONLY by the worker (system principal, never denied), so
  this is latent. (`runNextJob` gates before claiming; `runJobById` can't trivially, since it needs the
  claimed job's `project_id` to gate on.)
- **Scope when picked up:** peek the job's `project_id` (or claim under a savepoint and roll back the claim
  on denial) so a denied by-id execute does not strand the job.
- **Trigger:** if `runJobById` gains a non-worker (non-global) caller, or the flip's authz audit.

## DEFERRED-050

- **Title:** F2f — user-scoped notification list/mark needs user-identity isolation (not project authz)
- **Status:** **RESOLVED (2026-06-21)** — closed WITHOUT a new substrate. The deferred assumed a missing
  user↔principal model, but F1's principal IS the human identity (every request carries it via
  `callerPrincipalOf`), and the `notifications` table is dormant (`createNotification` has zero callers). Fix
  (D2): new `notificationUserOf(req) = callerPrincipalOf(req) ?? 'gui-user'`; all 4 `/api/notifications*`
  handlers derive the user from it and **ignore any request-supplied `user_id`** (the isolation hole);
  `listNotifications` additionally filters the `activity_log` JOIN to projects the principal can `read`
  (defense-in-depth) with `unread_count` over the visible set. auth-OFF → `'gui-user'` fallback (GUI +
  existing settings rows unchanged). Reviews: 2-stage self-review + `/review-impl` (no HIGH/MED; verified
  bearerAuth gates the routes, no MCP surface, mark-read fenced by `user_id=principal`; LOWs documented:
  env-token/unbound → shared bucket, createNotification principal-id contract). Tests:
  `notifications-authz.test.ts` (4). No migration. Original write-up:
- ~~OPEN~~ MED. Split from DEFERRED-047 (read-sweep). F2g-flip item.
- **Context:** `activity.listNotifications` / `markNotificationsRead` (src/services/activity.ts) and their
  `/api/notifications` routes are keyed by a caller-supplied `user_id` with no check. `listNotifications`
  JOINs `activity_log` and returns `a.project_id / title / detail / actor` — so passing `user_id=<victim>`
  leaks activity metadata for projects the caller has no grant on, and `markNotificationsRead` mutates
  another user's unread state. This is USER isolation (the authenticated principal must equal the
  requested user), a different axis than the project/tenant authz the read-sweep covered — so it was not
  fixed there. The project-keyed `notification_settings` handlers WERE fixed (commit 8aa736f).
- **Scope when picked up:** derive `user_id` from the authenticated principal (never the request), and/or
  filter the `activity_log` join to projects the principal can read. Needs the user↔principal identity
  mapping (the "who is the human behind this key" model), which F2 did not build.
- **Trigger:** before the F2g flip, or when the notifications surface is next touched.

## DEFERRED-049

- **Title:** F2f-groups (residual) — resolveProjectIds resolver-level authz + project/group id-namespace conflation
- **Status:** **RESOLVED (2026-06-21)** — closed via A2 + B2 + redact (user chose the formal namespace split).
  **B2:** `group` is now its own scope level in the grant lattice (`global ⊃ {project⊃topic⊃task, group}`) —
  added to `ScopeType`/`scopeCovers`/`resolveResourceScope` (a project grant no longer covers a same-named
  group, and vice-versa, by discriminated-union shape), migration **0070** (scope_type CHECK + additive
  mirror-backfill: project-grants-on-a-group-id → parallel group grants, delegate EXCLUDED, granted_by→root,
  no-op on this DB). Group TOPOLOGY ops (`createGroup`/`delete`/`getGroup`/`listGroupMembers`/add/remove)
  authorize strict `{kind:'group'}`; `createGroup` collision-rejects a non-group project id (no silent
  takeover); the 3 grant MCP tools (`grant_capability`/`list_grants`/`explain_authorization`) accept `group`.
  **A2:** `resolveProjectIds(projectId, includeGroups, actingPrincipalId)` authorizes the entry project
  (fail-loud) + filters group ids to caller-readable — result is safe to feed a raw `= ANY()`. The
  lessons-read surface is a deliberate **union** (`read@project OR read@group`, group arm gated on a real
  `project_groups` row so a `read@group:<plain-project>` can't leak it). **Sub-issue 0:** `listGroups`
  REDACTS `member_count` to null for non-grant callers (names stay for the dropdown). Reviews: 2 cold-start
  adversary passes (DESIGN + CODE) + a `/review-impl` coverage-gap pass — all findings fixed (notably the
  union existence-gate HIGH, the delegate-mirror MED, the unprovisionable-group MED). Tests:
  `groups-namespace-authz.test.ts` (12) + 5 pure lattice cases. Migration `0070`. Original write-up:
- ~~OPEN~~ MED (design). Split from DEFERRED-046. NOT live-exploitable today.
- **Context (related group read-model + modeling gaps from the adversary + `/review-impl` passes):**
  0. **`listGroups` is unguarded** (live `GET /api/groups` + MCP `list_project_groups`) and returns
     `member_count` for ALL groups cross-tenant — documented in-code as accepted shared-pool catalog
     metadata, but the per-caller-filtering decision belongs to this group-read-model item. (The per-group
     `listGroupMembers`/`getGroup` reads ARE gated on read@group as of commit 8aa736f.)
  1. **`resolveProjectIds` is unauthorized** (src/services/projectGroups.ts) — it folds a project's group
     ids into a scope array with no check. Every CURRENT consumer (search include_groups → `searchLessonsMulti`,
     check_guardrails include_groups) re-authorizes each returned id, so there is no live transitive leak;
     but the defense lives in the N callers, not the resolver. A future consumer that passes the expanded
     array straight into a `= ANY($1)` query without per-id authz reopens a transitive cross-scope read.
  2. **project/group id-namespace conflation** — groups ARE rows in the `projects` table and authorize via
     `scope_type='project'` grants (pure string equality `scope_id === id`). So a grant on a *project* named
     `acme` also covers a *group* named `acme` (and vice-versa), and `createGroup`'s `ON CONFLICT (project_id)
     DO UPDATE` can silently take over an existing project row whose id collides. Low practical risk (ids are
     admin-assigned) but a soundness gap the `kind:'project'`-for-group choice surfaces.
- **Scope when picked up:** (1) give `resolveProjectIds` an `actingPrincipalId` + first-line `read` authz on
  the entry project (or a doc-contract + a test asserting every caller re-authorizes each id); (2) add a
  namespace discriminator — a `group` scope_type in the grant lattice, or a `group:` id prefix at the
  projects-row level — so a project grant and a group grant can't be string-equal; reject `createGroup` on
  collision with a non-group project instead of `DO UPDATE`.
- **Trigger:** before the F2g flip, or when groups/search-scope expansion is next touched.

## DEFERRED-048

- **Title:** F2f-jobs (residual) — re-validate `payload.root` at job EXECUTION time, not only at enqueue
- **Status:** **RESOLVED (2026-06-20)** — closed via FULL CLOSURE (scope grew M→XL under adversarial review,
  user-approved). The model: specifying ANY filesystem path the worker will index is a GLOBAL capability
  under enforcement. Enforced at the single resolve chokepoint + every write vector — (a) explicit-root gate
  in `resolveProjectRoot(projectId, explicitRoot, authorizerPrincipalId)`; (b) authorizer-stamp columns
  `repo_root_authorized_by` / `root_path_authorized_by` (mig **0069**) set by the gated setters
  (`configureProjectSource`, `prepareRepo` — now gated UP FRONT before any FS clone/mkdir — and
  `registerWorkspaceRoot`) and re-verified via `hasGlobalGrant` at `resolveProjectRoot` branches 2/3;
  (c) `chunks.root` fallback (branch 4) NOT honored under enforcement (no provenance); (d) `payload.root`
  stamped `root_authorized_by` at `enqueueJob` + re-verified at `resolveRoot`, plus a `payload.cache_root`
  enqueue gate. Null stamp (auth-off / legacy row) → not honored post-flip → operator re-authorizes as a
  global principal (transition closure). Reviews: 4 cold-start adversary passes (curve 3→3→3→0, SATURATED)
  + a `/review-impl` coverage-gap pass (caught the prepareRepo clone-before-gate arbitrary-FS-WRITE). Tests:
  `payload-root-exec-authz.test.ts` (+e2e stored-root via worker) + `indexed-root-authorizer.test.ts`
  (setter gates, resolve re-verify, ON-CONFLICT clobber-preservation, disabled-suppression, chunks denial).
  Residual fragility split to **DEFERRED-054**. Original write-up:
- ~~OPEN~~ MED. Split from DEFERRED-045. Tied to the F2g worker/system-principal.
- **Context:** the global-grant gate (28ec95f) blocks a non-global principal from SETTING `payload.root` at
  enqueue. But `payload.root` is honored UNCONDITIONALLY at execution — `jobExecutor.resolveRoot` →
  `resolveProjectRoot` returns the explicit root with no principal/scope check (the worker indexes that
  filesystem path under the row's `project_id`). This is the same enqueue-time-only posture PR F shipped,
  but the cold-start adversary correctly notes that across the durable async-queue boundary a write-time
  gate is weaker than gating where the capability is USED: (a) rows enqueued before the flip (or while
  auth was OFF, where `hasGlobalGrant` returns true) already carry arbitrary `payload.root`; (b) nothing
  re-validates at exec time. Also recommended: an explicit unit test asserting a project/topic/task-scope
  grant ⇒ `hasGlobalGrant === false` (today proven only indirectly by jobqueue-authz's non-global cases),
  and consider requiring global-`admin` (not just global-`write`) for the root capability.
- **Scope when picked up:** stamp `payload.root_authorized_by` (a global principal id) at enqueue and verify
  `hasGlobalGrant` for it in `resolveProjectRoot` before honoring root; OR reject an explicit root that
  escapes the resolved project root unless an explicit global flag is set. Fold into the F2g worker/system-
  principal work (the background worker drains with no principal → needs root at the flip anyway).
- **Trigger:** before the F2g `MCP_AUTH_ENABLED` flip (must close before arbitrary-filesystem jobs can run
  under enforcement).

## DEFERRED-047

- **Title:** F2f-readsweep — systematically authorize the NEVER-guarded project-read surfaces (globalSearch's siblings)
- **Status:** **RESOLVED (2026-06-20)** — commits e3af366 (wave 1: analytics/auditLog/activity/agentTrust),
  be2b9a4 (wave 2: collaboration/chatHistory/lessonImportExport), 8aa736f (adversary-pass-2: learningPaths
  + notification_settings + empty-filter fail-closed). A follow-up cold-start adversary pass caught the
  two surfaces the first sweep missed (learningPaths, notification_settings) — now closed. The USER-scoped
  notification list/mark (listNotifications/markNotificationsRead) is split out to DEFERRED-050 (it needs
  the user-identity model, a different isolation axis). Original write-up:
- ~~OPEN~~ MED. Surfaced by `/review-impl` on the F2f domains 6–7 work. Auth is OFF
  → inert today; a F2g-flip prerequisite (and a hard blocker for domain 8, which retires the REST-layer
  scope middleware that is currently these surfaces' ONLY guard).
- **Context:** F2f (and DEFERRED-029 before it) migrated the call sites that HAD an `assertCallerScope`
  guard. But several read surfaces NEVER had one, so the "migrate the callerScope sites" approach is
  structurally blind to them. The cold-start adversary caught ONE by luck — `globalSearch` (Cmd+K) — now
  fixed (commit 6063784). `/review-impl` confirmed siblings still open:
  - `src/services/activity.ts` — reads `activity_log` by project filter; **0** authz calls. Reachable via
    `GET /api/.../activity` (and the agent slide-over).
  - `src/services/analytics.ts` — reads `lessons` + `activity_log` by project filter; **0** authz calls.
    Reachable via the analytics route.
  - **Likely more** — ~18 GET-route files read project-scoped data (learningPaths, collaboration,
    chatHistory, agents/audit, dashboard stats, …). They were NOT individually audited here; do not assume
    only these two.
  These leak cross-tenant project data at the flip once the REST `requireScope`/`requireResourceScope`
  middleware (their current guard) is retired in domain 8.
- **Why deferred (not a partial fix now):** the honest fix is a SYSTEMATIC sweep — enumerate every service
  function that reads a project-scoped table, confirm each either authorizes `read` on its project or is a
  deliberate cross-project/admin surface. Fixing only the two greps-happened-to-find would give false
  confidence ("reads are guarded") while siblings stay open — exactly the silent-cap anti-pattern. Needs a
  bounded discovery pass (grep every `FROM <project-table> WHERE project_id` against the authz set), then a
  uniform `assertAuthorized(read, {kind:'project'})` + `callerPrincipalOf` threading.
- **Scope when picked up:** (1) enumerate the unguarded project-read services (start: activity, analytics,
  then sweep all REST GET routes); (2) add `actingPrincipalId` + `assertAuthorized(read, project)` first-line;
  (3) thread `callerPrincipalOf(req)` from each route; (4) auth-ON cross-tenant tests per surface; (5) a
  cold-start adversary pass focused specifically on "what reads project data without authz."
- **Trigger condition:** before the F2g flip AND before domain 8 (retiring the REST scope middleware must
  not precede service-layer read enforcement). Tracked with the other F2g prerequisites.

## DEFERRED-046

- **Title:** F2f-groups — authorize project-group membership on the GROUP, not just the member project (+ guard `createGroup`)
- **Status:** **RESOLVED (2026-06-20)** — commit d1cabfa (membership write@group + createGroup write@group +
  deleteGroup admin@group) + 8aa736f (adversary-pass-2: listGroupMembers/getGroup read@group). Residual
  design items split to DEFERRED-049 (resolveProjectIds resolver-level authz + project/group id-namespace
  conflation). Original write-up:
- ~~OPEN~~ MED. Surfaced by the F2f domain-7 cold-start adversary pass (2 of 3
  agents converged on it). Pre-existing semantics, NOT an F2f regression — the legacy
  `assertCallerScope(callerScope, projectId)` guard ALSO keyed on the member project only. Auth is OFF,
  so inert today; a F2g-flip hardening item.
- **Context:** `addProjectToGroup`/`removeProjectFromGroup` (src/services/projectGroups.ts) authorize
  `write` on the **member project** but the row they INSERT/DELETE changes the **group's** composition.
  Groups are themselves `projects`-table rows (see `createGroup`) and membership is the mechanism by
  which knowledge crosses project boundaries (`resolveProjectIds` folds group ids into search scope).
  So at the flip a principal with write on project P but NO authority over group G can splice P into G
  (widening cross-project knowledge flow), and the post-authz group-existence check throws a SHAPED
  `NOT_FOUND` ("Group 'G' not found") → an existence oracle for arbitrary group ids to any project-writer.
  Separately, `createGroup` has NO `assertAuthorized` at all (and its REST route has no role guard) — any
  bearerAuth caller can create a group (which upserts a `projects` row).
- **Why deferred (design decision needed):** fixing it properly means introducing a `group` ResourceRef
  kind in `resolveResourceScope` (a group is a top-level scope, not a project/topic/task lattice node —
  needs a deliberate placement: treat group-id as a `project`-kind scope so a grant on the group covers
  it, or add a first-class `group` scope_type to the grants model). That is a behavior/contract change,
  not the mechanical pure-replace the rest of F2f was — so it belongs in its own design+review pass
  (user's design-first preference for cross-boundary changes).
- **Scope when picked up:** (1) authorize `write` on the GROUP (strict-reject alongside the member
  project) in add/remove; (2) make the group-not-found path return the no-leak shape (uniform
  NOT_FOUND, not a distinct message) or gate the existence check behind group authz; (3) add
  `assertAuthorized` to `createGroup` + a role guard on its route; (4) auth-ON tests: a write@P-only
  principal cannot splice P into a group it has no grant on.
- **Trigger condition:** before the F2g `MCP_AUTH_ENABLED` flip (cross-boundary membership must enforce
  by then), or whenever projectGroups is next touched.

## DEFERRED-045

- **Title:** F2f-jobs — migrate jobQueue (`enqueueJob`/`listJobs`/`cancelJob`) to `authorize()` (actor-native SEC-1/3/5/6 redesign)
- **Status:** **RESOLVED (2026-06-20)** — commit 28ec95f (global-grant gate: enqueue/cancel=write@project +
  required-project-id, list=read@project + no-filter⇒global, payload.root⇒global) + 8aa736f (adversary-pass-2:
  runNextJob execute-path gate). User chose the global-grant-gate design. Residual: EXECUTION-time
  payload.root re-validation at the worker (same enqueue-time posture as PR F) → DEFERRED-048. Original write-up:
- ~~OPEN~~ MED. Raised during the F2f domain-7 rollout — the ONE domain-7 service
  that is NOT a clean pure-replace. jobQueue stays on the DEFERRED-029 `callerScope` guard (its
  `d3-scope.test.ts` cases remain) until this is done. Auth is OFF, so jobQueue is correct today; this
  is a F2g-flip prerequisite, not a live bug.
- **Context:** `src/services/jobQueue.ts` uses `callerScope` not merely as an authz check but as a DATA
  value, in PR F's adversary-hardened logic:
  - **SEC-1** (`listJobs`): a scoped caller that omits both `projectId` and `projectIds` is pinned to
    `params = { ...params, projectId: callerScope }` (else `WHERE 1=1` → cross-tenant read of every
    project's jobs).
  - **SEC-3** (`enqueueJob`): a scoped caller that omits `project_id` gets it auto-bound to
    `callerScope`; a mismatching `project_id` is rejected.
  - **SEC-6** (`enqueueJob`): a scoped caller may NOT pass `payload.root` — the worker walks that
    filesystem path verbatim and would index another tenant's source under this tenant's `project_id`.
    Only an unscoped (admin/global) caller may specify `root`.
  - **SEC-5** (`cancelJob`): same auto-bind footgun as SEC-3.
  The actor model has no single "the caller's scope" — a principal can hold many grants — so none of
  these auto-bind/restrict rules translate mechanically. The worker also calls `indexProject` etc.
  with NO principal (internal/system caller), so it will NOT re-check authz at run time; SEC-6's
  enqueue-time `payload.root` block therefore remains the ONLY defense against the cross-tenant
  filesystem write PR F fixed. Getting the translation subtly wrong reintroduces that exact bug.
- **Scope when picked up (the redesign):**
  1. **Authz check:** `assertAuthorized(actingPrincipalId, 'write', { kind:'project', id: project_id })`
     for `enqueueJob`/`cancelJob`; `read` for `listJobs`. `project_id`/`projectId` becomes effectively
     REQUIRED for a non-global principal (no single scope to auto-bind to).
  2. **`payload.root` restriction (SEC-6):** replace "scoped caller can't pass root" with "only a
     principal holding a GLOBAL grant (or root) may pass `payload.root`." Needs a new helper, e.g.
     `hasGlobalGrant(principalId)` / a `global`-scope capability probe, since `authorize()` returns
     allow/deny but does not expose "is this principal globally privileged."
  3. **`listJobs` no-scope read (SEC-1):** a non-global principal with neither `projectId` nor
     `projectIds` must NOT get `WHERE 1=1`. Either require a project filter, or derive the readable
     project set from the principal's grants and constrain to it.
  4. **Worker/system caller:** depends on the F2g system/root principal (the worker passes no principal
     today) — fold into that work so run-time `indexProject`/`git.ingest` calls authorize as root.
  5. Re-run a cold-start hostile-actor adversary pass over the result (CLAUDE.md safety-sensitive policy
     — this is the cross-tenant-filesystem path) + auth-ON tests mirroring the PR F SEC-1/3/5/6 cases.
- **Trigger condition:** before the F2g `MCP_AUTH_ENABLED` default flip (jobQueue must enforce via
  grants by then), OR whenever jobQueue is next touched. Tracked alongside the other F2g prerequisites
  in `docs/sessions/SESSION_PATCH.md`.

## DEFERRED-044

- **Title:** F2 authz — `revoke_grant` grant-existence oracle (FORBIDDEN vs noop)
- **Status:** OPEN (2026-06-19, ACCEPTED-as-documented). LOW; raised by `/review-impl` on F2.
- **Context:** `revokeGrantAuthorized` (src/services/grantCapability.ts) returns `noop` for an unknown
  `grant_id` but throws `FORBIDDEN` for an existing grant the caller may not revoke. An
  authenticated-but-unauthorized caller can therefore distinguish "grant exists" from "grant doesn't
  exist" by the response shape. Mitigated by `grant_id` being an unguessable UUIDv4 (no enumeration).
- **Why not fixed now:** the alternatives are worse — returning `noop` for the unauthorized case
  hides a real authorization failure (silent no-op the caller believes succeeded); requiring a
  baseline authority to even attempt a revoke can't be scoped without first loading the grant. The
  UUID-unguessability mitigation is the standard resolution for this oracle class.
- **Trigger condition:** revisit if grant ids ever become guessable/sequential, or if the FE needs to
  distinguish "already revoked" from "not yours" for UX (then return a uniform `not_found` with a
  separate authorized-listing path).

## DEFERRED-043

- **Title:** Unify the Phase-15 coordination actor_id namespace onto `principal_id` (auth-ON prerequisite)
- **Status:** **RESOLVED (2026-06-19) — superseded by F1f** (user chose "full migration now"). Target
  fields are validated as principals (F1f.2); `migrate:coordination-actors` rewrites legacy string
  actors → principals across ~19 cols + 2 text[] arrays (F1f.3); `assertEnforceReady` gates on a clean
  substrate (F1f.4); reserved `system:`/`motion:` sentinels are exempted at migrate/gate AND reserved
  at the write boundary (F1-adv pass 3). Committed through `51a371d`. The remaining auth-ON enablement
  step (hard boot-gate) is the separate F4 item.
- **Context:** Phase-15 stores actor identity as free-text strings compared by exact equality
  (`claims.actor_id`, `body_members.actor_id`, `votes.actor_id`, `proxies.principal/proxy`,
  `topic_participants.actor_id`). F1e (commit 556959e/fb5cbc6/42d93a9) makes the *acting caller* a
  principal UUID under auth-ON, but the *stored/target* fields aren't resolved and old rows aren't
  migrated. At the auth-ON flip this strands claims, disenfranchises voters, and breaks proxy
  delegation (see plan `docs/plans/2026-06-19-actor-data-boundary-F1.md` — "F1-adv pass 1" section).
- **Scope when picked up (the reconciliation):**
  1. Resolve the TARGET/owner/member identity fields through the same chokepoint (add_body_member's
     member, cast_vote's vote-owner, grant_proxy's principal, join_topic participant) — and validate
     they resolve to an existing ACTIVE in-tenant principal (the F1d contract #3 the proxy/member
     paths currently skip).
  2. Fix grant_proxy: `principal` IS the caller (self-delegation) — resolve it, don't pass raw.
  3. Data migration: map legacy string `actor_id`s → `principal_id` (or an alias table), so historical
     coordination rows compare correctly once auth is on.
  4. Gate `assertEnforceReady` on "all live coordination actor_ids are resolvable principals" so an
     operator cannot flip enforcement into a stranded board (F1-adv finding #5).
- **Trigger condition:** before F4 declares any deployment enforce-ready, or before the first auth-ON
  rollout — whichever comes first. Pairs with the F4 deferrals (hard boot-gate, legacy-token default).

## DEFERRED-042

- **Title:** Actor data-boundary FE — LOW polish gaps from the coverage eval
- **Status:** OPEN (2026-06-19). Build-time polish; not a design blocker.
- **Context:** The FE+MCP coverage eval (`docs/specs/2026-06-19-actor-data-boundary-fe-mcp-eval.md`)
  closed the HIGH/MED gaps (bootstrap, nav, three contracts) but parked five LOW items:
  - **G4** empty / first-run states (zero principals, zero grants) for identity/delegation/authorization.
  - **G5** "lost both factors" admin-assisted MFA reset path (backup-code + forgot-password exist; the
    fully-locked-out human needs an admin/root reset flow).
  - **G7** dual-credential principal UX — one principal holding both a session (human) and api_key(s);
    the model allows it (kind=attribute) but no screen shows it.
  - **G8** scale: delegation tree collapse/virtualization + authorization decision-log windowing for
    thousands of grants / millions of rows (filters exist; rendering doesn't scale yet).
  - **G10** i18n — drafts are English; the operator is Vietnamese. Decide locale strategy for the
    governance surfaces.
- **Trigger condition:** when building the real `gui/src/app/{identity,delegation,authorization}` pages
  and `settings/{access,sessions}` — fold these in per page. None blocks F1/F2/F3/F-AUTH backend work.
- **Scope when picked up:** per-page polish during FE implementation; no new backend.

## DEFERRED-041

- **Title:** Browser session-login auth for the GUI (true human auth boundary)
- **Status:** DESIGNED (2026-06-19). Surfaced by the cold-start security review of the
  single-port gateway consolidation; now designed as phase **F-AUTH** of the actor
  data-boundary foundation. Build pending. Design:
  `docs/specs/2026-06-19-actor-data-boundary-standards-gap.md` + drafts
  `docs/gui-drafts/pages/{login,register,sessions}.html`.
- **Context:** The single-port gateway made the GUI the one external entrypoint, and
  the hardening pass added a cross-site guard (`gui/src/proxy.ts`), CORS lockdown,
  loopback-only infra publish, and an auth-off startup warning. But it did NOT create
  a *human* authentication boundary. The backend's only auth is bearer/API-key
  (`MCP_AUTH_ENABLED` + `api_keys`), designed for **agents**. A browser cannot safely
  carry a shared bearer token (`NEXT_PUBLIC_CONTEXTHUB_TOKEN` would ship it to every
  client). So with `MCP_AUTH_ENABLED=true`, agents authenticate but the **human GUI's
  same-origin `/api` calls have no credential path** — there is no login/session.
- **Why deferred:** real session auth (login page + session cookies, ideally
  httpOnly+SameSite, CSRF-token for state changes, or an auth proxy / OIDC in front of
  the gateway) is a feature, not a config flip — out of scope for the gateway
  consolidation. The cross-site guard + CORS lockdown already close the
  browser-driven attack vector for the common auth-off self-host case.
- **Trigger condition:** before exposing the gateway port to an untrusted network
  (public internet / shared LAN) for **human** use. Until then: keep the gateway on
  localhost/trusted network, or front it with an external authenticating reverse proxy.
- **Scope when picked up:** session-cookie login for the GUI; make `/api` accept the
  session for browser callers while keeping bearer/api_keys for agents; CSRF token for
  same-origin state-changing requests; revisit defaulting `MCP_AUTH_ENABLED=true` for
  non-loopback gateway bindings. See the security-review findings in the
  single-port-gateway session patch.
- **Designed scope (2026-06-19):** model = principal is the single subject; humans add
  `password+MFA → session`, agents keep `api_key` (both authenticate to a principal, no
  change to `authorize()`/grants). New tables: `human_credentials`, `mfa_factors`,
  `sessions`, `invites`, email-verify/reset tokens. Standards targeted: NIST 800-63B
  AAL2 (MFA) + session re-auth/idle windows; OWASP ASVS V6 (soft/hard lockout,
  ≤100 fails/hr, reset-never-locks, ≥12-char passwords). REST endpoints under
  `/api/auth/*` + admin `/api/invites`. Sequenced as F-AUTH (after F1, parallel to F2/F3).

---

## DEFERRED-040

- **Title:** Chunker heading detection silently broke on CRLF documents
- **Status:** ✅ RESOLVED (2026-06-18). `chunkDocument`'s heading regex
  `^(#{1,3})\s+(.+)$` failed on `\r`-terminated lines (JS `.` doesn't match `\r`,
  `$` doesn't match before it), so a **CRLF document detected 0 headings → naive
  fallback** instead of heading-aware hierarchical chunking. Affected any
  Windows-authored / pasted / git-autocrlf'd doc in production. **Surfaced** when the
  ai-eng corpus (autocrlf'd to CRLF mid-session) re-ingested as 16 chunks instead of
  51. **Fix:** `normalizeNewlines()` (CRLF/CR → LF) at the top of `chunkDocument` +
  `chunkDocumentSemantic` + a CRLF regression test. Verified: corpus re-ingests as 51
  chunks again. Found via the DEFERRED-039 semantic-chunking A/B.
- **Source fix (2026-06-19):** the *origin* of the CRLF was `core.autocrlf=true`
  smudging every checkout to CRLF (661/1101 tracked files were `w/crlf` in the
  working tree, all `i/lf` in the index). Pinned text files to LF via
  `.gitattributes` (`* text=auto eol=lf`), overriding per-machine autocrlf so
  checkouts stay LF and the "LF will be replaced by CRLF" commit warnings stop. Index
  was already 100% LF so the commit was `.gitattributes`-only (zero content
  renormalization); working tree refreshed to LF (`0` files `w/crlf` after). Belt +
  suspenders: the chunker is robust to CRLF *and* the repo no longer produces it.

---

## DEFERRED-039

- **Title:** Phase 17.3 (NLI third judge) + 17.4 semantic chunking — deferred as low-ROI
- **Status:** ✅ RESOLVED (2026-06-19) — all sub-items closed: **17.3 NLI judge BUILT**
  (paid off — resolves DEFERRED-031; see below), 17.4 semantic chunking (net-negative),
  17.4 HyDE (net-negative, DEFERRED-036), 17.4 RRF (metric-neutral). Every Phase-17
  retrieval/judge lever is now built + measured + decided. The NLI judge was the one win.
- ~~**Status:** DEFERRED (2026-06-18) — explicitly assessed, not forgotten.~~
- **17.3 NLI fact-checker:** ✅ RESOLVED (2026-06-19) — BUILT (user chose "build full
  NLI judge" over close-as-won't-fix). Cross-encoder NLI sidecar
  (`services/nli-judge`, `cross-encoder/nli-deberta-v3-small`, dockerized, model baked,
  `/health`+`/entail`+`/score`, 6 scoring tests) + TS client `src/qc/nliScore.ts`
  (4 wiring tests) + A/B runner `src/qc/nliGlobalAb.ts`. A/B on the 14 global rows
  proved NLI's **contradiction-rate** is the right fidelity signal where RAGAS
  faithfulness was measuring substring-recoverability of honest meta-claims: global
  faithfulness `1 − contradiction_rate` = 0.907 vs RAGAS 0.450, while still catching
  fabrication (contradiction). This **resolves DEFERRED-031** (the gap 17.3 targeted).
  Advisory/measurement-profile only — production + default baseline unchanged. This was
  the one Phase-17 lever that paid off (CoVe/HyDE/RRF/semantic all came back
  neutral-to-negative). Results: `docs/qc/2026-06-19-phase-17.3-nli-judge-results.md`.
- **17.4 semantic chunking:** RESOLVED — built (`chunkDocumentSemantic`,
  `template: 'semantic'`, `SEMANTIC_BREAKPOINT_PERCENTILE` env, off by default,
  7 unit tests) + A/B'd: **NET-NEGATIVE** (faithfulness 0.91→0.81, context_recall
  0.99→0.85, cp 0.87→0.78). Semantic merged the corpus into 22 topic-blended chunks
  vs hierarchical's 51 concept-clean ones; heading-aware chunking wins on structured
  docs. Kept off-by-default (niche: unstructured docs). Writeup:
  `docs/qc/2026-06-18-semantic-chunking-ab-results.md`. **Bonus:** the investigation
  surfaced + fixed a real CRLF chunker bug (see DEFERRED-040).
- **17.4 HyDE:** RESOLVED — built as the query-rewrite lever, measured net-negative
  (DEFERRED-036). **17.4 RRF:** RESOLVED — built (`CHUNKS_FUSION=rrf`, `rrfFuse()`,
  off by default, unit-tested) + A/B'd: **metric-NEUTRAL** (v2 weighted vs v3 RRF,
  all deltas ≤0.007 within noise; RRF changes the top-5 set in 89% of queries but
  cr is saturated at 0.99 so it's a wash). Kept off-by-default; production stays on
  weighted-sum. Writeup: `docs/qc/2026-06-18-rrf-fusion-ab-results.md`. The one
  untested regime where RRF might help (lexical-mismatch / identifier queries on a
  recall-headroom surface) is noted there but not pursued — CoVe/HyDE/RRF all
  came back neutral-to-negative, so retrieval-lever ROI here is low.
- **Trigger condition:** 17.3 → global-surface measurement becomes a priority; 17.4
  semantic chunking → a corpus where heading/token chunking measurably underperforms.
- **Priority:** LOW.
- **Source:** `docs/qc/2026-05-24-phase-17-answerer-model-selection.md` §Follow-up;
  assessed 2026-06-18.

---

## DEFERRED-038

- **Title:** Production chunk/lesson RAG feeds the 240-char display preview to the LLM (same truncation bug DEFERRED-037 fixed for QC)
- **Status:** ✅ RESOLVED (2026-06-18). BOTH surfaces fixed via a backward-compatible
  `snippetMaxChars` option (default unchanged for GUI/agent display; LLM-synthesis
  callers request the full item):
  - **chunks/chat** (`src/api/routes/chat.ts:94`, `search_documents` tool) →
    `snippetMaxChars: 2000`. Verified: s1 top chunk 240→**823 chars**, grounding
    fact absent→present; lift proven by the aieng-corpus benchmark (faithfulness
    0.62→0.82). Commit `30b9775`.
  - **lessons** (`reflect` MCP tool + chat `search_lessons` tool) →
    `snippetMaxChars: 2000` on `searchLessons`/`searchLessonsMulti`. The snippet
    source is `summary`-else-`content`; **106/709 (15%)** of lessons exceed 280
    (p90 306, max 2868). Verified: a long-source lesson's snippet 280→**2000**.
    Commit `61601a3`. Branch `deferred-038-lessons-snippet`.
  - The MCP `search_lessons` tool + REST endpoint keep the 280 display default —
    the agent can drill in via `get_lesson`, so not the bug.
  Both fixes deployed (container rebuilt). 976/976; tsc clean.
- ~~**Status:** OPEN (2026-06-18)~~
- **What:** DEFERRED-037 proved that feeding the synthesizer the 240-char
  `content_snippet` display preview (instead of the full chunk) causes
  false-abstention — a grounding fact past char 240 reads as "Not in context"
  (standard faithfulness 0.62→0.82 once the full chunk was fed). The fix
  (`snippetMaxChars`) was made **opt-in** (default stays 240 for GUI display) and
  wired only into the QC harness. **The same bug exists in production LLM paths
  that were NOT changed:**
  - **`src/api/routes/chat.ts:94-109`** — the chat `search_documents` tool calls
    `searchChunks(...)` with no `snippetMaxChars` and returns `content_snippet`
    (240 chars) to the **chat LLM**. The production chat assistant therefore
    can't ground on any fact past char 240 of a chunk — the exact failure mode the
    benchmark surfaced. **Primary fix target.**
  - **`src/mcp/index.ts:1832`** — the `reflect` MCP tool feeds `searchLessons`
    `content_snippet` (capped at 280 via `makeSnippet`, `src/services/lessons.ts:
    1167/1477`) into LLM synthesis. Parallel issue on the LESSONS surface; lessons
    are shorter so impact is smaller, but the class is identical.
- **Fix:** pass a wide window when the consumer is an LLM answerer (not a GUI list):
  `searchChunks({ ..., snippetMaxChars: 2000 })` in chat.ts; add an analogous
  option to `searchLessons` / `makeSnippet` for the reflect path. Keep the 240/280
  defaults for display callers (GUI search results, dedup-key input).
- **Tradeoff to weigh (why it's a deliberate change, not a default flip):** wider
  context = more input tokens per RAG turn (cost + latency) and, past the synth
  cap (~1000 chars/context), the "lost in the middle" effect. Right answer is
  probably full-chunk for chunk-RAG (chunks are bounded ~600 chars) but a measured
  cap for lessons. Verify with the chat path on a few real queries before/after.
- **Trigger condition:** next work on chat-RAG answer quality, or any report of the
  assistant saying "not in context" when the doc clearly contains the fact.
- **Estimated size:** S — 1-line per call site + a quick before/after on the chat
  path. Lessons variant is M (needs a `makeSnippet` width option threaded).
- **Priority:** MED — real product-quality bug (the assistant under-answers), but
  not data-loss/security; default behavior is safe (abstains rather than
  hallucinates).
- **Source:** DEFERRED-037 fix (`ce9110d`) + this scan; raised by the user.

---

## DEFERRED-037

- **Title:** Chunks synthesizer over-abstains on T/F-claim evaluation (template↔task mismatch)
- **Status:** ✅ RESOLVED (2026-06-18). Root cause was deeper than the title: TWO
  causes — (1) **context truncation** — `searchChunks` fed the synthesizer the
  240-char display preview, not the chunk, so facts past char 240 read as "Not in
  context" (fixed: `snippetMaxChars` option → MCP `snippet_max_chars` → QC
  callChunks requests 2000); (2) **template mismatch** (fixed: `claim-eval`
  template). Re-measure `aieng-corpus-v2`: standard false-abstentions **6/25→0/25**,
  faithfulness **0.76→0.91**, context_recall 0.88→0.99, **refusal_correctness
  1.00→1.00 preserved** (true-abstention intact). Commit `ce9110d`. Results:
  `docs/qc/2026-06-18-aieng-corpus-geneval-results.md` (Update section).
- ~~**Status:** OPEN (2026-06-18)~~
- **What:** The first grounded gen-eval on the ai-engineering corpus
  (`aieng-corpus-v1`) surfaced that `src/qc/templates/synthesizer.chunks.txt` — a
  CLOSED-BOOK Q&A template with aggressive anti-hallucination abstention ("ABSTAIN
  WHEN UNSUPPORTED → say exactly 'Not in context.'") — **over-abstains** on the
  competency bank's TRUE/FALSE-claim-evaluation task. **6 of 25 standard rows
  falsely returned "Not in context." with the grounding chunk at RANK 1** (e.g.
  AI-RAG-0001-s1: retrieved chunk literally says "a reranker cannot raise recall
  beyond what retrieval supplied"; answer = "Not in context."). This drags standard
  faithfulness 0.78→0.62 and answer_relevancy 0.64→0.48.
- **Why it happens:** the template treats the input as a generic question and
  abstains unless the answer appears near-verbatim; a T/F claim needs the answerer
  to map the claim to supporting/refuting evidence and judge it, not look up a
  verbatim answer. The caution is correct FOR THE PRODUCT (better abstain than
  hallucinate) but wrong for claim verification.
- **Trigger condition:** when benchmarking the competency bank (or any
  claim-verification set) on the chunks surface; or before scaling the corpus to
  the other 4 domains (the mismatch would understate every domain's score).
- **Fix:** add a claim-evaluation synthesizer variant (supported / refuted / absent)
  selectable for the competency task — OR pose competency queries as direct
  questions. Then re-run `aieng-corpus-v1` and compare.
- **Estimated size:** S/M — one template + a synth-template selector + a re-run.
- **Priority:** MED — gates a fair reading of the corpus benchmark; the corpus and
  retrieval themselves are already validated.
- **Source:** `docs/qc/2026-06-18-aieng-corpus-geneval-results.md`.

---

## DEFERRED-036

- **Title:** Query-rewrite A/B measurement run (none vs expand vs hyde)
- **Status:** ✅ RESOLVED (2026-06-18) — **verdict: rewrite does NOT improve
  quality; net-negative on ranking.** Lessons surface, 48 queries, temp=0:
  MRR none 0.856 → expand 0.772 → hyde 0.751 (−0.105); nDCG down for both; hyde
  only nudges recall@10/coverage +0.022 (at noise floor) by pushing hits *down*
  the ranking. Keep production on the raw query; lever stays as a harness tool.
  Writeup: `docs/qc/2026-06-18-hyde-ab-results.md`. Archives:
  `docs/qc/baselines/2026-06-18-hyde-ab-{none,expand,hyde}.json`.
- ~~**Status:** OPEN (2026-06-18)~~
- **What:** The query-rewrite lever is built + verified (`--rewrite-mode
  none|expand|hyde`, `src/qc/queryRewrite.ts`, design
  `docs/specs/2026-06-18-query-rewrite-lever.md`), but the actual A/B
  *measurement* — running the full golden set 3 ways and comparing
  recall@k/MRR/nDCG/coverage (+ gen-eval as secondary) — has not been run. The
  PRIMARY readout is the answer-INDEPENDENT retrieval metrics, so this is clean
  even on a controlled stack.
- **Why deferred:** shipping the lever and running the experiment are separate
  steps (same split as the CoVe lever). The measurement wants a controlled
  baseline stack (`start-baseline-stack.sh`) + `--control` for a noise floor, and
  is best run deliberately, not as a smoke.
- **Trigger condition:** when measuring retrieval-quality levers for a Phase-17
  writeup, or before deciding whether to wire query rewrite into the production
  retrieval path.
- **How to run:** `--rewrite-mode expand` and `--rewrite-mode hyde` vs a `none`
  baseline, same tag family, ideally `--control` each + `--groups edge-*` for the
  hallucination-prone rows. Compare per-surface recall@k/MRR; watch the noise
  floor (cp/cr ≈ 0.146/row, retrieval metrics ≈ 0.026/row from tie-breaking).
- **Estimated size:** S — no code; 3 baseline runs + a diff writeup under
  `docs/qc/`.
- **Priority:** MED — the lever is inert until measured; this is the payoff step.
- **Source:** Query-rewrite lever build (2026-06-18, session 5).

---

## DEFERRED-035

- **Title:** Per-caller wiring regression tests for the shared LLM client
- **Status:** ✅ RESOLVED (2026-06-19) — the 3 highest-value LLM callers have
  injected-`fetchImpl` wiring tests asserting the real HTTP body
  (`src/services/llm/callerWiring.test.ts`): **distiller** (sends `DISTILLATION_MODEL`
  + base-url/key, parses the JSON), **vision** (multimodal `image_url` base64-PNG
  block + `VISION_MODEL`), **lessons generative rerank** (`RERANK_MODEL`, ranking
  prompt carries query+candidates, applies the returned order). Each caller gained an
  optional `fetchImpl` test seam threaded to `chatComplete`.
  **The last piece (the `runBaseline.evalQuery` rewrite-wiring test) is now done.**
  Unblocked by entry-point-guarding `main()` (`isEntryPoint()` compares
  `import.meta.url` vs `pathToFileURL(argv[1])`, lowercased for Windows drive casing)
  so importing the module no longer fires the runner — verified both directions live
  (direct run still executes main; the test import does not). `evalQuery` is now
  exported and threads an optional `fetchImpl` into `rewriteQuery` (production omits
  it → real fetch, bit-identical). `src/qc/runBaseline.test.ts` (3 tests) pins the
  addendum's three invariants via a counting stub fetch + recording dispatch: rewrite
  computed ONCE per query (not per latency-sample), every sample dispatches the
  REWRITTEN string, fallback dispatches the ORIGINAL, trace attached to the row.
  993/993; tsc clean.
- ~~**Status:** OPEN (2026-06-18)~~
- **What:** The Phase-17.2 LLM in/out standardization migrated 11 chat call
  sites onto `src/services/llm/chatComplete`. `chatComplete` itself is unit-
  tested (transport, reasoning-suppression on/off, env off-switch, URL building,
  deep-merge, multimodal passthrough). But **no test pins each CALLER's wiring** —
  that distiller passes `DISTILLATION_MODEL` + the right base-url/key, that vision
  sends the multimodal image block, that lessons rerank uses JSON-mode, etc. A
  future edit that mis-wires a caller (wrong model var, dropped apiKey) would pass
  `tsc` and the full unit suite, because those paths are unmocked I/O. Caught
  today only by the live baseline runs (which exercise genPipeline + rerank) and
  the `/review-impl` pass (MED-2).
- **Why deferred:** most callers read env + open DB pools at module scope and
  don't accept an injectable `fetchImpl`, so adding wiring tests means light
  refactors (thread an optional `fetchImpl`/config) across 8 files — disproportio-
  nate to the risk given `chatComplete` is tested and the live baselines cover the
  hot paths.
- **Trigger condition:** next change touching `src/services/llm/` consumers, OR a
  reported regression in a distillation / vision / rerank path.
- **Estimated size:** M — thread `fetchImpl` into the 3 highest-value callers
  (distiller, vision, lessons rerank) + injected-fetch tests asserting the request
  body (model/url/key/JSON-mode).
- **Priority:** LOW — `chatComplete` contract is guarded; the gap is per-caller
  drift, not the shared layer.
- **Source:** `/review-impl` of commit `ab53ed5` (MED-2).
- **2026-06-18 addendum (review LOW-3 of `d37549a`):** the query-rewrite wiring in
  `runBaseline.evalQuery` shares this gap. Three invariants — rewrite computed
  ONCE per query (not per latency-sample), fallback dispatches the ORIGINAL query,
  trace attached to the row — live in module-private `evalQuery` with no injected
  `fetchImpl`. A refactor moving `rewriteQuery` inside the `runSamples` closure
  (→ N× LLM calls/query) or dispatching `q.query` instead of `dispatchQuery` would
  pass `tsc` + the full unit suite. `queryRewrite.ts` itself IS unit-tested
  (`parseRewrittenQuery`, `rewriteQuery` fallback); the untested part is the
  runBaseline call site. Fold the evalQuery wiring test into this item.

---

## DEFERRED-034

- **Title:** Raise chunks context_precision / context_recall (retrieval-layer, NOT template)
- **Status:** ✅ RESOLVED (2026-06-19) — **the "low chunks cp/cr" was a golden↔corpus
  mismatch, NOT a retrieval gap.** The prior "corpus-bound (032)" diagnosis was wrong:
  pulling the actual chunk content (DB) showed the legacy `qc/chunks-queries.json` answer
  key CONTRADICTS the ingested `test-data/sample.*` chunks (golden 100ms/jitter-0.2/
  editor,viewer vs corpus 1000ms/jitter-true/writer,reader), and the target chunks are
  retrieved at rank 1 — so `cr≈0` was a **false negative from a wrong answer key**, not
  truncation (the retry chunk is 166 chars < 240) and not missing corpus. Proof the
  pipeline is fine: the same chunks pipeline scores **cr 0.994** on the matched
  ai-engineering corpus (`aieng-corpus-v2`). **Fix:** made the matched ai-engineering set
  the default chunks golden (`qc/chunks-queries.aieng.json`, 56 rows; `runBaseline`
  `GOLDEN_FILES.chunks` re-pointed; added to `validateGoldenSet`; fixed an R4 violation in
  2 `no_answer` rows in the master `competency-geneval.json`). Legacy `chunks-queries.json`
  retained for the retrieval/noise probes (its `target_chunk_ids` are valid). Verified:
  default chunks baseline now `cr=1.00` (was ≈0); 1000/1000; tsc clean. The rerank/
  wide-pool/granularity levers below were chasing a phantom — **no retrieval change was
  needed.** Closeout: `docs/qc/2026-06-19-deferred-034-chunks-golden-mismatch-closeout.md`.
  Residual (more domains + `target_chunk_ids` for recall@k) belongs to DEFERRED-032.
- ~~**Status:** PARTIALLY ADDRESSED (2026-06-18)~~ — reranker + wide-pool + relevance
  gate shipped on the chunks surface (default-ON, like lessons/code). cp/cr came
  out **metric-neutral** on the 13-row corpus (cp Δ−0.013 / cr Δ+0.009, both
  inside the 0.146 judge-noise band): most targets already rank-1, so reranking
  has little headroom and noise swamps it. Mechanism verified (rerank fired
  13/13, reordered 11/13; wider pool improved result completeness 3→5 on two
  rows). Shipped on architectural-consistency + completeness grounds, not a
  metric win. Closeout: `docs/qc/2026-06-18-deferred-034-chunks-rerank-closeout.md`.
- **Update (2026-06-18, session 4): `searchChunksMulti` rerank parity DONE.**
  The multi-project chunk-search path lacked the reranker (it already had dedup).
  Extracted the shared post-retrieval pipeline `postProcessChunkMatches` (rerank
  → dedup → trim) + pure `chunkRerankActive`, used by BOTH `searchChunks` and
  `searchChunksMulti`, so they can't drift. Multi gained the `rerank?` param +
  wide-pool + 1000-char rerank window. Unit: `chunkRerankActive` gating (3
  cases) + the single-project refactor guarded by 61 existing chunks/lessons
  tests; 953/953 suite. Live-verified the 2-project path: `rerank=true` → wide
  pool (11/2 projects), rerank fires (`reranked: 11 candidates (pool=30)`),
  dedup, trim; `rerank=false` → narrow pool + correct bypass explanation; cold
  rerank service → graceful no-rerank fallback. Design:
  `docs/specs/2026-06-18-deferred-034-multi-rerank-parity.md`.
- **Update (2026-06-18, session 4): chunk granularity / re-chunking RE-DEFERRED
  — NOT measurable on the current corpus (corpus-bound, not granularity-bound).**
  DB + per-row diagnosis: the chunks corpus is **11 chunks total** (avg 272
  chars, min 100/max 524) across 3 sample files (`test-data/sample.{docx,pdf,png}`),
  **3 of which are vision-extraction failures** → ~8 usable tiny chunks. Per-row
  cr on the v11 baseline shows the bottleneck is corpus content, not slicing:
  e.g. `chunk-retry-strategy-overview` scores **cr=0 with cp=0.92** (retrieval
  precise, but the ground-truth claims simply aren't in any chunk). Re-chunking
  8 tiny chunks cannot (a) add absent facts, nor (b) clear the 0.146 cr
  judge-noise floor (top-5 already retrieves ~half the corpus), and would break
  every `target_chunk_ids` (new UUIDs) for zero measurable gain. The real `cr`
  lever is **corpus expansion** (more/richer documents — overlaps DEFERRED-032's
  corpus-blocked SA bank), NOT chunk granularity. Trigger: a larger ingested
  corpus exists. Until then, granularity work is unmeasurable.
- **Status (original):** OPEN (2026-06-18)
- **Why this exists:** the v11 "chunks cp/cr regression" was misdiagnosed as a
  synthesizer-template problem ("v12"). It is not — cp/cr are answer-independent
  (scored from question + ground_truth + retrieved_contexts), so no template
  change can move them. See DEFERRED-031 closeout (2026-06-18) and
  `docs/qc/2026-06-18-chunks-cp-cr-noise-floor-v12-closeout.md`. The ONLY way to
  genuinely raise chunks cp/cr is to improve the retrieved contexts themselves.
- **Trigger condition:** a deliberate chunk-retrieval-quality push (e.g. when
  chunk-heavy workloads become a priority, or a chunks-surface recall/precision
  target is set).
- **Levers (in rough priority order):**
  1. Chunk reranking — apply the cross-encoder/bge-reranker to chunk candidates
     (the lessons/code surfaces already rerank; confirm chunks path does too).
  2. Chunk granularity — current chunker splits may be too coarse/fine for the
     ground-truth claims; cp punishes irrelevant retrieved chunks, cr punishes
     missing ones.
  3. `top-k-contexts` tuning (currently 5) — more contexts trade cp for cr.
  4. Embedding model / hybrid FTS weight on the chunks surface.
- **Measurement gotcha:** cp/cr have a LARGE judge-noise floor (cp surface-mean
  range 0.146 over N=8 identical-input re-scores; one row flips 0↔1). Any real
  retrieval improvement must clear that band — use ≥3-run averaging or the
  `--control` duplicate, and re-use `src/qc/noiseFloorChunksCpCr.ts` to
  re-baseline the noise floor if the judge model changes.
- **Effort:** M-L (retrieval change + re-baseline + noise-aware A/B).

## DEFERRED-033

- **Title:** Code-surface retrieval non-determinism — SQL ordering bugs in tieredRetriever
- **Status:** RESOLVED (2026-06-17, same-day fix)
- **What:** Comparing the v10 Tradition A and Tradition B baseline JSONs
  on the `code` surface showed `recall@5` drift of −0.026 with same
  answerer + same embeddings + same reranker — should have been
  bit-identical. Forensic analysis of `per_query.top_k_keys` revealed
  35/77 queries (45%) had **different candidate sets entirely** (0/35
  were "same set, different order"), which a reranker cannot produce.
- **Root cause:** five SQL queries in
  `src/services/tieredRetriever.ts` lacked deterministic ordering:
  3× `ORDER BY rank/distance LIMIT N` without secondary tiebreakers,
  plus 2× path-match ILIKE queries with `LIMIT 50` and NO `ORDER BY`
  at all (pure heap-scan order, shifts with MVCC visibility /
  autovacuum). Plus the JS `candidates.sort()` in `fuse()` lacked a
  path-ASC tertiary key, so same-tier-same-score candidates inherited
  Set-insertion (i.e. SQL row-return) order.
- **Trigger:** observed during v10 closeout retrieval comparison; was
  open item #2 on `docs/qc/2026-06-17-v10-tradition-b-same-model-bias-results.md`.
- **Fix:** appended `(file_path ASC, symbol_name ASC NULLS LAST)` to
  each affected `ORDER BY`; added explicit `ORDER BY file_path ASC` to
  the two heap-scan path-match queries; added `path < path` tertiary
  key to the JS fuse-sort. 868/868 unit tests pass, tsc clean.
- **Why this is OK to RESOLVE on entry:** the v10A / v10B headline
  numbers don't shift (the −0.026 r@5 came from 2 gold items moving
  across the rank-5 boundary, not the candidate-pool churn).
  Future Phase-17 measurements on the code surface are now
  bit-reproducible at the retrieval layer.
- **Forensics doc:** `docs/qc/2026-06-17-code-surface-determinism-fix.md`

## DEFERRED-032

- **Title:** SA Competency Bank golden set has no corpus to ingest — baseline-blocked
- **Status:** PARTIALLY RESOLVED (2026-06-18) — **ai-engineering pilot DONE** (56 of
  294 items). Authored an independent 8-doc corpus (`corpus/ai-engineering/`, 51
  chunks), ingested, ran grounded gen-eval (`aieng-corpus-v1`): cr 0.88,
  groundedness 0.98, abstention 1.00. Methodology proven end-to-end. Results +
  template-mismatch finding: `docs/qc/2026-06-18-aieng-corpus-geneval-results.md`
  (→ DEFERRED-037). **Remaining (still OPEN):** the other 4 domains (aws-ops,
  developer, language-runtime, solution-architecture; 238 items) + `target_chunk_ids`
  population for recall@k. Scale only after the DEFERRED-037 template fix, else
  every domain's score is understated.
- **Update (2026-06-19, via DEFERRED-034):** the ai-engineering set is now the
  **default chunks golden** (`qc/chunks-queries.aieng.json`, re-pointed in
  `runBaseline`), replacing the broken `chunks-queries.json`. This makes the default
  chunks baseline's gen-eval cp/cr/faithfulness valid (cr 0.994). **`target_chunk_ids`
  population (for retrieval recall@k/MRR) is now explicitly part of THIS item** — the
  ai-eng rows have empty `target_chunk_ids`, so retrieval metrics are N/A until populated
  (gen-eval metrics are unaffected). Run the set with `--synth-template claim-eval`.
- ~~**Status:** OPEN (2026-06-17)~~
- **What:** `qc/competency-geneval.json` was compiled in a separate session
  (chronologically around 2026-06-17 00:50, not produced by the
  `deferred-030-rerank-quality` branch's work). It contains 294 statements
  derived from a 42-item SA Competency Bank covering 41 sub-categories of
  AI engineering / AWS ops / developer / language-runtime / solution
  architecture. The set has 148 `standard` (grounded-confirm), 141
  `false_premise` (hallucination probe), and 5 `no_answer` (abstention
  probe) items. Each statement carries an ideal-answer + must-contain-facts
  payload suitable for ragas faithfulness / answer_relevancy /
  groundedness_self_eval / refusal_correctness evaluation.

  The set's own metadata describes its corpus-dependency:
  > HELD OUT from the RAG corpus — only `corpus/` docs are ingested; this
  > set is the answer key.

  **`corpus/` does not exist** in this repository (verified 2026-06-17).
  Without an ingested corpus to ground answers in, running gen-eval on
  the competency set measures only the answerer's prior knowledge, not
  the system's RAG behavior — defeating the point of the held-out
  answer-key methodology.

- **Trigger condition:** when the corresponding corpus (the source
  documents the competency bank was authored against) lands in
  `corpus/` and gets ingested into `free-context-hub` as document
  chunks. Until then, the golden set is preserved-as-data, not
  preserved-as-baseline.
- **Estimated size:** L — author or import the corpus material; ingest
  via the document-extract job; populate `target_chunk_ids` in the
  golden set (currently empty) for recall@k; run a baseline (~50 min on
  Tradition B; ~80 min if also doing CoVe synth mode); document.
- **Priority:** depends on the workstream that produced the bank. The
  set is preserved here so it's not lost; a future session that
  surfaces with the matching corpus can pick it up.
- **Source:** discovered as untracked file during the `deferred-030-rerank-quality`
  branch wrap-up (PR #35). Origin session not identified from this
  branch's history. The competency set is preserved here to avoid
  losing 294 hand-authored ideal answers; corpus + baseline work
  deferred to the originating session.
- **Files:** `qc/competency-geneval.json` (committed in PR #35 alongside
  the v10 Tradition B + Tradition A baseline work — see commit body for
  the find/preserve rationale).

---


## DEFERRED-031

- **Title:** Global-surface synth: substring-search faithfulness / answer-relevancy trade-off
  cannot be cleanly resolved with the current RAGAS metric framework
- **Trigger condition:** any future Phase 17 metric framework change that decouples
  "groundedness of substantive claims" from "presence of meta-claims," OR a switch to a
  different judge (e.g. an NLI judge that scores propositions instead of substring
  recoverability).
- **Status:** ✅ RESOLVED (2026-06-19) — via the **Phase-17.3 NLI judge** (DEFERRED-039;
  the trigger's "NLI judge" path). Built a cross-encoder NLI sidecar
  (`services/nli-judge`, `cross-encoder/nli-deberta-v3-small`) and A/B'd it against RAGAS
  faithfulness on the 14 global rows. **Finding:** RAGAS faithfulness (0.450 mean) was
  measuring the wrong thing on this surface — it penalizes honest meta-claims ("the query
  surfaces lessons; the common theme is X") as ungrounded. NLI separates real
  hallucination (**contradiction**, mean rate **0.093** — honest answers don't contradict
  their contexts) from honest non-entailment. **Fix: global-surface faithfulness =
  `1 − nli_contradiction_rate` (mean 0.907 vs RAGAS 0.450)** — advisory/measurement-profile
  only; production + default baseline unchanged. Honest limit: NLI `neutral` can't catch
  an *on-topic silent* fabrication, but *off-topic* ones register as contradiction, and
  contradiction-rate is the meaningful signal for a "describe-what-was-retrieved" surface.
  Strict (entailment-only) NLI = 0.259, WORSE than RAGAS — not adopted. Other surfaces keep
  RAGAS. Results: `docs/qc/2026-06-19-phase-17.3-nli-judge-results.md`. Design:
  `docs/specs/2026-06-19-phase-17.3-nli-judge.md`.
- ~~**Status:** OPEN (2026-06-17)~~
- **Context:** Bug 3 v8 fix (Phase 17 closeout) reduced hedging across all surfaces by
  ~55%. On the `lessons`, `code`, and `chunks` surfaces this was a net win
  (`faith` neutral or up, `ar` up). On the **`global` surface**, `faith` dropped
  **−0.119** while `ar` rose +0.097 (v9 vs v6, n=10). DEFERRED-030 closeout note
  flagged "may need an ABSTAIN rule specific to substring-search semantics."
- **⚠️ 2026-06-17 first investigation was contaminated by the baseline-
  stack model-swap bug.** v1/v2 smoke iterations and the v9 reference
  ran with worker leaking `DISTILLATION_MODEL=gemma` while the baseline
  ran with mistral-nemo. Root cause + fix:
  `docs/qc/2026-06-17-baseline-stack-bug-postmortem.md`. Both smokes
  preserved as historical artifacts but their magnitudes (Δfaith +0.005,
  Δar −0.126; Δfaith +0.128, Δar −0.268) are not trustworthy on their own.

- **✅ 2026-06-17 v10 clean-stack baseline CONFIRMS the trade-off is REAL.**
  After fixing the baseline-stack bug + switching baseline rerank to
  match production (bge-reranker-v2-m3 via local-rerank-service), the
  v10 full-152-row baseline measured global-surface faithfulness =
  0.254 vs v9's 0.372 (Δ −0.118). The trade-off survives the clean
  stack. Results in
  `docs/qc/2026-06-17-v10-clean-stack-baseline-results.md`.

- **⚠️ 2026-06-17 v10 Tradition B baseline REVISES the magnitude.** Re-
  measured with gemma judge (instead of mistral-nemo same-model), global
  faithfulness = **0.444**, not 0.254. The "−0.118 from v9" delta was
  **~80% same-model bias artifact** — mistral-nemo judging mistral-nemo's
  hedge-heavy global-surface answers harshly because both share the same
  uncertainty calibration. A stronger independent judge sees those
  answers as more substantively grounded. The trade-off vs lessons/code/
  chunks (faith 0.45-0.90 on the same Tradition B run) is REAL but
  smaller and more nuanced than originally framed. Results in
  `docs/qc/2026-06-17-v10-tradition-b-same-model-bias-results.md`. The
  "not fixable at template layer alone" hypothesis below is now
  RETIRED — the metric framework is measurable; we just needed a
  cross-judge to detach the answerer's hedging from the judge's
  recognition of substance.

- **✅ 2026-06-17 v11 hybrid (v6-lessons/code/chunks + v8-global)
  CONFIRMED as Pareto improvement over both pure-v6 and pure-v8.**
  Catalog-wide weighted faith=0.618 (matches v6's 0.620 within noise,
  beats v8 by +0.089); catalog-wide ar=0.798 (beats v6 by +0.035 AND
  v8 by +0.013). Per-surface predictions all confirmed (lessons/code/
  chunks track v6, global tracks v8). Side surprise: code ar=0.793
  marginally beats both v6 (0.742) and v8 (0.789), suggesting a small
  positive interaction effect from mixing v6 strict-abstention with
  v8 global ABSTAIN signaling. One regression: chunks cp/cr drop by
  −0.076/−0.077 vs pure-v8 (v6 has weaker chunks cp/cr by design;
  v11 inherits that). Branch: `v11-hybrid-templates` off `deferred-030`.
  Run had to be re-done after first attempt corrupted by LM Studio's
  gemma-4 switching to reasoning-by-default between v6 and v11 runs,
  exhausting max_tokens before structured output could close. Fixed
  permanently via `reasoning_effort=none` monkey-patch in
  `services/ragas-judge/main.py:_build_openai_client`. Results in
  `docs/qc/2026-06-17-v11-hybrid-templates-results.md`. This downgrades
  DEFERRED-031 in two ways: (1) "global gap is fundamental at template
  layer" hypothesis is now FULLY RETIRED (v11 shows the gap is real but
  bounded at ~0.45 faith and is mitigated by v8 global framing); (2) the
  follow-up hybrid v11 PR is now MERGED — v11 is the new production
  default. Remaining open: ~~chunks cp/cr regression (potential v12 work)~~
  (CLOSED 2026-06-18, see below) and Tradition C measurement (still optional).

- **✅ 2026-06-18 chunks cp/cr "regression" CLOSED won't-fix — judge noise,
  not a template effect (v12 retired).** The v11 results doc framed chunks
  cp −0.076 / cr −0.077 vs pure-v8 as a template trade-off to fix with a "v12"
  hybrid chunks template. That is **causally impossible**:
  context_precision/context_recall are scored from
  (question, ground_truth, retrieved_contexts) ONLY — the synthesized answer is
  never passed (`services/ragas-judge/main.py:585-614`), so the chunks
  synthesizer template cannot move them. Proof: (1) chunks contexts were
  byte-identical across the v6/v8/v11 runs; (2) v6 and v11 use the
  byte-identical chunks template (hash `a01005e0d102b2c1`) yet scored cp 0.563
  vs 0.584 / cr 0.397 vs 0.372 — same template + same contexts → different
  score = judge non-determinism. An N=8 same-input re-score
  (`src/qc/noiseFloorChunksCpCr.ts`) measured a cp surface-mean noise band of
  **0.146** (0.584–0.731), ~2× the claimed −0.076; one row swung the full
  0.000↔1.000 on identical input. v8's 0.660 is an ordinary high draw.
  Closeout + measurement:
  `docs/qc/2026-06-18-chunks-cp-cr-noise-floor-v12-closeout.md`. v11 results
  doc corrected in place. **NEW retrieval-layer follow-up** (the only real way
  to raise chunks cp/cr): improve chunk ranking/rerank/granularity — logged as
  DEFERRED-034 below.

- **🔬 2026-06-17 v6 Tradition B baseline DOWNGRADES Bug 3 v8 from
  "net-positive" to "surface-mixed, net-negative catalog-wide."**
  Re-ran the v6 template state under Tradition B (152 rows, gemma judge)
  and compared head-to-head with v8 (=v10B). Catalog-wide weighted-mean
  faithfulness: v6=0.620, v8=0.528, **Δ=−0.091**. v8 trades −0.091 faith
  for +0.023 ar — a 4:1 unfavourable ratio. Per-surface: lessons mildly
  negative (faith −0.084), code LARGELY negative (faith −0.116, grd
  −0.105), chunks mixed (cp +0.097 / faith −0.041), global net-positive
  (ar +0.121, grd +0.100). The "v8 net-positive on lessons/code/chunks"
  claim from Phase 17 closeout was a same-model bias artifact —
  mistral-nemo judge sympathetically credited mistral-nemo's hedge-light
  v8 outputs. The hedge-RATE reduction (14→6 on code) is real
  (judge-independent synth statistic); the QUALITY value of that
  reduction was overstated. Surprising side finding: **v6 and v8 score
  IDENTICAL global faith (0.439 vs 0.444)** — the global-surface gap is
  neither a same-model bias artifact alone NOR a Bug 3 template effect.
  It's intrinsic to substring-search semantics on ambiguous queries.
  Full results: `docs/qc/2026-06-17-bug3-v6-vs-v8-tradition-b-results.md`.
  Open follow-up: a hybrid-template v11 measurement (v6-lessons-code-
  chunks + v8-global) under Tradition B would isolate the
  surface-specific wins — separate PR, not bundled into PR #35.

- **Pre-contamination-fix investigation result — NOT FIXABLE at the template layer alone:**
  - Two iterations attempted on `synthesizer.global.txt` against the controlled
    baseline stack (mistral-nemo answerer + mistral-nemo judge, seed=42, top-K=3,
    n=10 smoke per iteration):
    - **v1 (per-entity description, drop "common theme" framing):** Δfaith
      +0.005 (noise), Δar **−0.126**. Model produced bullet-style answers that
      tanked answer-relevancy without recovering faithfulness.
    - **v2 (prose + silent-skip irrelevant matches + anti-fabrication):** Δfaith
      **+0.128** (real lift), Δar **−0.268** (cratered). Model gamed the
      silent-skip rule by writing minimal answers ("The search surfaces two
      relevant entities: a lesson [1] and a document [2]." — 77 chars, no
      substantive description). RAGAS faithfulness rises trivially when there
      are fewer claims to ground; AR collapses because the answer doesn't
      actually answer the user's question.
  - **Root cause:** RAGAS `faithfulness` counts the FRACTION of claims that are
    substring-recoverable from the contexts. Honest meta-claims ("entity X
    is unrelated to the substring query") are scored as ungrounded because
    "unrelated" is not in the context. Substring-search inherently surfaces
    semantically-diverse matches, so any honest description either (a)
    fabricates a unifying theme (low faith, high AR), (b) explicitly notes
    diversity (low faith, OK AR), or (c) lists types without substance
    (high faith, low AR). The metric framework rewards (a) the most.
  - **Production decision (2026-06-17):** template REVERTED to v8 state on
    branch `deferred-030-rerank-quality`. Both failed iterations preserved as
    smoke baselines under `docs/qc/baselines/2026-06-16-2026-06-17-phase-17-bug3-global-fix*.{json,md}`
    so a future attempt can compare against them.
- **Estimated size:** M — likely requires either (a) a Phase 17.3 NLI-based judge
  that scores propositions instead of substring recoverability, OR (b) a separate
  "substring-search" metric that distinguishes substantive descriptions from
  meta-claims about match irrelevance, OR (c) accept that global-surface gen-eval
  is fundamentally noisy and use retrieval metrics only for that surface.
- **Priority:** LOW — production behavior unchanged (template at v8); affects only
  the `global` surface (10 of ~152 golden rows). Other surfaces (lessons, code,
  chunks) unaffected by this gap.
- **Sessions open:** 1
- **Source:** Phase 17 closeout note (`docs/qc/2026-05-25-phase-17-ragas-judge-fix-a-b.md`)
  + DEFERRED-030 follow-up investigation 2026-06-17.

---

## DEFERRED-030

- **Title:** Cross-encoder rerank — valid quality measurement (recall@k) + harness hygiene
- **Trigger condition:** any RAG quality pass on rerank, OR before citing a rerank *quality*
  (not latency) number publicly / on a CV.
- **Status:** RESOLVED 2026-06-16 (branch `deferred-030-rerank-quality`).
- **Context:** Cross-encoder (`bge-reranker-v2-m3`) integration shipped + deployed
  (`RERANK_TYPE=api`, Cohere protocol). **Latency** is measured + solid (90 ms vs ~6.8 s general
  LLM vs 1.8 s Phase-12 ranker). **Quality is NOT validly measured** — three follow-ups:
  1. `src/qc/rerankBenchmark.ts` `expect` labels are stale (authored for the Phase-12 lesson
     set; current catalog differs) → refresh ~33 labels to the live catalog for real recall@k/MRR.
  2. Add a raw-prefetch toggle so the harness baseline isn't itself cross-encoder-reranked now
     that `RERANK_TYPE=api` reranks server-side during `search_lessons`.
  3. v2: `min_rerank_score` floor using cross-encoder scores (off-topic rejection).
- **Resolution:**
  1. **Better than #1 — golden-set anchored.** Refactored `rerankBenchmark.ts` to load
     `qc/lessons-queries.json` (48 queries, 66 `target_lesson_ids`, all 66 verified active in
     current catalog 2026-06-16). True recall@1/3/5/10 + MRR per model, adversarial-pass rate
     for no-answer queries. No manual relabeling needed — pre-existing labels are already
     ground-truth.
  2. New `rerank?: boolean` (default `true`) on `SearchLessonsParams` /
     `SearchLessonsMultiParams`, threaded through MCP `search_lessons` tool + REST
     `POST /api/lessons/search`. `false` = explicit bypass, logged in explanations. Benchmark
     prefetches with `rerank: false` so client-side reranker A/Bs are uncontaminated.
  3. New env `RERANK_MIN_SCORE` (0..1, default 0 = no floor = unchanged). Cohere + TEI
     dispatchers drop docs whose relevance falls below the floor and log
     `dropped=N (min_score=X)` in explanations. Pure-function helper `applyRerankMinScore`
     (exported, 5 unit tests).
- **Live measurement:** cross-encoder (bge-reranker-v2-m3) vs no-rerank baseline on the 48-query
  golden set: R@10 +0.023, adversarial-pass 0.75 → **1.00**, R@3 −0.023 (single-query noise-floor
  artifact). Latency 38 ms / query. See `docs/benchmarks/2026-06-16-rerank-quality-recall.md`.
- **Files:** `src/env.ts`, `src/services/lessons.ts`, `src/api/routes/lessons.ts`,
  `src/mcp/index.ts`, `src/qc/rerankBenchmark.ts`, `src/services/lessons.test.ts`.
  Design: `docs/specs/2026-06-16-deferred-030-rerank-quality.md`.
- **Source:** Spec [[2026-06-16-cross-encoder-rerank-integration]] · benchmark
  `docs/benchmarks/2026-06-16-cross-encoder-rerank-benchmark.md`. User opted "Deploy + clean
  re-measure (latency)" and deferred the label refresh.

---

## DEFERRED-029

- **What:** Tenant isolation is asymmetric across transports. The tenant-scope work
  (DEFERRED-004, Sprint 15.12) is **Express middleware** (`requireScope`/`requireProjectScope`/
  `requireResourceScope`) and the service layer does not re-check caller scope. The **MCP
  transport does not run that middleware** and has no per-project scope concept — MCP auth is a
  single shared `workspace_token` (binary gate); `project_id` is a free parameter defaulting to
  `DEFAULT_PROJECT_ID`. So with `MCP_AUTH_ENABLED=true`, any token-holder can reach any project's
  lessons + coordination state via the MCP path. (15.11 authorization *levels* live in the
  service layer, so they DO apply to MCP; only tenant-scope is REST-only.)
- **Why deferred:** found during WS3 of the milestone review
  (`docs/qc/ws3-seam-bughunt-findings.md` S3). A cross-phase architectural gap, not a single bug;
  needs a product decision before implementation.
- **Decision needed:** is the MCP surface single-tenant-per-instance (then document it and close),
  or must it enforce per-project isolation on a shared instance (then move scope enforcement into
  the service layer so both REST and MCP inherit it, and add scoped MCP tokens)?
- **Trigger condition:** any plan to run a shared multi-tenant instance with `MCP_AUTH_ENABLED`,
  OR a security review of the MCP surface.
- **Estimated size:** L–XL — service-layer scope enforcement (so both transports inherit it) +
  scoped MCP token model + tests on the MCP path.
- **Priority:** MED — exploitable only with `MCP_AUTH_ENABLED=true` on a shared multi-tenant
  instance; the dev posture (auth-off, single tenant) is unaffected. But MCP is the primary client
  surface, so isolation gaps there matter more than on REST.
- **Session deferred:** 2026-05-23
- **Session resolved:** 2026-05-23 (same session — scoped + implemented + verified)
- **Sessions open:** 1
- **Status:** **RESOLVED** — implemented across PRs #20–#29 (9 stacked PRs + 1 orthogonal test-fix PR #30).
  Live-verified in dev mode + auth-on mode + hardened mode.
- **Implementation summary:**
  - **Mechanism shipped: Option B — explicit `callerScope` parameter**, threaded through ~115 service
    fns across 8 domain PRs (B/C1/C2/C3/D1/D2/D3/D4). 10 service-layer scope helpers (`assertCallerScope`
    + 8 DB-derive `assertXScope` helpers + `assertCallerScopeMulti`). Both REST and MCP transports
    inherit the same enforcement.
  - **Scoped MCP tokens:** `api_keys.project_scope` (re-used from Phase 13) is now the per-project
    MCP token model. Legacy single-shared `CONTEXT_HUB_WORKSPACE_TOKEN` deprecated, opt-out via
    `MCP_LEGACY_TOKEN_DISABLED=true` (PR E). REST `bearerAuth` also honors the disable flag (SEC-7
    fix, found during hardened-mode live verification).
  - **Security review:** 5 verification passes (4 cold-start static adversaries + 1 hardened-mode
    live verify) found 7 bypasses (2 CRITICAL + 4 HIGH + 1 MEDIUM latent), all fixed BEFORE merge.
    Diminishing-returns curve: 3 → 2 → 1 → 0 (static) + 1 (live).
  - **Test coverage:** 843 unit tests green (+123 from pre-session 720) — includes 8 real-DB
    regression tests + 18 auth-ON E2E tests covering REST + MCP cross-tenant matrix. Full E2E sweep
    in dev mode: 300/300 (api 128 + gui 52 + smoke 111 + agent 9).
- **Artifacts:**
  - PRs: #20 (B), #21 (C1), #22 (C2), #23 (C3), #24 (D1), #25 (D2), #26 (D3), #27 (D4), #28 (E), #29 (F)
  - Test-fix PR (independent of stack): #30
  - Closeout doc: `docs/deferred-029-closeout.md`
  - Migration doc: `docs/specs/2026-05-23-deferred-029-pr-e-legacy-token-migration.md`
  - DESIGN doc: `docs/specs/2026-05-23-deferred-029-mcp-tenant-scope-design.md`
  - 3 persisted MCP lessons: cold-start adversary guardrail (5287a774), three recurring bypass
    patterns (17320a37), trust model decision (62b4e10a)
- **Known limitations (Phase 16 candidates, not blocking):**
  - LOW-2: `searchLessonsMulti` + `include_groups: true` strict-rejects scoped callers.
    Functional regression, not a leak. Documented in migration doc with workaround.
- **Source:** WS3 seam bug-hunt, milestone review (S3). Related: [[DEFERRED-004]] (REST tenant-scope), [[DEFERRED-024]] (run-next queue pop). Closed WS0-F5 (auth-ON E2E slice must cover MCP — now does).

---

## DEFERRED-028

- **What:** The coordination layer (Phase 15 Board) became a **light task orchestrator**, which
  contradicts the WHITEPAPER Phase 13 non-goal: *"Not a task orchestrator… does not assign work
  to agents, schedule agent runs, or manage dependencies between tasks."* Concretely:
  `tasks.depends_on` + `claimTask` blocking a claim with `unmet_dependencies`
  ([board.ts:392](src/services/board.ts#L392)) = dependency-sequenced work; `tasks.raci` =
  assignment; `chaining.ts` auto-materializes approved decisions into (dependency-gated) tasks.
- **Why deferred:** found during WS1 of the milestone review (`docs/qc/ws1-drift-audit-findings.md`
  D1/D2). This is not a bug — it is a doc-vs-implementation contradiction that needs a **product
  decision**, not a code fix in the review PR.
- **Decision needed:** either (a) update the non-goal/whitepaper to acknowledge the system now
  does dependency-sequenced task coordination (likely the right call — the feature is deliberate
  and shipped), or (b) reconsider hard-gating vs advisory `depends_on`.
- **Trigger condition:** next WHITEPAPER revision OR a product-owner review of coordination scope.
- **Estimated size:** XS (doc) if (a); M if (b) revisits gating semantics.
- **Priority:** LOW — behavior is intentional and tested; the gap is documentation/intent, not correctness.
- **Session deferred:** 2026-05-23
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-23 (`milestone-review-phase-15`) — chose option (a): the WHITEPAPER
  Phase 13 "Not a task orchestrator" non-goal now carries a Phase 15 scope note acknowledging the
  Board does dependency-sequenced task coordination (`depends_on` gating + `raci` + chaining),
  while clarifying the decision-to-work stays human/collective-driven and it is still not a
  scheduler/runtime. Phase 15 Board bullet updated to surface `depends_on`/`raci`.
- **Source:** WS1 drift audit, milestone review (D1/D2).

---

## DEFERRED-025

- **What:** Hard 500 when the embedding model is unavailable. `searchLessons`, `updateLesson`
  (`src/services/lessons.ts`), and `runExtraction` (`src/services/extraction/pipeline.ts`)
  propagate `embedTexts` HTTP 400 ("model unloaded") as an unhandled 500 to the client.
- **Why deferred:** found during WS0 of the Phase 9–15 milestone review (`docs/qc/ws0-regression-findings.md` F2); a real-bug fix that needs its own debugging task, not bundled into the review test PR.
- **Drift:** Phase 6 design promised graceful fallback when the model is unavailable (tiered
  search → FTS). Search should degrade to FTS; write paths (update/extract) should enqueue
  re-embed as a job rather than failing the write.
- **Trigger condition:** any embeddings-availability hardening pass, OR a user report of 500s
  during model load/unload.
- **Estimated size:** M — fallback in search path + async re-embed on write paths + tests.
- **Priority:** MED — degrades core search/write whenever the embedding server hiccups.
- **Session deferred:** 2026-05-23
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-23 (`milestone-review-phase-15`). **Read paths:** `searchLessons`
  and `searchLessonsMulti` now catch an embed failure, log a WARN, and degrade to FTS-only ranking
  (sem_score → `0`, require an actual FTS match so we don't return the whole table; empty result
  when there are also no FTS tokens). **Write paths (fail-loud, cleanly):** `embedder.embedTexts`
  now throws `ContextHubError('SERVICE_UNAVAILABLE')` on an embeddings HTTP error → mapped to **503**
  (new code in `errorHandler`), instead of leaking a raw "HTTP 400" as a generic 500. Tests:
  `embedder.test.ts` (typed SERVICE_UNAVAILABLE) + live-verified the FTS fallback end-to-end against
  the rebuilt stack with embeddings unreachable (matches returned, no throw). 728 unit green; tsc
  clean; semantic happy-path E2E 105/105 on the rebuilt container.
- **Source:** WS0 regression run, milestone review (F2).

---

## DEFERRED-026

- **What:** Global search references a non-existent column. `src/services/globalSearch.ts:80`
  runs `SELECT sha, message, author, committed_at AS date` against `git_commits`, but that
  table has `author_name`/`author_email` (migration 0005), no `author`. The per-source error
  is swallowed, so the **commits section is silently dropped** from global-search results
  while smoke tests stay green.
- **Why deferred:** found during WS0 of the milestone review (`docs/qc/ws0-regression-findings.md` F3); real-bug fix with its own (small) task.
- **Trigger condition:** immediate — small, safe fix (`author` → `author_name`, or alias).
- **Estimated size:** XS — one column reference + a global-search test asserting commit hits.
- **Priority:** MED — global search silently returns incomplete results (no commits).
- **Session deferred:** 2026-05-23
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-23 (`milestone-review-phase-15`) — `globalSearch.ts:80` now selects
  `author_name AS author` (preserves the API contract). Regression test
  `src/services/globalSearch.test.ts` seeds a commit and asserts it surfaces with author populated.
- **Source:** WS0 regression run, milestone review (F3).

---

## DEFERRED-027

- **What:** `updateLessonStatus` (`src/services/lessons.ts`, the `PATCH /api/lessons/:id/status`
  path) leaks a raw DB error as a 500 on a malformed uuid: `invalid input syntax for type
  uuid: "undefined"`. A missing/invalid id or `superseded_by` should be validated and returned
  as 400, not surfaced as an unhandled Postgres error.
- **Why deferred:** found during WS0 of the milestone review (`docs/qc/ws0-regression-findings.md` F4); real-bug fix with its own task (root-cause whether the undefined comes from a caller or a missing guard).
- **Trigger condition:** immediate — input-validation hardening.
- **Estimated size:** S — uuid validation at the route/service boundary + a 400 test.
- **Priority:** LOW–MED — leaks DB internals and returns 500 for what should be a 400; not a data-integrity risk.
- **Session deferred:** 2026-05-23
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-23 (`milestone-review-phase-15`) — added `assertUuid()` guard in
  `lessons.ts`, called at the top of `updateLessonStatus` (lessonId + superseded_by) and
  `updateLesson` (lessonId); throws `ContextHubError('BAD_REQUEST')` → 400 via errorHandler.
  Service-layer guard so REST + MCP + import all inherit it. 3 tests in `lessons.test.ts`.
- **Source:** WS0 regression run, milestone review (F4).

---

## DEFERRED-024

- **What:** `POST /api/jobs/run-next` pops the next queued job across ALL projects
  (`runNextJob(queue_name)` has no project filter). A project-scoped api key calling it
  could run another project's queued job. DEFERRED-004 (the writer-route tenant-scope
  audit) guarded every body/query/resource route but could NOT close this one with a
  request-time guard — there is no project in the request; the cross-project reach is in
  the SERVICE's pop semantics.
- **Why deferred:** DEFERRED-004 CLARIFY Q3 — Tier-2. Closing it needs a
  `runNextJob(queue, projectScope?)` signature change so the pop filters by the caller's
  scope (and the route passes `req.apiKeyScope`). That is a scheduling-semantics change
  (a scoped worker only drains its own project's queue) with its own design + test
  surface, distinct from the request-time guard work.
- **Trigger condition:** a sprint that touches the job queue / worker, OR enabling
  `MCP_AUTH_ENABLED=true` with project-scoped keys that call `run-next`.
- **Estimated size:** S–M — `runNextJob` gains an optional project filter; the route
  passes the scope; tests for scoped vs global pop.
- **Priority:** LOW — `run-next` is a worker/operator endpoint; in the dev posture
  (`MCP_AUTH_ENABLED=false`) there is no scope. Exploitable only auth-on with a scoped
  key deliberately draining another project's queue.
- **Session deferred:** 2026-05-21
- **Sessions open:** 1
- **Status:** RESOLVED — 2026-05-21 (`run-next-scope-deferred-024`):
  `claimNextQueuedJob(queue, projectScope?)` adds `AND project_id = $2` to the pop CTE
  when a non-empty `projectScope` is supplied; `runNextJob(queue, projectScope?)` threads
  it; `POST /api/jobs/run-next` passes `req.apiKeyScope`. A project-scoped api key drains
  ONLY its own project's queue (and correctly skips null-project/global jobs). The
  background worker, auth-off, and global-scope keys pop across all projects unchanged
  (undefined/null scope → no filter). 5 tests in `jobQueueScope.test.ts`. Closes the last
  tenant-scope hole (Tier-2 of DEFERRED-004).
- **Source:** DEFERRED-004 CLARIFY Q3 / DESIGN §4 (`docs/specs/2026-05-21-deferred-004-tenant-scope-design.md`).

---

## DEFERRED-023

- **What:** `taxonomy_profiles` is not a knowledge-bundle entity. The Phase 11 export/
  import path carries `lesson_types` (incl. `scope` as of DEFERRED-008), but the
  `taxonomy_profiles` table itself does not round-trip. A `scope='profile'` lesson type
  imported with correct scope (post-DEFERRED-008) attaches to a profile of the same key
  ONLY if that profile exists on the destination — which today happens only via the
  config-seed (`config/taxonomy-profiles/*.json`) on a fresh instance, not via the bundle.
- **Why deferred:** DEFERRED-008 (2026-05-21) CLARIFY Q1 — the user chose the scope-only
  fix (close the data-integrity leak) and deferred the profiles round-trip as a separate
  feature. Adding `taxonomy_profiles` as a bundle entity is a new ENTRY_NAME + export
  iterable + import handler + manifest + conflict policy + tests (its own S–M scope).
- **Trigger condition:** a sprint that touches `src/services/exchange/*` for a feature
  reason, OR a user report that a cross-instance import lost taxonomy-profile definitions
  (not just type classification — DEFERRED-008 fixed the classification).
- **Estimated size:** S–M — new bundle entity `taxonomy_profiles.jsonl` (ENTRY_NAMES,
  encode iterable, BundleReader method), export SELECT, import apply handler with a
  conflict policy, manifest count, `bundleFormat.test.ts` + import e2e coverage.
- **Priority:** LOW — profiles re-seed from config on a fresh instance; the
  DEFERRED-008 fix already stops the scope-LEAK (the data-integrity issue). This is the
  remaining round-trip-completeness enhancement.
- **Session deferred:** 2026-05-21
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-23 — `taxonomy_profiles` is now a bundle entity. `bundleFormat.ts`
  (ENTRY_NAMES + BundleData + BundleReader.taxonomy_profiles + encode/iterate), `exportProject.ts`
  (owner-project cursor; owner_project_id NOT carried), `importProject.ts` (counts/conflict union +
  processBatched + `applyTaxonomyProfile` — owner rebound to target, built-in overwrite refused).
  Export's `WHERE owner_project_id=$1` filter + built-ins being owner-NULL means a bundle can never
  carry/inject a system built-in. 4 round-trip tests in `scopeRoundTrip.test.ts`; 720/720 green; no
  migration. Branch=taxonomy-profiles-bundle-deferred-023.
- **Source:** DEFERRED-008 CLARIFY Q1 (`docs/specs/2026-05-21-deferred-008-exchange-scope-clarify.md`); the original DEFERRED-008 "related" note.

---

## DEFERRED-022

- **What:** Multi-tier collective request-step routing. Sprint 15.8 supports collective
  steps ONLY on single-step routes (`escalate_to_authority` OR single-step `counter_sign`).
  The DoA matrix carries one `body_id` per row; a multi-step `counter_sign` collective
  route would inherit ONE body across all steps, collapsing the "distinct endorser at
  each level" guarantee to a single body. 15.8 hard-rejects multi-step counter_sign+
  collective at `submitRequest` with `BAD_REQUEST`. The realistic governance pattern
  ("coordination committee endorses, then authority board endorses" — two different
  bodies, one per level) is therefore unsupported.
- **Why deferred:** Sprint 15.8 REVIEW-DESIGN r1 F3 (WARN) — accepted-with-doc. The
  feature requires either (a) per-level body assignment in the DoA matrix (a new
  `doa_matrix_levels` table or a JSON column mapping level→body_id) or (b) a per-
  submission `collective_bodies` blob. Both are substantial design surface in their
  own right; 15.8 shipped the single-step common case to close DEFERRED-018 in a
  contained M sprint.
- **Trigger condition:** a Phase 15 sprint that implements per-level body assignment,
  OR a user-reported case where single-step collective insufficiency surfaces in
  practice.
- **Estimated size:** M — schema design + matrix lookup changes + submitRequest
  per-step body resolution + tests + the lapsed-escalation handling at each level
  (currently degrades to unilateral; with per-level bodies, could re-propose under
  the new level's body).
- **Priority:** LOW — single-step collective covers the most common "a single
  committee decides" pattern. Multi-tier collective is a governance enhancement.
- **Session deferred:** 2026-05-20
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.10 (2026-05-21): new `doa_matrix_levels (matrix_id,
  level, body_id)` table for per-level body assignment + `requests.body_by_level JSONB`
  snapshot column (honors B.7 snapshot-the-rules). submitRequest resolves per-step
  body via Map (table preferred, single-body fallback for 15.8 compat); distinct-body
  check on counter_sign+collective routes; missing_collective_body rejection.
  applyMotionToStep lapsed path reads the snapshot → re-propose under next level's
  collective body if configured, else fallback degrade-to-unilateral (Q2(a)).
  Event payload unified on `escalated_to: 'collective' | 'unilateral'` field (F2 fix —
  replaces 15.8's `degraded_to`). Backward compatible with 15.8 single-step collective
  matrix rows. Per-actor cross-body collusion documented as out-of-scope (interlocks
  with DEFERRED-015 — F3 accept-with-doc). 6 new tests + live smoke confirmed.
- **Source:** Phase 15 Sprint 15.8 REVIEW-DESIGN r1 F3 + DESIGN §2.2.

---

## DEFERRED-021

- **What:** MCP `decide_step` + `tally_motion` outputSchema does not declare the
  Sprint 15.7 `chain: {kind:'posted'|'deferred', ...}` field. The chain result is
  service-side correct (included in REST responses and the coordination_events log),
  but MCP `structuredContent` silently drops it because the outputSchema lacks the
  property. MCP clients reading `structuredContent.chain` see `undefined`.
- **Why deferred:** Sprint 15.7 REVIEW-CODE F3 (LOW). Adding a clean discriminated-
  union shape (`chain.kind='posted'` vs `'deferred'`) interlocks with DEFERRED-007
  (MCP SDK known issue with discriminated-union outputSchemas — `tool/call` returns
  `_zod` error). A flat-optional shape would work but is loose; defer the proper
  design to 15.8.
- **Trigger condition:** Sprint 15.8 OR the next sprint touching MCP outputSchemas,
  OR a reported MCP-client regression where the caller depends on `structuredContent.chain`.
- **Estimated size:** S — schema update + a regression test for `tool/call` end-to-end
  asserting the chain field; interlocks with DEFERRED-007 resolution.
- **Priority:** LOW — REST and event log carry the field; MCP callers can fall back to
  text parsing or REST.
- **Session deferred:** 2026-05-20
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.9 (2026-05-20): MCP `decide_request_step` and
  `tally_motion` outputSchemas declare optional `chain` field with FLAT-OPTIONAL shape
  (kind: required string, task_id/artifact_id/reason/deferred_event_id: optional strings)
  to avoid DEFERRED-007 discriminated-union SDK issue. Live `tools/list` smoke confirmed
  both schemas include the chain object property.
- **Source:** Phase 15 Sprint 15.7 REVIEW-CODE r1, F3 (`docs/audit/findings-sprint-15.7-code-r1.md`).

---

## DEFERRED-020

- **What:** Three LOW-severity test coverage gaps from the Sprint 15.6 `/review-impl` pass.
  **(a)** LOW-7: No API-level test for the route-layer fractional step-index guard (`/^\d+$/`
  in `routes/requests.ts:169`) — the existing service-layer test (`AC17`) hits `decideStep`
  directly; the route guard adds a 400 before it. **(b)** LOW-8: No test for the
  `artifact_advanced:true` path on the approved branch (AC15 covers `false`); no test that the
  `escalation_exhausted` sweep event in `coordinationSweep.ts` carries `artifact_advanced:false`
  (the field was added in 15.6 but only the `reject` path is test-asserted). **(c)** LOW-9: No
  event-ordering assertions in the drain tests `AC2`/`AC3` — tests verify counts and final state
  but do not assert `claim.force_lapsed` / `request.force_closed` precede `topic.closed` in the
  event log.
- **Why deferred:** All three are test coverage improvements, not production risks. Fixing them in
  the Sprint 15.6 POST-REVIEW cycle would have been batching LOW items with a HIGH fix — against
  the workflow's fix-HIGH-now, defer-LOW policy.
- **Trigger condition:** Any sprint that edits the affected code paths, or a dedicated test-
  coverage pass.
- **Estimated size:** XS–S — one route test for (a); one service test each for (b); two
  assert additions for (c).
- **Priority:** LOW
- **Session deferred:** 2026-05-18
- **Sessions open:** 3
- **Status:** RESOLVED — Sprint 15.9 (2026-05-20):
  (a) LOW-7 — 2 route-level tests added in `src/api/routes/requests.test.ts` covering
      fractional (`1.5`) + negative (`-1`) step-index inputs; assert 400 + BAD_REQUEST
      code from the route layer (not the service);
  (b) LOW-8 — positive `artifact_advanced:true` test in `requests.test.ts` (approve
      branch, cross-checked with artifact state→'final'); added assertion to T18 sweep
      test in `coordinationSweep.test.ts` that `escalation_exhausted` payload carries
      `artifact_advanced:false`;
  (c) LOW-9 — added event-ordering assertions to topics drain AC2+AC3 in `topics.test.ts`
      asserting `claim.force_lapsed` / `request.force_closed` events precede `topic.closed`
      by `seq` ordering.
- **Source:** Phase 15 Sprint 15.6 `/review-impl` LOW-7, LOW-8, LOW-9.

---

## DEFERRED-019

- **What:** Master design C.4 specifies that a **resolved Request** or a **carried Motion**
  emits an event whose handler **posts a new board task** ("execute the approved/carried
  outcome") — unless the topic is `closing`/`closed`, in which case it emits `task.deferred`.
  Neither Sprint 15.3 (request) nor Sprint 15.4 (motion) implemented this chaining: a 15.3
  `approved` request's outcome = the artifact advance + `request.resolved`; a 15.4 `carried`
  motion's outcome = the status flip + `motion.tallied`. No chained board task is posted by
  either primitive.
- **Why deferred:** Sprint 15.3 CLARIFY out-of-scope ("underspecified — *what task?* — and it
  interlocks with the topic `closing`-drain, DEFERRED-012") and Sprint 15.4 CLARIFY out-of-scope
  (the same, for motions). The chaining is one concern spanning both primitives and interlocks
  with DEFERRED-012 — the `closing`-drain handler must *suppress* chaining (emit `task.deferred`
  into the sealed trail) so a draining topic is never re-filled. Best built once, with
  DEFERRED-012, after the "what task does a carried motion / approved request spawn?" question
  is settled.
- **Trigger condition:** a Phase 15 sprint that implements primitive-outcome chaining — likely
  alongside or after DEFERRED-012 (the `closing`-drain), since the two interlock. No hard
  deadline; a feature follow-on.
- **Estimated size:** M — an event handler that posts a board task on `request.resolved`
  (approved) / `motion.tallied` (carried), suppressed on a `closing`/`closed` topic; tests;
  interlocks with DEFERRED-012.
- **Priority:** LOW — the resolved/carried outcome is fully recorded in the event log; a human
  or a successor process acts on it from the log. Automatic chaining is an ergonomics
  enhancement.
- **Session deferred:** 2026-05-18
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.7 (2026-05-20): chain emits at 3 sites (decideStep approve,
  tallyMotion carried, sweepExpiredMotions carried). Submitter-specified `execution_task` JSONB
  blob on requests + motions (migration 0060); chain merges blob over derived defaults. Dual-
  emit `task.deferred` (subject_type='topic') on closing/closed. Throws
  CHAINED_TASK_DEPENDENCY_INVALID → source ROLLBACK on bad blob. Source event payload extended
  with `chain: {kind, ...}` + `deferred_event_id` cross-ref on deferral. 5 tests cover AC1+
  AC3 (decision + blob), AC6 (negative outcomes), AC7 (closing → deferred), AC10
  (invalid_depends_on → rollback).
- **Source:** Phase 15 Sprint 15.3 + 15.4 CLARIFY out-of-scope; master design
  `docs/phase-15-design.md` C.4.

---

## DEFERRED-018

- **What:** A Sprint 15.3 `request_steps` row carries a `procedure` column
  (`unilateral`/`collective`); `submitRequest` (`src/services/requests.ts`) rejects
  `procedure='collective'` with "collective steps are Sprint 15.4". Sprint 15.4 built the
  **standalone** collective-decision primitive (`decision_bodies`/`motions`/`votes`/tally/veto)
  but did **not** wire it into request-step decision — a `procedure='collective'` step decided
  by a motion's tally instead of one officeholder's `decideStep`. `submitRequest` still rejects
  `collective`.
- **Why deferred:** Sprint 15.4 CLARIFY Q1 — the user's decision: 15.4 = the standalone motion
  machinery (the master roadmap's stated 15.4 scope). The `procedure='collective'` request-step
  integration is a cross-primitive contract (a request step's deadline/escalation interacting
  with a motion's full lifecycle) deserving its own design focus; folding it in would have
  re-expanded the security-review surface of the just-hardened (15.3.1) `requests.ts`.
- **Trigger condition:** a Phase 15 sprint that wires the Request and collective-decision
  primitives — makes a request step resolvable by a decision body. No hard deadline; a feature
  follow-on.
- **Estimated size:** M — `decideStep` (or a new path) routes a `collective`-procedure step to
  a motion; the motion's `carried`/`failed` maps to the step's `endorsed`/`returned`; the step
  deadline ↔ the motion deadline reconciled; per-path tests.
- **Priority:** LOW — `unilateral` (the only shipped request procedure) covers the current
  need; `collective` request steps are an enhancement.
- **Session deferred:** 2026-05-18
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.8 (2026-05-20): collective request-step wiring shipped.
  Migration 0061 added `doa_matrix.procedure+body_id` + `request_steps.body_id+motion_id` +
  status='motion_proposed'. submitRequest accepts collective; `proposeStepMotion` auto-proposes
  a motion at step 0; `decideStep` early-rejects collective with 'procedure_is_collective';
  `applyMotionToStep` (called from tallyMotion + vetoMotion + sweepExpiredMotions) handles
  4 outcomes (carried→step.endorsed advance, failed→returned, lapsed→degrade-to-unilateral
  escalation, vetoed→rejected). 15.7 chain fires on collective-carried-final via the same
  emitChain path; motion-chain suppressed on step-proposal motions to avoid duplicate tasks.
  Limitation: only single-step routes supported (multi-step counter_sign+collective rejected
  → DEFERRED-022).
- **Source:** Phase 15 Sprint 15.4 CLARIFY Q1 / out-of-scope
  (`docs/specs/2026-05-18-phase-15-sprint-15.4-clarify.md`); the Sprint 15.3 design decision D6.

---

## DEFERRED-017

- **What:** Phase 15 Sprint 15.4's collective-decision primitive
  (`decision_bodies`/`body_members`/`motions`/`votes`) carries the **same self-declared-authority
  class as DEFERRED-015/016**. `createBody` (`src/services/decisionBodies.ts`) is **ungated** —
  any `writer`-role caller mints a body with itself as the sole weighted member + itself in
  `veto_holders`. `addBodyMember` is ungated — anyone adds anyone at any weight. `castVote`'s
  `proxy_for` is **recorded but the proxy grant is unverified** (no `proxies` table). And
  `proposeMotion`'s `not_participant` gate is itself satisfiable by any caller because
  `joinTopic` is ungated (the Sprint 15.4 POST-REVIEW Adversary WARN-1). The *mechanism* is
  sound — quorum/threshold/veto/the vote-weight snapshot/the atomic ballot FSM cannot be
  subverted by a mutually-distrusting body member, and the early-tally vector is closed — but
  *who* may create a body / grant veto power / set a vote weight / hold a proxy is **not
  authorized**. Also (Sprint 15.4 REVIEW-CODE LOW-3): `decision_bodies.veto_holders` has no
  array-length / element-length cap — input hygiene on the same body-creation surface.
- **Why deferred:** Sprint 15.4 DESIGN §0.5 (the explicit honest-scope section) + CLARIFY (the
  user's decision — 15.4 = the standalone motion *mechanism*, coordinator-trusted under the
  `MCP_AUTH_ENABLED=false` single-operator dev posture). Body / membership / veto-power
  authorization is the **Phase 15 authorization model** — the same subsystem as DEFERRED-015
  (self-declared participant `level`), DEFERRED-016 (api-key multiplicity), DEFERRED-009
  (topic-scope authz); best built once as a coherent piece, not bolted onto the motion
  primitive.
- **Trigger condition:** **HARD trigger — same class as DEFERRED-015/016: MUST be resolved
  (together with 015 + 016) before ANY of:** (a) `MCP_AUTH_ENABLED=true` in a deployment with
  more than one non-mutually-trusting actor; (b) Sprint 15.6 (the GUI makes coordination
  interactively self-serve); (c) any production / multi-tenant use of the coordination
  primitives. Whichever comes first.
- **Estimated size:** M–L — a body/membership authorization model (who may create a body, grant
  veto power, assign a vote weight); a `proxies` grant table + verification; the `veto_holders`
  length cap (an S sub-item); interacts with the Phase 15 authz model
  (DEFERRED-009/015/016).
- **Priority:** HIGH — a residual of a governance primitive; only the `MCP_AUTH_ENABLED=false`
  single-operator dev posture keeps it non-exploitable now (the same posture as 015/016).
- **Session deferred:** 2026-05-18
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.11 (2026-05-21): decision-body authorization shipped.
  `createBody` + `addBodyMember` routes raised to `requireRole('admin')` (project-config
  operation). `veto_holders` length cap (≤64 entries, ≤256 chars each). `castVote.proxy_for`
  verification: new `proxies` table (migration 0063) + `grantProxy`/`revokeProxy`/`listProxies`
  (principal-only grant — granted_by must equal principal); `castVote` verifies the grant when
  auth-on (`proxy_not_granted`), preserves 15.4 unverified behavior auth-off (Q2 posture).
  Security review CLEAR. (DEFERRED-017 was the decision-body half of the Phase 15 authz model.)
- **Source:** Phase 15 Sprint 15.4 DESIGN §0.5; POST-REVIEW security Adversary WARN-1
  (`docs/audit/findings-sprint-15.4-post-review.md`); REVIEW-CODE LOW-3
  (`docs/audit/findings-sprint-15.4-code-r1.md`).

---

## DEFERRED-016

- **What:** Phase 15 coordination identity has no bound on **api-key multiplicity**. One
  operator who can mint api keys (`createApiKey`, `src/services/apiKeys.ts` — no per-operator
  key limit) can create N distinct DB keys; Sprint 15.3.1's F1 token-binding faithfully
  stamps each request/step with that key's `name`. So F1 makes the acting identity a
  token-bound credential handle, but it does **not** make "one human = one principal": an
  operator with key-minting power obtains as many distinct coordination identities as it
  creates keys, and can still drive a multi-level approval single-handed. (`api_keys.name`
  is also not schema-`UNIQUE`, but same-`name` keys *collapse* to one identity and are caught
  by `decideStep`'s self-decision guard — non-uniqueness is an audit-trail ambiguity, not a
  forgery vector. The residual here is key *multiplicity*, not name collision.)
- **Why deferred:** Surfaced at Sprint 15.3.1 REVIEW-DESIGN round 2 (Adversary NEW FINDING 1).
  Sprint 15.3.1's F1 closes the body-string identity-forgery vector (audit Finding 1's "pick
  two JSON strings"); bounding how many credentials one principal may hold is the
  **key-provisioning authorization model** — a different subsystem (`api_keys` /
  `createApiKey` / the `/api/api-keys` admin surface, related to DEFERRED-004) with its own
  design. An early 15.3.1 design draft wrongly described this residual as "covered by
  DEFERRED-015's trigger"; DEFERRED-015 scopes strictly to making the participant `level`
  authoritative (a `joinTopic` change) and does not own key provisioning. This item gives
  the residual a real owner.
- **Trigger condition:** Same HARD class as DEFERRED-015 — MUST be resolved (together with
  DEFERRED-015) before ANY of: (a) `MCP_AUTH_ENABLED=true` in a deployment with more than
  one non-mutually-trusting actor; (b) Sprint 15.6 (GUI self-serve coordination); (c) any
  production / multi-tenant use of the Board or Request-Approval primitives. **The Sprint
  15.3 audit's CRITICAL Finding 1 is fully closed only when F1 (Sprint 15.3.1, done),
  F2/level-authority (DEFERRED-015), and key-multiplicity bounding (this item) are all
  resolved.**
- **Estimated size:** M — a provisioning-side rule (who may mint keys; and/or binding a
  coordination actor to exactly one credential — a 1:1 actor↔key map, or per-key
  coordination-actor scoping); interacts with DEFERRED-004 (tenant-scope on admin endpoints)
  and the Phase 15 authz model (DEFERRED-009). **Verification (Sprint 15.3.1 POST-REVIEW WARN-1):** bundle an auth-on (`MCP_AUTH_ENABLED=true`) end-to-end smoke of Sprint 15.3.1's F1 (identity binding) + F4 (GET role gate) with this work — 15.3.1 verified F1/F4 via a route test-shim that reproduces `bearerAuth`'s `apiKeyName`/`apiKeyRole` contract, not a live auth-on stack.
- **Priority:** HIGH — a residual of a CRITICAL finding; only the `MCP_AUTH_ENABLED=false`
  single-operator dev posture keeps it non-exploitable now (same as DEFERRED-015).
- **Session deferred:** 2026-05-18
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.11 (2026-05-21): api-key provisioning hardened.
  (a) Actor-identity uniqueness — partial unique index `api_keys_active_name_uniq (name)
  WHERE revoked=false` (migration 0063); `createApiKey` catches 23505 → `duplicate_active_
  key_name`. (b) Per-operator key-count limit — `api_keys.created_by` column + env
  `MAX_KEYS_PER_CREATOR` (default 50); `createApiKey` counts active keys by creator and
  rejects `key_limit_exceeded`. The api-keys route passes `created_by` from `req.apiKeyName`.
  The one-human-two-keys residual is documented + bounded (security review §8 / probe P5):
  capped by the key limit + the level-grant audit chain (a key still can't self-grant
  authority). Security review CLEAR.
- **Source:** Phase 15 Sprint 15.3.1 REVIEW-DESIGN round 2, Adversary NEW FINDING 1
  (`docs/audit/findings-sprint-15.3.1-design-r2.md`).

---

## DEFERRED-015

- **What:** Phase 15 participant `level` is **self-declared and unverified**. `joinTopic` (`src/services/topics.ts`) inserts a `topic_participants` row with whatever `level` (`authority` / `coordination` / `execution`) the caller passes — there is no gate on who may become `authority` and no approval step. Sprint 15.3's `decideStep` (`src/services/requests.ts`) authorizes a step decision by `topic_participants.level === target_office` — so the officeholder check is only as trustworthy as a self-asserted level: a caller joins as `authority` and decides `authority`-target steps. (Sprint 15.3.1 binds the acting *identity* to the authenticated token, forcing a real distinct principal per actor; this item is the remaining half — making the *level* of that principal authoritative rather than self-asserted.)
- **Why deferred:** Sprint 15.3 human-in-loop review, security audit Finding F2 (CRITICAL). The user chose the "15.3.1 fix-up, defer levels" disposition: 15.3.1 closes the identity-spoofing half (F1 — token-bound `submitted_by`/`actor_id`); making `level` authoritative is a change to the 15.1 `joinTopic` write-path + the participant model with its own design surface (who may grant a level — a topic owner? an existing `authority`? an out-of-band role?), best built once as a coherent piece rather than bolted onto a fix-up.
- **Trigger condition:** **HARD trigger — MUST be resolved before ANY of:** (a) `MCP_AUTH_ENABLED=true` in a deployment with more than one non-mutually-trusting actor; (b) Sprint 15.6 (the GUI makes the coordination system interactively self-serve); (c) any production / multi-tenant use of the Board or Request-Approval primitives. Whichever comes first. Until then, the coordination authorization model is sound only under a single trusted operator (the current `MCP_AUTH_ENABLED=false` dev posture).
- **Estimated size:** M–L — a `level`-grant path (level set/changed only by a topic owner or an existing `authority` participant, not self-asserted at join); `joinTopic` defaults a new participant to `execution`; a level-change operation + event; tests. Interacts with the broader Phase-15 authorization model (DEFERRED-009).
- **Priority:** HIGH — the residual half of a CRITICAL finding; only the `MCP_AUTH_ENABLED=false` single-operator dev posture keeps it non-exploitable now.
- **Session deferred:** 2026-05-18
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.11 (2026-05-21): level-grant chain shipped. `joinTopic`
  no longer self-asserts level — the topic OWNER (`created_by`, a permanent grant root) may
  set their own level at first join (bootstrap); every other joiner is forced to `execution`
  (non-owner non-execution → `BAD_REQUEST level_grant_required`). New `grantLevel(topic_id,
  actor_id, level, granted_by)` op: only the owner or an existing `authority` may grant;
  self-grant forbidden; emits `topic.level_granted` (migration 0063 adds
  `topic_participants.granted_by`). Enforced ALWAYS (auth-on + auth-off, keyed on actor_id).
  `decideStep`'s `level === target_office` check is now authoritative. Owner-permanence: a
  demoted owner retains grant power (tested). Security review CLEAR — HARD pre-prod authz
  trigger satisfied for the coordination-role surface. (Tenant-scope authz remains DEFERRED-009.)
- **Source:** Phase 15 Sprint 15.3 human-in-loop review, security audit Finding F2 (`docs/audit/findings-sprint-15.3-human-review-security.md`).

---

## DEFERRED-014

- **What:** Two LOW-severity consistency residuals from the Sprint 15.3 REVIEW-CODE `/review-impl` pass, both in `src/services/requests.ts`. **(a)** `listRequests` does not check topic existence — `GET /api/topics/<unknown>/requests` returns `200 {requests:[]}`, whereas the 15.2 sibling `listBoard` carries an explicit topic-existence check (`board.ts` `[LOW-7]`) returning `NOT_FOUND`, and `getRequest` returns 404 for an unknown request; a caller cannot distinguish "topic has no requests" from "topic does not exist". **(b)** The `request.resolved` event payload is non-uniform — `approved`/`returned` carry `artifact_advanced`, while `rejected` (`requests.ts`) and `escalation_exhausted` (`coordinationSweep.ts`) omit it, so a consumer replaying the event log (AC11's authoritative record) sees the field on only 2 of 4 outcomes. **(c)** [Sprint 15.3.1 POST-REVIEW WARN-2] the REST decide route (`routes/requests.ts`) derives `step_index` via `parseInt(req.params.n)`, which truncates a fractional path segment (`/steps/1.5/decide` → `1`) — so Sprint 15.3.1's F5 fractional-rejection in `decideStep` is unreachable from REST (cosmetic: the truncated step fails safe to `not_current_step`; the negative case still reaches `decideStep` and is rejected; MCP rejects fractionals at `z.number().int()`). **(d)** [Sprint 15.3.1 REVIEW-CODE LOW-5] `submitted_by` / `actor_id` are not length-capped while 15.3.1's F7 caps `kind`/`subject_id` at 256 — an asymmetry (defensible: auth-on binds the identity to `apiKeyName` ≤128, auth-off is operator-trusted).
- **Why deferred:** Sprint 15.3 REVIEW-CODE `/review-impl` findings #4 + #5, both LOW. The code faithfully implements design rev 3 (which passed 3 cold-start Adversary rounds) — both items are "the reviewed contract could be marginally more consistent", not defects. Changing them in REVIEW-CODE would deviate from the reviewed design contract without re-running REVIEW-DESIGN. The REVIEW-DESIGN round-3 Adversary explicitly considered (a) and judged the current behavior "defensible, not worth a finding". Bundled for a future touch of the requests surface.
- **Trigger condition:** Sprint 15.6 (the GUI lists requests — a 404-vs-empty distinction becomes user-visible) OR any sprint that edits `src/services/requests.ts` or the coordination event-payload schema. **Re-defer note (Sprint 15.3.1):** 15.3.1 edited `requests.ts` / `routes/requests.ts` — nominally this trigger — but it was a deliberately-minimal security fix-up (F1/F3a/F4/F5/F7 only); bundling these non-security consistency residuals would have broadened the change and the security-review surface. Re-deferred — the trigger now means the next *feature* touch of the requests surface, or Sprint 15.6.
- **Estimated size:** S — (a) a plain `SELECT 1 FROM topics` existence check in `listRequests` + a test; (b) emit `artifact_advanced:false` on the reject + `escalation_exhausted` paths for a uniform payload + adjust the assertions; (c) a route-layer integer check on `req.params.n` for an honest 400; (d) a 256-char cap on `submitted_by` / `actor_id`.
- **Priority:** LOW — (a) `topic_id` is a UUID (not guessable) and an empty list is functional; (b) a replay consumer can treat a missing `artifact_advanced` as `false`.
- **Session deferred:** 2026-05-18
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.6 (2026-05-18): (a) `listRequests` NOT_FOUND check + AC14 test; (b) `artifact_advanced:false` on reject + escalation_exhausted paths + AC15; (c) route `parseInt` guard `/^\d+$/` + AC17; (d) `submitted_by` 256-char cap + AC18.
- **Source:** Phase 15 Sprint 15.3 REVIEW-CODE `/review-impl` review, findings #4 + #5 (`docs/audit/findings-sprint-15.3-code-r1.md`); extended (c)+(d) by Sprint 15.3.1 POST-REVIEW WARN-2 + REVIEW-CODE LOW-5.

---

## DEFERRED-013

- **What:** A `counter_sign` request route requires a *distinct* endorsement at each level on the route — that is its multi-party guarantee. Sprint 15.3's escalation sweep (`sweepStalledSteps`, `src/services/coordinationSweep.ts`) climbs a timed-out step's `target_office` up one level in place (design D9); when it climbs to a level a *later* step on the same route also targets, the route then has two steps at the same level. `decideStep` (`src/services/requests.ts`) authorizes by `level == target_office` (+ `actor ≠ submitted_by`) and does **not** track which actors decided earlier steps — so a single officeholder at that level can endorse both steps, collapsing the counter-sign's distinct-endorser guarantee into a single-endorser approval. Neither same-level step-collapse/de-duplication nor distinct-endorser enforcement (`decideStep` rejecting an actor who already decided an earlier step of the same request) is implemented in 15.3.
- **Why deferred:** Sprint 15.3 REVIEW-DESIGN round-2 Adversary finding W1 (WARN — non-fatal). It arises only on the post-deadline escalation path (already an abnormal route), the outcome is fully recorded in the event log, and the request still terminates correctly. The 15.3 design (§11.2, invariant 3) accepts it explicitly. The clean fix interacts with the collective-decision model (15.4) and the dispute model (15.5) — a route's quorum / distinct-endorser semantics should be settled once, alongside motions and votes, not bolted onto 15.3.
- **Trigger condition:** Sprint 15.5 (dispute), OR a reported case of an escalated counter-sign request being approved by a single endorser. Whichever sprint formalizes multi-party endorsement should add distinct-endorser enforcement to `decideStep` and/or same-level step-collapse at escalation time. **Re-defer note (Sprint 15.4):** Sprint 15.4 (collective decision) was a named trigger here, but the user's CLARIFY Q2 decision kept 15.4 to the standalone motion primitive — 15.4 does **not** touch `requests.ts` / `decideStep`, so folding the distinct-endorser fix in would have re-opened the just-hardened (15.3.1) security surface for an unrelated reason. Re-deferred to **Sprint 15.5** (dispute — which also formalizes multi-party adjudication of a request route).
- **Estimated size:** S–M — `decideStep` checks the request's already-decided `request_steps.decided_by` set and rejects a repeat endorser; optionally collapse adjacent same-`target_office` steps when the escalation sweep climbs a step; per-path tests.
- **Priority:** LOW — post-timeout-only, fully auditable, the request still terminates correctly.
- **Session deferred:** 2026-05-17
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.6 (2026-05-18): `decideStep` for `counter_sign` routes queries prior `request_steps.decided_by IS NOT NULL`; same actor in any prior step → `repeat_endorser` (→ HTTP 409). AC13 (negative) + AC16 (positive/distinct-actor) tests added.
- **Source:** Phase 15 Sprint 15.3 REVIEW-DESIGN round 2, Adversary finding W1 (`docs/audit/findings-sprint-15.3-design-r2.md`).

---

## DEFERRED-012

- **What:** `closeTopic` (`src/services/topics.ts`) is **atomic** — a topic flips `chartered|active → closed` in one step and the `coordination_events` log seals immediately. There is no intermediate `closing` drain-state in which in-flight items are force-lapsed *before* the seal. Sprint 15.1 design decision D4 specified "Sprint 15.2 adds the drain"; Sprint 15.2 re-deferred it. Consequence: a topic can be closed with a live or abandoned claim still attached; such claims are cleaned up after the fact by the abandoned-claim sweep's closed-topic branch (claim row dropped, task → `abandoned`, artifact left frozen with no revert — to preserve event-log/state coherence), rather than drained cleanly through the normal recovery path before the seal.
- **Why deferred:** Re-deferred by the Sprint 15.2 design and **ratified at the 2026-05-17 Phase 15 longrun human-in-loop review**. A `closing` drain-state must force-lapse *every* in-flight item type — claims (15.2), requests (15.3), motions/votes (15.4), disputes (15.5). Building it claims-only now would be reworked three times as the later primitives land. Deferred so it is built once over the complete in-flight set. `coordinationConstants.ts` `TOPIC_STATUSES` already includes `'closing'` (currently unused).
- **Trigger condition:** Sprint 15.5 (intake + dispute) — by which point the full in-flight item set exists. Build `closeTopic` two-phase (`active → closing`, drain/force-lapse all in-flight items, `closing → closed`); the log seal moves to the `closing → closed` step.
- **Estimated size:** M–L.
- **Priority:** MED — until then, closed topics rely on each primitive's sweep closed-topic branch for after-the-fact cleanup (functional, but not a clean pre-seal drain).
- **Session deferred:** 2026-05-17
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.6 (2026-05-18): three-phase `closeTopic` drain implemented in `src/services/topics.ts` — Phase 1 (`active → closing` + topic.closing), Phase 2 (drain claims/requests/motions/disputes/intake_items in individual short transactions), Phase 3 (`closing → closed` + topic.closed seal). All writer paths block on 'closing'. Sweeps skip 'closing' alongside 'closed'.
- **Source:** Phase 15 Sprint 15.1 design decision D4; re-deferred by Sprint 15.2 design; ratified at the 2026-05-17 longrun human-in-loop review.

---

## DEFERRED-011

- **What:** Sprint 15.2 ships the `tasks.topology` (`parallel|sequential|rolling`) and `tasks.depends_on` (`UUID[]`) columns (migration 0054) and records them at `postTask`, but **nothing enforces them**. `claimTask` (`src/services/board.ts`) grants a claim on any `posted` task regardless of whether a `sequential` task's `depends_on` predecessors are `completed`; there is no gating of a `rolling` consumer on a `baselined` upstream artifact. The columns capture coordinator intent; no service acts on it. `baselineArtifact` ships (the rolling-handoff primitive) but the rolling *wiring* does not.
- **Why deferred:** Explicitly scoped out at Sprint 15.2 CLARIFY (in-scope table ships the columns + `baselineArtifact`; enforcement is named a follow-up). Confirmed a pre-existing CLARIFY decision (not a new mechanism) by the design-r4 self-review, and re-flagged by the Sprint 15.2 QC matrix and the POST-REVIEW Scope Guard. The Board's core loop (post → claim → write → baseline → complete + the abandoned-claim sweep) is correct topology-agnostically; ordering enforcement is a coherent follow-on, best built once the wider in-flight item set (requests / motions / disputes) exists so the dependency model is uniform.
- **Trigger condition:** A Phase 15 sprint that implements task-dependency / topology enforcement, OR a reported case of a `sequential` / `rolling` task being claimed or worked out of order. **Sharpened at the 2026-05-17 longrun human-in-loop review: this MUST be resolved before Sprint 15.6 (the GUI makes the board interactively usable) OR before any production multi-agent self-serve run off the board — whichever comes first.**
- **Estimated size:** M — `claimTask` checks the `depends_on` predecessors' status for a `sequential` task (reject or queue the claim until every predecessor is `completed`); a `rolling` consumer gates on the upstream output artifact being `baselined`; per-topology tests.
- **Priority:** LOW — `parallel` (the common case) needs no enforcement; `sequential` / `rolling` producers currently rely on coordinator discipline, and the event log makes any out-of-order work auditable after the fact.
- **Session deferred:** 2026-05-17
- **Sessions open:** 3
- **Status:** RESOLVED — Sprint 15.7 (2026-05-20): claimTask topology enforcement on sequential
  (all depends_on must be `completed`) + rolling (upstream artifact must be `baselined`); parallel
  unchanged. Plus the closing-recovery half — sweepStuckClosingTopics scans topics in 'closing'
  whose most recent `topic.closing` event is > 5 minutes old, calls closeTopic with a 60s
  statement_timeout, capped at 10 topics per cycle (REVIEW-CODE F2). 6 topology tests
  (AC15–AC19) + 2 recovery-sweep tests (AC11, AC12). New error statuses: `unmet_dependencies`,
  `upstream_not_baselined`.
- **Source:** Phase 15 Sprint 15.2 CLARIFY out-of-scope (`docs/specs/2026-05-16-phase-15-sprint-15.2-clarify.md`); re-flagged by QC (`docs/audit/sprint-15.2-qc-ac-coverage.md`) + POST-REVIEW Scope Guard (`docs/audit/findings-sprint-15.2-post-review.md`).

---

## DEFERRED-010

- **What:** `replayEvents` (`src/services/coordinationEvents.ts`) caps results at `DEFAULT_REPLAY_LIMIT=1000` with no real pagination API beyond `next_cursor`. `joinTopic`'s induction pack uses `replayEvents`, so on a topic with >1000 events past the cursor a fresh joiner's pack `events` is the oldest 1000 and omits the joiner's own just-emitted `topic.actor_joined`; `your_cursor` is the high-water of that prefix and the agent must continue via `replay_topic_events` to fully re-prime. The behaviour is correct cursor semantics, but the first-pack ergonomics on a large topic are poor.
- **Why deferred:** REVIEW-CODE r1 finding 1 (WARN). Sprint 15.1 topics are small (only `topic.chartered`/`actor_joined`/`closed` events — a topic would need >1000 joins to hit the cap), so it is latent, not reachable. The design §3.2/§E already flag pagination as a future concern. A real paginated-pack API (or a fresh-joiner "tail" mode) is its own small design. The §9.8 coherence invariant was corrected (design rev 5) to describe the cursor-continuation contract honestly.
- **Trigger condition:** Phase 15 Sprint 15.2 (the Board adds `task.*`/`artifact.*`/`claim.*` events — topics will accrue many events), OR a reported case of an induction pack missing recent events.
- **Estimated size:** M — a paginated induction-pack API or a tail-mode read for fresh joiners; expose `has_more` / pagination in the pack.
- **Priority:** LOW
- **Session deferred:** 2026-05-16
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.12 (2026-05-21): `replayEvents` gains a `tail` mode
  (most-recent N events, `ORDER BY seq DESC LIMIT N` re-sorted ASC; `has_more` via
  `EXISTS(seq < min)` — no full COUNT). `joinTopic`'s FRESH-join (since_seq=0) induction
  pack uses tail mode so a joiner on a >N-event topic gets recent context incl. their own
  `topic.actor_joined`, with `your_cursor` = max seq (primed to HEAD). A re-prime
  (since_seq>0) keeps the forward cursor-continuation contract. 3 tail tests + a fresh-join
  induction-pack test.
- **Source:** Phase 15 Sprint 15.1 REVIEW-CODE r1, finding 1 (`docs/audit/findings-sprint-15.1-code-r1.md`).

---

## DEFERRED-009

- **What:** Phase 15 Sprint 15.1 topic operations — `getTopic`/`joinTopic`/`closeTopic` (`src/services/topics.ts`), `replayEvents` (`coordinationEvents.ts`), the `/api/topics/*` REST routes, and the 5 MCP tools — operate purely by the global `topic_id` PK with **no project-scope check**. A `writer`-role bearer token issued for project A can `POST /api/topics/<project-B-topic-id>/close` and irreversibly seal project B's coordination log — or join/read it — by `topic_id` alone. `closeTopic` is the destructive path.
- **Why deferred:** REVIEW-CODE r1 finding 2 (WARN). Same class as DEFERRED-004 (codebase-wide tenant-enforcement audit of writer-role handlers). The Phase 15 design deliberately punted authorization (design §4.4 defers level-based authz) and the REST surface is intentionally top-level (`topic_id` is a global PK — a design decision). Dev runs `MCP_AUTH_ENABLED=false`, so no caller-project context exists yet. `topic_id` is a UUID (not guessable). A proper fix belongs in a coherent Phase 15 authorization pass (the actor/level model's enforcement), not a 15.1 bolt-on.
- **Trigger condition:** a Phase 15 sprint that introduces topic-level authorization, OR `MCP_AUTH_ENABLED=true` adopted in a real deployment, OR a dedicated security-audit sprint.
- **Estimated size:** M — every topic operation loads `topics.project_id` and rejects with `NOT_FOUND` (to avoid id-probing) when it does not match the caller's resolved project scope (`req.apiKeyScope`); at minimum for the destructive `closeTopic`. A `requireTopicScope`-style middleware or service-layer guard, plus tests.
- **Priority:** MED — exploitable only with `MCP_AUTH_ENABLED=true` plus a leaked or logged `topic_id`.
- **Session deferred:** 2026-05-16
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.12 (2026-05-21): tenant-scope enforcement.
  New `requireResourceScope(entity)` middleware (8 resolvers — topic/request/motion/dispute/
  intake/body/task/artifact — each loads the owning `project_id` and compares to
  `req.apiKeyScope`; cross-tenant + unknown → 404 NOT_FOUND, no existence oracle) +
  `requireBodyProjectScope` (create routes with project_id in body — injects the key's scope
  on omission, no DEFAULT_PROJECT_ID escape) + `requireBodyTopicScope` (openDispute's
  body.topic_id). Applied across topics/board/requests/motions/disputes/intake routes
  (complete coverage per CLARIFY Q1, incl. indirect entity-derived scope). Auth-off /
  global-scope → unrestricted (dev posture preserved). Light tenant-isolation security
  checklist CLEAR. MCP path (unscoped workspace token, single operator) out of scope.
- **Source:** Phase 15 Sprint 15.1 REVIEW-CODE r1, finding 2 (`docs/audit/findings-sprint-15.1-code-r1.md`).

---

## DEFERRED-008

- **What:** Phase 11 knowledge-bundle export/import does not carry the `lesson_types.scope` column added by migration `0052_unify_lesson_types.sql`. `exportProject.ts:127` selects an explicit column list (`type_key, display_name, description, color, template, is_builtin, created_at`) that omits `scope`; `importProject.ts:464` INSERTs the same explicit list. Net effect: `scope` is dropped on export, and every imported `lesson_types` row lands as `scope='global'` via the migration 0052 column default — a source `scope='profile'` type silently becomes a global type on the destination instance, leaking it into the global registry for all projects there. Related: the `taxonomy_profiles` table is not in the bundle entry list at all (pre-existing Phase 13 gap), so profile-scoped types do not round-trip meaningfully even setting `scope` aside.
- **Why deferred:** Surfaced by the phase-13 bug-fix `/review-impl` pass (Finding 3, LOW) as an out-of-scope adjacent gap — the SS2 type-system unification introduced the `scope` column; updating the Phase 11 exchange path to carry it is a separate change with its own test surface. LOW because cross-instance export/import is opt-in, the `global` default keeps imported types functional (just mis-categorized), and profile-scoped types are independently re-seeded from `config/taxonomy-profiles/*.json` on a fresh instance.
- **Trigger condition:** Next sprint that touches `src/services/exchange/*` OR a user report that a cross-instance import lost taxonomy-profile type classification.
- **Estimated size:** S-M — add `scope` to the export SELECT + import INSERT/UPDATE + conflict-check SELECT; decide whether to add `taxonomy_profiles` as a new bundle entity (the M part); extend `bundleFormat.test.ts` + the import e2e suite.
- **Priority:** LOW
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** RESOLVED — 2026-05-21 (`fix-exchange-scope-deferred-008`): the scope-LEAK
  fixed. `exportProject` lesson_types SELECT now includes `scope`; `importProject`
  INSERT (create) + UPDATE (overwrite) persist `scope` via a `normalizeScope` helper
  that defaults a pre-fix bundle (no `scope` field) or a malformed value to `'global'`
  (prior behavior + no CHECK violation). A `scope='profile'` type now round-trips as
  'profile' instead of silently becoming 'global' on the destination's global registry.
  4 round-trip tests (AC1 export carries scope; AC4 profile + global round-trip; AC5
  pre-fix bundle defaults global). The `taxonomy_profiles`-as-bundle-entity round-trip
  (the "related" gap) is split out to DEFERRED-023.
- **Source:** phase-13 bug-fix `/review-impl` review (commit 00acfa4), Finding 3.

---

## DEFERRED-007

- **What:** MCP tool calls that use `z.discriminatedUnion` in their `outputSchema` return error `"Cannot read properties of undefined (reading '_zod')"` to the client, even when the underlying handler executed successfully and the side effects landed. Confirmed affects: `claim_artifact`, `check_artifact_availability`, `renew_artifact`, `submit_for_review` (and any Phase 13 tool using discriminated-union output).
- **Why deferred:** Latent regression — these tools' tests pass at the service level (bypass HTTP/MCP transport) and `tools/list` returns them correctly, so the issue was invisible until Sprint 13.4's end-to-end smoke directly invoked `tools/call`.
- **Status:** RESOLVED 2026-05-15 (longrun session 3, Sprint 13.7 Part D)
- **Resolution:** Root cause found in `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/zod-compat.js:114-156` — `normalizeObjectSchema` only handles `def.type === 'object'` for zod-v4 schemas. ZodDiscriminatedUnion has `def.type === 'union'` (not 'object'), so the function returns `undefined`, and the SDK's output-validation path crashes on the subsequent property access. The cleanest fix without upstream SDK patches is to flatten the discriminated union outputs to a plain `z.object` with optional/nullable fields keyed on a `z.enum` status. Applied in commit (Sprint 13.7) to 4 tools: claim_artifact, renew_artifact, check_artifact_availability, submit_for_review. Verified live via curl: `check_artifact_availability` now returns `structuredContent: {"available": true}` cleanly with no _zod error. Regression guard added in `test/e2e/api/phase13-mcp.test.ts`.
- **Source:** Sprint 13.4 deploy-state smoke discovered the regression; Sprint 13.7 Part D fixed.

---

## DEFERRED-006

- **What:** Integration-level smoke verification of `requireScope` 403 path under `MCP_AUTH_ENABLED=true`.
- **Status:** RESOLVED 2026-05-15 (longrun session 3, Sprint 13.7 Part B)
- **Resolution:** Shipped `docker-compose.auth-test.yml` (override that sets MCP_AUTH_ENABLED=true for mcp + worker services) + 6 e2e test cases in `test/e2e/api/phase13-auth-scope.test.ts` covering: env_token /api/me shape, db_key /api/me shape with scope, in-scope admin force-release (200), cross-tenant admin force-release blocked by requireScope (403 — the actual DEFERRED-006 closure), cross-tenant writer blocked by requireRole (403 — regression guard), mismatched body.owner_project_id on taxonomy create (403). Tests SKIP gracefully when auth not enabled. Helper updates: `createTestApiKey` accepts `project_scope`, `E2E_PROJECT_ID_B` added to constants. To run the full smoke: `docker compose -f docker-compose.yml -f docker-compose.auth-test.yml up -d mcp worker && npm run test:e2e:api`. The 6 cases ship code-validated (tsc clean) and run as opt-in via the override.

---

## DEFERRED-005

- **What:** GUI production build (`npm run build` AND `docker compose up -d --build gui`) fails on Geist font resolution: `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'` from `[next]/internal/font/google/geist_*.module.css`. Affects Next.js 16.2.1 + Turbopack default build path. Reproduced 2026-05-15 during Sprint 13.2 POST-REVIEW deploy-state smoke.
- **Why deferred:** Pre-existing issue (the running gui container at 4h uptime predates this regression). Sprint 13.2's tsc check is clean and the new code follows existing component patterns. Fixing the Geist resolution is a Next.js / Turbopack dependency issue outside Sprint 13.2's scope.
- **Trigger condition:** Next planned GUI work that requires a fresh container build (e.g., Sprint 13.4 or 13.6 in the current Phase 13 longrun); OR any urgent GUI hotfix that needs a deploy.
- **Estimated size:** S-M (likely a `next` version pin, font module installation, or Turbopack opt-out config flag).
- **Priority:** MED — blocks GUI deploys; running container survives but won't pick up Sprint 13.2's ActiveWorkPanel until resolved. The Sprint 13.2 backend ships fine (sweep, /api/me, requireScope all live).
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-15 (longrun session 2 start)
- **Source:** Sprint 13.2 POST-REVIEW deploy-state smoke (Mitigation B step F1) discovered local AND docker GUI builds both fail with identical error.
- **Resolution:** Root cause was `next/font/google` requiring network access to fonts.gstatic.com at build time; the build host couldn't reach it (firewall/proxy). Replaced `next/font/google` with the official `geist` npm package (v1.7.0) which ships the font files locally. Updated `gui/src/app/layout.tsx`: import `GeistSans`/`GeistMono` from `geist/font/sans` and `geist/font/mono` respectively. Build now succeeds (24 routes prerendered). GUI container rebuilt + redeployed; Sprint 13.2's ActiveWorkPanel verified live in browser via curl on /agents.

---

## DEFERRED-004

- **What:** Backend tenant-scope enforcement on admin-role endpoints.
- **Status:** RESOLVED 2026-05-21 (see full closure note at the end of this entry). The
  PARTIAL → RESOLVED history is preserved below for context.
- **Phase 13 progress:**
  - Sprint 13.2 (commit 416e48b): created `requireScope` middleware + applied to `DELETE /api/projects/:id/artifact-leases/:leaseId/force`.
  - Sprint 13.5 (commit 47954d1): applied `requireScope('id')` to `POST /api/projects/:id/taxonomy-profile/activate` and `DELETE /api/projects/:id/taxonomy-profile`; added inline body.owner_project_id scope-check on `POST /api/taxonomy-profiles`.
- **Sprint 13.7 audit findings:**
  - `/api/lesson-types` (requireRole('admin') only) — global admin route for managing custom lesson types across all projects; no `:id` URL param. Project-scoped admins can manage types globally per current design. Decision: keep global (custom lesson types are a server-wide concern in this codebase).
  - `/api/api-keys` (requireRole('admin') only) — global admin route for key management; per design, admin tokens manage keys for any project. Decision: keep global (matches the documented role design where admin tokens are global by definition).
  - `/api/git`, `/api/jobs`, `/api/workspace`, `/api/chat`, `/api/documents`, `/api/learning-paths`, `/api/groups` (writer+) — none have `:id` URL params at mount; route handlers read project_id from query/body. Service-layer enforcement should verify apiKeyScope against the body's project_id where applicable, but this is per-handler work outside the route-mount layer. Decision: deferred to a follow-up sprint that audits each service handler.
- **Remaining scope:** Service-layer audit of every writer-role handler that takes a `project_id` body/query param to verify it filters by `req.apiKeyScope`. This is ~7 service modules and is a larger audit than Sprint 13.7 budget allows.
- **Trigger condition:** Dedicated security-audit sprint OR external pen-test report.
- **Priority:** MED — exploitable but only by misconfigured project-scoped admin keys.
- **Sprint 13.7 closure decision:** mark as PARTIAL with explicit decisions for each top-level admin mount documented above. The remaining service-handler audit is acceptable as a follow-up because (a) the most exploitable routes (force-release, taxonomy activation) are already closed, (b) the global admin routes are global-by-design, (c) the writer-role routes require explicit per-handler audit that doesn't fit a single sprint.
- **Status:** RESOLVED — 2026-05-21 (`tenant-scope-audit-deferred-004`): the writer-role
  service-handler audit shipped. New `requireProjectScope(source, {multi})` middleware
  (strict-reject: a scoped key must declare a project equal to its scope; absent → 400
  `project_scope_required`, cross-tenant → 404, multi out-of-scope → 404) for COLLECTION
  routes; `requireResourceScope` extended with `document`/`learning_path`/`conversation`
  resolvers for RESOURCE-`:id` routes (DERIVE the project from the id — REVIEW-DESIGN F1:
  a declared project_id is bypassable by a cross-tenant resource id). Applied across
  git/jobs/workspace/chat/chatHistory/documents/learningPaths/projectGroups (~45 routes).
  Auth-off / global-scope → unrestricted (dev posture; 711-test baseline preserved). 10
  new D004 middleware tests. The global admin routes (lesson-types, api-keys) remain
  global-by-design (13.7 decisions). `POST /api/jobs/run-next` cross-project pop is split
  to a new Tier-2 deferred (scheduling-semantics service change). Light tenant-isolation
  security checklist CLEAR.

---

## DEFERRED-003

- **What:** `race_exhausted` code path in `src/services/artifactLeases.ts:74-82` (claimArtifact retry loop) is not covered by unit tests. The path triggers when two concurrent 23505-race winners both expire microseconds before our re-SELECT — statistically near-unhittable under MAX_TTL=240min defaults.
- **Why deferred:** Test would require deterministic control over Postgres transaction commit timing + system clock manipulation. Disproportionate setup cost for a near-unhittable rare path. Sprint 13.7 (E2E suite) can stress-test with synthetic short TTLs (e.g., 1-second leases) where the race window is naturally wider.
- **Trigger condition:** Sprint 13.7 E2E test design. OR: production observability shows the path firing (we'd log it via `logger.warn` for visibility).
- **Estimated size:** S (test scaffolding + 1 test)
- **Priority:** LOW
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-23 — the retry loop was extracted from `claimArtifact` into an
  exported, injectable seam `_claimWithRetry(p, once=_claimArtifactOnce)`. Production behavior is
  unchanged (default `once` = the real `_claimArtifactOnce`); the loop, `setImmediate` backoff, and
  `race_exhausted` return are identical. The full real-DB integration race is genuinely
  non-deterministic (step-1 lazy DELETE cleans the expired incumbent before any retry can re-observe
  it; forcing it with a competing connection deadlocks on the claim's uncommitted DELETE), so a
  deterministic unit test of the loop is the pragmatic resolution the original defer note anticipated.
  3 DB-free tests in `artifactLeases.test.ts`: all-retry → `race_exhausted` (asserts exactly 2 `once`
  invocations, pinned to `MAX_INTERNAL_RACE_RETRIES=1`); retry-then-claim → `claimed`; terminal-first
  → no retry. 723/723 green; no migration. Branch=race-exhausted-coverage-deferred-003.
- **Source:** Sprint 13.1 post-audit (`docs/audit/sprint-13.1-residuals.md` R5); design review r2 acknowledged "exceedingly rare" but didn't write a deferred entry.

---


## DEFERRED-001

- **What:** Phase 14 — Per-project embedding/distillation model routing. Add `embedding_model` and `distillation_model` columns to `project_sources` (or new `project_model_config` table). Modify `src/services/embeddings.ts` and chat-model callers to select model from project config.
- **Why deferred:** ~~Out of Phase 13 scope; user chose option C (Phase 14 defer).~~
- **Trigger condition:** N/A
- **Estimated size:** L
- **Priority:** N/A
- **Session deferred:** 2026-05-14
- **Sessions open:** 1
- **Status:** ABANDONED
- **Abandon reason:** Session 2026-05-14 (same day) — user reconsidered and chose **global swap pattern** instead of per-project routing. Quote: "tôi đề nghĩ chúng ta nên làm phase 14 trước luôn vì nó không tốn nhiều time ... chúng ta sẽ chuyển hoàn toàn qua nvidia/nemotron-3-nano, text-embedding-bge-m3". Per-project routing complexity not needed; both projects move together to the new model stack. The new Phase 14 scope is documented as an active spec (see `docs/specs/2026-05-14-phase-14-model-swap-spec.md`), not a deferred item.
- **Source:** Session 2026-05-14 — initial decision then reversed within same session.

---

## DEFERRED-002

- **What:** `mxbai-embed-large-v1` has 512-token context window. With `CHUNK_LINES=120` (~600-1000 tokens/chunk), code chunks routinely get truncated. LM Studio logs confirm: "Number of tokens in input string (634) exceeds model context length (512). Truncating to 512 tokens." Also: "tokenizer.ggml.add_eos_token should be set to 'true' in the GGUF header." This means Phase 12 measurement work (sprints 12.1c through 12.1h) was conducted on systematically truncated embeddings. Baselines in `docs/qc/baselines/*` reflect degraded vectors, not the embedding model's full capability.
- **Why deferred:** Resolution requires model swap to `bge-m3` (8192 ctx, same 1024-dim). Resolution path now active via Phase 14 (global swap pattern). Item kept OPEN until Phase 14 actually ships and bge-m3 is in production for both `free-context-hub` and `phase-13-coordination` projects.
- **Trigger condition:** Phase 14 ships (`.env` updated to `EMBEDDINGS_MODEL=text-embedding-bge-m3`, `reembedAll` script run against both projects, smoke test confirms search quality is intact). At that point Scribe sets Status to RESOLVED with sprint reference.
- **Estimated size:** M (re-embed in place; preserves all data)
- **Priority:** MED
- **Session deferred:** 2026-05-14
- **Sessions open:** 1
- **Status:** RESOLVED
- **Resolved at:** 2026-05-15
- **Resolved by:** Phase 14 model swap (commits TBD — pending session close). `.env` switched to `EMBEDDINGS_MODEL=text-embedding-bge-m3` (8192 ctx, same 1024 dim). `src/scripts/reembedAll.ts` ran against both projects: free-context-hub (2069 chunks + 638 lessons + 11 document_chunks all OK) and phase-13-coordination (3334 chunks + 2 lessons + 0 document_chunks all OK). Smoke tests pass for search_lessons / search_code_tiered / reflect / add_lesson distillation. The 512-token truncation that systematically degraded Phase 12 measurement work is now eliminated — bge-m3's 8192-token context window covers our 120-line chunks (~600-1000 tokens) with margin.
- **Source:** Session 2026-05-14 — user message with LM Studio log + mxbai-embed-large-v1 model name. Resolution active via Phase 14.

---
