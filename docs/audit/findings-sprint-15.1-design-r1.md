---
agent: adversary
phase: review-design
sprint: phase-15-sprint-15.1-substrate
round: 1
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md
spec_hash: ad5ca49cf0b65033
status: REJECTED
findings:
  - severity: BLOCK
    finding: >-
      SSE handler (section 5.1) - the NOT_FOUND-after-headers path. The prose comment
      says "verify topic exists (replayEvents will throw NOT_FOUND -> 404 before headers
      sent)" but the code shown has NO pre-flight existence check. The first and only
      replayEvents call is inside tick(); tick() is first invoked at the bottom of the
      handler (line 324) AFTER res.flushHeaders() at line 309. A NOT_FOUND thrown by that
      first replayEvents is caught by setInterval's tick().catch(() => cleanup()); cleanup
      only sets closed=true and clearInterval - it never calls res.end(). A request for a
      non-existent topic gets a 200 text/event-stream that emits nothing and the socket
      hangs until the client times out; the intended 404 is never produced.
    impact: >-
      Wrong HTTP status (200 instead of 404) and a hung connection for every /stream
      request against a missing or mistyped topic id. Violates AC9 and contradicts the
      design's own stated contract in section 5.1.
    required_fix: >-
      Add an explicit await replayEvents({ topic_id }) (or SELECT 1 on topics) BEFORE
      res.setHeader/flushHeaders, inside the route's normal try/catch so a NOT_FOUND
      becomes a real 404 with JSON body; only flushHeaders() once existence is confirmed.
  - severity: BLOCK
    finding: >-
      SSE handler (section 5.1) - overlapping tick() invocations. setInterval(tick, 2000)
      fires tick() unconditionally every 2 s, but tick() is async and its body
      (await replayEvents(...)) can take longer than 2000 ms under DB load. The only guard
      is "if (closed) return" at the top - there is NO re-entrancy / in-flight guard. When
      a slow tick is still awaiting, the next interval fires a second concurrent tick; both
      read the same closure variable cursor, both call replayEvents with that identical
      cursor, both res.write the same event rows, and cursor is then reassigned by whichever
      tick finishes last (lost update). Section 10's claim "no event is skipped" addresses
      a single tick's pull-from-cursor property, not concurrent overlap.
    impact: >-
      Under load the SSE stream delivers DUPLICATE events to the client, and the shared
      cursor can move backward or skip depending on tick interleaving - so events can also
      be skipped. The live stream is non-deterministic exactly when the system is busy.
      Violates AC9.
    required_fix: >-
      Make tick() non-reentrant: replace the bare setInterval with a self-rescheduling
      setTimeout that fires only after the prior tick settles, or guard with an inFlight
      boolean so an overlapping firing returns immediately.
  - severity: WARN
    finding: >-
      joinTopic (section 4.2, line 242) builds the induction pack with
      inductionPack(topic_id, since_seq ?? 0) "read after commit". The pack's three
      components - topic record (getTopic SELECT), roster (topic_participants JOIN actors),
      and events/your_cursor (replayEvents) - are separate queries run AFTER COMMIT with no
      enclosing transaction and no snapshot isolation. A concurrent join, append, or
      closeTopic on the same topic can interleave between these reads, so the three
      components observe three different points in time: your_cursor can point past events
      not present in events, the roster can list an actor whose topic.actor_joined event is
      absent from events, or topic.status can read closed for an actor that just
      successfully joined an active topic.
    impact: >-
      The induction pack - whose entire purpose (Phase 15 design B.4: "the topic states
      everything") is to let an ephemeral agent re-prime coherently - can be internally
      inconsistent. An agent trusting your_cursor may start replay past events it never
      received. The join transaction itself is sound; only the returned pack lacks
      coherence (AC3).
    required_fix: >-
      Read the induction pack's three components inside ONE transaction (the join txn
      before COMMIT, or a fresh read-only transaction with a consistent snapshot) so topic,
      roster, events, and your_cursor are a single coherent snapshot.
---

## Reasoning

### Finding 1 - SSE NOT_FOUND lands after headers are flushed (BLOCK)

Section 5.1's pseudocode is internally contradictory. Its first line is the comment
"verify topic exists (replayEvents will throw NOT_FOUND -> 404 before headers sent)",
asserting a pre-flight existence check before any header is written. No such check exists
in the code that follows. The literal control flow is: (1) res.setHeader(...) /
res.flushHeaders() commit headers and the 200 status to the wire; (2) timer + cleanup are
defined, req.on('close', cleanup); (3) tick() is called for "immediate first delivery".
tick() is the only place replayEvents runs, and replayEvents step 1 throws
ContextHubError('NOT_FOUND', ...) for an unknown topic. That throw rejects the tick()
promise; the timer wraps every tick as tick().catch(() => cleanup()) and the immediate
first call routes the rejection to cleanup either way. cleanup only does closed=true;
clearInterval(timer) - the response is never res.end()-ed and no 404 body is sent, while
the HTTP status is already 200 and immutable. A /stream request for a non-existent topic
therefore returns 200 text/event-stream, emits zero event data, and hangs. This violates
AC9 and directly contradicts the spec's own stated behaviour - a design defect because
the handler lifecycle is exactly what section 5.1 specifies.

### Finding 2 - overlapping ticks duplicate (and can skip) SSE events (BLOCK)

setInterval(() => { tick().catch(() => cleanup()) }, 2000) schedules tick every 2 s with
no regard for whether the previous tick finished. tick() is async and its critical line
await replayEvents({ topic_id, since_seq: cursor }) is a pooled DB round-trip - under
contention (the scenario Phase 15 exists to handle, per CLARIFY "Why now") it can exceed
2000 ms. When it does, interval N+1 fires a second tick() while tick N is still suspended
at the await. Both capture the same closure variable cursor, issue replayEvents with the
same since_seq, and both run the res.write loop - the client receives each event twice.
Then each tick runs cursor = next_cursor; the landing order of the two assignments is
non-deterministic, so cursor can be set to a stale (lower) value causing re-delivery, or
skip a range written in between. Section 10's "no event is skipped" argument covers only
a single tick's pull-from-cursor property, never two concurrent ticks on one shared
cursor. The closed flag guards teardown, not re-entrancy. The live stream becomes
non-deterministic precisely under load - breaks AC9.

### Finding 3 - induction pack is assembled from non-atomic post-commit reads (WARN)

joinTopic correctly does its writes (actor upsert, participant insert, status flip,
appendEvent) inside one transaction and COMMITs. The defect is the final line:
return inductionPack(topic_id, since_seq ?? 0) "read after commit". The pack is
{ topic, roster, events, your_cursor }: topic from a getTopic SELECT, roster from the
topic_participants JOIN actors query, events/your_cursor from replayEvents - three
independent statements executed after the join txn commits, with no surrounding
transaction. Each sees whatever is committed when it runs. A concurrent
joinTopic/closeTopic/future appendEvent interleaving between them yields a pack whose
parts disagree: a roster including actor X while events (read a moment earlier) lacks X's
topic.actor_joined; or your_cursor from a replayEvents that ran after another append,
pointing past an event the caller's events array lacks; or topic.status = closed returned
to an actor that just legitimately joined an active topic. The induction pack's whole
rationale (Phase 15 design B.4 - an ephemeral agent re-primes because "the topic states
everything") depends on coherence. Rated WARN not BLOCK because the join commits correctly
and no persisted data is corrupted - the defect is confined to the returned pack's
internal consistency - but it is a genuine AC3 gap; fix by reading all three components
within a single consistent-snapshot transaction.
