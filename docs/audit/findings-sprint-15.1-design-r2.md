---
agent: adversary
phase: review-design
sprint: phase-15-sprint-15.1-substrate
round: 2
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md
spec_hash: 5ba19ef7c5700997
r1_resolution: F1 resolved; F2 resolved; F3 resolved (incoherence eliminated, pack reads are now transactional) but the fix introduces a new lock-contention defect (finding 3) and the design overstates the resulting invariant (finding 2)
status: REJECTED
findings:
  - severity: BLOCK
    finding: >-
      SSE handler (section 5.1) - the rev-2 fix introduces a client-disconnect leak.
      The pre-flight await replayEvents(...) (line 347) runs BEFORE cleanup is defined
      (lines 355-360) and BEFORE req.on('close', cleanup) is registered (line 361).
      Node's 'close' event fires exactly once. If the client disconnects WHILE the
      pre-flight replayEvents is awaiting, that 'close' event fires with no listener
      and is lost forever. The await still resolves (the pool query is independent of
      the socket), flushHeaders() runs against a dead socket, then req.on('close') is
      registered for an event that already fired and will not fire again, and the
      setTimeout loop is armed. For an OPEN topic nothing terminates that loop:
      drainIfClosed only fires on a topic.closed event; replayEvents on an existing
      open topic does not throw so tick().catch(cleanup) never fires; res.write to a
      peer-reset socket returns false without a synchronous throw; and
      res.writableEnded stays false until the server itself calls res.end(), so the
      guard "if (closed || res.writableEnded) return" never trips.
    impact: >-
      A leaked setTimeout chain plus an indefinite stream of pooled DB queries for
      every client that disconnects during the pre-flight window - exactly the
      connection/timer leak that risk R2/R7 and invariant 10 claim is closed. Under
      any real client churn this exhausts timers and pool connections. Violates AC9
      ("cleans up its connection on client disconnect").
    required_fix: >-
      Define cleanup and register req.on('close', cleanup) BEFORE the pre-flight
      await replayEvents(...); and after that await returns, bail immediately if
      req.destroyed (or res.writableEnded) - do not flush headers or arm the timer
      for an already-closed request.
  - severity: WARN
    finding: >-
      Induction-pack coherence invariant is overstated. Section 4.2 (line 262) and
      invariant 9.8 both assert unconditionally that "every roster actor's
      topic.actor_joined event is present in events". joinTopic builds the pack with
      replayEvents({ topic_id, since_seq: since_seq ?? 0 }, client) - a cursor-bounded
      slice (seq > since_seq, capped at limit 1000) - while roster comes from
      fetchTopicWithRoster, a FULL participant snapshot. When a caller passes
      since_seq > 0 - the documented re-priming flow (CLARIFY Q4: "a re-priming
      ephemeral agent passes its last cursor") - every roster actor whose
      topic.actor_joined has seq <= since_seq is absent from events, so the stated
      invariant is false. Test T7 only ever joins with since_seq = 0, so the re-prime
      path is never exercised and the false invariant is never caught.
    impact: >-
      The spec documents a coherence guarantee the implementation does not provide; a
      reader (or T7-style test author) who trusts "roster subset of events actors"
      will be wrong for every re-priming join. The pack is still transactionally
      consistent - no data corruption - but the AC3 "coherent induction pack" contract
      is mis-described and untested for its primary use case.
    required_fix: >-
      Reword invariant 9.8 / section 4.2 to scope the guarantee correctly ("every
      roster actor with joined_seq > since_seq appears in events"), and add a T7
      variant that joins with since_seq > 0 and asserts the corrected invariant.
  - severity: WARN
    finding: >-
      The rev-2 F3 fix amplifies topics-row lock-hold time. joinTopic holds the
      topics-row lock from its SELECT ... FOR UPDATE (line 226) through COMMIT, and
      rev 2 now runs BOTH fetchTopicWithRoster (a 3-table JOIN) and replayEvents (an
      event-log scan, limit 1000, default since_seq = 0 so a full replay) INSIDE that
      window (lines 248-249). Because every concurrent appendEvent, joinTopic, and
      closeTopic for that topic blocks on the same lock, a single join now serializes
      all topic writers behind a complete induction-pack read. Section 10 (line 517)
      dismisses this as "a few ms" for 15.1 topic sizes, but the cost scales with
      event-log length up to the 1000-row cap - the design's own numbers, not a few
      ms.
    impact: >-
      Write throughput on a busy topic degrades: appends and joins queue behind each
      other's pack reads. Not corruption and tolerable at 15.1 scale, but it is a real
      contention regression versus r1 (which read the pack post-COMMIT, holding no
      lock) and the design under-states it.
    required_fix: >-
      Either keep the pack read inside the txn but downgrade the join lock to
      SELECT ... FOR SHARE (writers still serialize via appendEvent's UPDATE;
      concurrent joins no longer block each other), or read the pack in a separate
      REPEATABLE READ read-only transaction after COMMIT - and state the chosen
      trade-off explicitly in section 10.
---

## Round-1 resolution

**F1 (SSE NOT_FOUND lands after headers) - RESOLVED.** Section 5.1 adds an explicit
pre-flight await replayEvents({ topic_id, since_seq }) (line 347) that runs before any
res.setHeader / res.flushHeaders() (lines 349-350). A NOT_FOUND thrown by that call
propagates to the outer catch (e) { next(e) } (line 383), then the global errorHandler,
producing a real 404 JSON body with headers unsent. The live-smoke step at line 466
(curl -w on a non-existent topic expects HTTP 404) is the right evidence. The r1 BLOCK is
closed.

**F2 (overlapping SSE ticks) - RESOLVED.** Section 5.1 replaces setInterval with a
self-scheduling setTimeout: tick re-arms timer only on its own final line (380), after it
has fully settled, and the initial arm is a single setTimeout (382). At most one tick is
ever live, so the shared cursor has exactly one writer at a time - the overlapping-tick /
lost-update race is structurally eliminated. The r1 BLOCK is closed.

**F3 (induction-pack incoherence) - RESOLVED, but with new consequences.** The r1 defect -
the pack assembled from three independent post-COMMIT reads - is genuinely fixed: rev 2
reads topic+roster via one fetchTopicWithRoster JOIN and events+your_cursor via
replayEvents(..., client) inside the join transaction while the topics-row lock is held
(section 4.2 lines 247-249, section 4.5). The reads are now one transactional snapshot -
topic, roster, events, your_cursor agree. The fetchTopicWithRoster SQL is correct:
GROUP BY t.topic_id is valid because topic_id is the PK (PostgreSQL functional-dependency
rule lets every other t.* column be selected un-aggregated), and the
json_agg(...) FILTER (WHERE tp.actor_id IS NOT NULL) correctly suppresses the single NULL
row a LEFT JOIN yields for a participant-less topic. No deadlock: the pack reads are plain
SELECTs taking no additional row locks. However, the fix is not free - see finding 3 (it
amplifies lock-hold time, a contention regression) and finding 2 (the design then
overstates the coherence invariant for the since_seq > 0 re-prime path). F3 the
incoherence is resolved; F3 the fix spawned two new findings.

## Reasoning

### Finding 1 - SSE disconnect-during-pre-flight leaks the poll loop (BLOCK)

This is a textbook fix-interaction bug. Round 1's F1 fix was "move the existence check to a
pre-flight await before flushHeaders()." Correct in spirit, but the rev-2 code places that
await (line 347) upstream of where the lifecycle teardown is wired: cleanup is defined at
lines 355-360 and req.on('close', cleanup) is registered at line 361 - both after the
pre-flight await. Node emits a socket/request 'close' event exactly once. A client that
disconnects during the pre-flight replayEvents await (a pooled round-trip - not
instantaneous, and slowest exactly under the DB load Phase 15 exists to handle) fires
'close' into the void: no listener yet. The await resolves regardless (the query does not
observe the socket), flushHeaders() writes to a destroyed socket, req.on('close')
registers a listener for an event that has already fired and will not fire again, and the
setTimeout self-scheduling loop is armed. For an open topic nothing terminates that loop:
drainIfClosed only fires on a topic.closed event; a tick throw would route to cleanup but
replayEvents on an existing open topic does not throw and res.write to a peer-reset socket
returns false without a synchronous throw; and res.writableEnded is false until the server
itself calls res.end(), so the guard "if (closed || res.writableEnded) return" never
trips. The result is an unbounded setTimeout chain and an unbounded series of pooled DB
queries per leaked client - the precise R2/R7 leak the design claims (invariant 10,
section 5.1 line 386) to have closed. AC9 explicitly requires connection cleanup on client
disconnect. BLOCK. The fix is a two-line reordering: define cleanup and register
req.on('close', cleanup) before the pre-flight await, and re-check req.destroyed
immediately after it before flushing headers or arming the timer.

### Finding 2 - the pack coherence invariant is false for the re-prime path (WARN)

Rev 2's F3 fix made the four pack components a single transactional snapshot - a real
improvement. But section 4.2 (line 262) and invariant 9.8 then claim more than the
snapshot delivers: "every roster actor's topic.actor_joined event is present in events."
That holds only when events is the full log. joinTopic builds events from
replayEvents({ topic_id, since_seq: since_seq ?? 0 }, client) - bounded by seq > since_seq.
roster (from fetchTopicWithRoster) is always the full participant set. The moment a caller
passes since_seq > 0 - and CLARIFY Q4 says the re-priming ephemeral agent does exactly
that - every actor whose topic.actor_joined seq is at or below the cursor is in roster but
not in events, and the invariant is false. Test T7 (section 8) asserts this invariant but
only ever joins a freshly chartered topic, so since_seq is 0 and the re-prime path is never
tested. The pack is still internally consistent (no corruption) and a re-priming agent
that supplied the cursor already holds the earlier events - so the practical harm is
limited - but the spec states a guarantee it does not keep, for its single most important
use case, and the test plan does not catch it. WARN: reword the invariant to scope it
(joined_seq > since_seq) and add a since_seq > 0 T7 variant.

### Finding 3 - the F3 fix amplifies topics-row lock-hold time (WARN)

joinTopic takes the topics-row lock at SELECT ... FOR UPDATE (line 226) and holds it to
COMMIT. Rev 2 inserts two reads into that critical section: fetchTopicWithRoster (a
three-table JOIN) and replayEvents (an event-log scan, limit 1000, and the pack passes
since_seq = 0 so it is a full replay up to the cap). Invariant 2/3/8 establish that
appendEvent, joinTopic, and closeTopic for a topic all funnel through that same lock -
which is what makes the snapshot coherent, but also means a single join now blocks every
other writer to the topic for the entire duration of a full induction-pack read. Round 1's
design read the pack after COMMIT, holding no lock at all (incoherent - that was F3 - but
non-blocking). So the rev-2 fix trades incoherence for contention. Section 10 (line 517)
waves this away as "a few ms" for 15.1 topic sizes, but the cost is the design's own
1000-row cap times a JOIN, not a constant. It is tolerable at 15.1 scale and not
corruption, hence WARN, but the design under-states a genuine throughput regression. Fix:
downgrade the join's lock to FOR SHARE (appends still serialize on appendEvent's UPDATE;
concurrent joins stop blocking each other) or move the pack read to a post-COMMIT
REPEATABLE READ read-only transaction - and state the trade-off in section 10.
