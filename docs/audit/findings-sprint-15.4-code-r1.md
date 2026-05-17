# Sprint 15.4 — REVIEW-CODE round 1 — `/review-impl` cold review

**Phase:** REVIEW-CODE (7/12). **Mode:** v2.2 — main-session review with the `/review-impl`
framing (coverage gaps / drift risk / adjacent correctness). **Cold review** — the BUILD was
done by a fresh subagent, so this is a genuine no-author-blindness pass.
**Reviewed:** `migrations/0057_collective_decision.sql`, `src/services/decisionBodies.ts` +
`.test.ts`, `src/services/motions.ts` + `.test.ts`, `src/services/coordinationSweep.ts` (the
`sweepExpiredMotions` addition) + `.test.ts`, `src/api/routes/motions.ts` + `.test.ts`, against
DESIGN rev 2 (hash `a12f419578588e6d`).
**Verdict:** **OK** — 0 HIGH, 0 MED, 5 LOW. LOW-5 fixed inline; LOW-1/2/3/4 accepted +
documented.

## Stage 1 — spec compliance: PASS

The code implements DESIGN rev 2 faithfully. Spot-verified the contract-critical points:
`tallyMotion` rejects `now() < deadline` → `balloting_open` (BLOCK-1); the §4 tally is the
single Postgres-`NUMERIC` `FILTER`-aggregate statement; `castVote` snapshots the principal's
`body_members.vote_weight` onto `votes.weight`; `proposeMotion` rejects a cross-project body
→ `body_not_found` (the 15.3.1 F3a id-probing defense); the window model (`castVote`
pre-deadline / `vetoMotion` whole-balloting / `tallyMotion` post-deadline) is implemented; the
sweep is the third entity in the one advisory-lock cycle; `createBody`/`addBodyMember` are
NOT auth-gated (the §0.5 coordinator-trusted posture — correctly preserved); GET routes use
`requireRole('reader')`. No spec drift.

## Findings

### LOW-1 — `tallyMotion`/`sweepExpiredMotions` round-trip `quorum`/`threshold` through `Number()`
`motions.ts` reads `quorum`/`threshold` via `Number(bodyRes.rows[0].…)` and passes the JS
numbers to `aggregateVotes` as the `$2`/`$3` params; `castVote` correctly passes the raw
`vote_weight` *string* straight to the `votes` INSERT. The §4 *comparison* itself
(`f >= $3 * (f+a)`) is exact Postgres `NUMERIC`, and for any realistic threshold (`0.5`,
`0.667`, `0.75`) the `Number()` round-trip is exact — JS `Number.prototype.toString` emits the
shortest round-tripping decimal, so `0.6` → `"0.6"` → `NUMERIC 0.6`. Precision would erode only
for a threshold with > ~16 significant digits — absurd for a voting rule. **Disposition:
accept + document** — cosmetic; no practical impact; the design's "never JS float" is honored
where it matters (the comparison). A future touch could pass the raw NUMERIC strings (the
`castVote` pattern) for literal end-to-end exactness.

### LOW-2 — `castVote` deadline check is a separate query; `tallyMotion` inlines it
`castVote` runs `SELECT (now() >= $1::timestamptz)` as a second statement; `tallyMotion`
inlines `(now() >= deadline) AS expired` in the locked `SELECT … FOR UPDATE`. Functionally
identical — both run under the held `motion … FOR UPDATE` lock and use transaction `now()`.
**Disposition: accept + document** — cosmetic; recommend `castVote` inline the check on the
next touch of `motions.ts`.

### LOW-3 — `decision_bodies.veto_holders` has no array-length / element-length cap
`createBody` validates `veto_holders` as "an array of non-empty strings" but bounds neither
the array size nor element length (cf. the 15.3.1 F7 256-char cap on `kind`/`subject_id`, and
15.3.1 LOW-5 — the `submitted_by`/`actor_id` cap, which was *deferred*). A giant `veto_holders`
array is self-inflicted config under the §0.5 coordinator-trusted posture — input hygiene, not
a forgery vector. **Predicted at REVIEW-DESIGN round 2.** **Disposition: accept + document** —
folded into a deferred item at SESSION (the 15.3.1 LOW-5 precedent — the analogous cap was
deferred, not fixed inline).

