# Sprint 13.2 Design Review — Round 2 Adversary Findings

**Round:** 2
**Reviewer:** Adversary (cold-start sub-agent)
**Date:** 2026-05-15
**Status:** REJECTED (r1 F3 PARTIALLY FIXED + 2 new BLOCK + 1 new WARN)

## R1 Verification

- **F1 (partial-index myth)** — VERIFIED FIXED. Section 1 narrative at design.md:115-119 explicitly states migration 0048 ships a FULL unique index (not partial), explains step-1 DELETE coupling, and Section 7 adds a re-claim test (design.md:303-311) covering the expired-but-ungraced case end-to-end.
- **F2 (force-release UX role-gating)** — VERIFIED FIXED. New Section 10 adds GET /api/me, Section 8 fetches role on mount and gates rendering via canForceRelease = currentRole === 'admin', API client gets getCurrentUser().
- **F3 (migration constraint clobber)** — PARTIALLY FIXED. Section 3 adds a DO-block ASSERT that fails loud, but the assert only verifies the 13 hard-coded "expected_types" are PRESENT; it does NOT detect EXTRA types added between Phase 11/12 and now. A future job_type added by an intermediate migration will pass the assert and still be silently dropped from the rewritten constraint at lines 187-202.

## NEW FINDING 1 — BLOCK

**Category:** cross-file
**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.2-design.md:478-483 (Section 10 /api/me handler) and src/api/index.ts:70 (bearerAuth mount) vs src/api/middleware/auth.ts:38 (apiKeyScope attachment)
**Issue:**
The v2 /api/me handler computes `role = attachedRole ?? 'admin'` and ignores `apiKeyScope` entirely. But `bearerAuth` attaches BOTH `apiKeyRole` AND `apiKeyScope = keyEntry.project_scope` (auth.ts:37-38). The Active Work panel (Section 8) uses role alone to decide whether to render force-release across ALL projects in "All Projects" mode. A project-scoped admin key restricted to project X will see and attempt force-release rows from project Y. Spot check of artifactLeases.ts:384 confirms `forceReleaseArtifact` requires project_id but does NOT check it against apiKeyScope — meaning the backend may not even 403 the cross-tenant action (this is a pre-existing gap surfaced by Sprint 13.2's UX).
**Impact:**
Multi-tenant deployments using project-scoped admin keys can either be shown cross-project rows they can't act on (UX friction) or, worse, can force-release leases in projects outside their scope if no per-project authorization layer exists. The design adds /api/me but doesn't expose enough info for the GUI to filter correctly.

## NEW FINDING 2 — BLOCK

**Category:** deploy-state
**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.2-design.md:243-262 (scheduleSweep in src/index.ts) vs architecture overview at design.md:33-37
**Issue:**
The scheduler lives in src/index.ts (the MCP/API server process). In production with N replicas of the API server behind a load balancer, EVERY replica independently calls scheduleSweep() and enqueues a leases.sweep job every 15 min — actual cadence becomes N× intended. No leader election, no `pg_try_advisory_lock`, no singleton-row guard. The self-review item 1 (design.md:558) acknowledges async_jobs bloat from worker downtime but misses replica-count multiplication, which is constant-load even on happy paths.
**Impact:**
Async_jobs table grows at N× intended rate; worker work doubles/triples needlessly; the cadence guarantee in master design phase-13-design.md:234 ("every 15 minutes") is unenforceable in multi-replica deployments. The smoke step "Server logs 'leases.sweep scheduler started'" now logs N times silently.

## NEW FINDING 3 — WARN

**Category:** test-gap
**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.2-design.md:514-527 (Test plan) vs design.md:497-512 (smoke steps 9-10)
**Issue:**
Smoke step 10 (force-release 403 path) is gated on `if MCP_AUTH_ENABLED=true` — the docker-compose default is `false`, consistent with auth.ts:14 early-return. In AMAW autonomous mode with no human at the keyboard, smoke step 10 will be skipped silently. No unit/integration test asserts: (a) GET /api/me returns the role attached by bearerAuth, (b) ActiveWorkPanel hides the column when role !== 'admin', (c) requireRole('admin') on /force returns 403 for writer keys. The new /api/me endpoint, the new role-gated rendering, and the existing requireRole('admin') guard on DELETE /:leaseId/force all ship completely untested under the most common dev configuration.
**Impact:**
F2's "fix" cannot be regression-protected by the autonomous run's verification gate. A future refactor that silently broke /api/me (always returning 'admin', or null) would only be caught by manual testing with MCP_AUTH_ENABLED=true — which the design itself classifies as optional.
