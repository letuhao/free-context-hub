# Spec — Explicit Actor / Project / Task Data Boundaries (CLARIFY)

**Status:** CLARIFY (design checkpoint — not yet approved for build)
**Branch:** `feature/actor-data-boundary`
**Date:** 2026-06-19
**Scope class:** XL (touches identity, every domain service, the data model, MCP + REST + GUI, migrations)

## 1. Why (the project is changing shape)

ContextHub was a self-hosted memory + guardrails system for a *small, trusted team*.
The target is now a **multi-actor AI governance system**: many actors (humans and
AI agents) cooperating across projects and tasks, where **who may see and change
what** must be explicit and enforced — not assumed from a trusted network.

Without an explicit boundary + mechanism, multi-actor cowork creates correctness
problems (one agent clobbering another's context) and security risk (an agent
reading/altering data it has no business touching, or impersonating a human).

## 2. What exists today (gap analysis — from a 4-agent codebase survey)

**Strong, reusable foundation:**
- **Project tenant isolation** — `CallerScope = string | null | undefined`
  (`src/core/security/callerScope.ts`); `assertCallerScope` + 10 DB-derive
  `assertXScope` helpers (`scopeResolvers.ts`); threaded through ~115 service fns
  (DEFERRED-029); enforced via REST middleware (`requireScope`,
  `requireResourceScope`) and MCP (`resolveMcpCallerScope`). Cross-tenant access
  returns `NOT_FOUND` (no existence oracle). Project IDs are immutable post-INSERT.
- **An actor model** — `actors(project_id, actor_id, type CHECK IN ('human','ai'),
  display_name)` (migration 0053). Auto-registered on topic join.
- **Rich governance** — Phase 15: the Board (tasks/artifacts/claims with fencing),
  Request-Approval + DoA matrix, Collective Decision (motions/votes/veto/proxy),
  intake + disputes, append-only event log; the level-grant chain (owner +
  authority can grant; no self-grant) and an authorization model with HARD triggers.
- **Guardrails** — advisory action-pattern checks with an audit log.

**The three load-bearing gaps:**

1. **Identity is declarative, not authenticated.** `actor_id` / `actor_type` are
   passed in the request body and trusted verbatim. There is **no binding** from the
   authenticated credential (`api_keys` row) to an `actors` row. A key can claim any
   identity/type. `created_by` / `captured_by` / `submitted_by` are opaque TEXT, not
   FKs to `actors`, and are never checked against the caller. ⇒ The human/agent
   distinction (`actors.type`) is **advisory** and spoofable.

2. **No actor-level or task-level boundary.** Enforcement granularity is the
   **project** only. Within a project, any caller can list/claim/edit every task,
   lesson, document, and artifact. The sole sub-project ownership is the *ephemeral*
   artifact claim (checked only at artifact-write time). Tasks have `created_by` but
   no durable owner/assignee. Several collaboration tables (`lesson_comments`,
   `lesson_feedback`, `bookmarks`) lack even a `project_id`.

3. **Off by default.** Every boundary check is a no-op when `MCP_AUTH_ENABLED=false`
   (the default). The new single-port gateway adds a cross-site guard but **not** an
   auth boundary (see DEFERRED-041). So today there is effectively no enforced
   boundary in the running system.

## 3. Proposed conceptual model (layers)

A layered model that *reuses* the DEFERRED-029 pattern rather than reinventing authz:

1. **Authenticated Principal (identity layer).** Every request resolves to a trusted
   principal derived from its credential: `{ actor_id, actor_type (human|agent|system),
   project_scope, role }`. Bind `api_keys` → an `actors` identity. Stop trusting
   caller-asserted `actor_id`/`actor_type`: inject the authenticated one (or reject a
   mismatch). This is the **foundation** — nothing else is enforceable without it.

2. **Resource ownership (data layer).** Give resources explicit ownership/visibility
   metadata: owner actor, owning boundary (project → topic/task → actor), and a
   visibility level (e.g. `private` / `project` / `shared`). Add the missing
   ownership columns and backfill. Fix the unscoped collaboration tables.

3. **Boundary enforcement (access layer).** Extend `assertXScope` with actor- and
   task-aware checks (`assertBoundaryAccess`) layered *after* the project check.
   A principal may access a resource iff project scope matches **and** the ownership/
   visibility policy allows. Read and/or write isolation per policy.

4. **Governance policy (the "AI government" layer).** Express human-vs-agent rules as
   policy that composes with the existing DoA matrix / requests / guardrails — e.g.
   agents confined to assigned tasks; agent writes to sensitive resource classes
   require human sign-off; humans can override agents. Configuration, not hardcode.

5. **Secure-by-default + observability.** Decide the default posture; audit every
   boundary decision (allow + deny) so multi-actor behavior is debuggable.

## 4. Proposed phasing (each phase independently shippable + reviewable)

- **Phase A — Authenticated identity (foundation).** `api_keys` ↔ `actors` binding;
  derive principal on REST + MCP; stop trusting asserted identity. No data-access
  behavior change yet, but identity becomes trustworthy. Prereq for B–E.
- **Phase B — Ownership data model.** Add owner/visibility columns to core entities;
  backfill; add `project_id` to the unscoped collaboration tables; expose owner in
  APIs/GUI. No new denials yet.
- **Phase C — Boundary enforcement.** Actor + task-level access checks
  (`assertBoundaryAccess`) extending DEFERRED-029. Read+write isolation per policy.
- **Phase D — Human/agent governance policy.** The rules that make it a "government":
  agent confinement, human sign-off for sensitive agent actions, override — wired into
  DoA/requests/guardrails.
- **Phase E — Secure-by-default + session auth + audit.** Flip defaults, resolve
  DEFERRED-041 (human login/session), full boundary-decision audit.

## 5. Cross-cutting constraints (must hold)

- **Safety-sensitive review policy applies** (CLAUDE.md): every phase that adds an
  authz/tenant/governance primitive gets a cold-start hostile-actor adversary review
  (multi-pass) + live verification — not just `/review-impl`.
- **Do not regress** the DEFERRED-029 project isolation or the Phase 15.11 HARD authz
  triggers (owner permanence, no self-grant, proxy-grant authorization, etc.).
- **Watch the three recurring bypass patterns** (DEFERRED-029): optional-id-skips-guard,
  scope-check-one-id-miss-another, DB-tag-pinned-payload-trusted.
- **Back-compat / migration:** existing single-actor deployments must keep working;
  backfill must assign sane defaults; dev ergonomics (auth-off) preserved as an option.

## 6. Open decisions (for the design checkpoint)

1. **Boundary axes in scope** — which of: authenticated identity (foundation),
   human-vs-agent policy axis, actor-level ownership, task/topic-level access.
2. **Enforcement posture & default** — secure-by-default (hard deny, auth on) vs
   advisory-first (audit + warn, opt-in deny) vs keep opt-in.
3. **Primary governance goal** — restrict agent blast-radius / require human sign-off
   on sensitive agent actions / full per-actor RBAC / audit-only first.
4. **Starting point** — identity foundation first (recommended) vs full design then
   build vs a vertical slice on one domain (e.g. lessons) end-to-end.

## 7. Non-goals (for now)

- Replacing the existing Phase 15 governance primitives (we compose with them).
- External IdP / SSO integration (could be a later phase; OIDC noted in DEFERRED-041).
- Per-field / row-level encryption.
