---
agent: adversary
phase: review-design
sprint: phase-15-sprint-15.1-substrate
round: 3
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md
spec_hash: 10f7c51159e7875f
r2_resolution: F1 resolved; F2 resolved; F3 partial - incoherence + lock-contention are both genuinely fixed, but the rev-3 two-txn rewrite of joinTopic introduces a new connection-pool-poisoning defect (finding 1)
status: REJECTED
findings:
  - severity: BLOCK
    finding: >-
      joinTopic (section 4.2, lines 230-259) - the rev-3 two-transaction rewrite has
      try: / finally: client.release() with NO catch clause and NO unconditional
      ROLLBACK. Only the anticipated throws are guarded: lines 235/236/241 each do an
      explicit "ROLLBACK; throw" by hand. Every unanticipated DB error throws with no
      preceding ROLLBACK and escapes straight to "finally: client.release()", returning
      a pooled client with an open (or aborted) transaction to the pool. Concrete
      triggers: a deadlock (40P01) or lock-timeout on "INSERT INTO topic_participants"
      vs a concurrent join; a 23505 unique-violation race on the actor or participant
      INSERT; a statement_timeout; a transient connection error on any statement of txn
      1; and - the path rev 3 newly created - ANY throw from fetchTopicWithRoster or
      replayEvents inside txn 2 (lines 254-257: BEGIN ISOLATION LEVEL REPEATABLE READ
      READ ONLY ... COMMIT has no ROLLBACK on the failure path either). The design
      explicitly claims to mirror the proven Phase 13 artifactLeases.ts pattern, but
      artifactLeases.ts _claimArtifactOnce (lines 210-216) does exactly the opposite:
      catch (err) runs an unconditional client.query('ROLLBACK').catch then re-throws,
      inside finally client.release(). node-postgres pool.release() does NOT roll back
      an open transaction; the client is returned dirty.
    impact: >-
      Connection-pool poisoning. The next caller to acquire that pooled client inherits
      a half-open or aborted transaction: its first statement either runs inside the
      leaked transaction or fails with "current transaction is aborted, commands
      ignored until end of transaction block", and a leaked txn-2 leaves the connection
      stuck "SET TRANSACTION ISOLATION LEVEL must be called before any query". Under
      concurrent-join load (T8 re-join, AC8 concurrency test, the AC4 path) a single
      deadlock or unique-race silently corrupts an unrelated subsequent request. This
      is a fix-interaction bug: the rev-3 split to two transactions doubles the number
      of statements that can throw without a guarding ROLLBACK and adds a second BEGIN
      whose failure path is unhandled. It defeats AC3/AC4/AC8 reliability and
      contradicts the design's own stated Phase-13 mirroring.
    required_fix: >-
      Wrap joinTopic's body in an explicit catch (err) that runs an unconditional
      client.query('ROLLBACK').catch then re-throws, placed before the finally
      client.release(), exactly as artifactLeases.ts _claimArtifactOnce does - a
      single unconditional ROLLBACK covers an abort of whichever transaction (txn 1 or
      txn 2) is currently open; state in section 9 that the catch is the real guard.
  - severity: WARN
    finding: >-
      joinTopic txn-2 failure handling is asserted as benign but the recovery
      guarantee is not unconditionally true. Section 4.2 lines 265-267 and section 10
      line 549 claim "if txn 2 fails after txn 1 committed, joinTopic throws but the
      join is durably recorded; the caller's retry hits the idempotent re-join path and
      receives the pack." The first half is true. The second is not: a retry reads the
      pack again in txn 2, and if txn 2 fails for a non-transient reason (a persistently
      unreachable replica, a statement_timeout the pack read consistently exceeds, an
      event row that consistently fails to deserialize) every retry does a wasted no-op
      join (txn 1) and re-fails in txn 2 - the caller never gets a pack. The design
      presents retry as reliable recovery; for a persistent txn-2 fault it is an
      unbounded busy-loop with no terminal, pack-less error distinguishable from a
      transient one.
    impact: >-
      A caller is told (section 10) it can rely on retry to obtain the induction pack;
      for a persistent txn-2 failure that is a busy-loop with no pack. AC3 ("returns an
      induction pack") becomes conditionally unmet on the txn-2-fails branch the design
      itself introduced. Not corruption, hence WARN, but the spec documents a recovery
      guarantee it does not keep.
    required_fix: >-
      Either collapse the pack read into the join region under FOR SHARE (removing the
      separate txn-2 failure mode entirely while still resolving F3 - concurrent joins
      no longer block, appends still serialize via appendEvent's UPDATE), or keep two
      transactions but reword section 4.2/section 10 to state plainly that a persistent
      txn-2 failure surfaces as a thrown error with the join durably recorded - the
      pack is then obtained via a separate getTopic + replayEvents, not via an infinite
      joinTopic retry.
  - severity: WARN
    finding: >-
      Deviation D2 (poll-based SSE) leaves the SSE stream with no liveness floor: the
      section-5.1 handler can hold a half-dead connection open indefinitely for an OPEN
      topic. POLL_MS is 2000; on a quiet open topic the only client writes are the
      per-tick ": ping" comment (line 404). There is no timeout that ends a stream
      after N idle ticks. Rev 3 correctly catches a disconnect DURING the pre-flight
      await, but after headers flush the only disconnect detectors are req.on('close')
      firing and res.write throwing - and round 2's own finding-1 reasoning (which rev
      3 does not contradict) established "res.write to a peer-reset socket returns
      false without a synchronous throw." A human-GUI client - D2's single named
      consumer - that suspends a laptop or drops off a NAT may never trigger 'close'
      promptly; tick keeps polling the DB every 2 s forever, writing ": ping" into a
      black hole. The handler is leak-free against an OBSERVED close but not against a
      SILENT half-open socket; D2's justification ("~2 s latency is irrelevant to the
      human GUI") addresses latency, not the half-open-socket cost of a poll loop with
      no self-termination.
    impact: >-
      A slow accumulation of zombie poll loops + pooled DB round-trips for every GUI
      client that vanishes without a clean FIN (sleep/suspend is routine for the human
      GUI). Lower-rate than r2-F1's pre-flight leak but the same resource-drain class,
      and invariant 10 ("SSE leak-free lifecycle") overstates the guarantee: leak-free
      for an observed disconnect, not for a half-open socket. Tolerable at 15.1 scale,
      hence WARN, but a real gap the design does not name.
    required_fix: >-
      Add a bounded idle/total lifetime to the SSE handler: track consecutive
      zero-event ticks and call cleanup() after a cap (e.g. close the stream after
      ~5 min of no events, letting the GUI reconnect), and/or use res.write's return
      value plus a max-stream-age timer - and state the chosen bound and the
      half-open-socket trade-off explicitly in section 5.1 / invariant 10.
---

## Round-2 resolution

**r2-F1 (SSE disconnect-during-pre-flight leak) - RESOLVED.** Rev 3 moves the `cleanup`
definition (section 5.1 lines 369-374) and `req.on('close', cleanup)` registration (line
375) to *before* the pre-flight `await replayEvents` (line 380), and adds an explicit
post-await re-check `if (closed || req.destroyed) { cleanup(); return }` (line 383). A
client that disconnects during the pre-flight now either has its `'close'` captured by the
already-registered listener (`closed` set) or is detected via `req.destroyed`; the handler
bails before `flushHeaders()` and before arming the timer. The lost-`'close'`-event window
round 2 identified is genuinely closed. The r2 BLOCK is resolved. (Finding 3 of this round
is a *different*, narrower gap - a silent half-open socket on an already-streaming
connection - not a regression of r2-F1.)

**r2-F2 (induction-pack invariant overstated for the `since_seq>0` re-prime path) -
RESOLVED.** Section 4.2 lines 275-278 and invariant 9.8 are reworded to scope the guarantee
correctly: "every roster actor whose `topic.actor_joined` has `seq > since_seq` appears in
`events`" - explicitly noting that for `since_seq>0` earlier join events are intentionally
outside `events`. Test T8 is extended with a `since_seq>0` re-prime variant that asserts
the corrected, scoped invariant. The false unconditional claim is gone and the primary use
case is now tested. The r2 WARN is resolved.

**r2-F3 (in-txn pack read amplifies topics-row lock-hold time) - PARTIALLY RESOLVED.** The
*stated defect* - a full induction-pack read (a 3-table JOIN + an event scan to the
1000-row cap) held inside the `SELECT ... FOR UPDATE` critical section, serializing all
topic writers behind every join's pack read - is genuinely eliminated: rev 3 splits
`joinTopic` into txn 1 (the join writes, releasing the topics-row lock at `COMMIT`) and txn
2 (a `REPEATABLE READ READ ONLY` snapshot that builds the pack holding no write lock). The
pack is still one coherent snapshot (a read-only `REPEATABLE READ` transaction cannot hit a
40001 serialization failure - reads never conflict - so the coherence claim holds), and
contention is back to the r1 level. **But the fix is not clean.** It is resolved at the
cost of two new findings introduced by the rev-3 rewrite itself: (1) the two-transaction
body has no unconditional `catch`/`ROLLBACK`, so an unanticipated error in either
transaction returns a poisoned client to the pool (finding 1, BLOCK); (2) the txn-2-failure
recovery story the design now tells (section 10) is not unconditionally true (finding 2,
WARN). F3 the contention regression is resolved; F3's fix spawned a BLOCK and a WARN - the
same pattern round 2 observed when r1-F3's fix spawned r2-F2 and r2-F3.

## Reasoning

### Finding 1 - two-txn joinTopic returns a poisoned client to the pool (BLOCK)

This is a textbook fix-interaction bug. The rev-3 fix for r2-F3 split `joinTopic` into two
transactions on one pooled client (section 4.2 lines 230-259). The pseudocode structure is
`client = pool.connect()` / `try:` / ... / `finally: client.release()` - and that is the
whole error-handling envelope. There is **no `catch`**. The only rollbacks are the four
hand-written ones at lines 235, 236, 241, 297 - each immediately before a *deliberate*
`throw` on an *anticipated* condition (topic missing, topic closed, actor-type conflict).
Every error the design did not anticipate has no guarding `ROLLBACK`: a deadlock (40P01)
between two concurrent `INSERT INTO topic_participants` for the same topic, a 23505 on the
actor or participant insert under a join race, a `statement_timeout`, a transient socket
error mid-statement - and, the surface rev 3 *newly created*, any throw out of
`fetchTopicWithRoster` or `replayEvents` inside txn 2 (lines 254-257). Each such throw
escapes the `try:` and lands in `finally: client.release()`. node-postgres `release()`
does not roll back an open transaction - it returns the client to the pool as-is. The next
acquirer inherits a dirty connection: if txn 1 was mid-flight, the next caller's first
statement runs *inside* that transaction or fails "current transaction is aborted"; if txn
2's `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` was leaked, the connection is wedged
"SET TRANSACTION ISOLATION LEVEL must be called before any query." The design explicitly
claims (CLARIFY Approach A: "mirrors the proven Phase 13 `artifactLeases.ts` pattern";
section 8: harness "mirrored from `artifactLeases.test.ts`") to follow Phase 13 - but
`artifactLeases.ts` `_claimArtifactOnce` (file 7, lines 210-216) does the exact opposite:
its `catch (err)` runs an unconditional `client.query('ROLLBACK').catch(()=>{})` and then
re-throws, all inside `finally { client.release(); }`, and `renewArtifact` (lines 295-301)
repeats it. The shipped Phase 13 service *always* rolls back before releasing. joinTopic,
the design that claims to mirror it, drops the catch. Under T8's re-join concurrency,
AC8's explicit concurrent-append/join test, or any real multi-actor load, one deadlock or
unique-race poisons an unrelated later request. BLOCK - it corrupts requests beyond the
failing one and contradicts the design's own stated mirroring of Phase 13. The fix is one
`catch` block with an unconditional `ROLLBACK.catch(()=>{})`, copied verbatim from
`artifactLeases.ts`.

### Finding 2 - the txn-2-failure recovery guarantee is not unconditionally true (WARN)

Rev 3, having split `joinTopic` into two transactions, has to answer "what if txn 2 fails
after txn 1 committed?" Its answer (section 4.2 lines 265-267, restated section 10 line
549): "joinTopic throws - but the join is durably recorded; the caller's retry hits the
idempotent re-join path and receives the pack." The first half is true. The second half is
not unconditionally true. The re-join path (lines 244-251) is idempotent by being guarded
on `if rowCount > 0` from the participant `ON CONFLICT DO NOTHING RETURNING`. On a retry,
the participant row already exists, `rowCount` is 0, the `if` block is skipped - fine for
the participant and the event (correct, no duplicates). But the design's claim is about
*receiving the pack*: a retry reads the pack again in txn 2. If txn 2 fails for a
*non-transient* reason - a replica that stays unreachable, a `statement_timeout` that the
pack read consistently exceeds, an event row that consistently fails to deserialize - then
every retry does a wasted no-op join (txn 1) and re-fails in txn 2, and the caller never
gets a pack. The design presents retry as a reliable recovery; for a persistent txn-2
fault it is an unbounded busy-loop with no terminal, pack-less error distinguishable from a
transient one. "The join is never lost" is true; "a retry receives the pack" is what the
design says and it is conditional. WARN, not BLOCK: no data is corrupted and the common
(transient) case does recover. Fix: collapse the pack read back into the join region under
`FOR SHARE` - which removes the separate txn-2 failure mode entirely while still resolving
F3 (concurrent joins no longer block each other; appends still serialize on appendEvent's
`UPDATE`) - or, if two transactions are kept, reword section 4.2/section 10 to say plainly
that a persistent txn-2 failure surfaces as a thrown error and the pack is then obtained
via a separate `getTopic` + `replayEvents`, not via retrying `joinTopic`.

