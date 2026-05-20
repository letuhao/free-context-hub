# Sprint 15.8 — QC: AC coverage matrix

**Date:** 2026-05-20
**Spec hashes:** CLARIFY approved; DESIGN rev 2 hash `6d145951b9467172b096470e3b73af35d9a313b3`
**Tests:** 648/648 green; tsc clean; live smoke ✓.

## AC coverage

| AC | Description | Test | Status |
|----|-------------|------|--------|
| AC1 | submitRequest accepts collective + persists per-step procedure/body_id | requests.test.ts `15.8 AC1+AC4` | ✓ |
| AC1-neg | Reject multi-step counter_sign+collective | requests.test.ts `15.8 AC1-neg` | ✓ |
| AC4 | Auto-propose motion at step 0 activation | requests.test.ts `15.8 AC1+AC4` | ✓ |
| AC5 | decideStep on collective step → procedure_is_collective | requests.test.ts `15.8 AC5` | ✓ |
| AC6-carried | Motion carried → step endorsed → request approved + 15.7 chain | requests.test.ts `15.8 AC6-carried` + motions.test.ts `15.8 motions.T7` (full flow) | ✓ |
| AC6-failed | Motion failed → step returned, request returned, artifact reverted | requests.test.ts `15.8 AC6-failed` | ✓ |
| AC6-lapsed | Motion lapsed at non-top → step degrades to unilateral at next level | requests.test.ts `15.8 AC6-lapsed` + coordinationSweep.test.ts `15.8 sweep-lapsed` (sweep path) | ✓ |
| AC6-lapsed-at-top | Motion lapsed at authority tier → escalation_exhausted | requests.test.ts `15.8 AC6-lapsed-at-top` | ✓ |
| AC6-vetoed | Veto on linked motion → step rejected, request rejected | motions.test.ts `15.8 motions.T7-vetoed` | ✓ |
| AC7 | 15.7 chain fires on collective-carried-final | requests.test.ts `15.8 AC6-carried` (chained task asserted) + smoke | ✓ |
| AC9 | proposeMotion on body assigned to active step not blocked | covered by AC4 test (motion is proposed without issue) | ✓ (implicit) |
| AC10 | Existing unilateral tests still pass | npm test 648/648 — all pre-15.8 tests green | ✓ |

**AC8 removed in CLARIFY rev 2** (post-F2 reconciliation; multi-step counter_sign+collective hard-rejected).

## Chain deduplication (post-smoke fix)

Live smoke surfaced a behavioral gap: a collective approval was emitting TWO chained
tasks (one from motion.tallied → motion chain handler, one from request.resolved →
request chain handler). Fixed at BUILD-end:
- `motions.ts:tallyMotion` and `coordinationSweep.ts:sweepExpiredMotions` now check
  `motion.subject_ref.startsWith('request_step:')` and SUPPRESS the motion chain on
  step-proposal motions. The request's chain handler in `applyMotionToStep` still
  fires.
- Verified via live smoke: 1 chained task ("Execute approved request: ..."), not 2.
- F3 (LOW) flag: the prefix-string check is convention-dependent; documented in
  proposeStepMotion that the subject_ref format is load-bearing.

## Spec fingerprint vs implementation

| Item | Spec ref | Implementation | Drift |
|---|---|---|---|
| Migration 0061 schema | DESIGN §1 | applied | none |
| doaMatrix.ts returns procedure+body_id | §2.1 | doaMatrix.ts MatrixRow extended | none |
| submitRequest accepts collective | §2.2 | requests.ts §169 reject removed | none |
| Multi-step counter_sign+collective rejected | §2.2 + CLARIFY (post-F2) | requests.ts pre-INSERT reject | none |
| proposeStepMotion auto-propose at step 0 | §2.3 | requests.ts:proposeStepMotion called after request.submitted event | none |
| decideStep early-reject collective | §2.4 | requests.ts:decideStep `procedure==='collective'` branch (BEFORE status check, per AC5 test fix) | minor: re-ordered checks vs design — collective check precedes status check |
| applyMotionToStep 4-outcome dispatch | §2.7+§2.8 | requests.ts:applyMotionToStep exported | none |
| Lapsed degrade-to-unilateral | §2.8 lapsed (F1 fix) | requests.ts UPDATE step procedure='unilateral' body_id=NULL motion_id=NULL | none |
| Top-tier lapsed → escalation_exhausted | §2.8 + REVIEW-CODE F1 | requests.ts payload `{exhausted:true}` matches 15.3 | none (post-F1 fix) |
| tallyMotion + vetoMotion + sweep call applyMotionToStep | §2.9 | static import; all 3 paths wired | none |
| sweepStalledSteps skips motion_proposed | §2.10 | predicate already `status='pending'` — implicit skip | none |

**Spec drift:** none material. Minor ordering tweak in decideStep (collective check before status check — necessary because motion_proposed is not pending, AC5 test would otherwise return 'conflict' instead of 'procedure_is_collective').

## Deferred items review

| Item | Status | Notes |
|------|--------|-------|
| DEFERRED-018 | RESOLVED | Sprint 15.8 — collective request-step wiring shipped (single-step routes only) |
| DEFERRED-021 | Still OPEN | MCP outputSchema — to 15.9+ |
| DEFERRED-020 | Still OPEN | LOW test coverage cleanup — to 15.9+ |
| New limitation noted | Multi-tier collective (per-level body) | Carried into a future sprint (DEFERRED-022 candidate) |

## Verdict

**CLEAR.** 12/12 ACs covered (AC8 removed; AC9 implicit). No spec drift. REVIEW-CODE
F1+F2 applied; F3 accept-with-doc. Live smoke confirmed end-to-end collective approval
with 15.7 chain dedup. Ready for POST-REVIEW human gate.
