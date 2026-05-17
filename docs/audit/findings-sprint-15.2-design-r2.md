---
agent: adversary
phase: review-design
sprint: phase-15-sprint-15.2-board
round: 2
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md
spec_hash: 4e81c50df7a82932
r1_resolution: F1 resolved; F2 resolved; F3 resolved
status: REJECTED
findings:
  - severity: BLOCK
    finding: >-
      Section 4.1 the sweep acquires its row locks in the order task -> claim ->
      topics -> artifacts: it does SELECT ... FROM topics ... FOR UPDATE (step 3)
      and only afterwards calls revertArtifact (step 6), whose UPDATE artifacts
      ... is the first time it touches the artifacts row. Section 3.1
      writeArtifact and Section 3.2 baselineArtifact lock artifacts (the guarded
      UPDATE) then topics (appendEvent) -- order artifacts -> topics. Section 2.5
      completeTask locks task, then artifacts (UPDATE artifacts SET
      state=for_review), then topics -- order task -> artifacts -> topics. The
      sweep holds the topics row and waits for the artifacts row while a
      concurrent writeArtifact / baselineArtifact / completeTask holds the
      artifacts row and waits for the topics row -- a classic ABBA deadlock.
      Section 10 claimed uniform order task -> claim -> artifact -> topics does
      not match the Section 4.1 pseudocode, which never locks the artifact
      before topics; the Section 4.1 inline comment task -> claim -> topics omits
      the artifact lock entirely and contradicts Section 10.
    impact: >-
      Postgres detects the cycle and kills one transaction with 40P01. If the
      victim is the sweep, the abandoned claim is rolled back, logged, and
      skipped (Section 0.1-loop catch/continue) -- AC11 recovery silently does
      not happen for that claim until a later tick that happens not to race. If
      the victim is a writeArtifact / baselineArtifact / completeTask, the actor
      call returns a 500 -- AC6/AC8/AC9 produce spurious failures under normal
      concurrent load. Invariant 6 (the sweep is crash-isolated and
      close-race-safe) and the Section 10 no-deadlock-cycle claim are false.
    required_fix: >-
      Make the sweep acquire the artifacts row lock BEFORE the topics row lock:
      in Section 4.1 add an explicit SELECT 1 FROM artifacts WHERE artifact_id=$
      FOR UPDATE immediately after the claim-row lock (step 2) and before the
      topics FOR UPDATE (step 3), so every transaction order is task -> claim ->
      artifact -> topics; then correct the Section 4.1 inline comment and confirm
      Section 10.
  - severity: BLOCK
    finding: >-
      Section 4.1 closed-topic branch -- status=closed -> DELETE FROM claims
      WHERE claim_id=$; COMMIT; continue. For an abandoned (expired) claim on a
      closed topic the sweep drops the claim row but does NOT call revertArtifact
      and does NOT set the task posted. CLARIFY AC11 states without
      qualification: the abandoned-claim sweep detects a claims row past
      expires_at, emits claim.expired, returns the task -> posted, and reverts
      the output artifact to its last baselined version (or draft). There is no
      closed-topic exemption in AC11, and the artifact revert in Section 3.3 is a
      pure UPDATE artifacts that emits no event and so is not blocked by the
      sealed log. The master design C.4 likewise promises recovery for every
      claim-holdable state. The sprint design unilaterally narrows AC11; the
      drain deferred by CLARIFY is the closing-state machinery, not the sweep
      artifact revert.
    impact: >-
      AC11 is unmet for any abandoned claim whose topic was closed: the output
      artifact is left in working with half-written content_ref, never reverted
      to its last safe version, and the task row is left claimed forever. A QC /
      Scope-Guard pass keyed on the literal AC text flags AC11 as not covered.
    required_fix: >-
      In the Section 4.1 closed-topic branch, call revertArtifact(client,
      artifact_id, system:sweep) and run UPDATE tasks SET status=posted WHERE ...
      before the DELETE+COMMIT (still emitting no events, since the log is
      sealed) -- OR get AC11 amended in the CLARIFY spec to explicitly exempt
      closed topics, and state that exemption in Section 9 invariant 7.
  - severity: WARN
    finding: >-
      Section 2.1 postTask runs INSERT INTO tasks, INSERT INTO artifacts, INSERT
      INTO artifact_versions BEFORE the first appendEvent, and asserts a
      closed/missing topic is rejected by the appendEvent seal -- the first
      appendEvent throws BAD_REQUEST. That is only true for a closed topic. For
      a missing topic the tasks-row FK topic_id REFERENCES topics(topic_id)
      (migration 0054) fires a 23503 foreign-key violation on the very first
      INSERT -- the Section 0.1 catch rolls back and re-throws the raw 23503 as
      an unclassified 500, never reaching appendEvent.
    impact: >-
      post_task / POST /topics/:id/tasks against a non-existent topic_id returns
      a 500 instead of a 400/404; the Section 2.1 claim that the seal handles
      closed and missing uniformly is factually wrong for the missing case, and
      the Section 5 status-to-HTTP table has no row that produces a clean code
      for it.
    required_fix: >-
      In Section 2.1 add an explicit SELECT 1 FROM topics WHERE topic_id=$ FOR
      UPDATE (or a plain existence check) as the first statement of postTask and
      return a not_found status (->404) when the topic is absent; correct the
      Section 2.1 sentence to distinguish closed (seal -> 400) from missing
      (explicit check -> 404).
