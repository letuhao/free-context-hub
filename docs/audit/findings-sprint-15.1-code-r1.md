---
agent: adversary
phase: review-code
sprint: phase-15-sprint-15.1-substrate
round: 1
status: APPROVED_WITH_WARNINGS
findings:
  - severity: WARN
    finding: >-
      replayEvents caps results at DEFAULT_REPLAY_LIMIT=1000
      (coordinationEvents.ts:17,138 -- LIMIT $3) and sets next_cursor to the
      last RETURNED row seq (coordinationEvents.ts:153). joinTopic builds the
      induction pack via this same call (topics.ts:263). For a topic that has
      accrued >1000 events, a newly-joining actor receives a pack whose events
      array is the OLDEST 1000 events and therefore omits its own freshly
      emitted topic.actor_joined (seq >1000), while your_cursor reports the
      1000th seq, far behind the actor real join seq. This silently violates
      the coherence contract.
    spec_ref: >-
      Design section 9 invariant 8 (every roster actor whose topic.actor_joined
      has seq > since_seq appears in events; for since_seq=0 every roster actor
      join event is present, stated unconditionally) and section 4.2
      InductionPack coherence guarantee; T7. Section 3.2 pre-flags
      pagination-beyond-the-cap as a future concern but never qualifies the 9.8
      coherence invariant.
    required_fix: >-
      Make joinTopic pack read honor coherence at the cap: either pass the
      since_seq window so the pack always includes the joiner own
      topic.actor_joined event, or page the in-pack replay to the high-water
      mark; at minimum add a 15.1 test fixture exceeding the cap so the
      violation is visible rather than silent.
  - severity: WARN
    finding: >-
      No project_id enforcement on any topic read or mutation. joinTopic
      (topics.ts:209), closeTopic (topics.ts:314), getTopic (topics.ts:288) and
      replayEvents (coordinationEvents.ts:116) operate purely by the global
      topic_id PK; the REST routes (routes/topics.ts) carry no :projectId
      segment and never compare the caller project against topics.project_id. A
      writer-role bearer token issued for project A can POST
      /api/topics/<project-B-topic-id>/close and PERMANENTLY seal another
      project coordination topic (close is irreversible), or join/read it, by id
      alone.
    spec_ref: >-
      Design section 4.4 sanctions "any writer caller" for close but does not
      sanction cross-project access; CLARIFY R8/invariant 5 cover only
      unauthenticated ACTOR identity, not cross-tenant TOPIC access. The
      cross-tenant destructive-seal path has no spec coverage.
    required_fix: >-
      Scope every topic operation to the caller resolved project: load
      topics.project_id and reject (NOT_FOUND, to avoid id-probing) when it does
      not match the caller project context, at minimum for the destructive
      closeTopic path.
  - severity: WARN
    finding: >-
      AC9 (SSE pushes newly-appended events to a connected client and cleans up
      its connection on client disconnect) has zero automated test. The entire
      SSE handler in routes/topics.ts:111-178, the self-scheduling tick loop,
      the req.on(close) cleanup, the MAX_STREAM_MS half-open-socket bound, and
      drainIfClosed, is exercised only by a manual curl live-smoke. Neither
      coordinationEvents.test.ts nor topics.test.ts touches /stream. CLARIFY R2
      mitigation explicitly promised "Test covers disconnect cleanup"; design
      section 8 silently dropped that to live-smoke only.
    spec_ref: >-
      CLARIFY AC9 and CLARIFY Risk R2 (SSE handler registers a close-event
      cleanup ... Test covers disconnect cleanup); design section 8 test plan,
      which omits any SSE unit test.
    required_fix: >-
      Add an automated test for the SSE lifecycle: assert a connected client
      receives a later-appended event, and that a client disconnect clears the
      poll timer and ends the response (cleanup invoked exactly once), closing
      the gap between R2 stated mitigation and the shipped suite.
---

# REVIEW-CODE round 1 - Phase 15 Sprint 15.1 (Coordination Substrate)

Cold-start adversarial review of the BUILD output against design rev 4
(docs/specs/2026-05-16-phase-15-sprint-15.1-design.md) and the 13 acceptance
criteria (...-clarify.md). Three findings, all WARN, no BLOCK. Decision rule:
all-WARN means status APPROVED_WITH_WARNINGS.

