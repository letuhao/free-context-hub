# Sprint 15.8 — REVIEW-CODE round 1 (self-review, adversarial framing)

**Date:** 2026-05-20
**Subject:** Sprint 15.8 implementation on `phase-15-sprint-15.8` (uncommitted)
**Method:** "If you wanted to break this in production, where would you look?"

---

## F1 (WARN) — `applyMotionToStep` lapsed-at-top emits `step_escalated` with payload shape inconsistent with the existing 15.3 sweep

**Where:** `src/services/requests.ts:applyMotionToStep` lapsed-at-authority branch.

**The problem:** The existing 15.3 `sweepStalledSteps` at top-tier (escalation_exhausted)
emits:
```ts
payload: { step_index: step.step_index, exhausted: true }
```

My 15.8 `applyMotionToStep` at the same terminal point emits:
```ts
payload: {
  step_index,
  from_office: target_office,
  to_office: null,
  reason: 'motion_lapsed',
  degraded_to: 'unilateral'
}
```

Same event type (`request.step_escalated`), different payload schema. Consumers
expecting either `{exhausted: true}` (15.3) or `{from_office, to_office}` (15.3
sweep non-top + 15.8 sweep non-top) will see a third schema variant from 15.8
top-tier. Replay consumers must handle three shapes.

**Severity:** WARN — replay consumers still see step_escalated and can correlate
with the request.resolved (`outcome:'escalation_exhausted'`) event for the
authoritative state. The payload-shape inconsistency is a soft contract gap.

**Recommended fix:** align 15.8's top-tier emission with 15.3's:
```ts
payload: { step_index, exhausted: true, reason: 'motion_lapsed', degraded_to: 'unilateral' }
```

Apply now. One-line change.

---

## F2 (LOW) — `motions.test.ts` + `coordinationSweep.test.ts` cleanup() doesn't handle 15.8 inline-created request_steps + doa_matrix

**Where:** `src/services/motions.test.ts:cleanup` (around line 46) and
`src/services/coordinationSweep.test.ts:cleanup`.

**The problem:** my new 15.8 tests in motions.test.ts and coordinationSweep.test.ts
INSERT into `doa_matrix` + create requests + request_steps (via `submitRequest`
collective). Each test does inline cleanup at its end (UPDATE request_steps SET
motion_id=NULL + DELETE request_steps + DELETE requests + DELETE doa_matrix). But
this inline cleanup runs ONLY on success — if a test fails mid-way, leftover state
breaks the subsequent test's `beforeEach(cleanup)` with FK constraint violations
(motions FK to topics + body_id; doa_matrix FK to decision_bodies).

The cleanup() function in both test files only handles topic-scoped artifacts +
bodies — NOT requests/request_steps/doa_matrix.

**Severity:** LOW — tests are currently all green; the failure cascade only
materializes if a 15.8 test crashes. The `beforeEach(cleanup)` order would then
hit the FK violations and abort, but the original failure is the real signal.

**Recommended fix:** extend cleanup() in both files to delete request_steps +
requests + doa_matrix for the test project (mirror the pattern in
requests.test.ts cleanup). Defensive, makes test failure recovery cleaner.

Apply now. ~6 lines per file.

---

## F3 (LOW) — Step-proposal motion detection uses subject_ref string-prefix check (`request_step:`)

**Where:** `src/services/motions.ts:tallyMotion` and
`src/services/coordinationSweep.ts:sweepExpiredMotions` — the new chain-dedup
check `motion.subject_ref.startsWith('request_step:')`.

**The problem:** the dedup logic relies on the subject_ref string convention
(`request_step:<request_id>:<step_index>`) set in `proposeStepMotion`. If a
future sprint introduces a different naming convention for step-proposal motions,
this check silently misses them — both chains fire again, recreating the original
"2 tasks per collective approval" bug.

A more robust check: look up `request_steps WHERE motion_id=<this>`. If 1 row,
it's a step-motion (suppress chain); if 0 rows, it's standalone (chain).

**Severity:** LOW — current convention is consistent + tested via the live smoke.
A future code change that renames step-proposal motions would have to also update
this check; doing both would be a deliberate refactor, not a silent regression.

**Recommended fix:** ACCEPT-with-doc. Replace the string-prefix check with a
`request_steps WHERE motion_id=<this>` lookup. This is a query-per-motion cost
addition (small, sparse partial index covers it). But it also adds a 4th
`request_steps FOR UPDATE` call in the same transaction — already locked by the
step-update branch downstream. Marginal complexity. **Decision for 15.8:**
keep the prefix check; document in `proposeStepMotion` that the convention is
load-bearing for chain dedup. If future sprints touch this, they MUST update
both sides together.

---

## Summary

| F# | Severity | Where | Action |
|----|----------|-------|--------|
| F1 | WARN | applyMotionToStep top-tier step_escalated payload | FIX-now: align with 15.3 `{exhausted:true}` shape |
| F2 | LOW | motions/sweep test cleanup gaps | FIX-now: extend cleanup() |
| F3 | LOW | subject_ref string-prefix check | ACCEPT-with-doc |

**Verdict:** ACCEPTED with 2 fix-now (F1, F2) + 1 accept-with-doc (F3). Will apply
F1+F2 before QC.
