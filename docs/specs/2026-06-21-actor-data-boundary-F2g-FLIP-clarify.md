# F2g — `MCP_AUTH_ENABLED` flip · CLARIFY

**Date:** 2026-06-21 · **Branch:** `feature/actor-data-boundary` · **Size:** L (safety-sensitive, HARD pre-prod trigger)
**Standing constraint:** the actual flip stays gated behind an explicit human go — this milestone does NOT flip it
without that go. `corpus/**`, `docs/qc/**competency**`, `src/qc/ingestCorpus.ts` untouched.

## 1. Where we are (current state, verified)

- **Default is OFF.** `src/env.ts:69-71` — `MCP_AUTH_ENABLED` defaults to `false`.
- **Two enforcement chokepoints, both gated on the flag:**
  - REST: `bearerAuth` (`src/api/middleware/auth.ts:27-29`) — `if (!env.MCP_AUTH_ENABLED) return next()`. When ON:
    requires `Bearer`; env-token fast-path → admin (rejected when `MCP_LEGACY_TOKEN_DISABLED`); else `api_keys`
    DB lookup attaches `apiKeyPrincipalId` (the bound principal).
  - MCP: parallel resolver in `src/mcp/auth.ts` (`resolveTargetActor`/token resolution).
- **`authorize()`/`assertAuthorized` no-op when the flag is OFF** and enforce grants when ON. The entire F1/F2/F2g
  effort wired ~115 service fns + every REST route (Domain 8) so that `authorize()` is the SOLE gate — all inert
  today, all live the moment the flag flips.
- **Flip-readiness board is CLEAR.** DEFERRED-048..054 all RESOLVED (arbitrary-fs jobs closed; system-principal
  least-privilege 053/054; loadLeaf guard 052; job-strand 051). Remaining OPEN deferreds are non-blocking LOWs
  (DEFERRED grant-revoke oracle = ACCEPTED-as-documented; FE/MCP polish).
- **Hardened end-state is already documented** (WHITEPAPER §, deferred-029-closeout): `MCP_AUTH_ENABLED=true`
  + `MCP_LEGACY_TOKEN_DISABLED=true` + no `CONTEXT_HUB_WORKSPACE_TOKEN` (api_keys-only). Test rigs exist:
  `docker-compose.auth-test.yml` (auth ON) and `docker-compose.hardened-test.yml` (legacy token disabled).

## 2. What "the flip" can concretely mean (the decision)

### Decision A — scope of the change
- **A1 — Code default flip:** `env.ts` `.default(false)` → `.default(true)`. Auth ON *everywhere* by default; dev +
  the 1216-test suite must explicitly set `false`. Maximum "secure by default", **highest blast radius** (every test
  file + dev run changes; high regression risk against the whole suite).
- **A2 — Deployment-posture flip (recommended):** keep code default `false`; enforce ONLY on the published stack via
  `docker-compose.yml` / `.env` (`MCP_AUTH_ENABLED=true`). Dev + tests stay OFF (suite stays green); the one
  externally-published gateway enforces. Matches the deferred-029 hardened-end-state pattern (auth is a *deployment*
  posture, not a code default).
- **A3 — Posture flip + boot guard:** A2 plus a startup assertion that refuses to boot a "production" profile with
  auth OFF (closes the findings-13.2 risk: "auth accidentally left false in prod"). Strictly A2 + one guard.

### Decision B — hardening level at flip
- **B1 — auth-ON only:** `MCP_AUTH_ENABLED=true`, legacy shared token still accepted (back-comat).
- **B2 — full hardened end-state (recommended):** `MCP_AUTH_ENABLED=true` + `MCP_LEGACY_TOKEN_DISABLED=true` +
  no `CONTEXT_HUB_WORKSPACE_TOKEN` → every authenticated call maps to an `api_keys` row (a bound principal). This is
  the documented target and avoids shipping the deprecated single-shared admin token.

### Decision C — verification depth THIS milestone
- **C1 — readiness/plan only:** produce the runbook + a fresh **cold-start security adversary** (read-only) over the
  whole authn/authz surface + a **static "grep every fast-path"** audit; do NOT bring up a live auth-ON stack. The
  human flips later using the runbook.
- **C2 — live verification (recommended, policy-required if infra available):** C1 PLUS actually bring up
  `docker-compose.auth-test.yml` (+ `hardened-test.yml` for B2), run the auth-ON E2E suite, prove enforcement
  (cross-tenant 404/forbidden, principal-bound keys work, legacy token rejected under hardened), then tear down.
  The committed code default stays `false` regardless. Safety-sensitive policy explicitly requires "live
  verification of the documented end-state." Needs Docker + LM Studio; if unavailable → fall back to C1 with a
  `LIVE-SMOKE deferred` token.

## 3. Recommendation

**A2/A3 + B2 + C2.** Do NOT change the code default (A1 breaks dev/test ergonomics and is the riskiest path for the
least benefit). Make the flip a **deployment posture** (A2) — optionally with a boot guard (A3) — targeting the
**full hardened end-state** (B2), and **prove it live** (C2) before declaring done. Concretely this milestone would:
1. Cold-start hostile-actor adversary over `bearerAuth`, `mcp/auth.ts`, `authorize()`, `assertEnforceReady`,
   bootstrap, and the Domain 8 route surface — read-only, find real bypasses (expect 3→2→1→0 curve).
2. Static audit: grep every authn/authz fast-path the flag affects; confirm no path still short-circuits to admin
   under auth-ON except the (B2-disabled) legacy token.
3. Set the deployed-stack env to the hardened end-state (compose/.env only; code default untouched) + bootstrap
   root→system→verify `hasUsableSystemIdentity` (exactly global-write, per DEFERRED-053 runbook).
4. Live auth-ON E2E: enforcement proven, then restore dev posture. Code default stays `false`.

## 4. Open questions for the human (CLARIFY checkpoint)

1. **Scope** — A1 (code default) vs **A2/A3 (deployment posture, recommended)**?
2. **Verification depth** — C1 (readiness/plan only) vs **C2 (live auth-ON proof, recommended)**? (C2 needs the
   Docker stack + LM Studio reachable; confirm infra is available, else we record `LIVE-SMOKE deferred`.)
3. Hardening **B2 (full hardened, recommended)** assumed unless you prefer B1.
4. Confirm: even under C2, the **committed code default stays `false`** and the live stack is restored to dev
   posture afterwards — i.e. this milestone proves readiness and (optionally) flips the *running* stack, but does
   not land an auth-ON default in the repo. Is "done" = "live-proven + runbook committed, default still false", or
   do you also want the deployed compose/.env committed as auth-ON?
