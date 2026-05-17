# Sprint 15.3.1 — POST-REVIEW — cold-start security Adversary (final gate)

**Agent:** cold-start security-framed reviewer (general-purpose, opus) — the guardrail-mandated
security re-review (lesson `5c0b7b25`).
**Reviewed:** the shipped 15.3.1 implementation vs the 15.3 security audit + DESIGN rev 3.
**Verdict:** **CLEAR** — all 5 in-scope findings genuinely + traceably closed; 0 BLOCK, 2 WARN.

> Persisted by the main session — the sub-agent returned findings in its final message.

## Per-finding closure (verified against the code)

- **F1 — CLOSED.** The body-string forgery (submit-as-`alice`, decide-as-`bob`, one writer
  key) collapses: `bearerAuth` stamps one fixed `apiKeyName` per key; `resolveActorIdentity`
  forces `submitted_by` and `actor_id` to that same string (mismatching body → 403
  `IDENTITY_MISMATCH`); `decideStep`'s B1 self-decision guard then fires
  (`actorId === submittedBy → self_decision_forbidden`). The DESIGN §0.5 honest-scope claim
  is **accurate as implemented** — F1 closes exactly the identity-spoofing half on the
  DB-key path; auth-off / env-token / key-multiplicity remain, correctly owned by
  DEFERRED-015/016. Writer-gate precondition (`requireRole('writer')` on both POSTs) intact.
- **F3a — CLOSED.** Cross-topic submit → `NOT_FOUND` (`SELECT topic_id` + `!== topicId`
  check). `resolveArtifact` derives the topic from the write-locked `UPDATE … RETURNING
  topic_id` row — a locked consistent read, not an unlocked side-read. `topic_id`
  immutability invariant grep-verified (3 `UPDATE artifacts SET` sites, none mutate it).
  0-row early-return fires before destructuring `topic_id`. Both call sites updated.
- **F4 — CLOSED.** `requireRole('reader')` on both GET routes; correct layer.
- **F5 — CLOSED.** `decideStep` `Number.isInteger && >= 0` → `BAD_REQUEST`, service layer
  (covers REST + MCP), fail-safe.
- **F7 — CLOSED.** `submitRequest` 256-char cap on `kind`/`subject_id`, service layer.

No new BLOCK: the `IDENTITY_MISMATCH` 403 leaks no request/topic/role state and fires before
`decideStep`; the `resolveArtifact` signature change has no stale caller; no validation
throw leaks a client/transaction.

## WARN findings (non-blocking — accepted)

### WARN-1 — F1/F4 verified via the route test-shim, not an auth-on end-to-end docker smoke
The route tests inject `req.apiKeyName`/`req.apiKeyRole` via a shim; no
`MCP_AUTH_ENABLED=true` smoke proves the real `chub_sk_` token → `validateApiKey` →
`bearerAuth` chain. **Mitigated** — `bearerAuth` is unchanged Phase-13 code already relied on
for `apiKeyName`; the shim faithfully reproduces the *complete* contract `resolveActorIdentity`
(reads only `apiKeyName`) and `requireRole` (reads only `apiKeyRole`) consume; 15.3.1 changes
no auth-middleware code. **Disposition:** accepted for CLEAR. An auth-on e2e smoke of F1/F4
should accompany the auth-enabled multi-actor milestone — the same HARD-trigger class as
DEFERRED-015/016 (recorded in DEFERRED-016).

### WARN-2 — REST decide route truncates a fractional `step_index`
`routes/requests.ts:166` — `parseInt(String(req.params.n), 10)` turns `/steps/1.5/decide`
into `1`, so F5's *fractional* rejection in `decideStep` is unreachable via REST (the
fraction is gone before the service sees it). The *negative* case (`/steps/-1/decide`) DOES
reach `decideStep` and is correctly rejected; MCP rejects fractionals at the `z.number().int()`
schema. **Cosmetic** — a truncated step then fails safe to `not_current_step`; no
authorization impact. **Disposition:** accepted. A route-layer `Number.isInteger` mirror for
honest 400s rides the next `routes/requests.ts` touch (DEFERRED-014's trigger already covers
"any sprint that edits the requests surface").

## Verdict

**CLEAR.** All five in-scope findings traceably closed; F1's CRITICAL identity-forgery vector
is dead on the DB-key path and honestly scoped. The two WARNs are non-blocking and do not
gate the ship. F2/F6 correctly out of scope per the user disposition. → SESSION.
