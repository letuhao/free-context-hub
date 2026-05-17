# Sprint 15.3 REVIEW-DESIGN — Adversary findings (round 2)

**Phase:** REVIEW-DESIGN · **Round:** 2 · **Agent:** cold-start Adversary (general-purpose, opus)
**Design reviewed:** `docs/specs/2026-05-17-phase-15-sprint-15.3-design.md` rev 2, spec hash `ad97914a52f3bb51`
**Verdict:** REJECTED — 1 new BLOCK + 1 WARN; all 3 round-1 findings verified RESOLVED.

> Persisted by the main session — the Adversary sub-agent returned these findings in its
> final message (the harness blocks sub-agent writes under `docs/audit/`).

Spec hash reviewed: ad97914a52f3bb51

## Round-1 finding verification

- **Finding 1 (self-approval): RESOLVED** — §3.2 `decideStep` now selects `submitted_by` in the request `FOR UPDATE` load and rejects `actor = submitted_by` with `self_decision_forbidden` *before* the `level == target_office` check (correct ordering: a non-participant still gets `not_participant`). D5 amended, invariant 8 added, §11.7 documents the lone-officeholder consequence (escalation carries it to `escalation_exhausted`, never self-approval), §5 maps `self_decision_forbidden -> 403`.

- **Finding 2 (artifact_versions INSERT): RESOLVED** — §3.3 `resolveArtifact` gains `actorId`; the guarded UPDATE now `RETURNING version, content_ref`; the INSERT lists all 7 columns of `artifact_versions` explicitly (`created_by=$actorId`, `fencing_token=NULL`, `content_ref` carried forward), matching 15.2's `writeArtifact`/`baselineArtifact`. Both call sites in §3.2 (endorse-final, return) pass `$actor` — no stale call site.

- **Finding 3 (closed-topic pre-check): RESOLVED** — `submitRequest` pre-`BEGIN` reads `topics.status` and returns `topic_closed`; `decideStep` plain-reads `topics.status` after the request `FOR UPDATE` and returns `topic_closed`. §5 maps `topic_closed -> 409`, §6 covers it in the MCP failure-object set, §10 explicitly notes the pre-checks are non-locking and do not perturb the lock table. Invariant 7 refined (pre-check = clean status for the common case; `appendEvent` seal = mid-txn race guard).

## New findings

## Finding 1 — BLOCK  `weight` is not bounded to the INT domain — an out-of-range value reaches the INSERT as an unhandled `22003` -> 500

**Location:** §3.1 `submitRequest` validation block; §1 `requests.weight INT NOT NULL`; §2.1 `resolveMatrixRow` SQL; §5 / §6 (REST + MCP input surface)

**Problem:** §3.1 validates `weight` is "a finite integer >= 0" — it bounds the *lower* end but never the *upper* end. `requests.weight` is an `INT` column (§1), and `resolveMatrixRow`'s `weight_min <= $weight AND weight_max >= $weight` compares against `INT` columns. A caller passing `weight = 5000000000` (5 billion — a finite integer >= 0, so it passes §3.1) hits either `resolveMatrixRow`'s comparison or `INSERT INTO requests (... weight ...)`, where PostgreSQL raises `22003 numeric_value_out_of_range`. Neither §5 (JSON body) nor §6 (`z.object`, which accepts any `z.number()`) constrains the range upstream. The result is an unclassified DB error surfacing as a 500. This is the input-trust / bound-checking defect class explicitly flagged in this round's mandate, it breaks CLARIFY assumption A5 ("`submitRequest` fails CLEAR ... never a 500"), and it is inconsistent with the precedent the 15.2 codebase already set — `board.ts` `[LOW-8]` bounds `slot` length for exactly this reason, and `clampTtl`/`clampGrace` bound their numerics.

**Suggested fix:** In §3.1, tighten the `weight` validation to `Number.isInteger(weight) && weight >= 0 && weight <= 2147483647` (the INT domain — and the `doa_matrix.weight_max` default ceiling), throwing `ContextHubError('BAD_REQUEST', ...)` on violation; add a boundary test (`weight = 2147483648` -> clean 400) to `requests.test.ts`.