### LOW-4 — a malformed-UUID path param yields a 500, not a clean 400
`secondMotion`/`castVote`/`vetoMotion`/`tallyMotion`/`proposeMotion` `SELECT … WHERE
motion_id=$1` / `body_id=$1` against a `UUID` column; a non-UUID id → Postgres `22P02`, a raw
(non-`ContextHubError`) throw → the global handler → HTTP 500. This is the **identical
pre-existing pattern** in 15.3 (`getRequest`, `decideStep` — `request_id` UUID). **Disposition:
accept + document** — consistency with 15.3; a clean-400 UUID guard is a project-wide change
out of 15.4's scope (DEFERRED-014-class).

### LOW-5 — coverage gap: no test that a proxy-cast ballot is *counted* in a tally — **FIXED INLINE**
`motions.test.ts` T7 proved the proxy *row* shape (principal-keyed, `proxy_for` set, event
actor = holder); T8's tally tests used only *direct* votes. Invariant 4 ("a proxy ballot
counts; each principal once") was row-level-tested but **not tally-level-tested** — a
regression to the §4 query (e.g. an erroneous `WHERE proxy_for IS NULL`) would pass every
test. **Fixed inline** (the 15.3.1 LOW-2 precedent — a missing test fixed in REVIEW-CODE): added
`T8: tallyMotion counts a proxy-cast ballot at the principal weight` — voterA votes directly
(weight 6), voterB votes by proxy (weight 4); asserts `tally.for == 10` and
`participating == 10`. `motions.test.ts` re-run: **51/51** (was 50). Full suite → 524.

## What was checked and is sound (the `/review-impl` non-rubber-stamp evidence)

- **The tally invariant proofs are genuine, not happy-path.** T8's weight-snapshot test casts
  at weight 7, then `addBodyMember` re-weights the voter to 1, and asserts the tally still
  uses 7 — it genuinely proves §4 sums `votes.weight`, never re-joins `body_members`. The
  all-abstain test asserts `base == 0`. The tie test asserts `0.5` carries.
- **Ballot mutual exclusion** — T9 tests both directions (vetoed-then-tally, tallied-then-veto
  → `not_balloting`). Sequential (the status-guard half); the concurrent-race half rests on
  the `motion … FOR UPDATE` design argument — consistent with 15.3 (`decideStep` had no
  `Promise.all` race test either).
- **The sweep crash-isolation test (T11d) is genuine** — it plants a real `23505` PK collision
  on the bad topic's `coordination_events` (the reworked-T20 technique), so the bad motion's
  per-motion transaction actually throws inside the try-block and drives the §0.1-loop catch;
  the good motion still resolves. NOT the vacuous WHERE-filter mistake the original 15.3 T20
  made.
- **Proxy double-count** — the principal-keyed PK `(motion_id, actor_id)` makes a principal's
  ballot exactly one row; LOW-5's new test confirms the proxy row is summed.
- **The §10 lock order** — every motion txn locks `motion … FOR UPDATE` before `appendEvent`
  touches `topics`; `decision_bodies`/`body_members` are plain reads. Verified against the
  code: no ABBA.
- **tsc exit 0; `npm test` 523→524 green; live smoke 11/11** (incl. the BLOCK-1 fix exercised
  live).

## Verdict

**OK** — 0 HIGH, 0 MED, 5 LOW. LOW-5 fixed inline (51/51); LOW-1/2/4 cosmetic /
pre-existing-pattern, accepted; LOW-3 (the `veto_holders` cap) → a deferred item at SESSION.
None blocks. → QC.
