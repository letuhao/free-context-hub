---
agent: scope-guard
phase: post-review
sprint: phase-15-sprint-15.1-substrate
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md (rev 5)
status: CLEAR
spec_drift: false
spec_drift_note: >-
  Rev-5 spec hash fb2378e35e2d810e re-computed and verified exact (sha256 of the
  design file with the **Spec hash:** line value replaced by
  <computed-after-write>). All four revisions are accounted for by logged
  AUDIT_LOG events: rev 1 = design_complete (ad5ca49cf0b65033), rev 2/3/4 =
  design_revised v2/v3/v4 (last = 892ef920d6628657), rev 5 = fixes_applied
  (spec_hash_old 892ef920d6628657 -> fb2378e35e2d810e). The fixes_applied event
  spec_hash_old matches the rev-4 event spec_hash -- the hash chain is unbroken.
  The rev-5 [r-code-fix] markers appear at exactly the two content sites the
  event names (section 4.2 InductionPack coherence guarantee, section 9
  invariant 8) plus the Rev 5 header note -- no [r-code-fix] marker anywhere
  else, so no design content changed outside what the fixes_applied event
  describes.
ac_coverage:
  covered: [AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13]
  partial: []
  not_covered: []
prior_findings_resolved: "12/12 (design 9 + code 3)"
blockers: []
---

# POST-REVIEW -- Phase 15 Sprint 15.1 (Coordination Substrate)

Cold-start Scope Guard final gate. Read only the named files; verified every AC
claim against the real implementation and ran tsc --noEmit plus the three new
test files fresh against the live test DB. Verdict: **CLEAR**.

## Check 1 -- Spec-drift: PASS (no unexplained drift)

The design Spec hash line states its hash is the sha256 of the file with that
line value read as <computed-after-write>. Re-computing it that way yields
fb2378e35e2d810e -- an exact match for the rev-5 hash in the doc and in the
fixes_applied AUDIT_LOG event. Each Rev N header note maps to a logged event:
Rev 2 -> design_revised v2 (resolves design-r1), Rev 3 -> v3 (design-r2), Rev 4
-> v4 spec_hash 892ef920d6628657 (design-r3), Rev 5 -> fixes_applied
spec_hash_old 892ef920d6628657 -> fb2378e35e2d810e (REVIEW-CODE r1). The
fixes_applied event spec_hash_old equals the rev-4 event spec_hash, so the
revision chain is continuous with no missing link (rev 1 is the design_complete
event, ad5ca49cf0b65033). The fixes_applied event says rev 5 is the WARN-1
induction-pack coherence reword in 4.2/9.8 -- and the [r-code-fix] markers in
the design appear at exactly two content sites (section 4.2 InductionPack
coherence guarantee at line 317; section 9 invariant 8 at line 572) plus the
Rev 5 header note itself; a grep for [r-code-fix] finds nothing else. No design
content change is unaccounted for. The design file is untracked in git (new this
sprint), so prior revisions cannot be diffed from history, but the in-file
revision markers, the hash chain, and the AUDIT_LOG together fully account for
every change. Not drift.

## Check 2 -- AC coverage: PASS (13/13 covered)

Verified each AC against the real code and the named test, not the QC matrix
alone. The three new test files were run fresh against the live DB -- **21/21
pass** (the two ERROR log lines are the expected-rejection assertions in T9 and
T11). tsc -p tsconfig.json --noEmit exits 0.

- **AC1** (migration) -- 0053_coordination_substrate.sql creates topics, actors,
  topic_participants, coordination_events; the latter has PRIMARY KEY (topic_id,
  seq) (line 62); all DDL is CREATE ... IF NOT EXISTS (idempotent). Applied in
  VERIFY. Covered.
- **AC2** -- topics.test.ts "charterTopic creates a chartered topic and emits
  topic.chartered at seq 1" asserts status=chartered and events[0] is
  topic.chartered at seq=1; same-txn INSERT+appendEvent is structural in
  charterTopic (one BEGIN...COMMIT). Covered.
- **AC3** -- topics.test.ts "joinTopic registers actor + participant, emits
  topic.actor_joined, flips to active" asserts the status flip, a 1-row roster
  with level/type, the topic.actor_joined event, and the {topic,roster,events,
  your_cursor} pack. Covered.
- **AC4** -- topics.test.ts "joinTopic re-join is idempotent..." asserts no
  second participant row and (via replayEvents) exactly one topic.actor_joined;
  "...conflicting actor_type throws BAD_REQUEST" asserts the rejection. Covered.
- **AC5** -- topics.test.ts "getTopic returns the topic + full roster;
  NOT_FOUND..." asserts the record, the roster, and the unknown-topic rejection.
  Covered.
- **AC6** -- topics.test.ts "closeTopic emits topic.closed last, seals the log,
  and is idempotent" asserts topic.closed is the final event, a post-close join
  is rejected, and a second close returns already_closed:true with no new event;
  coordinationEvents.test.ts "appendEvent on a closed topic throws (the seal)"
  asserts the append-side seal. Covered.
