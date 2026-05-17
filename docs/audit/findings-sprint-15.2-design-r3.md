---
agent: adversary
phase: review-design
sprint: phase-15-sprint-15.2-board
round: 3
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md
spec_hash: b7989e44c083d131
r2_resolution: F1 partial; F2 resolved; F3 resolved
status: REJECTED
findings:
  - severity: BLOCK
    finding: >-
      The §0.2 / §10 lock-order "proof" omits appendEvent's hidden UPDATE topics row lock
      and is asserted, not derived. appendEvent (coordinationEvents.ts) does
      `UPDATE topics SET next_seq=next_seq+1` — a topics-row lock held to COMMIT — but every
      §2.x/§3.x pseudocode block writes appendEvent(...) opaquely, so the canonical-order
      claim is checked against pseudocode that never shows one of the four locks. Rev 3's
      mechanical sweep fix is real, but elevating it to "every transaction is a
      prefix-consistent subsequence" is unverified.
    impact: >-
      The no-deadlock guarantee (invariant 6, §10) rests on an unproven claim; a reviewer
      cannot confirm the canonical order without re-deriving every lock by hand.
    required_fix: >-
      Show every lock — including appendEvent's UPDATE topics — in every transaction's lock
      sequence and re-derive §0.2/§10 from that as an explicit table.
  - severity: BLOCK
    finding: >-
      completeTask (§2.5) reads the claim with a non-locking SELECT ... WHERE expires_at >
      now() (no FOR UPDATE), then DELETEs that row — a lock upgrade. claimTask-as-serializer,
      releaseTask, and the sweep all FOR UPDATE the claim row; completeTask alone reads it
      unlocked then exclusively deletes it. The claim row is first locked only at the DELETE,
      not at the liveness SELECT.
    impact: >-
      §9 invariant 7 ("completeTask acts on a live claim only") is not lock-enforced; the
      state='for_review' transition is decided on a possibly-stale read of the claim.
    required_fix: >-
      Add FOR UPDATE to completeTask's claim SELECT so the row is locked at first touch.
  - severity: WARN
    finding: >-
      The postTask F3 fix rests on a "topics are never hard-deleted" invariant enforced
      nowhere in the schema. Migration 0054's tasks.topic_id / artifacts.topic_id REFERENCES
      topics(...) declare no ON DELETE clause and nothing forbids DELETE FROM topics. No §8
      test covers a deleted (vs missing/closed) topic.
    impact: >-
      Any future hard-delete path (project purge, GDPR erase, test teardown truncating
      topics) reintroduces the raw 23503 -> 500 that F3 claims to have removed.
    required_fix: >-
      Name the "topics are never hard-deleted" invariant in §9 (and the 0054 migration
      comment) as a contract the FKs depend on, or pin the parent row with FOR SHARE.
---

# REVIEW-DESIGN round 3 — Phase 15 Sprint 15.2 (the Board)

Cold-start adversarial review of design rev 3 against rev-2's findings, the CLARIFY 15 ACs,
and the master design. 2 BLOCK + 1 WARN. Decision rule: any BLOCK → REJECTED.

## Round-2 resolution

**r2-F1 (sweep ABBA lock-order deadlock) — PARTIAL.** Rev 3 added the explicit
`SELECT 1 FROM artifacts … FOR UPDATE` at sweep step 2, breaking the *specific* cycle round 2
described (the sweep no longer locks `topics` before `artifacts`). But §0.2/§10 over-claim:
the blanket "prefix-consistent subsequence" guarantee omits `appendEvent`'s `topics`-row lock
from the pseudocode and does not derive each transaction's order — a deadlock finding
restated as an unproven claim. See findings 1 and 2.

**r2-F2 (closed-topic sweep branch vs AC11) — RESOLVED.** Rev 3 took the amend-the-AC option:
CLARIFY AC11 was scoped `[r2-fix — scoped open-vs-closed]` and §4.1's closed-topic branch
matches it verbatim. The coherence rationale is sound — a closed topic's tasks cannot be
re-claimed (the seal rejects `claimTask`'s `appendEvent`) and `revertArtifact` emits no event
of its own, so reverting would desync the artifact from the sealed log.

**r2-F3 (`postTask` 23503→500 on a missing topic) — RESOLVED.** Rev 3 adds the explicit
pre-`BEGIN` topic existence check → `NOT_FOUND`/404; §2.1 correctly distinguishes closed
(seal→400) from missing (check→404); §8 T1 adds the missing-topic test. The residual
schema-invariant risk is raised separately as finding 3 (WARN), not a non-resolution.

## Reasoning

### Finding 1 — the lock-order proof is asserted, not derived (BLOCK)

The round-3 mandate is to verify the canonical-order claim exhaustively. `appendEvent`
(`coordinationEvents.ts`) executes `UPDATE topics SET next_seq=next_seq+1 WHERE topic_id=$1
AND status<>'closed'` — a `topics`-row lock held to COMMIT. Every `appendEvent(...)` call in
the §2/§3/§4 pseudocode is therefore a `topics`-row lock, but the pseudocode renders them
opaquely, so §0.2's "every transaction is a prefix-consistent subsequence of
`task→artifact→claim→topics`" cannot be checked from the spec as written. §10 asserts the
property; it does not derive it. A no-deadlock guarantee that a reviewer cannot verify is not
a guarantee. The fix is to present an explicit per-transaction lock-sequence table with
`appendEvent`'s `topics` lock shown.

### Finding 2 — completeTask's claim lock is a SELECT-then-DELETE upgrade (BLOCK)

`completeTask` (§2.5) does `SELECT actor_id FROM claims WHERE artifact_id=$ AND expires_at >
now()` with **no `FOR UPDATE`**, then later `DELETE FROM claims WHERE artifact_id=$`. The
claim row is first write-locked only at the `DELETE`. Every other consumer of a claim row —
`claimTask` (via the task-row serializer + `DELETE`/`INSERT`), `releaseTask` (`SELECT … FOR
UPDATE`), the sweep (`SELECT … FOR UPDATE`) — locks the row at first touch. `completeTask`
alone reads it unlocked and decides the `state='for_review'` transition on that unlocked
read. §9 invariant 7 ("`completeTask` acts on a live claim only") is therefore not
lock-enforced. The fix is one keyword: `FOR UPDATE` on completeTask's claim SELECT — which
also fixes the lock *position* (the claim is then locked before the `UPDATE artifacts`,
making completeTask's order `task → claim → artifact → topics`).

### Finding 3 — the postTask fix rests on an unenforced schema invariant (WARN)

§2.1's justification ("Topics are never deleted, so the check has no TOCTOU; a plain SELECT
suffices") is correct for the *missing* case today. But migration 0054's
`tasks.topic_id`/`artifacts.topic_id REFERENCES topics(...)` declare no `ON DELETE` clause,
and nothing in the schema forbids `DELETE FROM topics`. Any future hard-delete path — a
project purge, a GDPR erasure, a test teardown truncating `topics` — reintroduces the raw
`23503 → 500` that finding F3 (round 2) claims to have removed, and no §8 test covers a
*deleted* (as opposed to missing or closed) topic. WARN, not BLOCK: no such delete path
exists today. The fix is to name the "topics are never hard-deleted" invariant in §9 and the
0054 migration comment as a contract the FKs depend on, or to pin the parent row with
`SELECT … FOR SHARE` inside the transaction.