### Finding 3 - poll-based SSE has no liveness floor against a silent half-open socket (WARN)

Deviation D2 ships SSE as a 2-second poll loop rather than `LISTEN/NOTIFY`. The rev-3 SSE
handler (section 5.1) is now correctly leak-free against an *observed* disconnect: r2-F1's
pre-flight window is closed (cleanup wired before the await), and `req.on('close')` ends
the stream when the socket reports closed. What rev 3 still does not address - and
invariant 10 ("SSE leak-free lifecycle") overstates by omission - is a *silent* half-open
socket. The only post-flush termination signals are (a) `req.on('close')` firing and (b) a
`res.write` throwing synchronously. Round 2's own finding-1 reasoning established the fact
rev 3 does not contradict: "`res.write` to a peer-reset socket returns false without a
synchronous throw." A human-GUI client - D2's single named consumer - that suspends a
laptop or drops off a NAT does not always send a clean FIN; `'close'` may not fire for a
long time or at all. For an *open* topic the loop never self-terminates: `drainIfClosed`
fires only on a `topic.closed` event, `replayEvents` on an existing open topic does not
throw, and the per-tick `: ping` comment writes into the dead socket without throwing. The
result is a zombie `setTimeout` chain plus a pooled DB round-trip every 2 s, per
silently-vanished GUI client - the same resource-drain class as r2-F1, at a lower rate.
D2's rationale defends *latency* ("~2 s latency is irrelevant to the human GUI"); it does
not defend the absence of a self-termination bound on a poll loop. WARN: tolerable at 15.1
scale and not corruption, but a genuine gap the design neither names nor bounds. Fix: give
the handler a bounded idle/total lifetime - end the stream (let the GUI reconnect) after a
cap of consecutive zero-event ticks or a max stream age - and state the bound and the
half-open-socket trade-off in section 5.1 and invariant 10.