# Sprint 13.2 Design Review — Round 3 Adversary Findings

**Round:** 3
**Reviewer:** Adversary (cold-start sub-agent)
**Date:** 2026-05-15
**Status:** REJECTED (r2 verification mixed + 2 new BLOCK + 1 new WARN)

## R2 Verification

- **r1-F3 (exact-equality assert):** VERIFIED FIXED — Section 3 DO block now parses current_def with regex, computes extra_types via `t <> ALL (expected_types)`, raises EXCEPTION listing unknowns; both missing and extra are caught.
- **r2-F1 (apiKeyScope in /api/me):** PARTIALLY FIXED — /api/me now returns project_scope and GUI gates per-row on scope, but the design itself acknowledges backend `forceReleaseArtifact` still doesn't check scope; only logged as DEFERRED-004 with no in-sprint fix, so the BLOCK's "or, worse, can force-release leases in projects outside their scope" path is still live in this sprint.
- **r2-F2 (advisory-lock scheduler):** VERIFIED FIXED — Section 5 wraps enqueue in `pg_try_advisory_lock`, releases explicitly, drops connection on failure, documents single-leader semantics.
- **r2-F3 (untested role gate):** VERIFIED FIXED — Section 7 adds 3 /api/me handler unit tests plus an auth-enabled docker-compose override smoke covering steps 10a-10d.

## NEW FINDING 1 — BLOCK

**Category:** cross-file
**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.2-design.md:599-600 vs src/api/middleware/auth.ts:14 and src/services/apiKeys.ts:11
**Issue:**
The /api/me handler at design.md:599-600 sets `role = attachedRole ?? 'admin'` and `project_scope = attachedRole === undefined ? null : (attachedScope ?? null)`. Three semantically different identities collapse to one wire response:
- (a) MCP_AUTH_ENABLED=false → `{role:'admin', project_scope:null, auth_enabled:false}` (anyone in dev mode)
- (b) env-var admin token → `{role:'admin', project_scope:null, auth_enabled:true}`
- (c) DB-backed admin key with project_scope=null (legit global admin) → `{role:'admin', project_scope:null, auth_enabled:true}`

The GUI's `canForceReleaseRow` reads `currentRole` and `currentScope` only — `auth_enabled` is never consulted. A developer testing in dev mode gets identical UX to a production global admin, so any QA against this endpoint cannot distinguish "auth off" from "auth on with admin key." Section 7's three unit tests cover the well-behaved cases and miss this collapse.
**Impact:**
The /api/me contract leaks the auth-disabled state through identical role+scope shape with only the `auth_enabled` boolean disambiguating. Any GUI code that forgets to also check `auth_enabled` effectively grants unrestricted admin UX in dev mode, which then carries over if MCP_AUTH_ENABLED is accidentally left false in production.

## NEW FINDING 2 — BLOCK

**Category:** deploy-state
**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.2-design.md:281 and design.md:292-294
**Issue:**
The advisory-lock key is the hand-picked magic number `0x1303_5_5_5_5_5_5_5_5n` with INCONSISTENT derivation stories: the v3 diff narrative at design.md:280 says "stable hash of `'phase-13.leases-sweep'`" — the inline source comment says "0x1303 = '13.03' + filler". Neither derivation is reproducible from a script in the repo. A future sprint adding another scheduled job has no way to pick a non-colliding key except by reading every prior `pg_try_advisory_lock` call site. There is no registry document, no grep for existing keys, no test that asserts the key equals what a hash function would produce. Postgres advisory locks share a 64-bit namespace across all subsystems, so any collision deadlocks the sweep scheduler silently.
**Impact:**
Collision risk is unmanaged. Self-review #6 acknowledges this should be "documented" but provides only inconsistent inline comments, not a registry. POST-REVIEW cannot verify uniqueness without grepping every `pg_advisory*` call site in the repo by hand.

## NEW FINDING 3 — WARN

**Category:** test-gap
**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.2-design.md:284-316 (scheduleSweep) and Section 7 test plan
**Issue:**
The advisory-lock guard at lines 284-316 is the entire mitigation for r2-F2 (multi-replica N× cadence), but the test plan has zero entries verifying it. The unit tests cannot test scheduleSweep because it lives in src/index.ts (no test harness). No test ensures: (a) two concurrent scheduleSweep invocations enqueue only one job, (b) lock released after enqueue so next 15-min cycle works, (c) the catch path doesn't double-release on `pool.connect()` failure, (d) `client.release()` runs even when unlock query fails. The self-review handwaves the DB-down case but doesn't propose a test.
**Impact:**
The most important architectural change in v3 (advisory-lock for multi-replica) has no automated regression protection. A future refactor could silently regress to N× cadence with the only signal being production async_jobs row-count anomalies weeks later.
