# Sprint 15.2 — QC AC-coverage matrix

**Phase:** QC (8/12) · **Date:** 2026-05-17 · **Agent:** main
**Spec:** `docs/specs/2026-05-16-phase-15-sprint-15.2-design.md` rev 5, spec_hash `737d0febc8e1c455`
**CLARIFY:** `docs/specs/2026-05-16-phase-15-sprint-15.2-clarify.md` (15 ACs)

## Spec fingerprint

- Current design doc hash: **`737d0febc8e1c455`** (rev 5). Matches the latest logged
  `fixes_applied` event in `AUDIT_LOG.jsonl`.
- Drift trail — fully logged, no unexplained drift:
  `411f03f1d1c510af` (v1) → `4e81c50df7a82932` (v2, design-r1) →
  `b7989e44c083d131` (v3, design-r2) → `f1898f1af5ede266` (v4, design-r3) →
  **`737d0febc8e1c455`** (v5, code-r1 F1: the `WITH prev` CTE → `SELECT … FOR UPDATE`).
- Every revision has a `design_revised` / `fixes_applied` event with `spec_hash` +
  `spec_hash_old`. **No drift unaccounted for.**

## AC coverage — 15/15 COVERED

| AC | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| AC1 | Migration 0054 — clean + idempotent; `tasks`/`artifacts`/`artifact_versions`/`claims` + `coordination_fencing_seq` + `claims_active_uniq` | COVERED | `migrations/0054_coordination_board.sql`; `npm run migrate` ×2 exit 0 (BUILD T1); container boot applied 0054 (VERIFY) |
| AC2 | `post_task` inserts `tasks` + one `artifacts` row, emits `task.posted` + `artifact.created`, one txn | COVERED | `board.ts postTask`; `board.test.ts`; live smoke (post_task → task+artifact; both events in log) |
| AC3 | `list_board` lists `posted` (claimable) tasks | COVERED | `board.ts listBoard`; `board.test.ts` (status filter); live smoke (`?status=posted`) |
| AC4 | `claim_task` → `{claim_id, fencing_token, expires_at}`; task → `claimed`; `claim.granted` + `task.claimed`; fencing_token strictly increases | COVERED | `board.ts claimTask`; `board.test.ts`; live smoke (tokens 113→114 monotonic) |
| AC5 | Concurrent `claim_task`: exactly one `claimed`, rest `conflict`, no 500 | COVERED | `board.test.ts` `Promise.all` concurrency test (task-row `FOR UPDATE` serializer) |
| AC6 | `write_artifact` versions only when claim live AND fencing ≥ accepted; else `conflict`; accepted_fencing_token set on success | COVERED | `artifacts.ts writeArtifact` (one guarded `UPDATE`); `artifacts.test.ts`; live smoke (write → v2 working) |
| AC7 | PUT with fencing token below accepted, or expired `claim_id` → `conflict` | COVERED | `artifacts.test.ts` (fencing-stale reject, expired-claim reject) |
| AC8 | `baseline_artifact` moves `working`/`draft` → `baselined`; emits `artifact.state_changed` | COVERED | `artifacts.ts baselineArtifact`; `artifacts.test.ts`; live smoke (baseline → v3 baselined) |
| AC9 | `complete_task`: task → `completed`, artifact → `for_review`, claim released; `task.completed` + `artifact.state_changed` | COVERED | `board.ts completeTask`; `board.test.ts`; live smoke (state_changed `baselined→for_review`) |
| AC10 | `release_task` by holder: claim removed, task → `posted`; emits `task.released` | COVERED | `board.ts releaseTask`; `board.test.ts` (holder / non-holder / expired) |
| AC11 | Abandoned-claim sweep — open topic: `claim.expired` + task → `posted` + `task.released` + revert to last baselined/draft, never un-baseline, never touch `accepted_fencing_token`; closed topic: drop claim row only, no revert/change/events | COVERED | `coordinationSweep.ts sweepAbandonedClaims`; `coordinationSweep.test.ts` T13–T17 (recovery, revert-to-draft, revert-to-baselined + token-unchanged, closed-topic drop-only, batch crash-isolation); live smoke (recovered=1, task→posted, `claim.expired`) |
| AC12 | Artifact identity derived `<topic>:<task>:<slot>`; actor cannot supply/diverge | COVERED | `board.ts postTask` derives `artifact_id`; live smoke explicitly asserts `artifact_id === topic:task:slot` |
| AC13 | REST mirrors the 7 MCP tools 1:1; one envelope `{status, data?, error?}` | COVERED | `api/routes/board.ts` (7 endpoints); `mcp/index.ts` (7 tools); MCP smoke (7 tools in `tools/list`); REST smoke (envelope) |
| AC14 | `tsc --noEmit` clean; new unit tests pass; existing suite green | COVERED | VERIFY + REVIEW-CODE re-verify: `tsc` exit 0; `npm test` 361/361 (329 existing + 32 new) |
| AC15 | Live smoke: charter+join → post → claim → write → baseline → complete; + a claim left to expire and the sweep | COVERED | VERIFY live smoke ALL_PASS (happy path + sweep); REVIEW-CODE re-smoke ALL_PASS (F1/F2/F3 explicit) |

**0 not-covered · 0 partial.**

## Prior findings — all resolved

- **REVIEW-DESIGN** (3 cold-start Adversary rounds): 9 findings (7 BLOCK + 2 WARN) — all
  resolved across rev 2–4; main self-review APPROVED at the 3-round cap.
- **REVIEW-CODE** (1 cold-start Adversary round): 3 findings (1 BLOCK + 2 WARN) — all
  resolved in rev 5; main self-review round 2 APPROVED.
- **No unresolved BLOCK.**

## Deferred items

- **DEFERRED-009** (Phase 15 topic/board ops lack project-scope enforcement) — OPEN,
  inherited from 15.1. Trigger (a multi-tenant exposure / explicit auth sprint) **not met**
  in 15.2 — `MCP_AUTH_ENABLED=false` in dev, same posture as 15.1.
- **DEFERRED-010** (induction-pack pagination beyond the 1000-event cap) — OPEN, inherited.
  15.2 topics stay well under the cap; trigger **not met**.
- **Active topology-ordering enforcement** (`topology`/`depends_on` columns ship; enforcing
  `sequential`/`rolling` ordering does not) — flagged out-of-scope at CLARIFY, a DEFERRED
  candidate. **To be logged as a new DEFERRED entry at SESSION.**

## QC verdict

Spec fingerprint clean (rev 5 hash matches the log; full drift trail accounted for).
15/15 ACs COVERED. 12 prior findings (9 design + 3 code) resolved. No unresolved BLOCK.
Deferred items OPEN with triggers unmet; one new DEFERRED candidate to log at SESSION.
**QC PASS — proceed to POST-REVIEW.**
