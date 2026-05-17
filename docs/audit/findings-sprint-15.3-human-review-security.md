# Sprint 15.3 — human-in-loop review: cold-start security audit

**Context:** Phase 15 human-in-loop review of the autonomous Sprint 15.3 run (4 scopes, the
user's request). This file is the commissioned **fresh security-framed cold-start audit**
(scope 1) — the equivalent of the 15.2 review's `/review-impl` pass that caught a HIGH four
AMAW rounds had missed.
**Agent:** cold-start security reviewer (general-purpose, opus).
**Verdict:** 2 CRITICAL, 1 HIGH, 2 MED, 2 LOW.

> Persisted by the main session — the sub-agent returned the findings in its final message
> (the harness blocks sub-agent writes under `docs/audit/`).

## The structural root cause

15.3 is the first Phase-15 primitive to turn **caller-supplied identity strings**
(`submitted_by`, `actor_id` — body-supplied, never bound to the authenticated token) and
**self-declared participant levels** (`joinTopic` lets an actor declare its own
`authority`/`coordination`/`execution` level) into **authorization decisions**. The four
AMAW adversarial rounds verified the self-decision guard's *logic* (`actor_id !==
submitted_by`) and the officeholder check's *logic* (`level === target_office`); none
questioned whether the *inputs* to those guards are trustworthy. They are not.

## Findings (audit verbatim, severity-ordered)

### 1 — CRITICAL — the no-self-approval rule (inv. 8) is bypassed by picking two identity strings
`src/services/requests.ts:418`; root cause `routes/requests.ts:90-98,137-142` + `mcp/index.ts` request tools.
The guard is `actor_id === submitted_by`; both originate from the same caller and are never bound to the authenticated token. One `writer`-token caller submits with `submitted_by:"alice"`, decides with `actor_id:"bob"` → `"bob" !== "alice"` → guard passes. With a `counter_sign` route the caller registers one puppet `actor_id` per level and drives the request to `approved` single-handedly, advancing the subject artifact `for_review → final`. The §9/inv.8/§11.7 safety argument assumes the two strings denote distinct real principals; they denote distinct strings.
**Fix:** bind the acting identity to the authenticated principal (the Phase-13 `apiKeyName` pattern) — `submitted_by`/`actor_id` derived from or verified against the token, not the body.

### 2 — CRITICAL — officeholder authorization is self-grantable via `joinTopic`'s self-declared level
`src/services/requests.ts:409-426`; root cause `src/services/topics.ts` `joinTopic` (`level` is a caller param, inserted verbatim, no approval gate).
`decideStep` authorizes by `level === target_office`, but a caller becomes any level — including `authority` — just by passing it to `joinTopic`. Combined with Finding 1, one caller fabricates a complete, correctly-leveled multi-step chain and approves any reachable `for_review` artifact. Invariant 3 ("only a participant whose level equals `target_office`") provides zero real authorization — the level is attacker-controlled. 15.1 used `level` descriptively; 15.3 made it a security input without hardening the write path.
**Fix:** level assignment must be authoritative (set by a topic owner / `authority` participant, not self-declared at join), or `decideStep` must consult a trusted source of an actor's level.

### 3 — HIGH — no scope check ties a request, its topic, and its subject artifact together
`src/services/requests.ts:155-183` (`submitRequest`), `:357-367` (`decideStep`).
**(a, 15.3-specific bug)** `submitRequest` checks the artifact *exists* (`SELECT 1 FROM artifacts WHERE artifact_id=$1`) but never that it belongs to the request's topic. On approval `resolveArtifact` advances that artifact and emits `artifact.versioned`/`artifact.state_changed` on the **request's** topic log, not the artifact's. A request on topic A force-finalizes topic B's artifact and topic B's log shows nothing — AC11 ("reconstructable from the log") silently broken. 15.2's `writeArtifact` derives the topic *from the artifact* (`topicIdForArtifact`); 15.3's `resolveArtifact` is passed the request's topic — a real divergence.
**(b, DEFERRED-009 amplification)** A `writer` token for project A can address project B's `topic_id` — 15.3 widens DEFERRED-009 from read/close to *submit, decide, and finalize project B's artifacts*.
**Fix:** `submitRequest` must require `artifact.topic_id == request.topic_id`; `resolveArtifact` should derive the topic from the artifact.

### 4 — MED — GET routes carry no `requireRole`; cross-topic request/step enumeration
`routes/requests.ts:104,117` — `GET /api/topics/:id/requests` and `GET /api/requests/:id` have no `requireRole` (only the two POSTs do). Any caller can read every request, step, `decided_by` actor id, deadline, `doa_snapshot` for any topic globally — including the actor-id strings Findings 1-2 need.
**Fix:** add `requireRole('reader')` to both GET routes; fold the cross-topic scope into the Finding 3 fix.

### 5 — MED→LOW — `decideStep` `step_index` is not range-validated (but fails safe)
`src/services/requests.ts:377-380`. A negative/fractional `step_index` passes the REST/MCP parse, but the `current_step !== step_index` guard rejects it cleanly → `not_current_step`. **Traced — not a live hole.** Robustness only: add `Number.isInteger(stepIndex) && stepIndex >= 0` (mirrors the `weight` B4 bound).

### 6 — LOW — escalation sweep cannot be steered to `approved` — CLEARED
`src/services/coordinationSweep.ts:240-360`. Worst an attacker achieves by stalling a step is `escalation_exhausted` (a terminal non-approval). The `current_step` join + `FOR UPDATE` re-check prevent acting on a stale step. Accept & document — no new escalation vector.

### 7 — LOW — `kind`/`subject_id` are unbounded-length strings (log-bloat, not injection)
`src/services/requests.ts:121-126,236`. All SQL is parameterized (verified — no user-data string interpolation; the only `${}` in SQL is the numeric `STEP_DEADLINE_MINUTES` constant). Unbounded `TEXT` written verbatim into rows + the event payload JSONB → DoS-by-bloat. Add a length cap (~256), or accept-and-document consistent with 15.1/15.2.

## Verdict: 2 CRITICAL, 1 HIGH, 2 MED, 2 LOW

Findings 1, 2, 3 are three faces of one structural gap: a single `writer`-token caller can
forge a complete multi-level approval and finalize artifacts (incl. other topics'/projects').
Not the same as DEFERRED-009 — the human must see this before 15.3 is relied upon.

---

## Disposition

Final disposition is being decided in the human-in-loop review. See the AUDIT_LOG
`human-review` event and the follow-up `human-review` decision event.