---

## Reasoning

### Finding 1 -- the sweep lock order is task -> claim -> topics -> artifacts, which deadlocks against every artifact-mutating transaction (BLOCK)

The round-2 mandate is to check every transaction lock acquisition order against the
sweep new lock order. The sweep (Section 4.1) does, in sequence: (1) SELECT 1 FROM tasks
FOR UPDATE, (2) SELECT 1 FROM claims FOR UPDATE, (3) SELECT status FROM topics FOR
UPDATE, then DELETE claim, UPDATE tasks, and (6) revertArtifact -- and revertArtifact
(Section 3.3) is the only place the sweep touches the artifacts row, via UPDATE
artifacts. So the sweep true acquisition order is task -> claim -> topics -> artifacts.

writeArtifact (Section 3.1) and baselineArtifact (Section 3.2) are a single guarded
UPDATE artifacts ... WHERE ... (locks artifacts) followed by appendEvent (locks topics)
-- order artifacts -> topics. completeTask (Section 2.5) locks the task, then UPDATE
artifacts SET state=for_review (locks artifacts), then appendEvent (locks topics) --
order task -> artifacts -> topics.

The sweep holds topics and blocks waiting for artifacts; a concurrent
writeArtifact/baselineArtifact/completeTask holds artifacts and blocks waiting for
topics. That is an ABBA cycle. Postgres aborts one side with 40P01. The Section 0.1-loop
catch swallows it on the sweep side (claim skipped -> AC11 recovery silently delayed);
on the actor side it surfaces as a 500 on a perfectly ordinary write. Section 10 claims
a uniform order task -> claim -> artifact -> topics -- but the Section 4.1 pseudocode
never locks artifact before topics, and the Section 4.1 inline comment says task ->
claim -> topics, omitting the artifact lock. The design contradicts itself and the
actual code path deadlocks. The fix is mechanical: lock artifacts FOR UPDATE between the
claim lock and the topics lock. BLOCK.

### Finding 2 -- the closed-topic sweep branch skips the artifact revert, leaving AC11 unmet (BLOCK)

