# Scenario Evaluation — Actor/Project/Task Data Boundary Design

**Date:** 2026-06-19 · **Branch:** `feature/actor-data-boundary`
**Inputs:** DESIGN `2026-06-19-actor-data-boundary-design.md` (post §14a static review)
**Method:** 3 cold-start red-team agents, ~46 concrete scenarios traced through §3 engine.

## Bottom line

The **static authz truth-table holds** — the §14a review fixes are real (CRITICAL-1 owner→delete
escalation **confirmed handled** in scenario form; tenant-gate-exempt-from-advisory and
load-attrs-from-DB also confirmed). But scenario testing found **the design's weak points are
not in the authz core — they're in (1) access-resolution semantics, (2) delegated execution,
(3) the grant path, and (4) the entire advisory→enforce rollout/ops machinery.** Several are
CRITICAL and must be resolved in design text before BUILD. A **design v2** revision is needed.

## Root-cause clusters (de-duplicated from 46 scenarios)

### A. CRITICAL — Visibility is unenforceable: Stage 1 grant-union defeats `private`/`restricted`
Stage 1 is an OR-union ("any covering grant allows"). The default `reader`/`*:read` role grants
`lesson:read`, which **overrides** `visibility=private`. So `private`/`restricted` collapse to
`project` — the entire Phase B ownership/visibility feature does nothing. Also a `private`/
`restricted` admin-visibility inversion (admins can read `private` but not `restricted`).
**Fix:** read decision = `visibility_allows(principal,res) AND rbac_allows(action)` (visibility is
a *restriction*, not an alternative grant). Define "explicit role" as a resource-scoped/admin grant,
not blanket `*:read`. Fix the private/restricted lattice. State RBAC has **no deny** — only
`actor_policies` deny — so "restrictive custom roles" can't be expressed via RBAC.

### B. CRITICAL — No delegated-execution model → authority laundering at every seam
The `system:worker` holds `*:*` and executes agent-enqueued jobs, Phase 15 chaining, and sweeps.
An agent action that would hit `require_approval` is **laundered to `system` authority** when the
worker runs it (no `actor_policy` constrains `system`). Same gap reappears in: Phase 15 **proxy
voting** (whose RBAC is checked — principal or proxy?), and **chaining** (chained sensitive action
runs as worker, not originator). This is the SEC-6 pattern one layer up.
**Fix:** a first-class **`on_behalf_of` / delegated-execution** model: worker/chaining/proxy
`authorize()` as the **originating principal** (carry `enqueued_by_principal_id`, set from the
authenticated caller at enqueue, never body-trusted), re-running `actor_policies` for the real
actor_type. Scope `system:worker` down from `*:*` to its infrastructural actions only. Add a §3.x
"Delegated execution" subsection.

### C. CRITICAL — Grant-path privilege escalation (custom role + scope + sockpuppet)
A `project-admin` can mint a custom role `(*,*)` (`owner_project=P`) and assign it at
`scope_type='global'` → escalates project→global. The no-self-grant DB CHECK is string-only and
defeated by a **second principal the same operator controls** (sockpuppet: `agent:p2` grants
`agent:p1`). No "granted ⊆ granter" invariant.
**Fix:** (a) a custom role with `owner_project=P` is assignable only at scope ⊆ P; (b) no-escalation
invariant: granted permission-set at granted scope ⊆ granter's own effective permissions there;
(c) identity-mutating grants (`role:grant`,`apikey:mint`) require a **human** granter (extend §7.1's
human-only rule beyond approvals).

### D. CRITICAL — Advisory→enforce rollout machinery is unsound (cluster)
- **Flip gate trusts absence of evidence.** "Zero would-deny rows" can't tell *safe* from
  *never-exercised* — a quarterly/rare path logs zero rows, flips clean, breaks in prod a month
  later. And `require_approval` is **not** "would-deny," so advisory escalations flip into hard
  approval-blocks invisibly. **Fix:** gate = *positive coverage of every catalogued (resource,action)*
  × *zero rows whose enforce effect differs from today* (deny **and** require_approval), rare/zero-
  observation actions default fail-safe (stay audit) + canary.
- **Rollback isn't instant; `authz_mode_overrides` is undefined; no cache-invalidation** (repo has
  Redis + `project_cache_versions`). **Fix:** define the override table; authz-config version bump on
  write; an `AUTHZ_GLOBAL_KILL=audit` env kill-switch read per-request; document propagation bound.
- **Per-access decision writes self-defeating at scale** — per-item INSERT on hot list/search +
  unbounded unpartitioned table; the flip-gate report then scans it. **Fix:** per-request (not
  per-item) or sampled writes (all denies + N% allows), time-partitioned table + retention/rollup.
- **Bootstrap deadlock / credential genesis** — governance is never-advisory (enforce day-one) but
  no global admin is seeded on a fresh install or a hardened upgrade (legacy token disabled) → admin
  path bricks. **Fix:** migration 1 seeds `system:bootstrap-admin` with global `*:*`; one-time
  `bootstrap-admin` credential mint; boot self-check that fails loud if no principal holds global
  `role:grant`.
