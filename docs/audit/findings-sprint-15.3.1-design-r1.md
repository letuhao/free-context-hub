# Sprint 15.3.1 — REVIEW-DESIGN round 1 — cold-start Adversary

**Agent:** cold-start adversarial design reviewer, security-framed (general-purpose, opus).
**Reviewed:** DESIGN rev 1 (`docs/specs/2026-05-18-phase-15-sprint-15.3.1-design.md`, hash `b2ee4d33b8a5fb12`) + CLARIFY spec + the 15.3 security findings + `requests.ts` / `routes/requests.ts` / `auth.ts` / `requireRole.ts` / `mcp/index.ts` request tools / `artifacts.ts` / migration 0054.
**Verdict:** REJECTED — 2 BLOCK + 1 WARN.

> Persisted by the main session — the sub-agent returned findings in its final message
> (the harness blocks sub-agent writes under `docs/audit/`).

## FINDING 1 — BLOCK — F1 binds identity to a non-unique `apiKeyName`; the design's "distinct keys = distinct principals" claim is false

`api_keys.name` has **no `UNIQUE` constraint** (only `key_hash` is unique). The design §1
claims "Multiple distinct DB keys = multiple distinct real principals, which is the intended
multi-party model." That is false on two levels: (a) two keys can share a `name`, so binding
the *authorization/audit identity* to `name` is binding to a non-unique field; (b) more
fundamentally, one human who can mint api keys creates N keys with N distinct names
(`submitter`, `approver-L1`, `approver-L2`), `resolveActorIdentity` faithfully stamps each
with a distinct identity, the self-decision guard (`actor_id !== submitted_by`) passes, and
— combined with F2's self-declared levels (deferred) — one human drives a full multi-level
approval. F1 raises the bar from "edit a JSON field" to "mint N api keys" but does **not**
deliver the per-principal guarantee §1 asserts.

## FINDING 2 — BLOCK — the auth-off / env-token branch leaves the forgery open; the design markets the fix as "complete"

When `apiKeyName` is absent — **every** REST caller under `MCP_AUTH_ENABLED=false`, and the
`CONTEXT_HUB_WORKSPACE_TOKEN` caller even when auth is enabled — `resolveActorIdentity`
returns the raw body value, unbound. Audit Finding 1's forgery reproduces unchanged in that
mode. The design conflates "auth disabled" (no authentication at all) with "env-token admin"
(one shared super-admin secret) into a single "no `apiKeyName`" branch and applies the
env-token's single-trusted-principal justification to both. Design §1 nonetheless states
"the REST-only fix is therefore *complete* for the audit's threat model," and AC9 asks the
POST-REVIEW Adversary to confirm "the forgery scenario no longer reproduces" — which it
plainly does under `MCP_AUTH_ENABLED=false`, the very config the test suite runs under. The
design overstates the result: the audit CRITICAL is closed only for the `MCP_AUTH_ENABLED=true`
DB-key path.

## FINDING 3 — WARN — F3a rests on an unstated `artifacts.topic_id` immutability assumption; §7's claims are stronger than what is guaranteed

`submitRequest`'s new 2a check is a pre-BEGIN *plain unlocked* read; `artifacts.topic_id` is
plain `TEXT` (migration 0054) with no DB-level immutability guarantee. If any code path can
`UPDATE artifacts SET topic_id=…`, an artifact can move topics between 2a's check and
`decideStep`/`resolveArtifact`, shifting the AC11 cross-topic break later in time rather than
closing it. Design §7 affirmatively claims the wrong-topic case is "unreachable" and the
lock order "preserved" — both claims silently depend on `topic_id` immutability, which the
design never states or verifies.

## Suggested directions (Adversary)

- **F1:** bind the acting identity to something already unique (`key_id` / a key prefix), or
  add a `UNIQUE` constraint on `api_keys.name`; stop asserting `apiKeyName` is per-caller
  unique without backing it.
- **F1 honesty:** state explicitly that the forgery remains open under `MCP_AUTH_ENABLED=false`
  and is accepted only as a dev posture; argue the env-token case on its own merits; reword
  AC9 to "F1 closed for the DB-key path," not unconditionally.
- **F3a:** state + verify (`grep`) that `artifacts.topic_id` is immutable post-creation,
  document it as the invariant F3a depends on, and correct §7's wording.
