# Sprint 15.7 — REVIEW-DESIGN round 1 (self-review, adversarial framing)

**Date:** 2026-05-20
**Reviewer:** main session (v2.2 self-review, hostile-actor framing)
**Subject:** `docs/specs/2026-05-20-phase-15-sprint-15.7-design.md` rev 1 (hash `d0619c99e071cc9172154707232deee0b073a8c4`)
**Method:** "If you wanted to break this, where would you look?" — find exactly 3 problems.

---

## F1 (BLOCK) — Single-event chain payload deviates from design contract on the sealed trail

**Where:** §5 Event payloads — "task.deferred is **not** emitted as a separate event".

**The problem:**
The master design (`docs/phase-15-design.md` §C.4) reads:
> "...the handler does **not** post; it emits `task.deferred` (recording the would-be
> task in the sealed trail) so a draining topic is never re-filled."

The design contract is clear: on closing/closed, emit `task.deferred`. The rev 1 DESIGN
embeds the chain result in the source event's payload (`chain: {kind:'deferred', ...}`)
and consciously skips the separate `task.deferred` emission.

**Why it breaks:** a consumer scanning the sealed trail for "deferred outcomes via type
filter" (`WHERE type = 'task.deferred'`) returns zero rows — the deferred record lives
inside the source event's nested JSON payload, not as a discrete event. This violates:

1. The "sealed trail" contract — the event log is the authoritative record per design
   §3.2; a consumer expects type filtering to be sufficient discovery.
2. The pre-provisioning of `task.deferred` in `EVENT_TYPES` (15.1) becomes meaningless
   if no handler ever emits it.
3. Future GUI panels (e.g., "show me approved-but-deferred chains across all closed
   topics") become awkward — they have to scan all `request.resolved` /
   `motion.tallied` events and filter on nested payload.

The "1 extra appendEvent per deferred chain (small)" cost is real but small. The
contract conformance benefit is large.

**Recommended fix (DESIGN rev 2):**
- On deferral (closing/closed/invalid_depends_on at chain time): emit BOTH
  - the source event (request.resolved / motion.tallied) with `chain: {kind:'deferred', ...}` in payload (for caller-side convenience), AND
  - a separate `task.deferred` event with payload `{source_event_type, source_id, would_be_task: <postTask-shaped params>, reason}`.
- On post (active topic): emit the source event + the existing inline `task.posted` +
  `artifact.created` (no extra `task.deferred`).

This preserves both type-filterable discovery AND in-source-event readability.

---

## F2 (BLOCK) — Chain-time invalid_depends_on semantics: DESIGN contradicts CLARIFY AC10

**Where:** §2 `emitChain` flow step 2 — "emit task.deferred (reason: 'invalid_depends_on')"
contradicts CLARIFY AC10 — "chaining fails atomically — **the source event rolls back,
the request/motion stays at its prior state**, and the operation returns
`chained_task_dependency_invalid` to the caller."

**The problem:** the DESIGN treats an invalid-depends_on submitter blob as a
*deferral*; the CLARIFY spec treats it as a *failure that rolls back the resolution*.
These have opposite observable behaviors:

| Path | DESIGN rev 1 | CLARIFY AC10 |
|---|---|---|
| Decider sees | "approved + chain deferred" | "topic_closed / chained_task_dependency_invalid" error |
| Request status | `'approved'` (sticks) | `'open'` (rollback) |
| Operator action | observe deferred event later | re-submit with fixed blob |

This is not a small thing — it changes whether the approval is durable or transient.
**Pick one and update both docs.**

**Recommended fix (DESIGN rev 2):** match CLARIFY — ROLLBACK on chain-time
invalid_depends_on. Reasoning:
- Submit-time validation is structural only; chain-time semantic failure is a
  REAL bug in the submitter blob — the operator should learn immediately.
- Soft-defer here masks bugs. The submitter would never know their template was
  broken unless they audit deferred events.
- Topic-closing/closed deferral is different — those are race outcomes, not bugs.
  Deferral is appropriate there.
- Asymmetry is informative: closing→defer (race), invalid_depends_on→rollback (bug).

The trade-off (decider's approval not sticking) is acceptable because the operator
sees the error and can re-decide after a blob fix.

---

## F3 (BLOCK) — `sweepStuckClosingTopics` holds the advisory lock for unbounded duration

**Where:** §3.5 — "Scheduler integration — added 4th in `startClaimsSweepScheduler`
cycle, after the 3 existing sweeps".

**The problem:** the existing scheduler (`coordinationSweep.ts:582–637`) holds a single
postgres advisory lock for the duration of all sweeps in one cycle. The 3 existing
sweeps are fast (per-claim/step/motion, each in a short transaction). Adding
`sweepStuckClosingTopics` calls `closeTopic` *synchronously* per stuck topic.

`closeTopic` is a 3-phase, multi-table, multi-event operation. On a topic with N
in-flight items, Phase 2 is O(N) — for a stuck topic that has accumulated thousands
of claims/requests/motions/intake/disputes during its broken state, Phase 2 could take
**minutes**. During that time:

1. The advisory lock is held.
2. The OTHER 3 sweeps (claims, steps, motions) cannot run their next cycle until this
   one finishes.
3. The single-threaded scheduler cannot run the next cycle.
4. A 2nd stuck topic accumulates more debt while waiting.

Worst case: a single pathologically-slow `closeTopic` blocks all sweep activity
indefinitely. The 5-minute scheduler interval becomes irrelevant.

**Recommended fix (DESIGN rev 2):**

Option A (preferred): per-topic timeout — wrap each `closeTopic` call in a
`statement_timeout` (set on the connection inside the per-topic transaction) of, say,
**60 seconds**. A timeout aborts that single topic's recovery, logs, and the loop
continues to the next stuck topic. Subsequent sweep cycles re-attempt the timed-out
topic.

```ts
// inside the per-topic try block:
await client.query(`SET LOCAL statement_timeout = '60s'`);
await closeTopic({...});  // bails with QueryFailedError on timeout
```

Option B (alternative, larger change): convert the new sweep to *enqueue* a
`topic.recover` async job (via the existing job queue) instead of calling closeTopic
inline. The sweep itself just identifies stuck topics and enqueues, releasing the
advisory lock quickly. The job runner executes closeTopic per topic. Decouples the
hot-path scheduler from heavy work.

**Option A is the minimum fix.** Option B is a 15.8 candidate if recovery proves slow
in production.

---

## Summary

| F# | Severity | Where | Action |
|----|----------|-------|--------|
| F1 | BLOCK | §5 | Emit separate `task.deferred` on deferral; keep payload `chain` field too |
| F2 | BLOCK | §2 step 2 | ROLLBACK on chain-time invalid_depends_on (match CLARIFY AC10) |
| F3 | BLOCK | §3.5 | Add 60-second `statement_timeout` per `closeTopic` call in stuck-closing sweep |

**Verdict:** REJECTED — DESIGN rev 1 has 3 BLOCK findings.

**Next step:** revise DESIGN to rev 2 addressing F1+F2+F3; re-hash; re-review.

---

## Sign-off

- [x] 3 problems found
- [ ] DESIGN rev 2 written
- [ ] REVIEW-DESIGN round 2 confirms CLEAR
