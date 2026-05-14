# Sprint 13.1 — Design Review Round 2 (Adversary)

**Verdict:** APPROVED_WITH_WARNINGS (0 BLOCK, 1 WARN)
**Spec hash reviewed:** 7fde8d0f4e46b5de (v2)

## v1 findings verification

- **v1 BLOCK 1 (force-release cross-tenant): VERIFIED** — `forceReleaseArtifact({project_id, lease_id})` runs `DELETE WHERE lease_id=$1 AND project_id=$2`; route nested at `/api/projects/:id/artifact-leases/:leaseId/force` (DELETE, admin). URL path scopes the tenant; service double-checks. Cross-tenant DELETE by lease_id alone is no longer possible.
- **v1 BLOCK 2 (renew silent no-op): VERIFIED** — `RenewResult` adds `{status:'cap_reached', expires_at, effective_extension_minutes}`. `capWasBinding = cappedMaxMs < candidateMs` triggers the distinct status. Caller can now distinguish real extension from pinned deadline.
- **v1 BLOCK 3 (synthetic agent_id): VERIFIED** — `_claimArtifactOnce` signals `{__retry:true}` when 23505 race resolves with no incumbent; outer `claimArtifact` retries once via `setImmediate`. Sentinel string is gone; bounded retry prevents infinite loop.

## New findings in v2 (1 WARN, 0 BLOCK)

### Finding 1 (WARN) — Exhausted-retry fallback misuses `rate_limited`

**Issue:** When `MAX_INTERNAL_RACE_RETRIES` (1) is exhausted, `claimArtifact` returns `{status:'rate_limited', reason:'max_active_leases', retry_after_seconds:1}`. Type-correct but semantically wrong: caller did NOT hit the per-agent lease cap. A caller observing `reason:'max_active_leases'` may take incorrect action (release another lease, raise quota alert).

**Why not BLOCK:** Statistically near-unhittable. Pathological window requires two consecutive winners to expire between INSERT and re-SELECT — given MAX_TTL_MINUTES=240, back-to-back microsecond expirations are not realistically achievable.

**Recommendation (non-blocking):** Add `reason:'race_exhausted'` to `rate_limited` variant OR a 4th ClaimResult variant `{status:'transient_error', retry_after_seconds:number}`. Could address in BUILD as 1-line polish.

## Other v2 changes — verified clean

- Discriminated union narrowing via `'__retry' in result` works (no ClaimResult variant defines `__retry`)
- `setImmediate` provides real event-loop yield in Node V8
- `effective_extension_minutes` math guarded against degenerate cases (Math.max(0, ...))
- Route `/:leaseId/force` vs `/:leaseId` — different segment counts, no Express collision
- `requireRole` hierarchy (admin ≥ writer) verified at middleware
- Lazy cleanup vs renew race — renew's FOR UPDATE row lock blocks claim step 1 DELETE
- artifact_id regex: rejects empty segments, accepts deep nesting

**Proceed to PLAN.** All 3 v1 BLOCKs resolved; 1 WARN is statistically near-unhittable.
