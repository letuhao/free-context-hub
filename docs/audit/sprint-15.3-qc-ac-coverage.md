# Sprint 15.3 QC — AC coverage (Scope Guard)

**Phase:** QC · **Agent:** cold-start Scope Guard (general-purpose, sonnet)
**Design:** `docs/specs/2026-05-17-phase-15-sprint-15.3-design.md` rev 3, spec hash `6f79057f9e42e4fc`
**Verdict:** CLEAR.

> Persisted by the main session — the Scope Guard sub-agent returned this in its final
> message (the harness blocks sub-agent writes under `docs/audit/`).

## Spec fingerprint

Recomputed `6f79057f9e42e4fc` = recorded `6f79057f9e42e4fc` — **MATCH**. The design document is
unmodified since REVIEW-DESIGN closed. No drift.

## AC coverage — 14/14 COVERED

| AC | Summary | Status | Code evidence | Test evidence |
|----|---------|--------|---------------|---------------|
| AC1 | Migration 0056 applies cleanly + idempotently; 3 tables + indexes; default matrix seeded | COVERED | `migrations/0056_request_approval.sql` — `IF NOT EXISTS` + 2 `WHERE NOT EXISTS` seeds | exercised by every requests.test.ts scenario |
| AC2 | `doa_matrix` per-project; topic override; resolution precedence | COVERED | `doaMatrix.ts` `resolveMatrixRow` (tier-ranked ORDER BY) | `doaMatrix.test.ts` T13a; `requests.test.ts` T3 |
| AC3 | submit resolves matrix, derives + freezes steps, emits `request.submitted` | COVERED | `requests.ts` `submitRequest` | `requests.test.ts` T1; `routes/requests.test.ts` (201) |
| AC4 | Both route shapes — `counter_sign` multi-step + `escalate_to_authority` single-step | COVERED | `doaMatrix.ts` `deriveRoute` | `doaMatrix.test.ts` T15a-c; `requests.test.ts` T1/T2 |
| AC5 | decide — endorse/return/reject; emits `request.step_decided` | COVERED | `requests.ts` `decideStep` | `requests.test.ts` T8/T9/T10/T11 |
| AC6 | Step decidable only by a participant at `target_office`; else `not_authorized` | COVERED | `requests.ts` authorization block | `requests.test.ts` not_authorized; `routes/requests.test.ts` 403 |
| AC7 | `collective` rejected at submission | COVERED | `requests.ts` (throws BAD_REQUEST) | `requests.test.ts` T5 |
| AC8 | approved → artifact `final`; returned → `working`; guarded UPDATE; `request.resolved` | COVERED | `requests.ts` `resolveArtifact` + decide branches | `requests.test.ts` T9/T10/T11 + MED-1 (0-row path) |
| AC9 | Escalation sweep — stalled step climbs one level, fresh deadline, `request.step_escalated` | COVERED | `coordinationSweep.ts` `sweepStalledSteps` climb branch | `coordinationSweep.test.ts` T17 |
| AC10 | Authority step timeout → `escalation_exhausted`; no dispute | COVERED | `coordinationSweep.ts` authority branch | `coordinationSweep.test.ts` T18 |
| AC11 | Every state change emits a `coordination_events` row; reconstructable | COVERED | `requests.ts` + `coordinationSweep.ts` + `resolveArtifact` emissions | `requests.test.ts` MED-1; `coordinationSweep.test.ts` T17/T18 |
| AC12 | REST mirrors MCP 1:1; one envelope | COVERED | `routes/requests.ts` 4 routes; `mcp/index.ts` 4 tools; `api/index.ts` mount | `routes/requests.test.ts` 6 HTTP-mapping tests |
| AC13 | `tsc` clean; new tests pass; suite green | COVERED | VERIFY: `tsc` exit 0; `npm test` 414/414 | the 414-test run |
| AC14 | Live smoke: charter → submit ≥2-step counter_sign → endorse ×2 → approved + artifact final; 2nd request expires → sweep escalates | COVERED | live smoke (VERIFY AUDIT_LOG) | attested by VERIFY; T9 + T17 cover identical paths on the real DB |

**Covered: 14/14 · Partial: 0 · Missing: 0**

## Deferred items — no trigger met by this sprint

- DEFERRED-013 (distinct-endorser / step-collapse) — trigger Sprint 15.4/15.5 — future.
- DEFERRED-014 (listRequests topic-existence; request.resolved payload uniformity) — trigger Sprint 15.6 / requests.ts edit — future.
- DEFERRED-012 (closeTopic drain) — trigger Sprint 15.5 — future.
- DEFERRED-011/010/009/008/004/003 — none met by this sprint's work.

## Findings

None. Fingerprint matches; all 14 ACs COVERED by shipped code + a real integration-level test;
DEFERRED-013/014 correctly logged with future triggers.

Informational (not a block): AC14's live smoke is attested by the VERIFY AUDIT_LOG entry
rather than a committed automated test — consistent with the design §8 "Live smoke (VERIFY)"
framing and the 15.2 precedent; T9 + T17 unit tests cover identical code paths on the real DB.

## Verdict: CLEAR
