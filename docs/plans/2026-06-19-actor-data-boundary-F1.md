# PLAN — Actor Data Boundary F1 (Identity + out-of-band root)

**Status:** PLAN · **Date:** 2026-06-19 · **Branch:** `feature/actor-data-boundary`
**Parent specs:** [`-FOUNDATION.md`](../specs/2026-06-19-actor-data-boundary-FOUNDATION.md) (F1 build plan),
[`-mcp-fe-design.md`](../specs/2026-06-19-actor-data-boundary-mcp-fe-design.md) (vocabulary + external surface).
**Size:** L (schema + API contract + auth). Full 12 phases, no skips. Per-sub-phase cold-start
adversary review against the CODE (safety policy: auth primitive + new service boundary).

## F1 acceptance criteria (from FOUNDATION)
- Identity is **un-spoofable** when auth is ON (acting principal derived from credential, not args).
- Auth-OFF = root/dev context **unchanged** (asserted values honored; dev loops + auth-off CI lane unbroken).
- Root is seeded **out-of-band** (a root principal + `ROOT_*` config); a compromised root is OUT OF SCOPE.

## Implementation decisions (made here; surfaced at first loop checkpoint)
1. **`principal_id` = UUID** (`gen_random_uuid()`), NOT ULID. The codebase uses UUID everywhere
   (`api_keys`, `coordination_events`); `uuid` is the only ID dep. UUID preserves every property the
   spec asks of ULID — opaque, never human-typed, un-spoofable. Avoids a new dependency. (Deviation
   from spec's "ULID" label, noted.)
2. **`is_root`** = a `boolean NOT NULL DEFAULT false` column with a partial unique index
   (`WHERE is_root`) enforcing **at most one** root. Set ONLY by the bootstrap path; never exposed as a
   grantable field in any API. ("derived/not grantable" satisfied by guard, not by computing it.)
3. **`api_keys.principal_id`** nullable FK → `principals` (legacy/env-token keys stay NULL; back-compat).
4. **Bootstrap** = `ROOT_BOOTSTRAP_TOKEN` env (printed once at first start) + `npm run bootstrap:root`
   CLI. Idempotent: seeds exactly one root principal + one root-bound durable api_key; no-op once root
   exists. **Lockout guard (F1 slice):** a preflight that refuses to declare the deployment
   "enforce-ready" unless a valid, non-expired root-bound credential exists. (FE enforcement-flip page
   is F4.)
5. **Acting-principal helper** = `resolveActingPrincipal({authenticatedPrincipalId, assertedActorId})`:
   - auth ON  + asserted matches authenticated → use authenticated.
   - auth ON  + asserted present and mismatches → throw `ASSERTED_IDENTITY_REJECTED`.
   - auth ON  + credential expired/revoked mid-use → `CREDENTIAL_EXPIRED` (distinct from authz DENY).
   - auth OFF → honor asserted (unchanged); fall back to root/dev principal when absent.

## Sub-phase decomposition (each = one loop iteration: RED → GREEN → adversary)
- **F1a — principals substrate.** migration `0064_principals.sql` (principals table + is_root guard +
  `api_keys.principal_id` FK). `src/services/principals.ts` (`createPrincipal`, `getPrincipal`,
  `getRootPrincipal`, `listPrincipals`, status transitions) + `principals.test.ts`.
- **F1b — api_keys ↔ principal binding.** `createApiKey({principal_id})`, `validateApiKey` returns the
  bound principal (joined), expiry/revocation surfaces `CREDENTIAL_EXPIRED` semantics. Tests.
- **F1c — root bootstrap.** `ROOT_BOOTSTRAP_TOKEN` in `env.ts`; `src/scripts/bootstrapRoot.ts` +
  `bootstrap:root` npm script; enforce-ready preflight (`assertEnforceReady`). Tests.
- **F1d — authenticated principal resolution.** Thread principal (not just scope) out of `mcp/auth.ts`
  + REST `auth.ts`; add `resolveActingPrincipal` helper + `whoami` MCP tool. Tests.
- **F1e — stop trusting asserted actor_id.** Apply `resolveActingPrincipal` at the MCP boundary for the
  ~19 asserted-identity tools (charter_topic, post_task, submit_request, propose_motion, cast_vote,
  submit_intake, … and `appendEvent`'s actor_id). Auth-ON reject mismatch; auth-OFF unchanged. Tests.
- **F1-adv — cold-start hostile-actor adversary** read-only pass over all F1 code; ≥3 passes to
  saturate per safety policy; fix every BLOCK; re-verify.

## /review-impl outcomes (F1a, post-commit 37c03be)
Fixed now: #1 root tests now `t.skip()` on a foreign root (global singleton would false-RED once F1c
seeds a dev root); #2 `validateDisplayName` checks the TRIMMED length; #3 added a concurrent-seeder
test proving "2 seeders → exactly 1 root". Carried forward:
- **#4 (F1c DECISION REQUIRED):** `seedRootPrincipal` hardcodes `kind='human'`. `bootstrap:root` is a
  headless path — decide in F1c whether the trust anchor is `human` (operator owner) or `system`
  (and whether to make it configurable). Pre-committed to `human` for now.
- **#5 (accept, codebase-wide):** `created_at`/`expires_at` typed `string` but node-pg returns `Date`
  (no `setTypeParser`). Works via JSON boundary serialization; F1b+ must not do string ops on them.
- **#6 (accept):** F1b auth-time check must validate non-root principal `status` (getRootPrincipal
  ignores status — fine for root since its status is guard-immutable). `listPrincipals` unbounded —
  scope-filter + pagination is F1d's MCP layer.
- **#7 (accept):** `createPrincipal` can mint a born-suspended/retired principal (useful for import).

## Out of F1 scope (later phases)
Grants/`authorize()` (F2), human-agent attribute + Board fence (F3), enforcement-flip FE + live
auth-ON CI denial (F4), human password/MFA/session (F-AUTH), grant/revoke MCP tools, ephemeral keys.