- **api_key→type heuristic silently escalates** — "prod-deploy-bot" owned by a human → `type=agent`
  → ops work needs approval after flip; flips clean (it's require_approval, not deny). **Fix:** mark
  heuristic types `unverified`, default unverified→`human` (fail-open during migration), gate escalation
  on operator confirmation.
- **`authorization_decisions` is a cross-tenant oracle** — global table, `auditor=*:read`; a
  project-scoped auditor reads every tenant's access patterns + private `resource_id`s. **Fix:**
  tenant-filter the decisions read path; don't log raw private resource_ids cross-tenant.
- **Governance off by default + untested in CI** — auth-off dev default = whole layer is a no-op;
  §13 doesn't mandate an auth-on enforce CI lane (DEFERRED-029 needed `docker-compose.auth-test.yml`).
  **Fix:** mandate an auth-on + enforce E2E lane gating merges, with a positive "cross-actor action
  throws" assertion.

### E. HIGH — AND-composition regresses live Phase 15 governance
Phase 15 seats authority via *participation* with no RBAC role. AND-composing "RBAC must also grant"
**disenfranchises every existing topic participant and every proxy** at enforce-flip (they have no
`motion:*` RBAC grant). **Fix:** for governance resource types, **Phase 15 grants; RBAC contributes
deny-only** (never a missing-grant deny). The would-deny report must surface this *before* flip — and
the AND must run in enforce (not advisory) for both halves so it isn't masked during the soak.

### F. HIGH — Principal lifecycle/status (`suspended`/`retired`) is inert
`status` is a data value with **no behavioral contract**. A suspended/compromised principal acts
normally; suspension is a no-op during the advisory window. Suspended approvers/claimants/voters
deadlock or block in-flight Phase 15 state. Retired owners leave `private` data permanently
admin-only. **Fix:** `status != active → deny` as a **never-advisory** hard precondition; define
suspend/retire lifecycle (revoke role_assignments, sweep claims, reroute in-flight steps, exclude
from quorum; reassign/relax owned-resource visibility).

### G. HIGH — `require_approval` mechanics
- **All-agent project deadlocks** — human-only approvers + no human present = permanent block (an
  explicitly targeted use case). **Fix:** define empty-approver-set semantics (global-human fallback
  / break-glass `system` approver with alerting / invariant "≥1 human required to enable the policy").
- **One-shot token TOCTOU** — the token short-circuits Stage 1 *and* the attr-reload/status/topic-
  state checks; a human's approval of a benign state can authorize a mutated/sensitive state by a
  since-revoked principal against a closing topic. **Fix:** bind token to a resource fingerprint
  (owner+visibility+topic+version) captured at approval; re-check principal status + tenant + topic
  state on re-entry; token bypasses only the re-escalation, never the hard preconditions.
- **Fan-out inbox flood** — per-`(principal,action,resource_id)` dedup doesn't bound 1000 distinct
  resources. **Fix:** batch-approve primitive + per-principal open-request cap (`too_many_pending`).

### H. HIGH (was the §15 open question — now correctness-critical) — instance vs type identity
`actor_id == principal_id` (the CRITICAL-3 fix) collapses two concurrent agent *instances* of the
same type into one principal → **Phase 15 Board fencing can't distinguish them** (stale vs live
holder). **Decision needed:** type-level principal for RBAC **+ an instance/session sub-identity that
the Board fence + `assigned_to` key on.** Must be decided in Phase A, not deferred.

## UNDERSPECIFIED (resolve in design text; lower individual severity)
- Create vs per-resource action classification ("missing resource_id = deny" would block all creates).
- Auth-off × never-advisory collision + **null `actor_type` matching `'*'` policies** (recommend null
  matches `*`, fail-closed for sensitive actions).
- Task/topic-scoped roles mapping onto resources lacking `task_id`/`topic_id`.
- Key rotation must preserve `principal_id` (name→principal is migration-time only).
- Non-reusable `principal_id` slugs (re-minting a retired slug inherits a dead owner's resources).
- `authorizeEdge` per-side action semantics + **mixed-mode edge = strictest-mode-wins**.
- Online backfill batch/lock strategy for huge tables (`lessons`, `document_chunks`).
- Rolling-deploy **expand-contract** for the `actors.type` CHECK tightening (old code writes `ai`).
- `set_visibility` promotion to `shared`/`restricted` is itself a privileged/governed action.
- `authorize()`-vs-mutation **transaction story** (check-then-act lost-authority TOCTOU; run authz on
  the mutation's `conn`/snapshot).
- New topic-scoped writer paths (`role:grant` at topic scope, token re-exec) must join the §15.6
  `closing`-reject set.
- Never-advisory should be a **per-action property** (`security_sensitive` flag), not an enumerated
  list (it omits `set_visibility`).
- Retention/erasure for `principals` + `authorization_decisions` (PII of retired humans) — add to §15.

## Confirmed HANDLED (the static review held)
- CRITICAL-1 owner→delete escalation: Stage 2 overlay correctly catches it (S12).
- Tenant gate exempt from advisory mode (CRITICAL-2).
- Global-key via explicit global grant + lazy membership (the locked-out cliff).
- Load-attrs-from-DB for the non-token path (HIGH-4); `authorizeEdge` two-sided check closes SEC-4.
- Forward direction of governance AND (global `contributor` seated at `execution` → correctly denied).

## Recommendation
Produce **DESIGN v2** folding A–H + the underspecified list. Three items are genuine *decisions*
(not just fixes) worth confirming: **H** (instance-vs-type identity model), the **delegated-execution
model** shape (B), and **retention/erasure** policy (defer vs in-scope). Everything else is a
determinate design-text fix. Do NOT start BUILD until v2 + a re-review pass.
