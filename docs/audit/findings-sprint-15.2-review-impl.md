---
agent: review-impl
phase: review-impl
sprint: phase-15-sprint-15.2-board
scope: 15.1+15.2
status: "1 HIGH (claim hijack via replayed claim_id+token, no actor check on writeArtifact), 5 MED, 7 LOW, 3 COSMETIC — concurrency model sound; gaps are in input-trust, error-mapping, and route-level test coverage"
note: "Cold-start /review-impl pass commissioned at the 2026-05-17 Phase 15 longrun human-in-loop review (review item §3, option a)."
---

# Sprint 15.1 + 15.2 — cold-start review-impl findings

Mental mode: *what does the test coverage miss; what can break that nothing guards
against.* The lock-order / guarded-UPDATE / sweep concurrency model is sound and not
re-litigated here. `tsc --noEmit` is clean. The findings below are about input fields
that reach Postgres or a capability check unguarded, error-mapping drift at the
REST/MCP↔service boundary, and untested paths.

Verdict: **1 HIGH · 5 MED · 7 LOW · 3 COSMETIC**.

---

## HIGH

### 1. [HIGH] `writeArtifact`/`baselineArtifact` never check claim ownership — any topic participant can hijack a live claim using the `claim_id`+`fencing_token` published in the event log

`src/services/artifacts.ts` (write) and (baseline).

The guarded `UPDATE` verifies only that the presented `claim_id` is *live on that
artifact* and `fencing_token >= accepted_fencing_token`:

```sql
AND EXISTS (SELECT 1 FROM claims c
             WHERE c.claim_id = $2 AND c.artifact_id = $1 AND c.expires_at > now())
```

It does **not** compare `claims.actor_id` to the caller's `params.actor_id`. The
`actor_id` argument is used only for `artifact_versions.created_by` and the event
`actor_id` — it is never a guard. `releaseTask`/`completeTask` *do* enforce ownership
(→ `not_owner`), so the surface is internally inconsistent: release/complete are
owner-gated, write/baseline are not.

This is exploitable, not theoretical, because the capability is broadcast.
`claimTask` emits `claim.granted` with `payload:{ task_id, claim_id, fencing_token }`.
`replayEvents` returns `payload` verbatim with no redaction, and `joinTopic`'s
induction pack carries the full event list. So **every actor who joins or replays the
topic learns every live claim's `claim_id` and `fencing_token`** — and can then call
`writeArtifact` with that pair (equal token satisfies `>= accepted`) and overwrite
another actor's in-flight artifact, advance its version, and emit `artifact.versioned`
under their own `actor_id`. The fencing token was designed to stop a *superseded*
holder, not a peer who copied a still-current token out of the log.

No test covers a write by a non-holder of a live claim (T8–T12 all write as the
claiming actor `worker-1`).

Suggested fix: add `AND c.actor_id = $actorId` to the `EXISTS` subquery in both
guarded `UPDATE`s (and to `classifyGuardConflict`'s claim re-SELECT, with a
`claim_not_owned` reason). Given design C.2 frames fencing as the stale-holder defense
and `releaseTask` already gates on ownership, the actor check is almost certainly the
intended behavior and its omission is a BUILD defect. (Full enforcement against a
*malicious* caller also needs actor-identity binding — DEFERRED-009 — but the
consistency fix is necessary and correct on its own.)

---

## MED

### 2. [MED] `releaseTask` / `completeTask` on a closed topic throw a raw 400 instead of returning a clean status

`closeTopic` is atomic and does not touch claims, so a topic can be `closed` with a
live claim still on a task. If a holder then calls `releaseTask`/`completeTask`, the
function locks the task, deletes the claim, updates `tasks.status`, and only then calls
`appendEvent`; the seal (`WHERE status <> 'closed'`) matches 0 rows and throws
`ContextHubError('BAD_REQUEST')`; the `catch` rolls the whole transaction back. The
caller gets HTTP 400 about the *topic* — not the `{status}` discriminant the result
type promises. The MCP tool surfaces it as a thrown `McpError`, breaking the
"business failures return a `{status}` object" contract. The sweep handles a closed
topic explicitly; voluntary release/complete has no such branch and no test. Fix: add
an explicit `topic.status='closed'` check returning a defined status (e.g.
`topic_closed`), or document the 400 as by-design.

### 3. [MED] No board-route test file exists — `statusToHttp` and every REST error branch are untested

There is no `src/api/routes/board.test.ts`. Design §8's plan lists only service tests
(T1–T17). `statusToHttp` — the mapping of every service `status` to an HTTP code — is
exercised by nothing. A regression mapping `conflict` to 200, or the router-local
error middleware ceasing to catch `ContextHubError`, would pass CI. The 15.1 topics
router *does* have a route test. Fix: add `board.test.ts` mirroring `topics.test.ts`,
asserting the HTTP code for one success, one `conflict`, one `not_owner`, one
`not_found`, one `BAD_REQUEST`.

### 4. [MED] `claim.granted` / `task.claimed` event payloads leak the fencing capability into the permanently-replayable log

`claim.granted` payload is `{ task_id, claim_id, fencing_token }`; `task.claimed` is
`{ claim_id, actor_id }`. Embedding a live mutable capability in an append-only,
fully-replayable log that `replay_topic_events` hands to every participant (and a
future export would carry off-instance) is a questionable contract — independent of
finding 1. Fix: emit `claim.granted` with `payload:{ task_id, actor_id }` (observers
still see who holds it); the `claim_id`/`fencing_token` are already returned in the
synchronous `ClaimResult` to the caller who needs them. Keep capability material out
of the durable log.

### 5. [MED] `replayEvents` / `GET /topics/:id/events` silently caps at 1000 events with no signal to the caller