CLARIFY AC11 is unqualified: an expired claims row -> emit claim.expired, task ->
posted, and revert the output artifact. The Section 4.1 closed-topic branch does only
DELETE FROM claims; COMMIT -- no revertArtifact, no task->posted. The design defence
(a closed topic expired claims are dropped without emitting into the sealed log)
justifies not emitting events -- but the artifact revert (Section 3.3) is a plain
UPDATE artifacts that emits nothing of its own and is not blocked by the seal, so the
sealed-log argument does not justify skipping it. The master design C.4 promises
recovery for every claim-holdable state. The CLARIFY out-of-scope item defers the
closing drain-state machinery, not the sweep revert behaviour. So the design has
unilaterally narrowed an acceptance criterion: an abandoned claim on a closed topic
leaves a dirty working artifact never reverted to its last safe version. The prompt
severity rule makes an unmet AC a BLOCK; AC11 as written is unmet. Either revert in the
closed branch too (cheap, no events) or get AC11 formally amended. BLOCK.

### Finding 3 -- postTask returns 500, not 400/404, for a missing topic; the Section 2.1 seal claim is wrong (WARN)

Section 2.1 inserts the tasks/artifacts/artifact_versions rows first and claims the seal
handles a closed/missing topic. The seal (coordinationEvents.appendEvent) does reject a
closed topic with a clean BAD_REQUEST. But for a missing topic the tasks.topic_id FK to
topics(topic_id) (migration 0054, Section 1) raises 23503 on the first INSERT INTO
tasks, long before any appendEvent runs; the Section 0.1 catch re-throws that raw FK
error as an unclassified 500. So post_task against a non-existent topic returns 500 --
there is no row in the Section 5 status->HTTP table for it, and the Section 2.1 sentence
is factually wrong for the missing case. Lower severity than a deadlock or an unmet AC,
but a real wrong-status-code gap and a false claim in the spec. Add an explicit topic
existence check at the head of postTask. WARN.

## Round-1 resolution

F1 (claimTask phantom incumbent / false verbatim-Phase-13 claim) -- RESOLVED. Rev 2 took
option (b) of the round-1 required_fix: the 23505 handler is deleted, Section 2.3 gives
a structural-impossibility proof, and the verbatim-artifactLeases.ts wording is
explicitly corrected. The proof is airtight for the 15.2 code as designed: claimTask is
the only transaction that INSERTs a claims row (the sweep, releaseTask, completeTask
only DELETE), and every claimTask for a given task serializes on the task-row FOR
UPDATE -- the loser runs DELETE-expired then the live-claim SELECT, finds the winner
committed row, and returns conflict with a real incumbent without ever reaching the
INSERT. Keeping claims_active_uniq as an integrity invariant that would surface a future
un-locked insert path as a loud 500 is a sound defensive posture, not a
phantom-incumbent regression. No false verbatim claim remains.

F2 (releaseTask consuming expired claims, bypassing the revert) -- RESOLVED. Section 2.4
now filters the claim SELECT with AND expires_at > now(); an expired claim yields
claim_expired (a no-op) and the sweep remains the sole consumer of expired claims and
the sole path that reverts. Invariant 7 correctly states this. The new claim_expired
status does not wedge a task: a task left claimed with an expired claim is lazily
cleaned and re-granted by the next claimTask (its DELETE-expired step), or recovered by
the sweep -- verified, no wedge.

F3 (sweep aborting its cycle on a topic-close race; missing Section 0.1 catch) --
RESOLVED. Section 4.1 now wraps each per-claim iteration in the explicit Section 0.1-loop
contract (try BEGIN..COMMIT, catch ROLLBACK + log + continue, finally release), so one
claim failure no longer aborts the batch, and it reads the topic status under SELECT
... FOR UPDATE, serializing closeTopic against the sweep so the open-branch appendEvent
cannot hit a freshly-sealed topic. Both halves of the round-1 required_fix are present.
(Note: the closed-topic path that this same FOR UPDATE now reliably reaches is itself
defective for a different reason -- see Finding 2 -- but the round-1 race/abort defect
F3 raised is resolved.)