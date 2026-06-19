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
  - **DECISION (carried from review #4):** root `kind` — `human` (operator owner) vs `system`.
  - **TODO (from F1b adversary MED):** validateApiKey currently FAILS CLOSED on any root-bound key
    (`p.is_root = false` required). F1c mints the legitimate root credential, so it must add a
    provenance marker (`api_keys.is_bootstrap` or equivalent) and relax the validator predicate to
    `(p.is_root = false OR k.is_bootstrap)` — deliberate, not silent. Plus the bootstrap path is the
    ONLY place a root-bound key is created (createApiKey refuses root).
- **F1d — authenticated principal resolution.** Thread principal (not just scope) out of `mcp/auth.ts`
  + REST `auth.ts`; add `resolveActingPrincipal` helper + `whoami` MCP tool. Tests.
- **F1e — stop trusting asserted actor_id.** Apply `resolveActingPrincipal` at the MCP boundary for the
  ~19 asserted-identity tools (charter_topic, post_task, submit_request, propose_motion, cast_vote,
  submit_intake, … and `appendEvent`'s actor_id). Auth-ON reject mismatch; auth-OFF unchanged. Tests.
  - **F1d adversary #2/#3 → F1e MUSTs:** (a) pass `allowUnboundAssertion = !MCP_LEGACY_TOKEN_DISABLED`
    to `resolveActingPrincipal` so hardened deployments refuse unbound-credential assertions; (b) when
    the resolver returns a non-null value that did NOT come from the authenticated principal (honored
    asserted), VALIDATE it resolves to an existing ACTIVE principal in the caller's tenant scope before
    persisting — else forged provenance / suspended-principal bypass returns. The resolver's JSDoc
    states this as a hard contract.
  - **F1d adversary #4 → optional refactor:** fold `classifyCredentialFailure` into `validateApiKey`
    as a single discriminated query (removes the validate→classify TOCTOU; benign today — only flaps
    the error code, never an allow).
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

## F1c adversary outcomes (BLOCKED → cleared)
Fixed in F1c: #2/#3 HIGH (bootstrapRoot non-atomic / reissue accumulated live root secrets) →
`createBootstrapRootKey` now atomically rotates (revoke prior live bootstrap key + insert in one
txn) + partial unique index `api_keys_one_live_bootstrap_per_principal` (≤1 live root credential);
#4 MED (name-collision 23505) → unique name + typed CONFLICT; #1 HIGH (contained) → `assertEnforceReady`
refuses while the legacy `CONTEXT_HUB_WORKSPACE_TOKEN` global-admin bypass is live; #6 → coverage
(rotation, empty-token, legacy-block, public-path-can't-set-is_bootstrap).

**Deferred to F4 (enforcement posture — cross-cutting, blast radius on the auth-ON E2E lane):**
- **#5 — hard boot-gate:** call `assertEnforceReady()` at startup when `MCP_AUTH_ENABLED=true` (refuse
  to boot into enforcement without a usable root credential). Currently advisory-only (CLI prints
  ready/not-ready). Wiring to `src/index.ts` startup risks the existing auth-ON E2E lane (which may
  rely on the legacy token) — design the interaction in F4.
- **#1 — legacy default:** consider flipping `MCP_LEGACY_TOKEN_DISABLED` default to true (or requiring
  it for enforce-ready at boot). Back-compat decision (DEFERRED-029 kept it false for migration).

## F1-adv pass 1 — CRITICAL cross-cutting finding (the actor_id namespace split)
A cold-start integration adversary found the one thing the per-phase reviews structurally couldn't:
**Phase-15's coordination substrate stores actor identity as free-text strings** (`claims.actor_id`,
`body_members.actor_id`, `votes.actor_id`, `proxies.principal/proxy`, `topic_participants.actor_id`)
compared by exact equality. F1e makes the *acting* field a principal UUID under auth-ON, but the
*stored/target* fields are NOT resolved and existing rows are NOT migrated. Consequences **at the
auth-ON transition** (not under auth-OFF — F1e is a behavioral no-op there):
- a task claimed under auth-OFF can't be completed/released under auth-ON (UUID ≠ stored string) →
  holder locked out;
