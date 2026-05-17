# Sprint 15.4 — POST-REVIEW — cold-start security Adversary (the guardrail gate)

**Agent:** cold-start security-framed reviewer (general-purpose, opus) — the guardrail-mandated
security review (lesson `5c0b7b25`: a governance primitive requires a security-framed
cold-start adversarial review). Sprint 15.4 ships exactly that — decision bodies, weighted
motions, votes, a quorum/threshold tally, a veto.
**Reviewed:** the shipped 15.4 implementation vs DESIGN rev 2 (`a12f419578588e6d`) + the CLARIFY
spec + the prior review record.
**Verdict:** **CLEAR** — no subversion path, no scope overclaim; 0 BLOCK, 1 WARN.

> Persisted by the main session — the sub-agent returned findings in its final message.

## §0.5 honest-scope claim — **ACCURATE AS IMPLEMENTED**

The Adversary verified all three required properties of DESIGN §0.5:
- **(a) The code behaves as §0.5 describes** — live-confirmed: `createBody` ungated;
  `addBodyMember` ungated (any actor, any weight); a member added mid-`balloting` voted on the
  in-flight motion; `castVote(proxy_for=X)` recorded the holder without verifying a grant.
- **(b) §0.5 does not overstate what IS closed** — the "what 15.4 does guarantee" list (exact
  quorum/threshold §4, the atomic ballot FSM §3.3–3.5, the cross-project guard, the complete
  replayable log) is all true; no "complete authorization" overclaim (the 15.3.1 design-rev-1
  BLOCK class is avoided).
- **(c) §0.5 does not understate** — no unnamed residual; the one residual not given its own
  bullet (the ungated `proposeMotion` participant gate) is transitively owned via §0.5's
  DEFERRED-015 reference + CLARIFY A3 → WARN-1, not a BLOCK.

## Attacks run — all defended (live, against the deployed stack)

1. **Early-tally forgery** (REVIEW-DESIGN BLOCK-1) — `balloting_open` (409); genuinely closed —
   `tallyMotion` rejects `now() < deadline` (`motions.ts:661-678`).
2. **Post-deadline determinism** — `castVote` rejects `now()>=deadline`, so the vote set is
   frozen before any tally; a post-deadline tally is deterministic.
3. **Non-member vote** — `not_member` (the membership check is on the principal).
4. **Caller forges vote `weight`** (body `weight:9999`) — ignored; the stored row carried the
   server-snapshotted `body_members.vote_weight`. The route extracts only
   `actor_id`/`choice`/`proxy_for`.
5. **Double-vote / change a cast ballot** — `already_voted` (PK + `ON CONFLICT DO NOTHING`).
6. **Non-veto-holder veto** — `not_veto_holder`.
7. **Proxy double-count** — a holder casting twice for one principal → `already_voted`; the
   principal-keyed PK makes a principal exactly one row carrying the *principal's* weight;
   `aggregateVotes` has no `WHERE proxy_for IS NULL` — `proxy_for` is audit-only (LOW-5 closure
   re-verified).
8. **Proxy holder votes as a non-member principal** — `not_member`.
9. **Veto / tally race** — 5 concurrent tallies + 1 veto on one motion → exactly one committed,
   the other 5 → `not_balloting`; one terminal status, no corruption (`motion … FOR UPDATE`).
10. **Cross-project body↔topic** — `body_not_found` (no 500, no id-probe leak; the 15.3.1 F3a
    pattern).
11. **Veto a `proposed` (non-balloting) motion** — `not_balloting` (D6).
12. **Tally arithmetic** — `threshold=1` unanimity resolves; all-abstain base=0 → `failed` (no
    divide-by-zero); weights summed in Postgres NUMERIC; the `Number()` round-trip of realistic
    thresholds is exact.

Statically verified: the lock order `motion → vote → topics` holds in every transaction (no
ABBA); `tallyMotion` + `sweepExpiredMotions` share the one `computeMotionTally` (the §4 single
source of truth); the sweep's closed-topic branch locks `topics … FOR UPDATE` and skips; the
crash isolation (T11d) plants a real `23505`; the vote-weight snapshot is genuine (T8).

## WARN-1 — §0.5 does not explicitly enumerate the ungated `proposeMotion` participant gate

`proposeMotion`'s `not_participant` gate (`motions.ts:297-303`) is the only authorization-like
check on *who may propose*, but under the coordinator-trusted posture it provides no real
barrier — `joinTopic` is itself ungated (the 15.1 substrate; live-confirmed a caller
self-joined at `level:'authority'`), so any caller satisfies the gate. §0.5's four bullets do
not name this; it is **transitively owned** (§0.5 references "the same class as DEFERRED-015 —
self-declared participant `level`", and DEFERRED-015 *is* the ungated-topic-participation item;
CLARIFY A3 states motion authorization is coordinator-trusted). The residual is **owned, not
missed** → WARN, not BLOCK.

**Disposition (non-blocking, accepted).** Sharpen §0.5 with one sentence — "the `proposeMotion`
topic-participant gate is itself satisfiable by any caller (`joinTopic` is ungated,
DEFERRED-015); it provides provenance, not authorization." The DESIGN doc is the
QC-fingerprinted rev-2 contract — it is **not** edited post-QC (that would be spec drift); the
sharpening is recorded here and folded into the SESSION deferred item that owns the §0.5
authorization residual.

## Carried-forward LOWs — confirmed non-blocking

- **LOW-3** (`veto_holders` array uncapped) — self-inflicted config under the coordinator-trusted
  posture; not a forgery vector. Routed to a SESSION deferred item.
- **LOW-4** (malformed-UUID param → 500) — pre-existing project-wide pattern (15.3 identical);
  not a 15.4 regression.

## Verdict

**CLEAR.** The authorization model is sound for what it claims — the mechanism (quorum /
threshold / veto / weight-snapshot / the atomic FSM) cannot be subverted by a
mutually-distrusting body member; the early-tally lever (BLOCK-1) is genuinely gone — and
honestly scoped for what it does not close — body / membership / veto / proxy / electorate
creation is coordinator-trusted, owned by a HARD-trigger deferred item, with no overclaim.
AC14 (guardrail `5c0b7b25`) is satisfied. WARN-1 is a one-sentence doc sharpening. → SESSION.
