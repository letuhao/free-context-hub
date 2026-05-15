# Sprint 13.2 Code Review — Round 1 Adversary Findings

**Round:** 1 (code-review)
**Reviewer:** Adversary (cold-start sub-agent)
**Date:** 2026-05-15
**Status:** REJECTED (2 BLOCK + 1 WARN)

## FINDING 1 — BLOCK

**Category:** auth
**File:line:** src/api/routes/artifactLeases.ts:114-121 + src/api/middleware/requireRole.ts:23-37
**Issue:**
The DELETE /:leaseId/force route is gated by requireRole('admin'), but requireRole only checks role level — never consults `req.apiKeyScope`. The handler then calls forceReleaseArtifact with project_id taken from the URL path, never the admin's scope. A DB-keyed admin scoped to project-A can issue `DELETE /api/projects/project-B/artifact-leases/<leaseId>/force` and the server deletes the lease. The GUI's headerShowsForceRelease defensively hides the column for scoped admins in All Projects mode, but the API has no such guard — any curl/MCP-tool caller bypasses the UI. The v2 BLOCK 1 fix that explicitly added project_id to forceReleaseArtifact for tenant isolation is undermined because the URL's project_id is trusted instead of the caller's scope.
**Impact:**
Cross-tenant force-release by scoped admins via direct API; violates the project-scope contract that exists at the UI layer.

## FINDING 2 — BLOCK

**Category:** deploy-state
**File:line:** migrations/0051_leases_sweep_job_type.sql:14-56
**Issue:**
The defensive ASSERT block's `expected_types` array lists 13 types that existed BEFORE this migration, deliberately excluding 'leases.sweep' itself. The check RAISES EXCEPTION if any type in the live constraint is not in expected_types. After this migration runs successfully, the constraint contains 14 types including 'leases.sweep'. On replay — disaster recovery from a backup taken after migration ran, dev workflow that TRUNCATEs schema_migrations, CI restore-and-replay, direct `psql -f` — the assertion fires with "UNKNOWN type(s) the design did not include: {leases.sweep}" and aborts. The migration treats its own outcome as a clobber hazard.
**Impact:**
Migration replay / DR / direct psql application fails with confusing error pointing at the very type the migration adds.

## FINDING 3 — WARN

**Category:** test-quality
**File:line:** src/services/sweepScheduler.test.ts:87-97
**Issue:**
The test "enqueues exactly once per cycle when lock acquired" only asserts `enqueueSpy.called >= 1`. With intervalMs=30 and waitMs(80), the scheduler fires 2+ cycles. A regression where a single cycle accidentally enqueues twice (chained setTimeout fires before finally-block reschedule, double-await of pool.connect that calls enqueueJob twice) would pass silently. The companion "skips enqueue" test correctly asserts `=== 0`, so the file has precision when it wants it — this test simply has the wrong assertion for its stated claim.
**Impact:**
A double-enqueue-per-cycle regression of leases.sweep would not be caught by the unit test designed specifically to guard it.
