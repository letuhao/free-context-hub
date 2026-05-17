---
agent: scope-guard
phase: post-review
sprint: phase-15-sprint-15.2-board
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md
spec_hash: 737d0febc8e1c455
status: CLEAR
spec_drift: false
ac_covered: 15 of 15
prior_findings_resolved: "12/12 — 7 design BLOCK (d-r1 F1/F2/F3, d-r2 F1/F2, d-r3 F1/F2) + 2 design WARN (d-r2 F3, d-r3 F3) + 1 code BLOCK (c-r1 F1) + 2 code WARN (c-r1 F2/F3) all verified resolved in the current code/spec."
---

# REVIEW (POST-REVIEW) — Phase 15 Sprint 15.2 (the Board)

Cold-start Scope Guard, final conservative gate before SESSION/COMMIT. Judged only
from the files and from commands run in-session. Decision rule: ANY unresolved
issue → BLOCKED.

## 1. Spec-fingerprint check — CLEAN

Recomputed the design doc hash (the file with the hash line value replaced by
`<computed-after-write>`, sha256, first 16 hex) → `737d0febc8e1c455`.

- Recomputed hash `737d0febc8e1c455` **equals** the value recorded in the design
  doc header **and** the `spec_hash` of the latest `fixes_applied` event in
  AUDIT_LOG.jsonl (`2026-05-17T14:40:00Z`).
- Full drift trail v1→v5 logged, no gap — every revision has a
  `design_complete`/`design_revised`/`fixes_applied` event carrying both
  `spec_hash` and (for revisions) `spec_hash_old`, an unbroken chain:
  - v1 `411f03f1d1c510af` — `design_complete`
  - v2 `4e81c50df7a82932`, old `411f03f1d1c510af` — `design_revised` r1-fix
  - v3 `b7989e44c083d131`, old `4e81c50df7a82932` — `design_revised` r2-fix
  - v4 `f1898f1af5ede266`, old `b7989e44c083d131` — `design_revised` r3-fix
  - v5 `737d0febc8e1c455`, old `f1898f1af5ede266` — `fixes_applied` code-r1
- The review-event chain confirms every hash (design-r1..r3 reviewed v1..v3,
  design-r4-selfreview + code-r1 reviewed v4, code-r2-selfreview reviewed v5). No
  skipped revision, no unexplained hash.

**spec_drift: false.** The QC matrix's fingerprint claim is independently confirmed.

A note (not drift): the three new service files carry a header doc-comment citing
the v4 hash. A stale *citation* in a source comment, not implementation drift —
the files implement design rev 5 (each has the explicit `SELECT … FOR UPDATE`
pre-lock and the `[code-r1 F1]` markers; no `WITH prev` CTE survives). The design
doc itself — the artifact POST-REVIEW fingerprints — hashes correctly to v5.
Flagged for SESSION housekeeping, not a gate failure.

## 2. Fresh evidence — run in-session

**`npx tsc -p tsconfig.json --noEmit`** → exit 0. Clean.

**`npm test`** → `tests 361 · pass 361 · fail 0 · cancelled 0 · skipped 0 ·
todo 0`. Matches the expected 361/361. The 3 new Sprint 15.2 test files contribute
32 tests (board 17, artifacts 9, sweep 6); 329 pre-existing. Tests hit the live
Docker `db`.

## 3. AC coverage walk — 15/15, verified independently against the code

AC1 migration 0054 idempotent/additive; AC2 `postTask` one-txn task+artifact+v1+2
events; AC3 `listBoard` status filter; AC4 `claimTask` returns claim+token, task
→claimed, monotonic token; AC5 `Promise.all` concurrency → exactly one winner;
AC6 `writeArtifact` one guarded UPDATE (state+fencing+claim-liveness); AC7 stale
token / expired claim → conflict; AC8 `baselineArtifact` → baselined; AC9
`completeTask` → completed/for_review/claim released; AC10 `releaseTask` → posted;
AC11 sweep open-topic full recovery + closed-topic drop-only (matches amended
CLARIFY AC11); AC12 derived `artifact_id`; AC13 7 REST + 7 MCP, one envelope;
AC14 tsc 0 + 361/361; AC15 live smoke ALL_PASS (VERIFY + REVIEW-CODE re-smoke).
All verified against file:line — 15/15 covered, 0 partial, 0 missing.

