# Sprint 15.3 REVIEW-DESIGN — Adversary findings (round 3)

**Phase:** REVIEW-DESIGN · **Round:** 3 (final — 3-round cap) · **Agent:** cold-start Adversary (general-purpose, opus)
**Design reviewed:** `docs/specs/2026-05-17-phase-15-sprint-15.3-design.md` rev 3, spec hash `6f79057f9e42e4fc`
**Verdict:** ACCEPTED — 0 new findings; both round-2 findings verified RESOLVED.

> Persisted by the main session — the Adversary sub-agent returned these findings in its
> final message (the harness blocks sub-agent writes under `docs/audit/`).

Spec hash reviewed: 6f79057f9e42e4fc

## Round-2 finding verification

- **Round-2 BLOCK (weight unbounded): RESOLVED** — §3.1 now validates `weight` as "an integer in `[0, 2147483647]`" and throws `ContextHubError('BAD_REQUEST', 'weight out of range')` for an out-of-range value, "never an unhandled `22003`/500 (CLARIFY A5)". The bound `2147483647` is exactly `INT4` max, matching both `requests.weight INT` (§1) and `doa_matrix.weight_max INT` / its default ceiling. The check is a pre-`BEGIN` validation, and §8 T1–T12 adds the boundary test. Fix is correct and complete — both ends bounded, integer-checked (a float or `NaN` from a non-numeric body also fails CLEAR), thrown before any DB write.

- **Round-2 WARN (counter-sign collapse): RESOLVED** — §11.2 now explicitly states the loss is of "the **distinct-endorser** property that is the whole point of a `counter_sign` route," not merely the step count. Invariant 3 carries the caveat and cites `§11.2, DEFERRED-013`. DEFERRED-013 exists in `docs/deferred/DEFERRED.md` — well-formed, `Status: OPEN`, trigger Sprint 15.4/15.5, sourced to r2 finding W1; the file's `Next ID: 014` header is consistent. The prior gap (a §11.2 deferral claim with no DEFERRED.md backing) is closed.

## New findings

None.

Evidence — the concrete checks the round-3 Adversary ran on rev 3:

- **Fix-induced regression check.** The `weight` bound is a pure pre-`BEGIN` validation addition — no lock, no schema, no contract change; §10's lock table untouched. The §11.2 / invariant-3 edits are prose-only. No regression.
- **Migration numbering.** Highest existing is `0055_task_abandoned_status.sql`; `0056_request_approval.sql` is the correct next number.
- **Cross-sprint catalog contract.** All four `request.*` event types are in `EVENT_TYPES` (`coordinationConstants.ts`) and `subject_type:'request'` is in `SUBJECT_TYPES` + the 0053 `coordination_events` CHECK. `artifacts.state` permits `for_review`/`final`/`working`. 0056 introduces no new event type, subject type, or artifact state — §1's "no ALTER" claim holds.
- **`artifact_versions` INSERT (r1 B2 chain).** §3.3 lists all 7 columns explicitly; `version`/`state`/`note`/`created_by` are NOT NULL in 0054 and all supplied; matches `writeArtifact`/`baselineArtifact`/`revertArtifact`. Both §3.2 call sites pass `$actor`.
- **Self-approval (r1 B1 chain).** §3.2 selects `submitted_by` under the request `FOR UPDATE` and rejects `actor = submitted_by` before the level check; inv. 8 + §11.7 hold; §5 maps `self_decision_forbidden → 403`.
- **Closed-topic contract (r1 B3 chain).** `submitRequest` (pre-`BEGIN`) and `decideStep` (post request-load) plain-read `topics.status` → `topic_closed`/409; matches the 15.2 `releaseTask`/`completeTask` MED-2 pattern.
- **Escalation convergence.** `up(target_office)` runs only when `target_office < authority` → yields `coordination`/`authority`, both pass the CHECK; a step climbs ≤2 ticks then terminates. The sweep scan's `r.current_step = s.step_index` + `r.status='open'` predicate ensures only the active step of a live request is eligible — a resolved request's trailing `pending` steps are inert (never swept; `decideStep` rejects them via `status ≠ 'open'`).
- **Sweep ↔ `decideStep` race.** Both acquire `request` `FOR UPDATE` first; the loser re-reads `status ≠ 'open'` and bails. No double artifact advance.
- **Lock order.** §10's table is a prefix-consistent subsequence of `task → claim → request → request_step → artifact → topics`; 15.2's transactions lock only within `{task, claim, artifact, topics}`, disjoint from `{request, request_step}`, sharing at most `artifact`+`topics`, both acquiring `artifact` before `topics` — no ABBA.
- **14 ACs.** Round 2 walked all 14; rev 3 changes nothing AC-relevant except tightening the AC3/A5 `weight` input path and the AC11 reconstructability narrative — both improve coverage.

## Verdict: ACCEPTED

Rev 3 cleanly resolves both round-2 findings — the `weight` BLOCK with a correct, test-backed `[0, 2147483647]` bound thrown before any DB write, and the counter-sign WARN with an honest §11.2 / invariant-3 rewrite plus a properly-logged DEFERRED-013. No fix-induced regression. The independent pass over the matrix resolution, the escalation sweep, the lifecycle/event-log edges, and the cross-sprint catalog/lock contracts surfaced no new BLOCK and no genuine new WARN. REVIEW-DESIGN is closed at the round-3 cap.

---

## Closure — main session

REVIEW-DESIGN complete. Design final at **rev 3, spec hash `6f79057f9e42e4fc`**. Three
cold-start Adversary rounds (r1 REJECTED 3 BLOCK → rev 2; r2 REJECTED 1 BLOCK + 1 WARN,
3/3 r1 fixes + 14/14 ACs verified → rev 3; r3 ACCEPTED, 0 new). The findings spanned
authorization, schema/migration, cross-sprint contract drift, and input-trust — no
concurrency monoculture (the calibration-note risk). One deferred item logged: DEFERRED-013.
Proceeding to PLAN.