`DEFAULT_REPLAY_LIMIT = 1000`; `next_cursor` is the last *returned* event's seq. For a
topic with >1000 events the call silently returns a truncated page with no way to know
more remain (no `has_more`). A client treating `next_cursor` as "caught up" stops
1000 events early; the induction pack has the same cap. DEFERRED-010 covers the full
pagination API, but the *silent* truncation is a correctness trap now. Fix: add
`has_more: boolean` to `ReplayResult`, set when `events.length === limit`.

### 6. [MED] `writeArtifact` accepts an empty / missing `content_ref` and silently versions the artifact with `content_ref=''`

`content_ref` is unvalidated; the REST route coerces a missing field to `''`. A
`PUT /artifacts/:id` with `content_ref` omitted does not 400 — it writes a new version
with `content_ref=''`, bumps `version`, emits `artifact.versioned`. `postTask`
carefully validates `title`/`kind`/`slot`; `writeArtifact` skips the one field that
*is* the payload. Fix: reject an empty `content_ref` with `BAD_REQUEST`.

---

## LOW

### 7. [LOW] `listBoard` returns `200 {tasks:[]}` for a nonexistent topic — inconsistent with `GET /topics/:id` (404)

`listBoard` does no topic-existence check; `getTopic`/`replayEvents` throw `NOT_FOUND`.
A client cannot distinguish "no tasks" from "no topic." Fix: add the `SELECT 1 FROM
topics` check `postTask` already does, or document the divergence.

### 8. [LOW] `slot` has no maximum length — the derived `artifact_id` (a TEXT PK and URL path segment) is unbounded

`SLOT_REGEX` matches any length. Design Q1 states "max ≈ 110 chars" but nothing
enforces it. A 5000-char slot yields a ~5072-char `artifact_id` PK/URL. Fix: add a
`slot.length <= 64` bound.

### 9. [LOW] `depends_on` UUIDs are format-validated but never checked for existence or same-topic membership

`postTask` validates each entry against `UUID_REGEX` but no FK / SELECT confirms the
referenced tasks exist or share the topic. Topology enforcement is deferred
(DEFERRED-011), so a dangling edge is acceptable now — but 15.3+ enforcement inherits
unvalidated edges. Fix: accept & document; add a same-topic existence check when
topology enforcement lands.

### 10. [LOW] REST `since_seq` / `raci` accept shapes the MCP schema rejects — boundary drift

`since_seq` passes any number incl. negatives (MCP: `min(0)`); `raci` accepts a JSON
array via `typeof x === 'object'` (MCP: `z.record` rejects arrays). Minor 1:1
violations of AC13. Fix: clamp `since_seq >= 0`, reject non-plain-object `raci`.

### 11. [LOW] No test proves the fencing sequence is *strictly* monotonic under concurrency

`board.test.ts` T3 checks two *sequential* claims; T5 (concurrent) never inspects
tokens. Nothing proves interleaved claims get strictly-ordered distinct tokens. Fix:
add a concurrent-claim test asserting N distinct tokens.

### 12. [LOW] `appendEvent` rejects a closed *or missing* topic with one indistinguishable error

`rowCount === 0` → `'topic … is closed or does not exist'`. `claimTask`/`releaseTask`/
`completeTask` rely on the task-row FK to guarantee the topic exists; a weakened FK
would surface a missing topic as "closed." Fix: accept & document, or split
`TOPIC_CLOSED` vs `TOPIC_MISSING`.

### 13. [LOW] No coverage for MCP `tools/call` failure shapes on the 15.2 tools

No test asserts the `McpError` code for `post_task` throws, nor the `structuredContent`
shape of a `conflict` result against the flat `z.object` `outputSchema`. DEFERRED-007
is followed in source but no test guards a regression. Fix: accept (live VERIFY smoke
covers it) or add a thin MCP-handler test.

---

## COSMETIC

### 14. [COSMETIC] `board.test.ts` T5 contains dead code

`const winnerActor = claimed[0].status === 'claimed' ? null : null; void winnerActor;`
— both branches `null`, immediately discarded. Remove it.

### 15. [COSMETIC] T16 would assert "no revert" more directly via an `artifact_versions` count

T16 checks artifact `state`/`version` unchanged; asserting `COUNT(*) FROM
artifact_versions` unchanged would more directly prove the sweep appended nothing.

### 16. [COSMETIC] `revertArtifact`'s artifact-missing throw is unreachable-by-construction but undocumented as such

The only caller (the sweep) has already locked the artifact row; a one-line
"unreachable — caller holds the row lock" comment would match the codebase convention.

---

## Checks run that came up clean (not padded into findings)

- 15.1 input fields — `charterTopic`/`joinTopic`/`closeTopic` trim + reject-empty;
  `joinTopic` validates `actor_type`/`level` against their sets before INSERT.
- `appendEvent` validates `type`/`subject_type` against their sets before INSERT.
- `postTask` validates `topology` against the `TOPOLOGIES` set.
- Idempotent re-join — both the `chartered→active` flip and the `topic.actor_joined`
  event gate on `rowCount > 0`; tested.
- Seq monotonic / gap-free — concurrent-append test asserts seqs are exactly `[1..N]`.
- `claims_active_uniq` race — T5 confirms exactly one `claimed` under 6-way `Promise.all`.
- Sweep never un-baselines — T14/T15 prove revert-to-draft / revert-to-last-baseline,
  `accepted_fencing_token` unchanged; T17 proves crash isolation.
- Closed-topic sweep branch — T16 proves claim dropped, no revert, no event.
- SSE cleanup — disconnect runs cleanup once; unknown topic 404s.
- `tsc --noEmit` clean.
