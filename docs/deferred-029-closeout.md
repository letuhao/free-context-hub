# DEFERRED-029 Closeout — MCP Tenant-Scope Enforcement

**Status:** ✅ COMPLETE — 2026-05-23
**PRs:** #20 (B) through #29 (F) — 9 PRs, all stacked
**Migrations:** none required (additive type/contract changes only)
**Test baseline at close:** 831/831 unit green; `tsc --noEmit` clean; +18 auth-ON E2E tests
**Adversary findings:** 6 bypasses + 3 hygiene items closed across 4 review passes

---

## What DEFERRED-029 is

Phase 13 introduced api_keys with per-project `project_scope`, but the REST middleware was
the only enforcement layer. MCP transport had a single shared workspace_token with NO
per-project scope, and every service function trusted the project_id its caller declared.

DEFERRED-029 makes tenant isolation **service-layer**: every project-scoped service fn
accepts an optional `callerScope` and asserts the caller's scope against the resource's
project_id BEFORE any read or write. REST + MCP both inherit the same guard because both
transports pass the same value into the same service.

The end-state: a scoped api_keys token cannot read or write data outside its
`project_scope`, regardless of which transport (REST or MCP) it uses or which endpoint it
targets. Cross-tenant attempts yield `NOT_FOUND` with the same byte-level shape as an
unknown-id 404 — preserving the **no-existence-oracle** posture the REST middleware
already had.

---

## The contract

```ts
// src/core/security/callerScope.ts
export type CallerScope = string | null | undefined;
// undefined → auth-off / env-token / no middleware attached → UNRESTRICTED
// null      → admin/global key (api_keys.project_scope IS NULL)  → UNRESTRICTED
// string    → project-scoped key (api_keys.project_scope = '<id>') → enforced
```

Two primitive helpers (PR A):

- `assertCallerScope(scope, projectId)` — direct match for fns that take a project_id.
- `assertCallerScopeMulti(scope, projectIds)` — strict-reject for multi-project fns.

Eight DB-derive helpers (PR C1 / C2 / D1):

- `assertTopicScope`, `assertTaskScope`, `assertMotionScope`, `assertDisputeScope`,
  `assertRequestScope`, `assertIntakeScope`, `assertBodyScope`, `assertArtifactScope` —
  for fns that take an entity_id; the helper DB-derives the entity's project_id.
- `assertDocumentScope`, `assertLessonScope` (added in PR D1/F) — for cross-table edge
  writes where two ids must both be scope-checked.

All helpers throw `ContextHubError('NOT_FOUND', 'not found')` on cross-tenant — same
shape, no oracle.

---

## The 9-PR stack

| PR | Domain | Service fns | Tests after |
|---|---|---|---|
| **#20 (B)** | lessons (foundation domain) | 8 fns | — |
| **#21 (C1)** | topics + board (tasks/artifacts) | 10 fns + first DB-derive helpers | — |
| **#22 (C2)** | requests + motions + decisionBodies + proxies | 18 fns | — |
| **#23 (C3)** | disputes + intake + reviewRequests + chaining | 14 fns | 755 |
| **#24 (D1)** | exchange + documents + chunks + generatedDocs | 20 fns + assertDocumentScope | 773 |
| **#25 (D2)** | git + projectSources + workspace | 12 fns | 785 |
| **#26 (D3)** | jobQueue + artifactLeases + taxonomy + replay + groups | 18 fns | 803 |
| **#27 (D4)** | distillation + KG + indexing + guardrails + chat-sweep + artifacts | 15 fns | 817 |
| **#28 (E)** | retire legacy `CONTEXT_HUB_WORKSPACE_TOKEN` | — | 820 |
| **#29 (F)** | auth-ON E2E + 4 adversary passes + 6 bypass fixes + 2 hygiene | +assertLessonScope, 6 fixes | 831 |

