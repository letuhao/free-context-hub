# Sprint 15.4 — QC — Scope Guard (AC coverage + fingerprint)

**Phase:** QC (8/12). **Reviewer:** main session, Scope-Guard mechanical check.
**Verdict:** CLEAR — fingerprint match, no drift; AC1–AC13 covered; AC14 is the POST-REVIEW gate.

## Spec fingerprint

DESIGN `docs/specs/2026-05-18-phase-15-sprint-15.4-design.md` — recomputed SHA-256[0:16]
(file with the hash line reading `<computed-after-write>`) = **`a12f419578588e6d`**. Matches the
rev-2 hash recorded at REVIEW-DESIGN completion (AUDIT_LOG `2026-05-18T11:50Z`). **No
unexplained drift** — the design has not been touched since rev 2; BUILD implemented against it.

## AC coverage matrix (CLARIFY §"Acceptance criteria", 14 ACs)

| AC | Requirement | Covered by | Status |
|----|-------------|-----------|--------|
| AC1 | Migration 0057 applies cleanly + idempotently; the 4 tables + indexes | `0057_collective_decision.sql` (`CREATE … IF NOT EXISTS` ×4 + 3 indexes); applied via `applyMigrations()` at BUILD; the 95 new tests run green against the tables; idempotent by construction | ✅ |
| AC2 | `createBody`/`addBodyMember`; invalid quorum/threshold/weight → `BAD_REQUEST` | `decisionBodies.test.ts` T2 (createBody valid + 8 validation rejections incl. quorum<0/threshold>1/threshold≤0/NaN) + T3 (addBodyMember + vote_weight≤0/unknown body) — 19 tests | ✅ |
| AC3 | `propose_motion` by a participant; non-participant / unknown body → clean status; closed topic → `topic_closed` | `motions.test.ts` T5 (11 tests: valid+event, not_participant, body_not_found, **cross-project body**, topic_closed, unknown topic, deadline below/above/fractional, over-long subject_ref); route test (propose 201, non-participant 422) | ✅ |
| AC4 | `second_motion` by member≠proposer → `balloting`; proposer/non-member/non-proposed rejected | `motions.test.ts` T6 (member→balloting+event, self_second_forbidden, not_member, conflict, not_found, topic_closed); route test (second 200, self-second 403) | ✅ |
| AC5 | `cast_vote` during balloting → weighted ballot; non-balloting/past-deadline/non-member rejected | `motions.test.ts` T7 (11 tests: valid+weight-snapshot, not_member, not_balloting, balloting_closed, already_voted, proxy, self-proxy, invalid choice, not_found, topic_closed); route test (vote 200) | ✅ |
| AC6 | `tally_motion`: quorum unmet→`lapsed`; quorum+threshold→`carried`; quorum+!threshold→`failed`; abstain → quorum-only | `motions.test.ts` T8 (13 tests: balloting_open, lapsed, carried, failed, **all-abstain→failed**, tie@0.5→carried, no-votes×2, non-balloting, already-tallied, not_found, weight-snapshot, proxy-tally); route test (tally past-deadline 200/carried) | ✅ |
| AC7 | `veto_motion` by a `veto_holders` member while balloting → `vetoed`; non-holder rejected; veto/tally mutually exclusive | `motions.test.ts` T9 (veto+event, veto-holder-not-member→vetoed D8, not_veto_holder, not_balloting, not_found, **mutual exclusion both directions**); route test (veto 200, non-holder 403) | ✅ |
| AC8 | Proxy: `proxy_for` recorded, principal-keyed; the tally counts each principal once | `motions.test.ts` T7 proxy-ballot (principal-keyed row, `proxy_for` set, event actor = holder) + T8 `proxy-tally` (REVIEW-CODE LOW-5 — a proxy-cast ballot counted at the principal weight: `for == 10`) | ✅ |
| AC9 | The expired-motion sweep: balloting-past-deadline resolved; proposed-past-deadline → `lapsed`; closed-topic skipped | `coordinationSweep.test.ts` T11a (auto-tally), T11b (lapsed/not_seconded), T11c (closed-topic skip), T11d (crash isolation — genuine 23505) | ✅ |
| AC10 | Every state change emits a `coordination_events` row; lifecycle reconstructable | events asserted throughout — `motion.proposed` (T5), `motion.seconded` (T6), `vote.cast` (T7), `motion.tallied` (T8/T11a/T11b), `motion.vetoed` (T9); `replayEvents` used | ✅ |
| AC11 | REST mirrors MCP 1:1; one envelope; writes `writer`, GETs `reader` | `routes/motions.test.ts` 21 tests — status→HTTP map + the GET role gate (the 15.3.1 test-shim: `reader` admitted, unknown role → 403). The 11 MCP tools (T13) mirror REST 1:1 — tsc-clean + exercised by the live smoke (verified by tsc + smoke, not separate unit tests — the 15.3 precedent) | ✅ |
| AC12 | `tsc` clean; new tests pass; the existing suite stays green | `tsc` exit 0; `npm test` **524/524** (429 prior + 95 new: decisionBodies 19 + motions 51 + routes/motions 21 + coordinationSweep +4) | ✅ |
| AC13 | Live smoke: body 3 members → propose → second → 3 votes → tally→carried; veto; sweep | live deployment smoke on the rebuilt `mcp`+`worker` images: **11/11** — incl. pre-deadline tally → 409 `balloting_open` (BLOCK-1 verified live), post-deadline tally → carried, veto → vetoed | ✅ |
| AC14 | POST-REVIEW: a security-framed cold-start Adversary confirms the body/motion/vote authz model is honestly scoped (guardrail `5c0b7b25`) | **POST-REVIEW phase (9/12) — pending** | ⏳ POST-REVIEW |

## Notes

- **AC9 — the sweep is unit-verified, not live-exercised.** The expired-motion sweep runs on
  the worker's 5-min cadence; the live smoke covered the request-driven REST paths and the
  sweep is proven by `coordinationSweep.test.ts` T11a–d (in the 524). Proportionate — the
  15.3.1 QC precedent (the escalation sweep was likewise unit-verified, not live-re-run).
- **AC11 — the MCP 1:1 mirror** is verified by `tsc` (the 11 tools compile against the same
  service fns the REST routes call) + the live smoke (the deployed REST surface). No separate
  MCP unit-test layer — the 15.1/15.2/15.3 precedent.
- REVIEW-CODE 5 LOW: LOW-5 fixed inline (the 524th test); LOW-1/2/4 cosmetic / pre-existing,
  accepted; LOW-3 (`veto_holders` array cap) → a deferred item at SESSION. None blocks QC.
- AC14 is the guardrail-mandated security gate — a security-framed cold-start Adversary at
  POST-REVIEW (lesson `5c0b7b25`; 15.4 is a governance primitive).

**QC verdict: CLEAR.** Proceed to POST-REVIEW (the AC14 gate).
