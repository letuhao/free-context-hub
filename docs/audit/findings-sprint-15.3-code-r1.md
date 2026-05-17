# Sprint 15.3 REVIEW-CODE — /review-impl findings (round 1)

**Phase:** REVIEW-CODE · **Round:** 1 · **Framing:** `/review-impl` (coverage gaps / input-trust / boundary drift / test quality — per the longrun calibration note, deliberately not a concurrency pass)
**Agent:** cold-start adversarial implementation reviewer (general-purpose, opus)
**Reviewed:** the Sprint 15.3 implementation (migration 0056; `doaMatrix.ts`, `requests.ts`, `coordinationSweep.ts` additions; `routes/requests.ts`; 4 MCP tools; wiring) against design rev 3 + the 14 CLARIFY ACs.
**Verdict:** FINDINGS — 0 HIGH, 2 MED, 3 LOW, 1 COSMETIC.

> Persisted by the main session — the reviewer sub-agent returned these findings in its
> final message (the harness blocks sub-agent writes under `docs/audit/`).

## Coverage checks the reviewer ran and confirmed PASS

- **Self-approval (inv. 8):** `decideStep` rejects `actorId === submittedBy` after the participant check — tested; no bypass (a submitter is always a participant; no `leaveTopic` exists).
- **`weight` bound (B4):** rejected non-integer / `<0` / `>2147483647` pre-`connect()` — tested at the service (T12) and REST (400) layers.
- **Route freeze (inv. 1):** `doa_snapshot` frozen on `request_steps`; `decideStep`/`sweepStalledSteps` never re-read `doa_matrix` — tested.
- **Escalation convergence (inv. 4):** `execution→coordination→authority` then terminal — correct, in-bounds.
- **Lock order:** `decideStep` and `sweepStalledSteps` both prefix-consistent with the global order; closed-topic mid-transaction race handled by `appendEvent`'s seal.
- **`submitRequest` connection lifecycle:** validation throws pre-`connect()`; the `no_route` early return is pre-`BEGIN` — no client leak, no dangling transaction.
- **MCP output schemas:** all four tools use flat `z.object` (no `z.discriminatedUnion`) — DEFERRED-007 respected.
- No SQL-injection / parameterization gap; `resolveArtifact`'s `artifact_versions` INSERT names all seven columns (B2 confirmed).

## Findings

### 1 — [MED] No test for the `resolveArtifact` 0-row best-effort path
`src/services/requests.ts:287-290`. Design invariant 5 / §3.3: approving/returning a request whose subject artifact is *not* in `for_review` must still resolve the request, emit `artifact_advanced:false`, and append no `artifact_versions` row / no artifact event. `requests.test.ts` covers the 1-row approve and return paths but **no test exercises the 0-row branch** — the most fragile path (a refactor turning the guarded `UPDATE` unconditional would pass the whole suite). **Fix:** add a test — submit a request whose subject artifact is not in `for_review`, endorse to approval, assert `request.status='approved'`, `request.resolved` payload `artifact_advanced===false`, and `artifact_versions` row count unchanged.

### 2 — [MED] T20 "crash isolation" test does not exercise the catch-and-continue path
`src/services/coordinationSweep.test.ts` (T20). The test sets the bad request to `status='approved'`, but the sweep scan filters `WHERE r.status='open'`, so an `approved` request is excluded from the scan and never enters the per-step loop — and the re-check inside the loop is a clean `ROLLBACK; continue`, not a caught exception. So T20 proves "a non-open request is skipped", not "a throwing step does not abort the batch". The `§0.1-loop` catch in `coordinationSweep.ts` has **zero coverage**. **Fix:** mirror T17 (`sweepAbandonedClaims` crash isolation) — force a genuine thrown error inside the stalled-step transaction, assert the good step in the same batch still escalates.

### 3 — [LOW] The `'conflict'` DecideResult variant is unreachable dead code
`src/services/requests.ts:59` (type) / `:402-405` (producer) / `routes/requests.ts` (409 map). `conflict` is returned only on a step-row `rowCount===0` or `status!=='pending'` — both unreachable: an out-of-range `step_index` is pre-empted by `not_current_step`; the current step's row always exists and is always `pending` under the `requests FOR UPDATE` + `status='open'` invariant. The design §3.2 labels it "defensive". **Disposition: ACCEPT** — design-sanctioned defensive code, harmless; documented here.

### 4 — [LOW] `listRequests` does not check topic existence (inconsistent with 15.2 `listBoard`)
`src/services/requests.ts:627-660`. `GET /api/topics/<unknown>/requests` → `200 {requests:[]}`, whereas `getRequest` returns 404 and the 15.2 sibling `listBoard` has an explicit topic-existence check (`[LOW-7]`) → `NOT_FOUND`. **Disposition: DEFER → DEFERRED-014** — the code matches design §3.4; the REVIEW-DESIGN round-3 Adversary already judged this "defensible, not worth a finding".

### 5 — [LOW] `request.resolved` event payload shape varies across outcomes
`requests.ts` approve/return emit `{outcome, artifact_advanced}`; reject (`requests.ts`) and `escalation_exhausted` (`coordinationSweep.ts`) emit `{outcome}` only. Each line matches its design section — not code-vs-design drift, but an avoidable non-uniformity in the AC11 authoritative log. **Disposition: DEFER → DEFERRED-014** — changing it would deviate from the reviewed design contract.

### 6 — [COSMETIC] Unbounded free-text fields
`requests.ts` — `kind`/`subject_id`/`submitted_by`/`topic_id`/`actor_id` are `.trim()`'d + non-empty-checked but not length-bounded. The reviewer concluded **no fix needed**: none are key segments (unlike `board.ts`'s `[LOW-8]` `slot`, which bounds it precisely *because* `slot` is part of the derived `artifact_id` PK), and 15.1's `charterTopic`/`joinTopic` likewise do not bound their text — so this is *consistent with the shipped codebase*, not a regression. **Disposition: ACCEPT** — flagged only for completeness; in scope if the project later adopts a blanket text-length policy.

## Verdict: FINDINGS — 0 HIGH, 2 MED, 3 LOW, 1 COSMETIC

---

## Resolution — main session

- **MED 1, MED 2 → FIXED.** Both are test-coverage gaps on explicitly-claimed invariants; the fix is test-only (no production-code / contract change). Two tests added/reworked via a dispatched fix-up agent; each verified to genuinely fail if its invariant breaks. Re-VERIFY confirms the suite green.
- **LOW 3, COSMETIC 6 → ACCEPTED.** LOW-3 is design-sanctioned defensive code; COSMETIC-6 is consistent with the shipped codebase (the reviewer itself said no fix needed). No action.
- **LOW 4, LOW 5 → DEFERRED-014.** Both are "the 3-round-reviewed design contract could be marginally more consistent" — fixing them in REVIEW-CODE would deviate from the reviewed contract without re-running REVIEW-DESIGN. Bundled for a future touch of the requests surface (trigger: Sprint 15.6, or any edit to `requests.ts` / the event schema).

No HIGH/BLOCK finding → no REVIEW-CODE round 2 required (the MED fixes are test-only and cannot regress production behavior). Proceed to QC after re-VERIFY.
