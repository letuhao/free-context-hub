# DEFERRED-029 — MCP tenant-scope enforcement — CLARIFY

**Date:** 2026-05-23
**Source finding:** WS3-S3 (`docs/qc/ws3-seam-bughunt-findings.md`)
**Branch:** `deferred-029-mcp-tenant-scope-design`
**Size:** L–XL (large mechanical change + new auth model + security review)

---

## 1. Problem (what was found)

The Phase 9–15 milestone review found that tenant isolation is **enforced on REST but absent on
MCP**:

- REST has scoped API keys: `api_keys.project_scope` (string|null) is attached to the request
  as `req.apiKeyScope` by `auth.ts`, and `requireScope`/`requireProjectScope`/
  `requireResourceScope` Express middleware reject cross-tenant access (returning 404 to avoid
  an existence oracle).
- MCP has **a single shared `workspace_token`** (`MCP_AUTH_ENABLED` → `assertWorkspaceToken`).
  It is a binary gate, **not** a per-project scope. `project_id` is a free parameter on
  coordination/lesson tools, defaulting to `DEFAULT_PROJECT_ID`. No service function re-checks
  caller scope.

Concrete consequence: in an `MCP_AUTH_ENABLED=true` deployment, any caller holding the shared
token can read or mutate **any project's** lessons and coordination state by varying
`project_id`. The 15.11 authorization levels live in the service layer so they apply on MCP;
only tenant-scope is REST-only.

## 2. Scope decisions (already confirmed)

| Question | Decision | Source |
|---|---|---|
| Is multi-tenant isolation on a shared instance a goal? | **Yes** | User decision 2026-05-23 |
| Enforcement mechanism | **Option B — explicit `callerScope` parameter** threaded through service functions, with enforcement in the service layer (so REST + MCP both inherit) | User decision 2026-05-23 |
| MCP authentication model | **Scoped MCP tokens** (per-project; likely reuse `api_keys.project_scope`) replacing the single shared `workspace_token` | User decision 2026-05-23 |
| Timing | **Dedicated phase** AFTER the Phase 9–15 milestone review (PR #18), with full DESIGN + security-framed review | User decision 2026-05-23 |

## 3. In scope

- A `callerScope: string | null | undefined` parameter on every service function whose
  current resource target is `projectId`, with enforcement at the top of the function
  (matching the REST middleware's tenant-isolation semantics: cross-tenant → 404, no oracle).
- Every REST route updated to thread `req.apiKeyScope` into the service call.
- Every MCP tool handler updated to thread the caller's scope (derived from the MCP token).
- A scoped MCP token model: per-project tokens, likely reusing `api_keys.project_scope` (one
  source of truth for both transports).
- Backward compatibility: `auth-off` (no middleware attached) and global keys (`apiKeyScope =
  null`) remain unrestricted; only project-scoped string keys are gated.
- Tests: per-service unit tests + an auth-ON E2E slice covering the **MCP path** (per WS3-S3 /
  WS0-F5), not just REST.

## 4. Out of scope

- Removing the existing REST middleware (`requireScope` etc.) — they remain as the
  request-boundary fail-fast (defense in depth). Service-layer enforcement is added beneath them.
- Cross-instance / federated auth (handled by the existing pull-endpoint pinning work).
- Role/level changes (15.11 authz model unchanged).
- Migrating the auth store (api_keys table reused; no new table).

## 5. Open questions (DESIGN must answer)

1. **How does an MCP request resolve a scoped token?** Send the same scoped API key as the
   `workspace_token`? Or a separate `api_keys.role='mcp'` row? Backward compat with the legacy
   single shared token (env-driven)?
2. **Granularity:** every service fn that touches `project_id`, or a narrower critical set
   (lessons read/write + coordination)? Recommendation: every fn — incomplete coverage is the
   exact failure mode of the current asymmetry.
3. **Helper shape:** one `assertCallerScope(callerScope, resourceProjectId)` helper, or a
   per-domain check? Recommendation: one shared helper, mirrors `requireScope` semantics
   (cross-tenant → `ContextHubError('NOT_FOUND')` — preserves the no-oracle 404).
4. **Multi-project operations** (e.g. `searchLessonsMulti(projectIds)`): how does a scoped key
   interact with a multi-project query? Recommendation: filter `projectIds` to only the scoped
   one (or reject if the request asked for projects outside scope — strict-reject mirroring
   `requireProjectScope`).
5. **Migration phasing:** big-bang single PR, or by domain (lessons → coordination → exchange
   → documents)? Recommendation: by domain across multiple PRs — each is its own reviewable
   unit; the helper + token model land first, then per-domain.

## 6. Acceptance criteria

- [ ] AC1: every service fn touching `project_id` accepts `callerScope` and enforces via the
  shared helper.
- [ ] AC2: every REST route passes `req.apiKeyScope` into the service call (no service fn is
  ever called without the scope being explicitly considered).
- [ ] AC3: every MCP tool handler derives the caller's scope from the MCP token and passes
  it; the legacy single-shared-token path resolves to `null` (global) for backward compat OR
  is documented as deprecated.
- [ ] AC4: a project-scoped key issued for project A, calling via MCP `tools/call` with
  `project_id=B`, gets the same `NOT_FOUND` (no existence oracle) it would on REST.
- [ ] AC5: auth-off (`MCP_AUTH_ENABLED=false`, no api_keys) baseline unchanged — all existing
  tests still pass without enabling auth.
- [ ] AC6: the auth-ON E2E slice (new under WS2 or this phase) exercises tenant-scope on
  **MCP** (not just REST) with passing and rejecting cases.
- [ ] AC7: security-framed review CLEAR (per CLAUDE.md safety-sensitive code requirement),
  with the checklist documented inline.

## 7. Risks

1. **Mechanical breadth.** "Every service fn touching project_id" is a large set. Mitigation:
   land the helper + a typed `CallerScope` first, then add the param across services in tight,
   reviewable per-domain PRs (Question 5).
2. **Test breakage.** Existing service tests do not pass `callerScope`. Mitigation: default
   parameter (`callerScope?: string | null`); when undefined, the helper treats it as
   "unrestricted" — same as auth-off today. Then progressively make the param required only on
   the routes/MCP paths that have a scope to pass.
3. **MCP token-model regression.** Replacing the shared token can lock out current MCP clients
   that hold the legacy token. Mitigation: keep the legacy single-shared-token as a
   **deprecated** acceptance with `scope = null` (global), until clients migrate to scoped
   tokens. Document the deprecation timeline.
4. **Security-sensitive code.** Tenant isolation has a security check guardrail. Mitigation:
   run a second adversary review with security framing on the helper + the per-domain PRs
   before each merge.

## 8. Next step

Proceed to DESIGN (`2026-05-23-deferred-029-mcp-tenant-scope-design.md`) covering: the helper's
exact contract, the `callerScope` type + propagation, the MCP token resolution, per-domain
service classification, migration sequence, and the security review checklist.
