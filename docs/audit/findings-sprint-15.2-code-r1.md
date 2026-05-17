---
agent: adversary
phase: review-code
sprint: phase-15-sprint-15.2-board
round: 1
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md
spec_hash: f1898f1af5ede266
status: REJECTED
findings:
  - severity: BLOCK
    location: src/services/board.ts completeTask (also src/services/artifacts.ts writeArtifact / baselineArtifact)
    finding: >-
      The `WITH prev AS (SELECT state FROM artifacts WHERE artifact_id=$1) UPDATE
      artifacts ... FROM prev` pattern does NOT reliably capture the artifact's
      pre-transition state under concurrency. `prev` is a separate, non-locking
      scan of `artifacts` evaluated against the statement READ COMMITTED snapshot;
      the UPDATE target row is re-fetched at the latest committed version via
      EvalPlanQual whenever the UPDATE had to block on a concurrently-held row
      lock. When a concurrent writeArtifact/baselineArtifact commits in the window
      between snapshot acquisition and lock grant, prev.state and the row the
      UPDATE actually transitions can disagree. The board.ts comment and design
      sec 2.5/3.1 claim the CTE "captures the pre-transition state" — that
      guarantee is not verifiable. It is also a BUILD-time deviation: design sec
      2.5 literal SQL for completeTask is a plain UPDATE with no CTE.
    impact: >-
      artifact.state_changed events can be emitted with a factually wrong "from"
      value (an artifact that went baselined->for_review logged as
      draft->for_review). In writeArtifact the stale prev_state also drives the
      conditional `if (prevState !== newState)` that gates emission of
      artifact.state_changed — a stale value can emit a spurious state-change
      event or suppress a real one. The coordination event log is the append-only
      spine actors replay to reconstruct artifact state; a wrong/missing
      transition silently corrupts that reconstructed history. The race is
      reachable — writeArtifact locks neither the claim nor the task row, so it
      runs concurrently with completeTask on the same artifact.
    required_fix: >-
      Capture the pre-transition state from the row the transaction actually
      locks. Add an explicit `SELECT state FROM artifacts WHERE artifact_id=$1 FOR
      UPDATE` as an earlier step in the same transaction (it becomes the
      artifact-row lock — canonical-order-correct, it precedes appendEvent's
      topics lock and, for writeArtifact/baselineArtifact, is the first lock),
      then run a plain guarded UPDATE on the already-locked row. Update the
      board.ts comment and design sec 2.5/3.1 to state the actual mechanism.
  - severity: WARN
    location: src/services/board.ts postTask
    finding: >-
      postTask validates topic_id, title, kind, created_by, topology and slot but
      never validates the elements of depends_on. The column is UUID[] (migration
      0054). A caller passing a non-UUID string in depends_on (the REST route
      forwards the array verbatim) causes INSERT INTO tasks to raise Postgres
      22P02 inside the transaction. That error is not a ContextHubError, so the
      sec 0.1 catch re-throws it and the global handler returns a 500.
    impact: >-
      A malformed depends_on UUID yields an unclassified HTTP 500 instead of a
      clean 400 — the same defect class design sec 2.1 [r2-fix F3] explicitly
      fixed for the missing-topic case (raw FK 23503 -> explicit 404). A caller
      cannot distinguish a server fault from its own bad input.
    required_fix: >-
      In postTask, before BEGIN, validate every element of depends_on against a
      UUID regex and throw ContextHubError('BAD_REQUEST', ...) on a malformed
      entry, mirroring the existing slot/topology validation.
  - severity: WARN
    location: src/services/coordinationSweep.ts open-topic branch / task-not-found branch
    finding: >-
      The open-topic recovery branch emits artifact.versioned AND
      artifact.state_changed after revertArtifact with no check that the revert
      produced an actual state change. A claimed-but-never-written artifact is
      still draft v1; revertArtifact reverts draft->draft, so the sweep emits a
      no-op artifact.state_changed {from:draft,to:draft}. Separately the
      task-not-found defensive branch drops the orphan claim and COMMITs but does
      NOT increment `recovered`, while the closed-topic branch does increment
      `recovered` for the analogous drop-claim-only outcome — an inconsistent
      diagnostic count.
    impact: >-
      The event log accumulates spurious {from:X,to:X} state-change events for
      every abandoned never-written claim, polluting replay/audit. The `recovered`
      count returned by sweepAbandonedClaims under-reports when orphan-task claims
      are present, making the sweep metric unreliable for monitoring.
    required_fix: >-
      Guard the sweep's artifact.state_changed emission with `if (from !== to)`
      (as writeArtifact already does), and pick one consistent rule for
      `recovered` — applying it to both the closed-topic and task-not-found
      branches.
---

# REVIEW-CODE round 1 — Phase 15 Sprint 15.2 (the Board)

Cold-start adversarial code review of the Sprint 15.2 implementation against design
rev 4 (spec_hash `f1898f1af5ede266`) and the 15 CLARIFY ACs. 1 BLOCK + 2 WARN.
Decision rule: any BLOCK → REJECTED.