- **AC7** -- coordinationEvents.test.ts "replayEvents returns events seq >
  cursor, ascending" and "...past the end returns empty, next_cursor = input
  cursor" assert ascending order and the high-water-mark cursor. Covered.
- **AC8** -- coordinationEvents.test.ts "concurrent appendEvent: seqs are
  exactly 1..N, distinct, no error" runs Promise.all of 5 appends and asserts
  [1,2,3,4,5] distinct. Covered.
- **AC9** -- src/api/routes/topics.test.ts (new in rev 5): "SSE stream of a
  closed topic delivers the backlog and ends with stream_end", "...unknown topic
  returns 404 (not a hung 200)", "...runs cleanup exactly once on client
  disconnect" -- the disconnect test asserts the live-stream counter returns to
  its baseline after req.destroy(). A real lifecycle assertion, not a happy-path
  touch. Covered.
- **AC10** -- topics.test.ts "actor identity is project-scoped..." joins the
  same actor_id into two projects and asserts two distinct actors rows with the
  respective types. Covered.
- **AC11** -- five MCP tools (charter_topic/join_topic/get_topic/close_topic/
  replay_topic_events) registered in src/mcp/index.ts; six REST endpoints in
  routes/topics.ts (5 mirrored + SSE) all returning {status:ok,data} /
  router-local {status:error,...}; SSE has no MCP tool (design section 6).
  Covered.
- **AC12** -- tsc --noEmit exit 0 (re-run fresh); 21 new tests pass (re-run
  fresh); QC records the full suite at 329/329. Covered.
- **AC13** -- live smoke is recorded in the VERIFY phase_complete AUDIT_LOG
  event with concrete evidence (charter->join->get->events->close, the event log
  showing the three events in seq order, and the missing-topic 404). The
  deployed stack cannot be re-driven from a cold-start review, but the SSE route
  test independently confirms the same chartered/actor_joined/closed ordering
  against the DB. Covered.

## Check 3 -- Finding resolution: PASS (12/12 resolved)

**Design review r1-r3 -- 9 findings (4 BLOCK + 5 WARN), all resolved.** The
AUDIT_LOG review events for rounds 1/2/3 each record REJECTED, and each
following design_revised event records the fix; the round-2 and round-3 events
carry r1_resolution/r2_resolution notes confirming the prior round findings
resolved. The rev-4 main+self-review event (round "4-final", APPROVED) states
all 9 findings across r1-r3 (4 BLOCK + 5 WARN) are resolved and the
fix-interaction scan is clean. No unresolved BLOCK.

**Code review r1 -- 3 WARN, 0 BLOCK.** findings-sprint-15.1-code-r1.md confirms
status APPROVED_WITH_WARNINGS, 0 BLOCK. WARN-1 (induction-pack coherence
overstated past the replay cap) -- fixed: design 4.2/9.8 reworded to honest
cursor-continuation wording, and a new replayEvents limit/cursor test
("replayEvents honors the limit; the cursor continues the read correctly") was
added and passes; the pagination residual is tracked as DEFERRED-010. WARN-2 (no
cross-project topic scoping) -- deferred as DEFERRED-009. WARN-3 (SSE handler had
no automated test) -- fixed: new src/api/routes/topics.test.ts with three SSE
tests, all passing. Every WARN is either fixed or carries a real, well-formed
DEFERRED entry. No unresolved BLOCK anywhere.

## Check 4 -- Deferred items: PASS (both OPEN, neither trigger met)

**DEFERRED-009** (cross-project topic scope) -- well-formed: What/Why/Trigger/
Size/Priority/Status all present, Status OPEN, sourced to REVIEW-CODE r1 finding
2. Trigger condition: a Phase 15 sprint that introduces topic-level
authorization, OR MCP_AUTH_ENABLED=true adopted in a real deployment, OR a
dedicated security-audit sprint. Sprint 15.1 ships no authorization enforcement
(design 4.4 explicitly defers level-based authz; closeTopic is open to any
writer), and dev runs MCP_AUTH_ENABLED=false -- no caller-project context
exists. Trigger not met.

**DEFERRED-010** (real induction-pack pagination) -- well-formed, Status OPEN,
sourced to REVIEW-CODE r1 finding 1. Trigger condition: Phase 15 Sprint 15.2 (the
Board adds task.*/artifact.*/claim.* events), OR a reported case of an induction
pack missing recent events. Sprint 15.1 emits only topic.chartered/
topic.actor_joined/topic.closed; a topic would need >1000 joins to reach the
DEFAULT_REPLAY_LIMIT=1000 cap, and 15.2 is the next sprint, not this one.
Trigger not met.

## Verdict

All four checks pass: spec hash verified and every revision logged (no drift);
13/13 ACs genuinely covered with passing tests re-run fresh; all 4 design-review
BLOCKs and all 3 code-review WARNs resolved or deferred with real entries; both
DEFERRED items OPEN with triggers not met by 15.1. **POST-REVIEW: CLEAR.**
Ready for SESSION/COMMIT.