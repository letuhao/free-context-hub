# Sprint 15.3 POST-REVIEW — Scope Guard

**Phase:** POST-REVIEW (final conservative gate) · **Agent:** cold-start Scope Guard (general-purpose, opus)
**Verdict:** CLEAR.

> Persisted by the main session — the Scope Guard sub-agent returned this in its final
> message (the harness blocks sub-agent writes under `docs/audit/`).

## Spec fingerprint
Recomputed `6f79057f9e42e4fc` = recorded `6f79057f9e42e4fc` — **MATCH**. Design unmodified since
REVIEW-DESIGN closed; the `doaMatrix.ts` / `requests.ts` / `routes/requests.ts` / `0056.sql`
headers all carry the matching `Spec hash`. No drift.

## Review-chain resolution (all verified in shipped code)
- **REVIEW-DESIGN r1 — 3 BLOCK → design rev 2:**
  - B1 self-approval — RESOLVED: `requests.ts` rejects `actorId === submittedBy` →
    `self_decision_forbidden`, after the participant check, before the level check.
  - B2 `artifact_versions` INSERT incomplete — RESOLVED: all 7 columns explicit,
    `created_by` threaded via `resolveArtifact`'s `actorId` param.
  - B3 closed-topic contract hole — RESOLVED: `submitRequest` (pre-BEGIN) + `decideStep`
    (post request lock) plain-read `topics.status` → `topic_closed`/409.
- **REVIEW-DESIGN r2 — 1 BLOCK + 1 WARN → design rev 3:**
  - B4 `weight` unbounded — RESOLVED: `requests.ts` validates `[0, 2147483647]` pre-`connect()`.
  - W1 counter-sign distinct-endorser collapse — RESOLVED as documentation (§11.2 + inv. 3
    rewritten) + logged DEFERRED-013.
- **REVIEW-DESIGN r3 — ACCEPTED, 0 new findings.** Closed at the 3-round cap.
- **REVIEW-CODE r1 (`/review-impl`, 0 HIGH, 2 MED, 3 LOW, 1 COSMETIC):**
  - MED-1 (no test for `resolveArtifact` 0-row path) — FIXED, test-only.
  - MED-2 (T20 didn't exercise catch-and-continue) — FIXED, test-only (genuine 23505 crash isolation).
  - LOW-3 (`'conflict'` dead code) ACCEPTED (design-sanctioned); LOW-4 + LOW-5 → DEFERRED-014;
    COSMETIC-6 (unbounded text) ACCEPTED (consistent with the codebase).
  Production files reverted byte-for-byte after the test-only fix.

## AC coverage
QC's 14/14 COVERED confirmed coherent; Scope Guard spot-checked AC3 (submit materializes
frozen steps + emits `request.submitted`), AC8 (guarded `for_review→final|working` advance +
`request.resolved`), AC9 (escalation climb + `request.step_escalated`) — all confirmed.

## Deferred items
DEFERRED-013 (trigger 15.4/15.5), DEFERRED-014 (trigger 15.6 / `requests.ts` edit),
DEFERRED-012 (trigger 15.5), and DEFERRED-011/010/009/008/003 — **no OPEN item has a
trigger condition met by this sprint's work.**

## Independent evidence (Scope Guard re-ran)
`npm run build` — exit 0, clean. `npm test` — exit 0; 414 tests, 414 pass, 0 fail, 0 skipped.

## Verdict: CLEAR

The sprint may proceed to SESSION + COMMIT.

---

## Main-session note — the one non-blocking cosmetic observation

The Scope Guard flagged a possible imprecise comment at `coordinationSweep.test.ts:552`.
Main examined `coordinationSweep.test.ts:505-573`: the comment at line 552 — "Good step must
have been escalated (coordination → authority)" — is **accurate**. Both T20 steps are seeded
by `mkTopicWithStalledStep(name, 'execution')`, which produces a request whose stalled step 0
has `target_office='coordination'` (dispositively confirmed by the *passing* assertions: line
557 asserts the good step ends at `authority` after one climb, and line 564 asserts the
unchanged bad step is at `coordination`). The good step therefore climbs `coordination →
authority` exactly as the comment says. No comment in the test reads "bad step's coordination".
The Scope Guard's note was a misread of the seeding helper; **no change made** — the test's
comments and assertions are all correct.