Verdict: REJECTED — one BLOCK. The concurrency core the design iterated over four
revisions is genuinely sound (the canonical lock order `task → claim → artifact →
topics` holds in every transaction; `claimTask` has no 23505 retry loop and the
task-row `FOR UPDATE` is the real serializer; the guarded UPDATE fuses
writable-state + fencing + claim-liveness into one statement; the sweep is
per-claim crash-isolated and `closeTopic`-race-safe). The BLOCK is in a CTE that
the design assumes captures pre-transition state but cannot verifiably do so.

## Finding 1 (BLOCK) — the `WITH prev` CTE does not verifiably capture pre-transition state

`completeTask` runs `WITH prev AS (SELECT state FROM artifacts WHERE
artifact_id=$1) UPDATE artifacts SET state='for_review' FROM prev WHERE
artifacts.artifact_id=$1 AND artifacts.state IN (...) RETURNING prev.state AS
prev_state`. `prev_state` feeds `appendEvent(artifact.state_changed,
{from:prev_state,to:'for_review'})`. `writeArtifact`/`baselineArtifact` use the
identical shape; in `writeArtifact` `prev_state` also drives `if (prevState !==
newState)` — the conditional that gates the state-change event.

The pool runs default READ COMMITTED (`db/client.ts`, no isolation override).
`prev` is a separate scan of `artifacts` evaluated against the statement snapshot,
while the UPDATE target row is re-fetched via EvalPlanQual at its latest committed
version when the UPDATE had to block on a concurrent row lock. Whether `prev` is
re-evaluated in lock-step with the EPQ-refetched target row is plan-shape- and
version-dependent — i.e. not verifiable by a reviewer. For a sprint whose design
ethos is provable concurrency, an unverifiable pre-state read in load-bearing code
is a defect by the sprint's own standard (cf. design-r3: "a guarantee a reviewer
cannot verify is not a guarantee").

Reachable interleaving: `writeArtifact`/`baselineArtifact` lock only the artifact
row (the claims check is a plain `EXISTS`, no claim/task lock). (1) Artifact A
draft, live claim C. (2) TX-B `writeArtifact(A,C)` and TX-A `completeTask` start;
TX-A locks task, locks C `FOR UPDATE`, reaches its guarded UPDATE; TX-B takes A's
row lock first. (3) TX-A's `prev` scan reads A.state='draft'; TX-A's UPDATE blocks.
(4) TX-B commits — A is 'working'. (5) TX-A's UPDATE unblocks via EPQ — 'working'
is writable → sets 'for_review'. (6) `RETURNING prev.state` may still be 'draft'
→ the log records a false `{from:'draft',to:'for_review'}` transition.

Fix: read the pre-transition state from the row the transaction actually locks —
`SELECT state FROM artifacts WHERE artifact_id=$1 FOR UPDATE` as an explicit
earlier step (it becomes the artifact-row lock, canonical-order-correct), then a
plain guarded UPDATE on the locked row. Correct the comment and design sec 2.5/3.1.

## Finding 2 (WARN) — postTask does not validate `depends_on`; malformed UUIDs 500

`postTask` validates topic_id/title/kind/created_by/topology/slot but not the
elements of `depends_on` (UUID[]). The REST route forwards the array verbatim.
`depends_on:['not-a-uuid']` → `INSERT INTO tasks` raises Postgres `22P02` → not a
`ContextHubError` → the sec 0.1 catch re-throws → the global handler returns 500.
Same failure mode design sec 2.1 [r2-fix F3] fixed for the missing-topic case.
Fix: validate every `depends_on` element against a UUID regex before `BEGIN`,
throw `BAD_REQUEST`.

## Finding 3 (WARN) — sweep emits no-op state-change events; inconsistent `recovered`

The open-topic branch emits `artifact.versioned` + `artifact.state_changed`
unconditionally after `revertArtifact`. A claimed-but-never-written artifact is
still draft v1; `revertArtifact` reverts draft→draft, so the sweep emits a no-op
`{from:draft,to:draft}`. `writeArtifact` already guards its own state event with
`if (prevState !== newState)`; the sweep should too. Separately the task-not-found
branch drops the orphan claim without `recovered++` while the closed-topic branch
does `recovered++` for the analogous drop-claim-only outcome — inconsistent
metric. Pick one rule, apply to both branches.

## AC walk

AC1–AC5, AC8–AC15 implemented and tested (T1–T17 + extra cases). AC6/AC7 met — the
guarded UPDATE is one atomic statement; the ok-vs-conflict decision rests on
`rowCount`, the re-SELECT only attributes a reason. MCP `outputSchema`s are flat
`z.object` with `z.enum` status fields — no `z.discriminatedUnion`; business
failures return `{status}` objects, never thrown. The sec 0.1 transaction contract
is honored everywhere; the sweep uses the sec 0.1-loop variant correctly.