- `add_body_member` stores the member as a raw string but `cast_vote` resolves the voter to a UUID →
  membership check fails → electorate disenfranchised;
- `grant_proxy` resolves `granted_by` to a UUID but `principal` stays raw → the `granted_by==principal`
  self-delegation invariant becomes unsatisfiable; (also: `principal` IS the caller here and should be
  resolved too — a genuine F1e wiring inconsistency, fix folded into whichever option is chosen);
- `cast_vote` proxy branch persists the unresolved vote-OWNER into `votes.actor_id` + the event log.

**Why this is NOT a live regression:** default posture is auth-OFF; F1e changes nothing there. The
hazard is the auth-ON flip, which is **F4 (enforcement posture)** — already deferred and already noted
to need a reconciliation step. F1's AC ("auth-OFF unchanged") holds.

**RESOLUTION = a distinct effort (see DEFERRED-043):** make `principal_id` the universal actor
namespace across Phase-15 — resolve the target/owner/member fields through the same chokepoint, add a
data migration (legacy string actor_id → principal_id), and gate `assertEnforceReady` on "all
coordination actor_ids are resolvable principals" so auth can't be flipped into a stranded board.
Pending the user's scope decision (defer-to-F4 / narrow-F1e / full-migration-now), F1-adv passes 2–4
are paused — they would only echo facets of this same finding.

## F1f — namespace unification (user decision: "full migration now", supersedes DEFERRED-043)
**Architecture: REWRITE to UUIDs** (not an alias layer). The steady state is uniform — every
coordination actor field holds a `principal_id`, comparisons stay string-equality (now UUID↔UUID), so
service comparison logic is UNCHANGED. Principals are global subjects (no project column); "validate
target" = "exists + active" (tenant-scoping is F2 grant territory, not here).

- **F1f.1 — target-actor validation helper.** `isActivePrincipal(id)` in principals.ts;
  `resolveTargetActor(actorId)` / `resolveTargetActors([...])` in mcp/auth.ts: auth-ON → the actor MUST
  be an existing active principal (else BAD_REQUEST); auth-OFF → passthrough (unchanged). Tests.
- **F1f.2 — wire target/owner/member fields.** add_body_member (member), cast_vote (vote-owner in the
  proxy branch), grant_proxy (principal = caller → resolve via acting; proxy = target → validate),
  create_decision_body (veto_holders[]), and any other identity REFERENCE field. Under auth-ON these
  must be principal UUIDs; auth-OFF unchanged.
- **F1f.3 — data migration.** A migration that, per distinct legacy string actor_id across the
  coordination tables (claims, body_members, votes, proxies, topic_participants, tasks.created_by,
  requests.submitted_by, motions.proposed_by/second_by, decision_bodies.*, intake/dispute), creates an
  imported principal (kind='agent', display_name=string, status='active') and rewrites the column to
  the principal_id. Idempotent; a no-op on empty/already-UUID data. (Operators bind credentials to the
  imported principals out-of-band to act as them under auth-ON.)
- **F1f.4 — enforce-ready gate.** `assertEnforceReady` also refuses if any live coordination actor_id
  is not a resolvable principal (so auth can't be flipped into a stranded board) — closes F1-adv #5.
- **F1f-adv — saturating multi-pass** over F1f, then resume the paused F1-adv passes 2–4 over all F1.

## Out of F1 scope (later phases)
Grants/`authorize()` (F2), human-agent attribute + Board fence (F3), enforcement-flip FE + live
auth-ON CI denial (F4), human password/MFA/session (F-AUTH), grant/revoke MCP tools, ephemeral keys.
