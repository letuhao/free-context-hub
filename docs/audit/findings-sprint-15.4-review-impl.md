# Sprint 15.4 — /review-impl — adversarial implementation review (coverage / drift)

**Phase:** POST-REVIEW (9/12) — `/review-impl` invoked by the user at the POST-REVIEW
checkpoint, the separate coverage-gap mental mode that REVIEW-CODE and the POST-REVIEW Adversary
deliberately do not run.
**Scope:** the uncommitted Sprint 15.4 changes (13 files).
**Verdict:** 1 MED + 1 LOW + 2 COSMETIC — **all 4 fixed** (user: "fix all issues").

## Findings + disposition

### MED-1 — `veto_holders` stored un-trimmed; a whitespace-padded veto holder silently cannot veto — **FIXED**
`decisionBodies.ts` `createBody` trim-*validated* each `veto_holders` element
(`v.trim().length === 0`) but stored the array **raw**; `vetoMotion` trims the incoming
`actor_id`, then `veto_holders.includes(actorId)`. A body created with `veto_holders:[" alice "]`
stored `" alice "`; `vetoMotion({actor_id:"alice"})` → `[" alice "].includes("alice")` → false →
`not_veto_holder` — the configured veto holder was **silently disabled**. Every other actor
field in the sprint (`created_by`, `addBodyMember.actor_id`, `proposed_by`, `castVote`/
`vetoMotion.actor_id`) is trimmed-and-stored — `veto_holders` was the lone inconsistency, and
no test used a whitespace entry. Fails safe (a dead veto just lets the motion tally normally —
no forgery), so not a security HIGH; a real latent correctness bug.
**Fix:** `createBody` now `vetoHolders.map((v) => v.trim())` before the INSERT. **TDD:** the
new `motions.test.ts` T9 whitespace test was confirmed **RED** against the un-trimmed code
(`not_veto_holder` ≠ `vetoed`), then **GREEN** after the fix. `motions.test.ts` 51 → 54.

### LOW-2 — the 11 MCP tools were tsc-verified but never invoked — **FIXED**
The VERIFY live smoke exercised the REST API only; no test or smoke ever called `tools/call`
on a 15.4 MCP tool — a registration / arg-mapping / output-schema bug would have been invisible
(cf. DEFERRED-007). 15.4 uses the flat-`z.object` pattern that *fixed* DEFERRED-007, so that
crash cannot recur — but the coverage was genuinely absent.
**Fix:** an MCP-transport smoke (`tools/call` via the `@modelcontextprotocol/sdk` streamable-HTTP
client) — `tools/list` confirms all 11 Sprint 15.4 tools registered, and 8 are exercised
end-to-end through the MCP transport (`charter_topic`/`join_topic`/`create_decision_body`/
`add_body_member`/`propose_motion`/`second_motion`/`cast_vote`/`get_motion`) incl. the BLOCK-1
gate (`tally_motion` pre-deadline → `balloting_open` over MCP). **9/9** on the rebuilt stack.
(`get_motion` returns `{status:'ok', motion:{…}}` — the 15.1 `get_topic` shape; a flat
`z.object` with a nested object field, DEFERRED-007-safe — confirmed correct, not a finding.)

### COSMETIC-3 — `deadline_minutes` boundary not asserted — **FIXED**
`motions.test.ts` T5 tested `deadline_minutes` out-of-range (1, 999999) + fractional (10.5) but
never asserted exactly `5` (MIN) / `43200` (MAX) are *accepted*. **Fix:** added the
boundary-accepted test.

### COSMETIC-4 — `getMotion` never tested returning a populated `tally` — **FIXED**
`motions.test.ts` T10 tested `getMotion` only on a `balloting` motion (`tally` null). **Fix:**
added a test — tally a motion, then `getMotion` round-trips a populated `tally` JSONB.

## What was checked and found sound

Every input field on all 7 service fns (trim / persist — sound except `veto_holders`, MED-1);
the vote-weight snapshot (genuinely proven — T8 casts at 7, re-weights to 1, tally still 7);
idempotence (`castVote`/`addBodyMember` `ON CONFLICT` — tested); the `appendEvent` boundary
(all five 15.4 event types + `motion` subject in the catalog); the sweep-scan-throw boundary
(the scheduler `cycle` catch absorbs it + reschedules); the new `coordinationSweep → motions`
import (no cycle); the §10 lock order in every transaction.

## Re-VERIFY (the fixes loop back to the evidence gate)

- `tsc` exit 0.
- `npm test` **527/527** (524 + 3 new `motions.test.ts` tests). `motions.test.ts` 54/54,
  `decisionBodies.test.ts` 19/19.
- `mcp`+`worker` Docker images **rebuilt on the final code**; MCP-transport smoke **9/9**;
  the REST smoke was 11/11 at the first VERIFY (routes unchanged by the review-impl fixes — the
  fix is in the shared `createBody` service, re-proven by the post-rebuild MCP smoke + the 527
  suite).

The spec fingerprint is **unchanged** — the review-impl fixes touched `decisionBodies.ts` (code)
and `motions.test.ts` (tests) only; DESIGN rev 2 (`a12f419578588e6d`) was not edited, no drift.
QC AC coverage only grew (the 3 new tests). AC12's count updates 524 → 527.

## Disposition

All 4 findings **fixed and re-verified**. No deferred residual from this pass — the
review-impl-found gaps are closed, not deferred. → the POST-REVIEW human checkpoint.
