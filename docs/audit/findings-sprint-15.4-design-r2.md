# Sprint 15.4 — REVIEW-DESIGN round 2 — main-session adversarial self-review

**Phase:** REVIEW-DESIGN (3/12), round 2. **Mode:** v2.2 — main-session self-review.
**Reviewed:** DESIGN rev 2 (`docs/specs/2026-05-18-phase-15-sprint-15.4-design.md`, hash
`a12f419578588e6d`).
**Verdict:** **ACCEPTED** — the 3 round-1 findings are resolved with no regression; 0 new BLOCK,
0 new WARN, 1 LOW noted for REVIEW-CODE. → PLAN.

## Round-1 findings — verified resolved

- **BLOCK-1 (early-tally forgery) — RESOLVED.** §3.5 `tallyMotion` now reads `deadline` in the
  `FOR UPDATE` row and rejects `now() < deadline` → `{balloting_open}`. The window-model table
  (§3.5) + §11 inv. 2 make it explicit: `castVote` = `balloting ∧ pre-deadline`; `vetoMotion` =
  `balloting` (any); `tallyMotion`/sweep = `balloting ∧ post-deadline`. §6 maps `balloting_open`
  → 409; §9 covers the pre-deadline-tally test; §12 item 8 records the closure.
  **Why the fix is sound:** post-deadline the vote set is *frozen* (`castVote` rejects
  `now() ≥ deadline`), so a post-deadline tally is **deterministic** — every caller gets the
  same result regardless of timing. The forgery depended on tallying a *mutable* (pre-deadline)
  vote set; freezing the set before the tally removes the lever. No liveness regression: a
  `balloting` motion always resolves within `deadline + ≤5 min` (on-demand tally or the sweep).
- **WARN-1 (electorate not frozen) — RESOLVED.** §0.5 gains the "the electorate is live, not
  frozen" bullet; §11 inv. 11 records it. Honest, consistent with the coordinator-trusted
  posture; no overclaim.
- **WARN-2 (threshold tie semantics) — RESOLVED.** §4 gains the "inclusive-threshold semantics"
  paragraph — `for ≥ threshold·base`; `≥` is required for `threshold=1` unanimity to resolve;
  a tie carries at `threshold=0.5`; supermajority is the body's `threshold` choice.

## Re-walk — "forge a carried motion" on rev 2

No new vector. The early-tally lever is closed (a post-deadline tally is deterministic over a
frozen vote set). Body / membership / proxy-grant self-dealing remain the **§0.5
coordinator-trusted residual** — correctly scoped, not overstated, owned by a deferred item
(filed at SESSION, the DEFERRED-015/016 HARD-trigger family). The sweep is `system`-driven (no
caller controls its timing). Veto spanning the post-deadline-pre-sweep window is intentional
and documented (master B.6 "while balloting"); a veto holder acting is legitimate, not a
forgery. The round-1 fixes introduced no regression — verified the `castVote` (`≥deadline`
reject) / `tallyMotion` (`<deadline` reject) boundary is gap-free and non-overlapping at the
exact deadline instant.

## LOW noted for REVIEW-CODE (not blocking)

- **LOW — `decision_bodies.veto_holders` has no explicit array-length / element-length cap.**
  §2.1 validates `veto_holders` as "an array of non-empty strings" but sets no bound on the
  array size or element length (cf. the 15.3.1 F7 `kind`/`subject_id` 256-char cap, and
  15.3.1 LOW-5 — the `submitted_by`/`actor_id` cap, accepted+deferred). A giant array is
  self-inflicted config under the coordinator-trusted posture — not a forgery vector, an input
  hygiene gap. Disposition: note it for the REVIEW-CODE `/review-impl` pass to judge (the
  15.3.1 LOW-5 class — a small `≤N entries, each ≤256` cap, or accept+document).

## Verdict

**ACCEPTED.** REVIEW-DESIGN closes at round 2 (BLOCK-1 + 2 WARN resolved in rev 2, 0 new
BLOCK/WARN — the review→fix loop terminates, the 15.3.1 r2-ACCEPTED precedent). Design FINAL =
rev 2, spec hash `a12f419578588e6d` (the POST-REVIEW / QC fingerprint). → PLAN.