Service-fn count: ~115 fns threaded across 8 service-domain PRs (B/C1/C2/C3/D1/D2/D3/D4).
Plus REST routes (~80) and MCP handlers (~70) all wired to pass `callerScope`.

---

## The 6 adversary findings (all fixed before merge)

PR F's cold-start security-adversary reviews (4 passes) found 6 bypass paths that the
prior 8 PRs shipped unnoticed. **All fixed in PR F before any production exposure.**

| # | Sev | Pattern | File | Adversary |
|---|---|---|---|---|
| **SEC-1** | CRITICAL | `listJobs` cross-tenant read when scoped caller omits both `projectId` and `projectIds` (WHERE clause unconstrained) | `src/services/jobQueue.ts` | #1 |
| **SEC-2** | CRITICAL | `triageIntake` writes coordination event to caller-supplied `route.topic_id` that was never scope-checked | `src/services/intake.ts` | #1 |
| **SEC-3** | HIGH | `enqueueJob` allows scoped caller to omit `project_id` → row written with NULL → worker runs unrestricted with attacker-chosen `payload.root` | `src/services/jobQueue.ts` | #1 |
| **SEC-4** | HIGH | `linkDocumentToLesson`/`unlinkDocumentFromLesson` cross-tenant edge writes — scope-check doc, miss lesson | `src/services/documents.ts` | #2 |
| **SEC-5** | MEDIUM (latent) | `cancelJob` identical SEC-3 trap shape — unreachable today, footgun for next caller | `src/services/jobQueue.ts` | #2 |
| **SEC-6** | HIGH | Worker `payload.root` cross-tenant filesystem read — SEC-3 pinned DB tag, this closes the filesystem-read path | `src/services/jobQueue.ts` (reject at enqueue) | #3 |

**Recurring patterns:**
1. **"if (project_id) assert" trap** — guard skipped when the optional id is falsy
   (SEC-1, SEC-3, SEC-5). Fix: when `callerScope` is a string, auto-bind project_id to
   scope OR reject.
2. **"scope-check resource, miss secondary id"** — only one of multiple caller-supplied
   ids is scope-checked (SEC-2 missed `route.topic_id`; SEC-4 missed `lesson_id`). Fix:
   scope-check every caller-supplied id whose project the row is attributed to.
3. **"DB tag pinned, payload trusted"** — worker trusts payload fields (filesystem
   paths, urls) even when project_id is correctly bound (SEC-6). Fix: reject dangerous
   payload fields at the boundary for scoped callers.

---

## Adversary saturation curve

| Pass | New HIGH+ findings | Note |
|---|---|---|
| Adversary #1 | 3 (2 CRITICAL + 1 HIGH) | General hostile-actor sweep |
| Adversary #2 | 2 (1 HIGH + 1 MEDIUM latent) | Verify #1's fixes + similar patterns |
| Adversary #3 | 1 (1 HIGH) | Event-log injection + worker payload trust |
| **Adversary #4** | **0** | Concurrency/TOCTOU + transaction boundaries + oracles |

**Curve: 3 → 2 → 1 → 0.** Floor reached at pass #4. Each pass caught a DIFFERENT class
of pattern; pass #4 confirmed saturation by probing 5 new angles (TOCTOU, txn
boundaries, error-message oracle, group-based, exchange bundle injection) — all not
viable for exploitation.

---

## Trust model — explicit

After DEFERRED-029, the system has a clear three-actor trust model:

| Actor | `CallerScope` | What they can do |
|---|---|---|
| **Auth-off (dev)** | `undefined` | Everything. No enforcement. `MCP_AUTH_ENABLED=false` mode. |
| **Admin / global key** | `null` | Everything. Scoped-key bypass for ops/migration. From either `CONTEXT_HUB_WORKSPACE_TOKEN` (deprecated, opt-out via `MCP_LEGACY_TOKEN_DISABLED=true`) or an `api_keys` row with `project_scope IS NULL`. |
| **Scoped key** | `'<project_id>'` | Only their own project's data. Cross-tenant → `NOT_FOUND` with no oracle leak. Worker-driving jobs are still allowed but `payload.root` is rejected (SEC-6). |

