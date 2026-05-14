# Sprint 13.2 Code Review — Round 2 Adversary Findings

**Round:** 2 (code-review)
**Status:** APPROVED_WITH_WARNINGS (all r1 fixed; 1 BLOCK + 2 WARN new)

## R1 Verification

- F1 cross-tenant force-release: **VERIFIED FIXED** — `requireScope('id')` applied to force-release route.
- F2 migration idempotency: **VERIFIED FIXED** — DO block branches on set-equality, returns no-op on replay.
- F3 sweepScheduler test `>= 1`: **VERIFIED FIXED** — test now uses tight timing to assert exact `== 1`.

## NEW FINDING 1 — BLOCK

**Category:** auth / unrestricted-fallback
**File:line:** src/api/middleware/requireScope.ts:27-30
**Issue:** requireScope's "no role attached → allow" fallback is keyed off `attachedRole === undefined`. A future auth middleware that sets `apiKeyScope` without setting `apiKeyRole` (e.g., a JWT/OIDC layer, or refactor of bearerAuth) would silently bypass the scope check. The middleware should base its fallback on `attachedScope === undefined` since scope — not role — is what this middleware enforces.
**Impact:** Future auth refactor introduces silent cross-tenant bypass — exactly the failure mode r1 F1 was supposed to close.

## NEW FINDING 2 — WARN

**Category:** migration / parser-fragility
**File:line:** migrations/0051_leases_sweep_job_type.sql:36-37
**Issue:** The regex `regexp_matches(current_def, '''([^'']+)''', 'g')` greedily extracts every single-quoted token. Works for canonical Postgres output but could mis-parse alternate constraint shapes (e.g., embedded COLLATE annotations with quoted identifiers). Safer: anchor on `ARRAY[...]` segment or query `information_schema.check_constraints` directly.
**Impact:** Future Postgres upgrade or benign constraint annotation could trip the defensive assert.

## NEW FINDING 3 — WARN

**Category:** test-flakiness / timing
**File:line:** src/services/sweepScheduler.test.ts:100-103
**Issue:** "exactly one enqueue per cycle" relies on 50ms setTimeout firing at ~50ms and a 75ms wait completing before the second cycle at ~100ms. On loaded CI (Windows agents, containerized runners) the first cycle's promise chain can slip past 75ms, leaving `called === 0` flakily; conversely a quiet loop could fire the second cycle just inside 100ms. No deterministic boundary.
**Impact:** Intermittent CI failures → "rerun until green" culture.
