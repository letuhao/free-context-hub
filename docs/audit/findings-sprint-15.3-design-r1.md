# Sprint 15.3 REVIEW-DESIGN — Adversary findings (round 1)

**Phase:** REVIEW-DESIGN · **Round:** 1 · **Agent:** cold-start Adversary (general-purpose, opus)
**Design reviewed:** `docs/specs/2026-05-17-phase-15-sprint-15.3-design.md` rev 1, spec hash `9c51e29447a2341b`
**Verdict:** REJECTED — 3 BLOCK findings.

> Persisted by the main session — the Adversary sub-agent returned these findings in its
> final message (the harness blocks sub-agent writes under `docs/audit/`).

Spec hash reviewed: 9c51e29447a2341b

## Finding 1 — BLOCK  A request submitter can endorse their own request
**Location:** §3.2 `decideStep` authorization block; §2.2 `deriveRoute`; D3/D5; CLARIFY AC6
**Problem:** `decideStep`'s authorization checks only that the actor is a topic participant whose `level == target_office`. It never checks `actor_id != requests.submitted_by`. Two routing paths put the submitter at a step's `target_office`: (a) `escalate_to_authority` always derives the single step `[required_level]` — an `authority`-level participant submitting a `weight>=50` `artifact_review` (the seeded default) gets a one-step route targeting `authority`, and they are themselves an `authority` participant; (b) the `counter_sign` empty-ladder fallback — a participant at level L submitting a request whose `required_level` equals L derives an empty ladder, which D3 collapses to `[required_level]` = `[L]`. In both cases the submitter satisfies `level == target_office` and can call `decideStep(endorse)` on their own request, self-approving it and advancing the subject artifact `for_review -> final` with zero independent review. This defeats the entire point of an approval primitive and is the highest-risk class of bug (authorization), the exact surface the prior 15.2 review monoculture missed.
**Suggested fix:** In `decideStep`, after the participant/level check, reject `actor_id == submitted_by` with a `not_authorized` (or a dedicated `self_decision_forbidden`) status; document the rule in §9 invariants and add it to AC6's test. Decide explicitly what happens when the only officeholder at a step *is* the submitter (e.g. force escalation, or reject submission at `submitRequest` time).

## Finding 2 — BLOCK  §3.3 `resolveArtifact`'s `artifact_versions` INSERT omits the NOT NULL `created_by`
**Location:** §3.3 `resolveArtifact(client, outcome, artifactId)`; migration `0054` `artifact_versions` DDL
**Problem:** `artifact_versions` declares `version`, `state`, `note`, and `created_by` all `NOT NULL` (migration 0054, lines 44–54). §3.3 says only "append an `artifact_versions` row (`note:'request <outcome>'`)" and gives `resolveArtifact` the signature `(client, outcome, artifactId)` — with **no actor parameter**. There is therefore no value available for the `NOT NULL created_by` column, so the INSERT as designed will raise a `23502 not-null violation` at runtime, surfacing as an unclassified 500 on every approve/return. The design also never states which `version` (presumably the `RETURNING version` of the guarded UPDATE), `state`, or `content_ref` the row carries — 15.2's `writeArtifact`/`baselineArtifact` specify every column precisely; §3.3 does not, inviting divergent implementations.
**Suggested fix:** Add an actor argument to `resolveArtifact` (thread the deciding actor from `decideStep`, or use a `'system:request'` literal as `revertArtifact` does with `'system:sweep'`), and fully specify the `artifact_versions` INSERT: `version` = the UPDATE's returned version, `state` = the new artifact state, `content_ref` = carried forward from the prior version, `fencing_token` = NULL, `note`, `created_by`.

## Finding 3 — BLOCK  `submitRequest`/`decideStep` lack a closed-topic pre-check, reintroducing the 15.2 MED-2 defect
**Location:** §3.1 `submitRequest`, §3.2 `decideStep`, §9 invariant 7, §5 status->HTTP table
**Problem:** §9 invariant 7 deliberately *relies on* `appendEvent`'s close-seal to reject writes on a `closed` topic. But `decideStep` calls `appendEvent` only *after* it has already issued `UPDATE request_steps`/`UPDATE requests`; when the topic is closed, `appendEvent` throws `ContextHubError('BAD_REQUEST', 'topic ... is closed')`, the catch rolls the transaction back (no corruption) — but the caller receives a **raw thrown `BAD_REQUEST` -> HTTP 400**, not a structured result status. Sprint 15.2 explicitly classified this exact behavior as a defect for `releaseTask`/`completeTask` and fixed it (rev 6 MED-2: a closed-topic plain-SELECT pre-check returning a clean `topic_closed` status); 15.3 reintroduces the bug. The §5 status->HTTP table confirms the omission: it has no `topic_closed` entry. `submitRequest` has the same hole.
**Suggested fix:** Add a closed-topic plain-`SELECT status` pre-check to both `submitRequest` and `decideStep` (the 15.2 MED-2 pattern — a non-locking read, so the lock order is unchanged), returning a clean `topic_closed` status; add `topic_closed -> 409` to the §5 table and the MCP failure-object set; add a test.

## Verdict: REJECTED

---

## Resolution — main session, design rev 2

All 3 BLOCK findings accepted and resolved in design **rev 2**. No pushback — the findings
are spread across three distinct surfaces (authorization / schema / cross-sprint contract
drift), no concurrency monoculture; the schema facts were independently re-verified against
migrations 0053/0054 and `coordinationEvents.ts`/`coordinationConstants.ts`.

- **Finding 1 -> resolved.** D5 amended: a submitter is never an officeholder for their own
  request. §3.2 `decideStep` now selects `submitted_by` and rejects `actor_id == submitted_by`
  with a dedicated `self_decision_forbidden` status (-> 403). New invariant 8. §11.7 documents
  the lone-officeholder consequence: when a step's level has only the submitter, the step is
  undecidable and the escalation sweep carries it forward to `escalation_exhausted` — chosen
  over a `submitRequest`-time rejection because topic participants are living (another
  officeholder may join after submission). The `escalate_to_authority` self-submit path
  resolves by escalation, not self-approval.
- **Finding 2 -> resolved.** §3.3 `resolveArtifact` gains an `actorId` parameter (the deciding
  actor, threaded from `decideStep` — real provenance, preferred over a system literal). The
  guarded UPDATE now `RETURNING version, content_ref`; the `artifact_versions` INSERT is
  fully column-specified (`fencing_token` NULL per the 15.2 baseline/revert convention,
  `content_ref` carried forward unchanged).
- **Finding 3 -> resolved.** `submitRequest` (pre-BEGIN) and `decideStep` (post request-load,
  a plain non-locking read) now read `topics.status` and return a clean `topic_closed`;
  §5 maps `topic_closed -> 409`; invariant 7 refined (pre-check = clean status for the common
  case; `appendEvent` seal = authoritative guard for the mid-transaction close race). Lock
  order unchanged (the pre-checks take no row lock — §10).

A 4th concern raised during verification was **cleared, not a defect**: migration 0056 needs
no `ALTER` — 15.1 pre-provisioned `coordination_events.subject_type='request'` (0053 CHECK),
the four `request.*` event types (`EVENT_TYPES` catalog), and the `for_review`/`final`/`working`
artifact states (0054 CHECK). Documented in §1 of rev 2.

Rev 2 goes to a round-2 cold-start Adversary for confirmation.
