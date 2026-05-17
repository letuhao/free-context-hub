---
agent: adversary
phase: review-design
sprint: phase-15-sprint-15.2-board
round: 1
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md
spec_hash: 411f03f1d1c510af
status: REJECTED
findings:
  - severity: BLOCK
    finding: >-
      Section 2.3 claimTask claims (D6, Section 9 invariant 1) to be the
      "verbatim Phase 13 _claimArtifactOnce algorithm", but it drops the
      algorithm's race-retry loop (MAX_INTERNAL_RACE_RETRIES + the __retry signal
      from fetchConflictResultOrRetry) while keeping a 23505 handler whose
      re-SELECT is assumed to always find a live claim. The design's own Section
      2.3 closing line says "claims_active_uniq is the backstop for the (now
      rare) interleave" so a 23505 IS anticipated. On the 23505 path, when the
      re-SELECT of the live claim returns 0 rows (the conflicting row was a stale
      claim past expires_at that step-1 DELETE missed, or the sweep deleted it in
      the window), Section 2.3 still returns {status conflict, incumbent_actor_id,
      expires_at} but there is no row to read incumbent_actor_id / expires_at
      from.
    impact: >-
      A claimTask on the 23505 + 0-rows path returns a conflict referencing a
      non-existent incumbent (undefined actor_id / expires_at) the exact bug
      Phase 13 round-1 fixed ("synthetic race-resolved conflict reports
      non-existent incumbent") and whose fix the design claims to mirror. AC5
      ("rest conflict, with the incumbent, no 500") is unmet on that path. D6's
      "verbatim artifactLeases.ts" claim is FALSE: artifactLeases.ts has the
      outer claimArtifact retry loop; Section 2.3 has neither the loop nor the
      __retry branch.
    required_fix: >-
      Either (a) port the Phase 13 outer retry loop verbatim: on 23505 with a
      0-rows re-SELECT, return __retry and retry once, then surface a distinct
      race-exhausted status, making the "verbatim" claim true; or (b) prove and
      state in Section 2.3 that 23505 is structurally impossible here (the task
      FOR UPDATE lock + artifact_id embedding task_id serialize every claimTask
      that could collide on one artifact_id), delete the dead 23505 handler, and
      correct Section 9 invariant 1 / the Section 2.3 "backstop" wording.
  - severity: BLOCK
    finding: >-
      Section 2.4 releaseTask selects the claim to delete by artifact_id with NO
      liveness filter ("SELECT ... FROM claims WHERE artifact_id=$ FOR UPDATE").
      An expired-but-unswept claim therefore satisfies releaseTask: if its
      actor_id matches the caller, releaseTask DELETEs it and sets the task to
      posted WITHOUT calling revertArtifact. The sweep (Section 4.1) for the
      identical expired-claim condition does task->posted PLUS revertArtifact.
      Whether an abandoned artifact is reverted thus depends on a race between
      the sweep and a late releaseTask by the returning holder.
    impact: >-
      AC11 (the revert guarantee: abandoned claim => artifact reverts to last
      baseline or draft) is violated: a holder whose claim expired, then calls
      releaseTask before the sweep runs, leaves the artifact in working with
      half-written content_ref and no claim the next claimant inherits dirty,
      unbaselined content that should have been reverted. Section 9 invariant 9
      and the whole revert design assume the sweep is the only consumer of
      expired claims; releaseTask silently bypasses the revert path.
    required_fix: >-
      In Section 2.4, restrict releaseTask to LIVE claims: add "AND expires_at >
      now()" to the claim SELECT so an expired claim yields not_found (the sweep
      owns it); OR have releaseTask call revertArtifact when the claim it removes
      is already past expires_at, so both expired-claim consumers honour the
      revert contract identically.
  - severity: BLOCK
    finding: >-
      Section 4.1 sweepAbandonedClaims reads topic status with a non-locking
      "topicStatus <- SELECT status FROM topics WHERE topic_id=$" and then, on the
      open-topic branch, calls appendEvent (claim.expired / task.released /
      artifact.*) inside the per-claim txn. closeTopic can run in the window
      between that status read and appendEvent; the 15.1 seal
      (coordinationEvents.ts: UPDATE ... WHERE status <> closed, 0 rows => throw
      BAD_REQUEST) then makes appendEvent throw. Section 4.1's per-claim loop body
      shows BEGIN..COMMIT but states NO Section 0.1 catch/ROLLBACK/release wrapper
      and no try/catch around the body so that throw escapes the loop and aborts
      the whole sweep cycle, directly violating Section 4.1's own stated goal
      "one bad claim must not block the rest". D7's claim that this "reuses the
      sweepScheduler.ts structure" is misleading: the shipped sweepScheduler.ts
      releases the advisory lock per-cycle and is safe under concurrent replicas
      ONLY because its sole locked action is an idempotent DELETE; moving
      event-emitting, artifact_versions-appending recovery work directly inside
      that cycle inherits none of that safety argument.
    impact: >-
      A topic closing concurrently with a sweep tick aborts the entire sweep
      cycle, leaving every other expired claim in that tick unrecovered until the
      next 5-minute interval; the per-claim txn that threw may also leak a dirty
      client if Section 0.1's finally-release is genuinely absent (the design
      never shows it for the Section 4.1 loop). The Section 0.1
      transaction-cleanliness contract (Section 9 invariant 8) is unverifiable
      for the sweep, and AC11 recovery is delayed/skipped on close races.
    required_fix: >-
      In Section 4.1, wrap each per-claim iteration body in the explicit Section
      0.1 contract (try { BEGIN..COMMIT } catch { ROLLBACK; log; CONTINUE do not
      rethrow } finally { release }), and either make the topic-status decision
      race-free (re-check status under the same lock, e.g. SELECT status FROM
      topics WHERE topic_id=$ FOR UPDATE before branching) or treat an appendEvent
      BAD_REQUEST inside the open branch as "topic closed mid-sweep" and fall
      through to the closed-topic path (drop the claim, no events) rather than
      aborting.