The worker runs as `callerScope=null` (global) by design — it's a trusted system actor.
The boundary is at the enqueue point: scoped callers cannot smuggle filesystem paths
into the job payload (SEC-6).

---

## Migration to hardened mode

For deployments that have fully migrated from the legacy single-shared token to scoped
`api_keys`:

```bash
# Hardened end-state env
MCP_AUTH_ENABLED=true
MCP_LEGACY_TOKEN_DISABLED=true
# CONTEXT_HUB_WORKSPACE_TOKEN: unset (no longer required)
```

Full migration recipe: `docs/specs/2026-05-23-deferred-029-pr-e-legacy-token-migration.md`.

---

## Known limitations (Phase 16 candidates)

| ID | Description |
|---|---|
| LOW-2 | `searchLessonsMulti` + `include_groups: true` strict-rejects scoped callers (resolveProjectIds returns group_ids that fail per-pid scope check). Workaround: iterate per-project. Future fix: `assertCallerScopeMultiInclGroups` helper that DB-checks each id is either `== callerScope` or a group the caller's project belongs to. |
| LOW (hygiene) | `jobExecutor.ts` has 13 duplicated `'project_id required for <type>'` string literals — could consolidate into a typed helper. |

---

## Architectural lessons (persisted as MCP lessons)

1. **Cold-start hostile-actor adversary review is mandatory for authz primitives.**
   `/review-impl` coverage missed 6 bypasses; cold-start framing caught them all. CLAUDE.md
   Sprint 15.3 guardrail validated 4 times in PR F alone.

2. **Multi-pass adversary review is not redundant** for safety-sensitive code. Each
   pass caught a different class of pattern; expect 3-4 passes to saturate. Diminishing
   returns are the signal to stop.

3. **Three recurring patterns to watch for** in tenant-scope work:
   - **"if (project_id) assert"** — guard skipped when optional id is falsy
   - **"scope-check resource, miss secondary id"** — multi-id fns where only one is checked
   - **"DB tag pinned, payload trusted"** — worker reads payload paths even when DB
     project_id is correctly bound

4. **Project IDs are immutable post-INSERT** by codebase convention — confirmed by
   adversary #4 (zero `UPDATE … SET project_id` statements). This is load-bearing for
   the no-TOCTOU guarantee between `assertXScope` and the subsequent write.

---

## Closeout checklist

- [x] All 9 PRs open and stacked (#20 → #29)
- [x] **839/839 unit tests green** (+119 from session start 720; includes 8 real-DB regression tests for SEC-1/SEC-2/SEC-3/SEC-6)
- [x] **19/19 auth-ON E2E DEFERRED-029 tests PASS live** against rebuilt MCP container (proven 2026-05-23 19:30Z)
- [x] 4 adversary passes complete; 6 bypasses fixed before merge
- [x] Migration doc + Phase 16 candidate documented
- [x] `tsc --noEmit` clean
- [x] Architectural lessons persisted via `add_lesson` MCP calls
- [x] Live E2E proof: stack switched to `MCP_AUTH_ENABLED=true`, rebuild verified the deployed code matches PR F branch, all DEFERRED-029 cross-tenant tests pass, stack restored to dev mode
- [ ] Human review + sequential merge of the stack (next-session work)

**Pre-existing E2E failures (NOT caused by PR F):** 14 phase13-* test failures persist
unchanged before/after the PR F rebuild (5 phase13-mcp, 4 phase13-reviews, 1
phase13-leases, 4 phase13-cross-feature). These need separate triage. They are
out of scope for DEFERRED-029.

DEFERRED-029 is **complete and live-verified**, ready for human review/merge.
