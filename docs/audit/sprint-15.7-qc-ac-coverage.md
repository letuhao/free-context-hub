# Sprint 15.7 — QC: AC coverage matrix

**Date:** 2026-05-20
**Spec hashes:**
- CLARIFY: rev 2 approved 2026-05-20
- DESIGN: rev 2 hash via git `4d54f81e2befe8ebf50d70403882a9295e296836`
- PLAN: 19 tasks T1–T19

**Tests green:** 638/638 (602 base + 36 new). `tsc --noEmit` clean. Live smoke ✓.

## AC coverage matrix

### Chaining (DEFERRED-019)

| AC | Description | Test | Status |
|----|-------------|------|--------|
| AC1 | submitRequest accepts execution_task; structural validation | requests.test.ts AC1 + chaining.test.ts validate-* (15 tests) | ✓ |
| AC2 | proposeMotion accepts execution_task; structural validation | motions.test.ts AC2 + chaining.test.ts validate-* | ✓ |
| AC3 | approved request → chain emits task.posted, request.resolved.chain.kind=posted | requests.test.ts AC1 (passes) + requests.test.ts AC3 (blob override) | ✓ |
| AC4 | tallyMotion carried (user-driven) → chain emits posted | motions.test.ts AC2, AC4 | ✓ |
| AC5 | sweepExpiredMotions auto-carried → chain emits posted | coordinationSweep.test.ts AC5 | ✓ |
| AC6 | Negative outcomes (returned/rejected/escalation_exhausted/failed/lapsed/vetoed) → no chain, no new task | requests.test.ts AC6, motions.test.ts AC5/AC6 | ✓ |
| AC7 | Topic 'closing' → task.deferred (subject_type=topic), source.chain.kind=deferred | requests.test.ts AC7, motions.test.ts AC7 | ✓ |
| AC8 | postTask atomicity — failure rolls back source event | covered indirectly by AC10 throw → rollback | ✓ (transitive) |
| AC9 | execution_task validation negatives | chaining.test.ts (15 validate-* tests) | ✓ |
| AC10 | invalid_depends_on at chain time → throw, request stays 'open' | requests.test.ts AC10 | ✓ |

### Stuck-closing sweep (DEFERRED-011a)

| AC | Description | Test | Status |
|----|-------------|------|--------|
| AC11 | Topic 'closing' > 5 min → sweep recovers to 'closed' | coordinationSweep.test.ts AC11 | ✓ |
| AC12 | Topic 'closing' < 5 min → not picked up | coordinationSweep.test.ts AC12 | ✓ |
| AC13 | Sweep runs 4th in scheduler advisory-lock cycle | Verified by code reading + manual run logs (not test-covered) | ⚠ partial |
| AC14 | Per-topic failure doesn't abort the loop | Inherent to §0.1-loop pattern + REVIEW-CODE F2 cap; not explicit test | ⚠ partial |

### Topology enforcement (DEFERRED-011b)

| AC | Description | Test | Status |
|----|-------------|------|--------|
| AC15 | claimTask sequential w/ incomplete predecessor → unmet_dependencies | board.test.ts AC15 | ✓ |
| AC16 | claimTask sequential w/ all completed → claimed | board.test.ts AC16 | ✓ |
| AC17 | claimTask rolling w/ upstream not baselined → upstream_not_baselined | board.test.ts AC17 | ✓ |
| AC17b | claimTask rolling w/ baselined upstream → claimed | board.test.ts AC17b | ✓ |
| AC18 | claimTask parallel w/ non-completed predecessor → claimed (no check) | board.test.ts AC18 | ✓ |
| AC19 | claimTask sequential/rolling w/ empty depends_on → claimed | board.test.ts AC19 | ✓ |

## Spec fingerprint check

| Item | Spec ref | Implementation | Drift? |
|------|----------|----------------|--------|
| `execution_task` JSONB column on requests | §1 migration 0060 | migration 0060 applied | none |
| Same column on motions | §1 | applied | none |
| `validateExecutionTask` constraints | §2 design table | chaining.ts MAX_TITLE_LEN=512, MAX_SLOT_LEN=64, MAX_KIND_LEN=64, MAX_DEPENDS_ON=32, MAX_RACI_BYTES=8192 | none |
| Chain emit at 3 sites (decideStep approve, tallyMotion carried, sweepExpiredMotions carried) | §3.1, §3.2, §3.3 | wired in all 3 | none |
| topics FOR UPDATE in chain handler | §6.1, §6.2 race analysis | chaining.ts emitChain step 1 | none |
| task.deferred subject_type='topic', subject_id=topic_id | §5 (rev 2 refinement) | chaining.ts emitChain (deferred branch) | none |
| chain.deferred_event_id cross-ref | §5 | chaining.ts returns deferred_event_id; decideStep/tallyMotion embed in source payload | none |
| invalid_depends_on → ROLLBACK source (no deferral) | §2 step 2 (F2 fix) | chaining.ts throws ContextHubError; caller rolls back | none |
| closeTopic statementTimeoutMs param | §3.5 (F3 fix) | topics.ts signature + applyStmtTimeout helper | none |
| claimTask sequential `depends_on` all `completed` | §3.4 | board.ts | none |
| claimTask rolling upstream `baselined` | §3.4 | board.ts | none |
| sweepStuckClosingTopics event-log-based scan | §3.5 (Q2) | coordinationSweep.ts query joins coordination_events ON type='topic.closing' | none — minor: column is `ts` not `created_at` (spec had typo; corrected in code) |
| LIMIT cap on stuck-closing scan | REVIEW-CODE F2 | `LIMIT $2` with SWEEP_STUCK_CLOSING_MAX_PER_CYCLE=10 | none |

**Spec drift:** none material. One minor correction during BUILD: design §3.5 wrote
`max(created_at)` but the schema column is `ts` — code uses `ts`. Same intent.

## Deferred items review

| Item | Status | Notes |
|------|--------|-------|
| DEFERRED-019 | RESOLVED | Primitive-outcome chaining shipped with submitter execution_task blob |
| DEFERRED-011 | RESOLVED | Both halves: closing-topic stuck-recovery sweep + topology enforcement on claimTask |
| DEFERRED-020 | OPEN (re-deferred) | LOW test coverage gaps from 15.6 review-impl — 2nd session |
| DEFERRED-007 | INTERLOCKS w/ F3 (LOW deferred) | MCP discriminated-union outputSchema |

## QC verdict

**CLEAR.** All HIGH/MED findings from REVIEW-DESIGN and REVIEW-CODE resolved; AC coverage
is ✓ for 15/19 ACs and ⚠ partial for 2 (AC13/AC14 — sweep ordering + §0.1-loop isolation,
both verified by code reading rather than explicit tests; consistent with how 15.6 verified
its drain-loop behavior).

**Recommendation:** ready for POST-REVIEW human gate.