---

## Reasoning

### Finding 1 - the "verbatim Phase 13" claim is false; the 23505 0-rows path returns a phantom incumbent

D6 and Section 9 invariant 1 both assert Section 2.3's claim transaction is the
verbatim artifactLeases.ts _claimArtifactOnce algorithm. It is not. The shipped
Phase 13 path has two layers: _claimArtifactOnce (one attempt) and the outer
claimArtifact loop (for attempt <= MAX_INTERNAL_RACE_RETRIES). On a 23505 the
shipped fetchConflictResultOrRetry re-SELECTs the live lease and, when it finds 0
rows, returns { __retry: true } the race winner's lease expired between their
INSERT and the re-SELECT, so the artifact is genuinely free; the outer loop
retries. This __retry branch exists specifically because Phase 13 round 1 was
REJECTED for "synthetic race-resolved conflict reports non-existent incumbent"
(AUDIT_LOG line 23). Section 2.3 collapses this to a single line - "on 23505
ROLLBACK; re-SELECT the live claim -> conflict (a concurrent winner)" - with no
outer loop, no __retry, and an unconditional assumption that the re-SELECT yields
a live row. The design cannot have it both ways: its own Section 2.3 closing
sentence says claims_active_uniq "is the backstop for the (now rare) interleave",
i.e. it expects 23505 to fire; yet a 23505 with a 0-rows re-SELECT has no
incumbent row, so the returned incumbent_actor_id / expires_at are undefined. If
the designer instead believes 23505 is structurally impossible (the task FOR
UPDATE + artifact_id embedding task_id do serialize every colliding claimTask),
then the entire 23505 handler is dead code and the "verbatim" / "backstop"
wording is wrong. Internally inconsistent either way, and a live AC5 risk on the
0-rows path. BLOCK.

### Finding 2 - releaseTask consumes expired claims and skips the revert

Section 2.4's claim lookup - SELECT ... FROM claims WHERE artifact_id=$ FOR
UPDATE - has no expires_at > now() predicate. Claims are ephemeral but expired
rows linger until the sweep (the Section 1 migration deliberately ships a plain
unique index, exactly as Phase 13 0048 does, so expired rows are not
auto-removed). So there is a real window - claim past expires_at, sweep (5-min
interval) not yet run - in which releaseTask finds the expired claim, matches
actor_id, and treats it as a normal release: DELETE the claim, task -> posted,
emit task.released. It does NOT call revertArtifact. The sweep (Section 4.1), for
the identical expired-claim condition, does revertArtifact. The artifact's
recovery therefore depends on who wins a race. A returning holder who calls
releaseTask after their own claim lapsed leaves the artifact in working with
their partial content_ref and no claim - the next claimant picks up dirty,
never-reverted content. AC11 is the explicit "abandoned claim => revert to last
baseline / draft" guarantee, and Section 9 invariant 9 reasons from "the sweep
sweeps live claims only"; both silently assume the sweep is the sole path that
retires an expired claim. releaseTask is a second such path with no revert.
BLOCK.

### Finding 3 - the sweep is not crash-safe; the topic-status check is a TOCTOU; D7's reuse claim is misleading

D7 says the sweep "reuses the sweepScheduler.ts structure" and calls
sweepAbandonedClaims() directly (not via async_jobs). The shipped
sweepScheduler.ts is explicit in its own header that it is not leader election:
it acquires and releases the advisory lock within one cycle, around the enqueue
only, and is safe under N concurrent replicas purely because the only locked work
is an idempotent DELETE ("duplicate jobs delete nothing extra"). Moving the
recovery work - DELETE claim + UPDATE task + revertArtifact (which appends
artifact_versions) + three appendEvents - directly into that cycle inherits none
of that idempotency. The per-claim SELECT 1 ... FOR UPDATE does serialize two
replicas on the claim row (the loser skips) - that part holds. But Section 4.1
reads topic status with a non-locking SELECT status FROM topics, then branches:
closed => drop claim, no events; open => proceed to appendEvent. Nothing stops
closeTopic from running in the window between that read and the appendEvent. When
it does, the 15.1 seal (coordinationEvents.ts lines 72-83: UPDATE topics ...
WHERE status <> closed -> rowCount === 0 -> throw ContextHubError(BAD_REQUEST))
makes appendEvent throw. Section 4.1's per-claim body shows BEGIN..COMMIT but
never shows the Section 0.1 catch -> ROLLBACK -> finally release wrapper and has
no try/catch around the loop body - so the throw propagates out of the for loop
and kills the whole sweep cycle, contradicting Section 4.1's stated invariant
"one bad claim must not block the rest". Every other expired claim in that tick
waits a full 5-minute interval. And because Section 0.1's finally-release is not
shown for this loop, the throwing iteration's client may leak. The sweep is the
riskiest path in 15.2 (the CLARIFY pre-emptive self-review item 2 says so) and
the design under-specs exactly the failure mode the CLARIFY flagged. BLOCK.