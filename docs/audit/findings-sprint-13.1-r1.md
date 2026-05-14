# Sprint 13.1 — Design Review Round 1 (Adversary)

**Verdict:** REJECTED (3 BLOCK, 0 WARN)
**Spec hash reviewed:** 93c2195d411a5152

## Finding 1 (BLOCK) — `forceReleaseArtifact` is cross-tenant by construction

**Issue:** `forceReleaseArtifact(leaseId)` takes only `leaseId` and runs `DELETE FROM artifact_leases WHERE lease_id = $1` — no `project_id` filter. Admin keys in this system are issued per-project (apiKeysRouter at `src/api/index.ts:98`), and the REST mount has no project gate. An admin holding an API key for project A can delete leases belonging to project B by knowing/guessing a UUID.

**Where:** `src/services/artifactLeases.ts` `forceReleaseArtifact`; mount in `src/api/index.ts` per design L477.

**Why it matters:** Tenant-isolation breach. Leasing is project-scoped (CLARIFY AC10); Phase 11 went to lengths to enforce cross-tenant guards in import. This design re-introduces the leak. The GUI "Force-release" button (phase-13-design.md L240) is shown next to per-project lease rows — the natural backend should be per-project too.

**Question for designer:** Should `forceReleaseArtifact` require the caller's `project_id` and refuse on mismatch, or should the admin force-release route be mounted under `/api/projects/:id/artifact-leases/:leaseId` with `requireRole('admin')` so the path itself scopes it?

## Finding 2 (BLOCK) — Renew silently no-ops at the TTL cap

**Issue:** In `renewArtifact`: `newExpiresAt = min(current.expires_at + extend_by_minutes·60s, now + 240min)`. If a lease was claimed with `ttl_minutes = 240`, then immediately after claim `current.expires_at ≈ now + 240min`, so `cappedMaxMs ≈ candidateMs` and a renew of `extend_by_minutes = 60` yields a new expiry effectively equal to (or earlier than) the old one. The service returns `status: 'renewed'` with that `expires_at`. The same silent no-op happens any time `current.expires_at - now ≥ 240min - extend_by_minutes`.

**Where:** `src/services/artifactLeases.ts` `renewArtifact`.

**Why it matters:** The point of `renew` is to prevent long-running tasks from losing their lease. A `renewed` response that didn't actually extend the deadline causes the agent to skip its next renew attempt — exactly the failure mode this tool exists to prevent.

**Question for designer:** Should `renewArtifact` return a distinct status (e.g., `cap_reached` with the actual `expires_at` and `effective_extension_minutes`) when `cappedMaxMs <= row.expires_at.getTime()`? Or should the cap be measured from `created_at` (absolute session ceiling) rather than `now()` (sliding ceiling)?

## Finding 3 (BLOCK) — Synthetic `<unknown:race-resolved>` conflict reports a non-existent incumbent

**Issue:** `fetchConflictResult` handles the case where INSERT failed with `23505` but the re-SELECT finds no row (because the racing winner's lease expired between the failed INSERT and the re-query). The design returns `status: 'conflict'` with `incumbent_agent_id: '<unknown:race-resolved>'`, `incumbent_task: ''`, `seconds_remaining: 0`.

**Where:** `src/services/artifactLeases.ts` `fetchConflictResult`.

**Why it matters:** Two problems: (a) the artifact is actually AVAILABLE at the moment of response — there is no incumbent — so reporting `conflict` makes the caller back off when it should immediately retry; (b) `'<unknown:race-resolved>'` violates the documented `agent_id` shape (CLARIFY A5: "opaque caller-supplied string"). Any downstream filtering/grouping by agent_id will treat the sentinel as a real agent.

**Question for designer:** Should the service do one bounded internal retry of the full claim transaction when the post-23505 SELECT finds no incumbent? If retry is undesirable, should we add a fourth `ClaimResult` variant like `{ status: 'retry'; reason: 'transient_race' }` so the caller is explicitly told to retry rather than treat this as a genuine conflict?