## 4. BLOCK-resolution walk — all 8 BLOCKs verified resolved in the current code

- **d-r1-F1** — `claimTask` has no 23505 handler / retry loop; the task-row
  `SELECT … FOR UPDATE` is the serializer; a loser returns `conflict` with the
  real incumbent. RESOLVED.
- **d-r1-F2** — `releaseTask`'s claim SELECT carries `expires_at > now() FOR
  UPDATE`; an expired claim → `claim_expired` no-op. RESOLVED.
- **d-r1-F3** — the sweep is per-claim `BEGIN…COMMIT` in a `try`; the `catch`
  rolls back, logs, and continues (no rethrow); topic status read `FOR UPDATE`.
  RESOLVED.
- **d-r2-F1** — the sweep locks task→claim→artifact→topics (artifact before
  topics); no ABBA against `writeArtifact`/`completeTask`. RESOLVED.
- **d-r2-F2** — the closed-topic sweep branch drops the dangling claim only;
  matches CLARIFY AC11 as amended `[r2-fix — scoped open-vs-closed]`. RESOLVED.
- **d-r3-F1** — design §10 is a derived per-transaction lock table incl.
  `appendEvent`'s `topics` lock; verified against the code — every transaction is
  a prefix-consistent subsequence of `task→claim→artifact→topics`. RESOLVED.
- **d-r3-F2** — `completeTask`'s claim SELECT carries `FOR UPDATE`. RESOLVED.
- **c-r1-F1** — no `WITH prev` CTE survives anywhere in `src/`;
  `completeTask`/`writeArtifact`/`baselineArtifact` read the pre-image from a row
  locked via `SELECT … FOR UPDATE`; the guarded `UPDATE` stays one atomic
  statement; lock position unchanged. RESOLVED.

The 4 WARNs are resolved too: d-r2-F3 (`postTask` topic-existence check → 404),
d-r3-F3 (topics-permanence invariant named §0.3), c-r1-F2 (`depends_on` UUID
validation → clean 400), c-r1-F3 (sweep no-op `state_changed` skipped + consistent
`recovered`).

## 5. Deferred-item status — no OPEN item with a met trigger

- **DEFERRED-009** (topic/board ops lack project-scope enforcement) — OPEN,
  inherited; 15.2 ships the same `MCP_AUTH_ENABLED=false` dev posture, introduces
  no topic-level authorization. Trigger not met.
- **DEFERRED-010** (induction-pack pagination past the 1000-event cap) — OPEN,
  inherited; 15.2 topics stay well under the cap. Trigger not met.
- **New candidate — active topology-ordering enforcement** — out-of-scope at
  CLARIFY; a DEFERRED candidate to be logged at SESSION (a Scribe action, not a
  code gap; CLARIFY explicitly defers it).

## 6. Verdict — CLEAR

Spec fingerprint recomputes to `737d0febc8e1c455` = recorded = latest logged hash;
v1→v5 trail unbroken (spec_drift false). `tsc` exit 0; `npm test` 361/361 — fresh,
in-session. 15/15 ACs implemented and tested, verified independently at file:line.
All 8 BLOCKs (7 design + 1 code) + 4 WARNs verified resolved in the current code.
No OPEN deferred item has a met trigger.

One non-blocking housekeeping nit for SESSION: the three new service files' header
comment cited the v4 hash; the code implements rev 5.

**POST-REVIEW: CLEAR. Proceed to SESSION.**
