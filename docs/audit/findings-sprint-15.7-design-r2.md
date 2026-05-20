# Sprint 15.7 — REVIEW-DESIGN round 2 (self-review, adversarial framing)

**Date:** 2026-05-20
**Reviewer:** main session (v2.2 self-review)
**Subject:** `docs/specs/2026-05-20-phase-15-sprint-15.7-design.md` rev 2 (hash `4d54f81e2befe8ebf50d70403882a9295e296836`)
**Method:** verify r1 BLOCK fixes + scan for new BLOCKs.

---

## R1 BLOCK fix verification

| F# | Fix landed | Where in rev 2 |
|----|-----------|---------------|
| F1 — dual-emit task.deferred | ✅ | §2 emitChain flow step 1 + §5 task.deferred event payload; `chain.deferred_event_id` added to source-event payload for cross-ref |
| F2 — invalid_depends_on → ROLLBACK | ✅ | §2 emitChain flow step 2: throws ContextHubError; source rolls back; aligns with CLARIFY AC10 |
| F3 — statement_timeout cap on closeTopic | ✅ | §3.5: closeTopic accepts `statementTimeoutMs?: number`; sweep passes 60_000; per-connection SET statement_timeout inside closeTopic |

All three R1 BLOCKs resolved.

---

## R2 findings (pre-publication refinements caught during r2)

These were applied **inline to rev 2** during the r2 review pass — not separate
findings to fix, but recorded here for traceability:

### WARN-1 — `task.deferred` `subject_type` was 'task' with phantom UUID

**Where:** §5 event payload (initial rev 2 draft).
**Issue:** the initial rev 2 draft set `subject_type='task'` and `subject_id=<fresh
UUID>` for `task.deferred`. But no real task exists — the UUID is a phantom. Other
`task.*` events use real `tasks.task_id` as subject_id, so this would be the only
`task.*` event with no underlying task row.
**Fix applied:** subject_type='topic', subject_id=topic_id. The deferral is a
topic-scoped fact; the would-be-task fully lives in payload. Filtering "events about
this topic" naturally includes the deferral.

### WARN-2 — `closeTopic` signature using borrowed `PoolClient`

**Where:** §3.5 (initial rev 2 draft).
**Issue:** initial draft passed an external `PoolClient` to `closeTopic` so the sweep
could call `SET statement_timeout` on it. But `closeTopic` internally allocates fresh
connections per-phase and per-item — threading a borrowed client through a 3-phase
structure forces a major rewrite of the existing 15.6 code.
**Fix applied:** simpler optional `statementTimeoutMs?: number` param. closeTopic runs
`SET statement_timeout` on every internal `pool.connect()` if the param is set.
Backward-compatible (existing 15.6 callers don't pass it). Surgically minimal.

---

## R2 BLOCK scan

Scrutinized rev 2 for new BLOCK-class issues:

- **Lock order with chain handler taking topics FOR UPDATE late** — verified safe.
  Canonical order `request → request_step → artifact → topics` (existing 15.3 lock
  order); topics is last; no cycle.

- **`appendEvent` ordering when chain emits BOTH task.posted AND task.deferred + source
  event in one transaction** — verified: in `posted` branch, order is task.posted,
  artifact.created, request.resolved. In `deferred` branch, order is task.deferred,
  request.resolved. Replay consumers see chain events before source — slightly out of
  intuitive order but well-defined and recoverable via payload cross-refs.

- **Submitter-blob raci 8 KB cap** — design notes "raci recorded as-is, ≤8 KB JSON"; cap
  is mentioned but not enforced in any code path described. Add: structural validation
  in `validateExecutionTask` must check `JSON.stringify(raci).length ≤ 8192`. Adding to
  PLAN task T2 as an explicit acceptance.

- **`sweepStuckClosingTopics` lateral join performance** — `JOIN LATERAL ... SELECT
  max(created_at) FROM coordination_events WHERE topic_id=t.topic_id AND
  type='topic.closing'` is an indexed lookup (coordination_events has `(topic_id, type)`
  in the schema, per 15.1 migration). Plan: <1s per scan even at 100k events. Acceptable.

- **Race with concurrent decideStep on same request + closeTopic Phase 2 force_closed**
  — Phase 2 holds no topic lock; UPDATE requests blocks on row lock; one finishes first;
  the other sees post-state and skips per §0.1-loop. No deadlock; no double-resolution.

- **execution_task slot collision with another chained task on same topic** — each
  postTask call generates a fresh task_id (randomUUID); artifact PK is `<topic>:<task_id>:<slot>`;
  task_id differs across chains; no collision possible even with identical slot.

**No new BLOCKs.**

---

## Verdict

| | Count |
|---|---|
| R1 BLOCKs resolved | 3/3 |
| R2 new BLOCKs | 0 |
| R2 WARNs (fixed inline rev 2) | 2 |

**Status: CLEAR.** DESIGN rev 2 ready to proceed to PLAN.

`PLAN` phase MUST capture:
- T2: `validateExecutionTask` enforces `raci` ≤ 8 KB JSON
- T5: closeTopic gains `statementTimeoutMs` param
- T8: chain `deferred_event_id` cross-ref appears in source event payload
- T7: route layer accepts `execution_task` in submit_request + propose_motion body