The implementation is, on the load-bearing invariants, sound: the seq-allocation
UPDATE (coordinationEvents.ts:72-77) genuinely fuses seq allocation, the
per-topic append serializer (row lock), and the seal into one atomic step --
invariants 2 and 3 hold, and T4 Promise.all concurrency test proves gap-free
1..N. The two-transaction joinTopic (topics.ts:206-282) wraps both transactions
in the single mandated try/catch/finally with one unconditional best-effort
ROLLBACK -- invariant 11 holds and matches artifactLeases.ts verbatim. The
idempotent-join ON CONFLICT DO NOTHING RETURNING ties the event emission to the
same outcome as the participant insert -- invariant 4 holds, and T8/T9 confirm
no duplicate row, no duplicate event, and conflicting-type rejection. The SSE
pre-flight runs replayEvents before any header write and the close listener is
wired before the first await, so a missing topic yields a real 404 and a
mid-pre-flight disconnect bails cleanly.

The three findings are coherence/isolation/coverage gaps, not crashes.

## Finding 1 (WARN) - induction pack truncates past the replay cap, breaking invariant 8

joinTopic reads its induction pack inside txn 2 by calling replayEvents with the
txn-2 client (topics.ts:263). replayEvents applies a LIMIT with the value
defaulting to DEFAULT_REPLAY_LIMIT = 1000 (coordinationEvents.ts:17, 114, 138)
and computes next_cursor as the seq of the last row it actually returned
(coordinationEvents.ts:153). The query is "seq > cursor ORDER BY seq ASC LIMIT
1000", so for a topic with more than 1000 events past the cursor it returns the
oldest 1000. A new actor topic.actor_joined is the newest event (highest seq);
on a topic that has already exceeded 1000 events, that event sits beyond the
LIMIT window. The joining actor therefore gets a pack whose events does not
contain its own join event and whose your_cursor is the 1000th seq, far behind
its true join seq. Design section 9 invariant 8 states, with no event-count
qualifier, that for since_seq=0 every roster actor join event is present and
that your_cursor is consistent with events. Design section 3.2 acknowledges
pagination past the cap as a future concern, but never weakens the 9.8 coherence
guarantee, and the induction pack is precisely where that guarantee matters,
because an ephemeral agent re-primes purely from the pack. 15.1 topics are
expected to be small, so this is latent rather than immediate (hence WARN, not
BLOCK), but it is a real silent divergence and T7 coherence assertion passes
only because the test topic has 2 events.

## Finding 2 (WARN) - no cross-project isolation; any writer can permanently seal another project topic

topic_id is a global PK and the REST surface is deliberately top-level (no
:projectId segment), that is a design choice. But the consequence is that none
of getTopic, joinTopic, closeTopic, or replayEvents ever loads
topics.project_id and compares it to the caller resolved project. bearerAuth
plus requireRole(writer) only establish that the caller is a writer, not for
which project. So a writer token scoped to project A can issue POST
/api/topics/<project-B-topic-id>/close and closeTopic (topics.ts:299-343) will
append topic.closed and flip the status, an irreversible seal of project B
coordination log, purely from knowing the id. getTopic / joinTopic likewise read
and mutate across the tenant boundary. Design section 4.4 says close is open to
any writer caller and defers level-based authorization; CLARIFY R8 / invariant 5
accept that actor identity is unauthenticated and only guarantee the actor
cannot be namespaced into the wrong project on join. Neither sanctions a
cross-tenant destructive operation. The id is a UUID so probing is hard, but a
leaked or logged topic_id is enough. WARN because the spec did punt
authorization generally; flagged because the destructive cross-tenant path is
nowhere explicitly accepted.

## Finding 3 (WARN) - AC9 (SSE) is entirely unverified by the automated suite

CLARIFY AC9 requires the SSE stream to push new events and clean up on client
disconnect, and CLARIFY Risk R2 mitigation states verbatim that the SSE handler
registers a close-event cleanup and that a test covers disconnect cleanup. The
design section 8 test plan then reduced SSE verification to a single manual curl
line under Live smoke (VERIFY) and added no SSE unit test. The shipped suite
matches section 8: coordinationEvents.test.ts (T1-T5) and topics.test.ts
(T6-T12) contain no reference to /stream, the poll loop, cleanup, or
MAX_STREAM_MS. Consequently the most lifecycle-fragile code in the sprint, the
self-scheduling tick (routes/topics.ts:162-173), the close-event cleanup
teardown (123, 117-122), the half-open-socket MAX_STREAM_MS bound (109, 164),
and drainIfClosed (148-154), has no regression coverage; a future edit can
silently reintroduce the connection-leak or overlapping-tick bugs that
design-review rounds 1-3 were spent eliminating, and CI will stay green. WARN
(coverage gap, not a present defect), but it directly contradicts R2 promised
mitigation.