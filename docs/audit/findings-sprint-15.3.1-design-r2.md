# Sprint 15.3.1 — REVIEW-DESIGN round 2 — cold-start Adversary

**Agent:** cold-start adversarial design reviewer, security-framed (general-purpose, opus).
**Reviewed:** DESIGN rev 2 (`docs/specs/2026-05-18-phase-15-sprint-15.3.1-design.md`, hash `e5b39a95a5658c45`) + the r1 findings + CLARIFY spec + `requests.ts` / `routes/requests.ts` / `auth.ts` / `requireRole.ts` / `apiKeys.ts` / migration 0041 / `mcp/index.ts` request tools / `artifacts.ts` / migration 0054.
**Verdict:** ACCEPTED — all 3 round-1 findings RESOLVED; 2 new WARN, 0 BLOCK.

> Persisted by the main session — the sub-agent returned findings in its final message.

## Part A — round-1 finding verification

- **R1-FINDING 1 — RESOLVED.** rev 2 §0.5 deletes the false "distinct keys = distinct
  principals" claim. The sub-claim it now rests on — same-`name` keys collapse to one
  coordination identity and are caught by `decideStep`'s self-decision guard
  (`actorId === submittedBy`, string compare `requests.ts:418`; participant lookup keyed on
  the `actor_id` string `requests.ts:410`) — was **verified true** against the code. The
  multi-distinctly-named-key residual is honestly conceded.
- **R1-FINDING 2 — RESOLVED.** §0.5's three-mode table honestly separates `auth=true`+DB-key
  (CLOSED) / env-token (open, justified as one shared super-admin secret) / `auth=false`
  (explicitly OPEN, dev posture). "complete for the threat model" removed; AC9 reworded and
  now satisfiable.
- **R1-FINDING 3 — RESOLVED.** §2.5 states `artifacts.topic_id` immutability; the Adversary
  independently re-ran `grep "UPDATE artifacts SET" src` → 3 sites, none mutate `topic_id` —
  matches the design. §7 wording corrected; §2b correctly frames `RETURNING topic_id` as a
  locked read.

## Part B — new findings (both WARN)

### NEW FINDING 1 — WARN — the multi-key residual is mis-attributed to DEFERRED-015's trigger; no deferred item actually owns it

§0.5 item 1 and §10 say the multi-key-per-human residual "shares DEFERRED-015's HARD
trigger." But DEFERRED-015 is scoped *strictly* to making the participant `level`
authoritative (a `joinTopic` write-path change) — it does not cover bounding api-key
multiplicity, an `api_keys` / `createApiKey` provisioning concern in a different subsystem.
Sharing a trigger ≠ being owned. After 15.3.1 ships, the residual lives only in this design
doc's prose — not in `DEFERRED.md` — so the SESSION Scribe will not carry it forward. When
DEFERRED-015 is later resolved, someone may believe the F1/F2 CRITICAL is fully closed while
the key-multiplicity hole stays open and untracked.

**Resolution direction:** file a real deferred item (DEFERRED-016) owning "bound api-key
multiplicity / one-human-one-principal for coordination identity," then cite it from
§0.5/§10 instead of hand-waving DEFERRED-015's trigger.

### NEW FINDING 2 — WARN — F1's DB-key guarantee silently depends on the `requireRole('writer')` POST gate, which is never stated as a precondition

`resolveActorIdentity` binds identity to `req.apiKeyName` for *every* valid DB key,
including `reader` keys (`bearerAuth` sets `apiKeyName` regardless of role). The only thing
keeping a `reader` key out of `submitRequest`/`decideStep` is the `requireRole('writer')`
middleware on the two POSTs. F1's "a DB-keyed caller can only act as its own key" claim
silently assumes the caller already passed that gate — but F1 and the writer gate are
presented as independent (F4 only discusses the GET routes). Not a live hole (the writer
gate is present and unchanged) → WARN. But it is the same class of unstated-precondition
defect the 15.3 audit's root cause names.

**Resolution direction:** state in §1/§0.5 that F1's DB-key binding assumes the POST routes
retain `requireRole('writer')`; optionally have the AC1 route test assert a `reader`-key
POST is still 403.

## Verdict

ACCEPTED. All r1 findings genuinely resolved (real fixes verified against code, not
papered-over wording). Both new findings are WARN — neither is a live exploit (multi-key
needs key-minting power; the writer gate is present). Implementer to address both: NEW
FINDING 1 → file DEFERRED-016; NEW FINDING 2 → state the writer-gate precondition + test it.