## Finding 2 — WARN  Escalation can collapse the `counter_sign` multi-party guarantee onto a single endorser

**Location:** §4.1 / D9 (escalation re-targets `target_office` in place); §11.2; invariant 3

**Problem:** A `counter_sign` route such as `[coordination, authority]` exists to require *two distinct* endorsements — one at `coordination`, one at `authority`. When the `coordination` step stalls and the sweep escalates it (D9), its `target_office` climbs to `authority`. Now both step 0 and step 1 target `authority`, and `decideStep` authorizes by `level == target_office` alone (plus `actor != submitted_by`). Nothing prevents the *same* authority officeholder from endorsing step 0 and then step 1 — so the route's two endorsement events can both originate from one actor, collapsing the multi-party counter-sign into a single-endorser approval. §11.2 names and accepts the redundant-endorsement aspect ("a faithful record ... step-collapse/de-duplication is deferred"), but does not call out that the *distinct-endorser* property is lost, not merely the step count.

This is a WARN, not a BLOCK: it occurs only on the post-deadline escalation path (already an abnormal route), it is fully recorded in the event log, the design surfaced the redundancy deliberately, and 15.5's dispute conversion is the stated downstream remediation. It should be recorded explicitly so the guarantee weakening is not lost between sprints.

**Suggested fix:** Extend §11.2 / invariant 3 to state explicitly that escalation may route multiple steps of a `counter_sign` route to the same level and that, until step-collapse/de-dup lands, a single officeholder may satisfy more than one such step — and that restoring the distinct-endorser guarantee is deferred to 15.4/15.5. No 15.3 code change required; this is a documentation-completeness fix so POST-REVIEW and 15.5 inherit an accurate invariant.

## Verdict: REJECTED

Finding 1 is a BLOCK: an out-of-range `weight` reaches the DB as an unhandled `22003`, producing a 500 — the exact input-trust gap the round-2 mandate called for, and a regression against CLARIFY assumption A5 and the 15.2 bound-checking precedent. The three round-1 findings are all fully and correctly resolved (verified against the real §s — D5/§3.2/inv. 8 for B1, §3.3 + both §3.2 call sites for B2, §3.1/§3.2/§5/§10 for B3), and no fix-induced regression was found (self-decision rule preserves liveness via §11.7's escalation path; `resolveArtifact` signature change has no stale call site; closed-topic pre-checks are non-locking and leave §10 intact). All 14 CLARIFY ACs were walked and are addressed. Finding 2 is a non-fatal WARN. Rev 3 should resolve Finding 1, after which the design is otherwise sound.

---

## Resolution — main session, design rev 3

Round 2's verdict is accepted in full — including its verification that rev 2 cleanly
resolved all 3 round-1 BLOCKs with no regression and that all 14 CLARIFY ACs are addressed.

- **Finding 1 (BLOCK, `weight` unbounded) -> resolved.** §3.1 now validates `weight` as an
  integer in `[0, 2147483647]` (the `INT` domain of `requests.weight` and the
  `doa_matrix.weight_max` ceiling); an out-of-range value throws
  `ContextHubError('BAD_REQUEST', 'weight out of range')` — never an unhandled `22003`/500,
  honoring CLARIFY assumption A5. A boundary test is added to the §8 plan
  (`requests.test.ts` T1–T12). This is exactly the input-trust gap the main session
  deliberately left for a fresh cold-start pass rather than fold into rev 2 — the process
  caught it as intended.
- **Finding 2 (WARN, counter-sign collapse) -> resolved.** §11.2 is rewritten to state
  explicitly that escalation can route two steps to the same level and that a *single*
  officeholder may then satisfy both — the distinct-endorser property is lost, not just the
  step count. Invariant 3 carries the caveat. The deferred capability (distinct-endorser
  enforcement / same-level step-collapse) is now logged as **DEFERRED-013** (trigger: Sprint
  15.4/15.5) — closing the prior gap where the design's §11.2 claimed a deferral with no
  DEFERRED.md backing.

Rev 3 (spec hash recorded in the AUDIT_LOG round-2 review event's successor) goes to a
round-3 cold-start Adversary for confirmation (the 3-round REVIEW-DESIGN cap).
