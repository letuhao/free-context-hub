# Sprint 13.2 Code Review — Round 3 Adversary Findings

**Round:** 3 (code-review, final per cap)
**Status:** APPROVED_WITH_WARNINGS after main-session triage (2 BLOCK r3 → 1 BLOCK + 1 WARN; main accepts 1 BLOCK fix + applies F3 WARN; r2 F2 downgrade documented)

## R2 Verification (all 3 fixed)

- F1 requireScope fallback: VERIFIED FIXED.
- F2 migration parser: VERIFIED FIXED.
- F3 test flakiness: VERIFIED FIXED.

## NEW FINDING 1 — BLOCK (accepted; fix applied in v3)

**Category:** cross-tenant / UI-server disagreement
**File:line:** src/api/routes/me.ts:42-44
**Issue:**
`buildMeResponse` falls back to `key_source: 'env_token'` + `role: 'admin'` + `project_scope: null` when `attachedRole === undefined`, ignoring `attachedScope`. Same bug class F1 fixed in requireScope.ts. If any future auth middleware (or a corrupted DB row in api_keys with NULL role but non-NULL project_scope) attaches `apiKeyScope` without `apiKeyRole`, me.ts says "admin/global" while requireScope correctly 403s. GUI in `headerShowsForceRelease` (gui/src/app/agents/page.tsx:432-436) trusts me.ts, so the button shows for every row but every click 403s.
**Impact:** Misleading admin UI in auth-state-mismatch scenarios.
**Fix:** me.ts must also consult `attachedScope`; if scope is attached without role, treat as misconfigured and return restrictive identity.

## NEW FINDING 2 — DOWNGRADED to WARN by main-session triage

**Adversary classification:** BLOCK (stale-closure / cross-tenant UI data leak)
**Main-session re-classification:** WARN (minor UI flicker only)

**Adversary's claim:** `fetchClaims` deps include `effectiveProjectIds`; if that context returns fresh array per render, fetchClaims rebuilds → effect re-runs → interval thrash + re-render storm.

**Evidence against the BLOCK framing:**
- `gui/src/contexts/project-context.tsx:106-115` wraps `effectiveProjectIds` in `useMemo` with deps `[selectedProjectIds, isAllProjects]`. The array reference is stable across renders unless its inputs actually change. No re-render storm.
- Re-reading the closure: `setClaims((r.claims ?? []).map((c) => ({ ...c, _project_id: projectId })))` uses the closure-captured `projectId` at fetch start time. The tag is correct for the data, just stale relative to the user's current selection. There is no cross-tenant tag confusion — only a brief UI flash showing the old project's data tagged with that project, which is then replaced by the next fetch.
- The genuine residual issue is the lack of AbortController. Worst observable: ~1 second of stale data when switching projects, still tagged correctly. Not a confidentiality issue.

**Action:** Documented as a minor UI improvement candidate; deferred to a future sprint if observed as actual friction. Not a Sprint 13.2 BLOCK.

## NEW FINDING 3 — WARN (accepted; fix applied in v3)

**Category:** input-validation
**File:line:** src/services/artifactLeases.ts:454-459 (clampGrace) and parallel `clampTtl` at 405-410
**Issue:**
`clampGrace(NaN)` falls through every comparison and returns `Math.floor(NaN) = NaN`. Bound as `$1` in `make_interval(mins => $1)`, Postgres rejects at runtime. A malformed `leases.sweep` job payload causes permanent worker-side failures.
**Impact:** A single poisoned job payload → recurring worker errors and clogged DLQ.
**Fix:** Add `Number.isFinite` guard as first check in both clamp helpers.
