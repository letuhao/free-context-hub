---
agent: main+self-review
phase: review-design
sprint: phase-15-sprint-15.1-substrate
round: 4-final
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md
spec_hash: 892ef920d6628657
status: APPROVED
basis: >-
  The 3-round cold-start design-review cap is reached (docs/amaw-workflow.md;
  Phase 13/14 precedent). Rev 4 resolves round-3's 3 findings and adds no new
  mechanism, so REVIEW-DESIGN closes with a main-session self-review of rev 4
  rather than a 4th cold-start round. The implemented code is checked fresh by
  the REVIEW-CODE cold-start Adversary against this spec.
---

## Round-3 resolution — verified

**r3-F1 (BLOCK — two-txn `joinTopic` returns a poisoned client) — RESOLVED.**
Rev 4 adds §4.0 "Transaction & connection-management contract": every transactional
service function (`charterTopic` / `joinTopic` / `closeTopic`) is wrapped in
`try { … } catch (err) { await client.query('ROLLBACK').catch(()=>{}); log; throw err }
finally { client.release() }` — the verbatim Phase 13 `artifactLeases.ts`
`_claimArtifactOnce` pattern. §4.2 `joinTopic` shows both transactions inside one such
`try`; the single unconditional `catch`→`ROLLBACK` aborts whichever txn (1 or 2) is open
at throw time, and is a harmless no-op between txn 1's COMMIT and txn 2's BEGIN. §4.4
`closeTopic`'s `already_closed` early-`return` runs an explicit `ROLLBACK` first (a
`return` skips the `catch`). Invariant 11 states the `catch` is the real rollback guard.
No unanticipated error can now return a pooled client with an open/aborted transaction.

**r3-F2 (WARN — txn-2-failure recovery overstated) — RESOLVED.**
§4.2's "Txn-2 failure — honest recovery story" no longer claims a retry unconditionally
yields the pack. It states: the join (txn 1) is durably committed and not lost; txn 2 is
`READ ONLY` so it has no serialization-failure surface; a transient infra fault recovers
on retry; a persistent fault surfaces as a thrown error and the pack is then obtained via
`get_topic` + `replay_topic_events`. §10 and invariant 8 updated to match.

**r3-F3 (WARN — SSE has no liveness floor vs a silent half-open socket) — RESOLVED.**
§5.1 adds `MAX_STREAM_MS = 1_800_000` (30 min); `tick` checks `streamDeadline` and
force-ends the stream at the cap, bounding a half-open-socket zombie poll loop. The resume
cursor is read from `?since=` or the `Last-Event-ID` reconnect header, so the cap is
invisible to a live `EventSource` client. Invariant 10 reworded from "leak-free" to
"leak-bounded" and names the half-open-socket trade-off.

## New-issue scan — does rev 4 introduce a new BLOCK? (the fix-interaction check)

Rev 4 contains **no mechanism change**: (a) the §4.0 `catch` is the verbatim shipped
Phase 13 pattern; (b) §4.2's recovery paragraph is documentation only; (c) §5.1's
`MAX_STREAM_MS` is one constant plus one age check at the top of an already-existing loop.
Checks performed:
- `closeTopic` `already_closed` path: `ROLLBACK` precedes `return`, so `finally`'s
  `release()` gets a clean client — verified.
- `joinTopic` `catch` with an error arriving between txn 1's COMMIT and txn 2's BEGIN:
  `ROLLBACK` on no open txn → `.catch(()=>{})` swallows the warning — verified harmless.
- §5.1 `endStream` / `drainIfClosed` refactor (`evts.some(...) ? (endStream(), true)
  : false`) is behaviour-equivalent to the rev-3 inline form — verified.
- `tick`'s max-age check returns without re-arming the timer ⇒ the loop terminates —
  verified.

One **pre-existing, non-blocking** edge noted for REVIEW-CODE (not introduced by rev 4):
`Number(req.query.since ?? …)` yields `NaN` if `since` arrives as a repeated query param
(Express coerces those to an array). A `Number.isFinite` guard is a trivial code-level
fix; flagged for the BUILD / REVIEW-CODE phase, not a design BLOCK.

## Verdict

REVIEW-DESIGN closes **APPROVED** at the 3-round cap. 9 findings across rounds 1–3
(4 BLOCK, 5 WARN) are all resolved; rev 4 introduces no new BLOCK. The design is
BUILD-ready — proceed to PLAN.
