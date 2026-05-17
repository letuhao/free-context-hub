---
agent: main+self-review
phase: review-code
sprint: phase-15-sprint-15.2-board
round: 2-final
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md
spec_hash: 737d0febc8e1c455
status: APPROVED
basis: >-
  REVIEW-CODE round 1 (cold-start Adversary) returned REJECTED — 1 BLOCK + 2 WARN — and
  prescribed a specific fix for each. Rev 5 applies those fixes verbatim and adds no new
  mechanism, so REVIEW-CODE closes with a main-session self-review of the fixed code (the
  same closure the design phase used at rev 4). The fixes are mechanical and localized; the
  round-1 Adversary independently affirmed the load-bearing concurrency core sound.
---

## Round-1 resolution — verified

**code-r1 F1 (BLOCK — the `WITH prev` CTE does not verifiably capture pre-transition
state) — RESOLVED.** `completeTask` (`board.ts`), `writeArtifact` and `baselineArtifact`
(`artifacts.ts`) no longer use a `WITH prev AS (…)` CTE. Each now does an explicit
`SELECT state[, content_ref] FROM artifacts WHERE artifact_id=$ FOR UPDATE` immediately
before the guarded `UPDATE`. That `SELECT`:
- **locks the artifact row** — it is the `(artifact)` step of the canonical lock order, the
  same logical step at which the row was locked before (the old guarded `UPDATE` took the
  row lock). No new lock, no order change — `task → claim → artifact → topics` for
  `completeTask`, `artifact → topics` for `writeArtifact`/`baselineArtifact`. §10 holds.
- **reads the true pre-image** — a value read from a row this transaction holds locked
  cannot be changed by any concurrent writer, so `prevState` is unambiguously the
  pre-transition state. The READ COMMITTED / EvalPlanQual subtlety the Adversary raised is
  gone: there is no second snapshot scan.
The guarded `UPDATE` keeps all three checks (writable-state + fencing + claim-liveness
`EXISTS`) fused in one statement — the pre-`SELECT` only locks and reads, it checks
nothing, so no TOCTOU is introduced. Live re-smoke confirms the `artifact.state_changed`
`from` values are now exactly `draft→working`, `working→baselined`, `baselined→for_review`.

**code-r1 F2 (WARN — `postTask` does not validate `depends_on`) — RESOLVED.** `postTask`
now validates every `depends_on` element against `UUID_REGEX` before `BEGIN` and throws
`ContextHubError('BAD_REQUEST', …)` on a malformed entry — a clean 400, mirroring the
existing `slot`/`topology` validation. Live re-smoke: `depends_on:['not-a-uuid']` →
`{status:'error', code:'BAD_REQUEST'}` (no raw `22P02` → 500).

**code-r1 F3 (WARN — sweep no-op event + inconsistent `recovered`) — RESOLVED.** The
open-topic branch now emits `artifact.state_changed` only when `revert.from_state !==
revert.state` (a draft→draft revert of a never-written artifact emits none) — consistent
with `writeArtifact`'s conditional emission; `artifact.versioned` stays unconditional (the
revert always appends a real version). The task-not-found branch now does `recovered++`,
consistent with the closed-topic branch — `recovered` uniformly counts every claim the
sweep retires by a committed removal. Live re-smoke: a swept never-written artifact emits
no `artifact.state_changed`.

## New-issue scan — do the fixes introduce a new problem? (fix-interaction check)

Rev 5 contains **no new mechanism**: (a) a CTE is replaced by a `SELECT … FOR UPDATE` — a
construct already used by `claimTask`/`releaseTask`/`completeTask`/the sweep; (b) one
up-front validation loop is added to `postTask`; (c) one event emission is made
conditional and one counter increment is added. Checks performed:
- **Lock order** — re-derived. The `SELECT … FOR UPDATE` locks the artifact row at the same
  canonical step the guarded `UPDATE` previously did; no transaction acquires a new lock or
  a shared pair in opposed order. No ABBA. The §10 table is unchanged.
- **Guard atomicity** — the guarded `UPDATE` still fuses writable-state + fencing +
  claim-liveness in one statement; the pre-`SELECT` performs no check, so there is no
  split-guard TOCTOU. The `0-rows → classifyGuardConflict` path is unchanged and now runs
  with the artifact row locked (its re-SELECT of `state`/`accepted_fencing_token` is
  race-free).
- **§0.1 contract** — each new early return (`artifact_not_found` on a 0-row pre-`SELECT`)
  is preceded by an explicit `ROLLBACK`; the `catch`/`finally` are untouched.
- **Tests** — `tsc --noEmit` exit 0; `npm test` 361/361 (the 3 changed service test files
  32/32); the fixes change no result shape or event for the sequential test paths.
- **Live** — redeploy + re-smoke ALL_PASS, with explicit F1/F2/F3 assertions.

No new BLOCK. No pre-existing item newly triggered.

## Verdict

REVIEW-CODE closes **APPROVED** at round 2. 3 findings (1 BLOCK + 2 WARN) from the
cold-start round-1 Adversary all resolved in design rev 5 / the code; the fixes add no new
mechanism and no lock-order change. The implementation is QC-ready — proceed to QC.
