# Sprint 15.4 — REVIEW-DESIGN round 1 — main-session adversarial self-review

**Phase:** REVIEW-DESIGN (3/12). **Mode:** v2.2 default — main-session self-review with
explicit adversarial + security framing ("if you wanted to forge a carried motion, where would
you look?"). **Reviewed:** DESIGN rev 1 (`docs/specs/2026-05-18-phase-15-sprint-15.4-design.md`,
hash `f8b92211c3281d44`).
**Verdict:** **REJECTED** — 1 BLOCK + 2 WARN. → DESIGN rev 2, then review round 2.

## BLOCK-1 — Early-tally forgery: `tallyMotion` has no deadline gate

**Where:** §3.5 `tallyMotion`, §6 (`POST /api/motions/:id/tally`, `requireRole('writer')`).

**What's wrong.** `tallyMotion` is callable by **any `writer`-role caller at any moment while
the motion is `balloting`** — there is no check that the ballot window has closed. A proposer
can: propose → have a confederate second → cast their own `for` vote → immediately call
`tallyMotion` **before the opposition has voted**. The §4 query snapshots only the votes cast
so far; with `quorum` met by the proposer's own weight and `base = for` (no `against` yet), the
motion resolves **`carried`**.

This is **not** inside the §0.5 coordinator-trusted residual. §0.5 covers *body / membership /
veto / proxy creation*. The early tally works between **legitimate, mutually-distrusting body
members** — every actor is a real member with a real weight; the forgery is purely the *timing*
of the tally call. A motion is supposed to be decided by the *body*, over the *ballot window*;
rev 1 lets one member decide it the instant they have a transient lead.

**Fix (rev 2).** `tallyMotion` rejects `now() < deadline` → `{status:'balloting_open'}` (HTTP
409). A ballot is tallied **only after its `deadline`** — by an on-demand `tallyMotion` call
(immediacy: get the result now rather than waiting up to 5 min for the sweep) **or** by the
sweep (automatic). This is faithful to master C.2 ("tally — or automatic at deadline"). The
window model becomes explicit and is documented in §3.5 + an invariant:

| Operation | Allowed window |
|---|---|
| `castVote` | `status='balloting'` ∧ `now() < deadline` |
| `vetoMotion` | `status='balloting'` (the entire live window — master B.6 "while balloting") |
| `tallyMotion` / the sweep | `status='balloting'` ∧ `now() ≥ deadline` |

Veto and tally remain mutually exclusive — both take `motion … FOR UPDATE` and re-check
`status='balloting'`; their windows overlap only post-deadline, where the row lock serializes
them. Consequence for the §9 test plan + AC13: a live-smoke / unit tally requires a
past-`deadline` motion — the smoke sets `deadline` into the past via direct SQL (the 15.3
escalation-smoke precedent).

## WARN-1 — The electorate is not frozen at `second`

**Where:** §3.2 `secondMotion`, §3.3 `castVote`, D7, §0.5.

**What's wrong.** rev 1 snapshots `vote_weight` per *cast* (D7) but never snapshots *membership*
per *motion*. A `body_members` row **added (or re-weighted) while a motion is `balloting`**
affects that in-flight motion — a member added after `second` can `castVote` on it. The honest
self-review must say so: §0.5 calls out *creation-time* self-dealing but is silent on
*mid-ballot* membership mutation.

**Fix (rev 2).** Document it honestly rather than build a freeze (the master does not mandate a
motion-electorate snapshot, and a live electorate is consistent with the coordinator-trusted
posture — ungated membership *is* DEFERRED-015-family). §0.5 gains a bullet: "the electorate is
**live, not frozen** — a `body_members` change during `balloting` affects the in-flight motion;
`vote_weight` is snapshotted per-cast (D7), membership is not snapshotted per-motion; both are
within the coordinator-trusted residual." An invariant records it. A motion-electorate freeze
is noted as a future enhancement, not a 15.4 deliverable.

## WARN-2 — Threshold tie semantics under-documented

**Where:** §4 (the tally query + outcome table), CLARIFY Q6.

**What's wrong.** §4's carry test is `for ≥ threshold · (for+against)`. The `≥` is **correct
and necessary** — it is what makes `threshold = 1` (unanimity) reachable (`for ≥ 1·base` ⇔
`against = 0`). But the *consequence* is unstated: at `threshold = 0.5` an exact tie
(`for == against`) **carries** (`5 ≥ 0.5·10`). A reader expecting "ordinary majority `>50%`"
(master B.6) would be surprised — rev 1 implements "`≥` the threshold fraction," i.e. a tie at
0.5 carries.

**Fix (rev 2).** §4 explicitly documents the **inclusive-threshold** semantics: `carried` iff
`for ≥ threshold·base`; `threshold` is the *inclusive minimum* `for`-fraction; at
`threshold = 0.5` a tie carries; `threshold = 1` is unanimity (exact, by virtue of `≥`); a body
wanting a strict supermajority sets `threshold` accordingly. No code change — a documentation
completeness fix on a correct, deterministic mechanism.

## What was checked and is sound (so this is not a rubber-stamp)

- **Ballot mutual exclusion** — `castVote`/`tallyMotion`/`vetoMotion`/sweep all take `motion …
  FOR UPDATE` first; serialized on the motion row; the post-lock `status` re-check is the guard
  (stronger than master C.2's lock-free CAS). Verified no TOCTOU.
- **Proxy double-count** — principal-keyed PK `(motion_id, actor_id)`; a holder casting own + N
  proxied ballots = N+1 distinct rows; §4 sums rows; `proxy_for` never enters the count. The
  *principal* (not the holder) is the `body_members` membership check. Sound.
- **§10 lock order** — `… → motion → vote → topics`; 15.4's lock set `{motion,vote,topics}` is
  disjoint from 15.2/15.3's except `topics` (always last); the three sweeps run sequentially.
  No ABBA — verified exhaustively.
- **§4 NUMERIC arithmetic** — computed in one Postgres statement; node-pg sends the
  `quorum`/`threshold` params with unspecified OID, Postgres infers `numeric` from
  `param * numeric` / `numeric >= param` context — no float drift, no `text*numeric` error.
  (Rev 2 may add explicit `::numeric` casts for clarity, not correctness.)
- **All-abstain / no-votes tally** — the `(f+a) > 0` guard makes `carried` false without a
  divide; `participating ≥ quorum` decides `lapsed` vs `failed`. Both terminating.
- **Sweep convergence** — terminal statuses are outside the scan predicate; one tick resolves.
- **Cross-project integrity** — `proposeMotion` requires `body.project_id == topic.project_id`
  → `body_not_found` (the 15.3.1 F3a id-probing defense). Sound.

## Verdict

**REJECTED** — BLOCK-1 (early-tally forgery) is a genuine governance hole that the rev-1 design
missed; it must be closed before BUILD. WARN-1 + WARN-2 are honesty / documentation-completeness
gaps. → DESIGN **rev 2** folds all three; then REVIEW-DESIGN **round 2** re-reviews.
