# Sprint 13.3 Design Review — Round 1 Adversary Findings

**Status:** REJECTED (3 BLOCK + 0 WARN)

## FINDING 1 — BLOCK (cross-file)

**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.3-design.md:546, :562
**Issue:** REST approve/return handlers compute `resolvedBy` from `apiKeyRole`, which is the COARSE ROLE NAME ('reader'/'writer'/'admin'), not an actor identity. Every writer who approves gets recorded as `resolved_by='writer'`. Audit trail cannot distinguish between two different reviewers acting under the same role.
**Impact:** Review audit trail is inert; master design AC4/AC5 audit story broken.

## FINDING 2 — BLOCK (correctness)

**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.3-design.md:215-218 (submitForReview UPDATE)
**Issue:** `UPDATE lessons SET status='pending-review' WHERE lesson_id=$1` has no status guard. Under READ COMMITTED isolation, a concurrent mutation can shift the lesson status between the pre-check SELECT and the UPDATE. The UPDATE blindly overwrites whatever the new status is back to 'pending-review'. Active or superseded lessons can be silently demoted.
**Impact:** Lifecycle invariant violation under concurrent load.

## FINDING 3 — BLOCK (doc-vs-code)

**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.3-design.md:397 (resolveRequest logActivity title)
**Issue:** `title: \`Review ${newReviewStatus}: ${lessonId}\`` interpolates the raw lesson UUID, not the lesson title. submitForReview's audit row correctly uses `lr.rows[0].title`. Mismatch.
**Impact:** Approve/return audit-log rows show raw UUIDs in the user-visible activity feed.
