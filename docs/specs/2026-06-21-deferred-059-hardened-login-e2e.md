# DEFERRED-059 — Hardened human-login E2E + gateway-shim retirement + live flip

**Date:** 2026-06-21 · **Session:** 15 · **Branch:** `feature/actor-data-boundary`
**Size:** L · **Type:** [FS] · **Safety-sensitive:** yes (exposes the auth surface publicly; retires a credential-injection path)
**Discharges:** DEFERRED-059 (and makes the hardened posture *legitimate* per completion-plan §7).

## Goal

Prove the F-AUTH human login chain works end-to-end in the **hardened (auth-ON)** posture,
retire the shared-admin gateway-token shim, and flip the live stack onto the legitimate
hardened posture (auth-ON + human login enforced + shim gone).

## Discovery that corrects the DEFERRED-059 recipe

The note said "bootstrap wizard (root → **operator** → enforce) → login." The code does **not**
connect that way:

- `POST /api/bootstrap/operator` creates a bare `human` principal with **no email and no
  credential** ([bootstrap.ts:124](../../src/api/routes/bootstrap.ts)). It is a **login dead-end**.
- Login resolves email→principal **through the invites trail** — `resolvePrincipalByEmail` joins
  `invites` + `human_credentials` ([passwordCredentials.ts:176](../../src/services/passwordCredentials.ts)),
  and `acceptInvite` **mints its own fresh principal** ([invites.ts:131](../../src/services/invites.ts)).

**The actually-loginable path** (and the one this work exercises):

```
bootstrap/root            → seeds root principal + mints root API key (shown once)
bootstrap:system          → system-worker identity (enforce-ready precondition)
backfill:grants           → every credential covered (enforce-ready precondition)
POST /api/invites  (root) → invite token for the operator's email
POST /api/auth/register   → creates the loginable human + credential + AAL1 session
POST /api/auth/login      → session cookie
GET  /api/me              → returns the operator principal
MFA enroll/verify → re-login → mfa_required → /api/auth/mfa/verify → AAL2
POST /api/bootstrap/enforce → 200 enforce_ready  (then MCP_AUTH_ENABLED stays on)
```

**Finding filed (DEFERRED-063):** `bootstrap/operator` is vestigial as built — either wire it to
issue an invite for the operator email, or drop it from the wizard. Not blocking this work (the
invite→register path is the real one); recorded so the dead route doesn't mislead a future operator.

## Acceptance criteria

1. **AC1 — Automated hardened E2E test** (`src/api/auth-hardened-e2e.test.ts`): drives the REAL
   `createApiApp` over HTTP under `MCP_AUTH_ENABLED=true`, proving register → login → cookie →
   `/api/me` (principal == operator) → MFA enroll/verify → logout → re-login (`mfa_required`) →
   `/api/auth/mfa/verify` (AAL2) → `/api/me` still the operator. Pins the cooperative
   bearerAuth-cookie-defer → sessionAuth → meRouter wiring that NOTHING currently covers end-to-end.
   Added to the `package.json` test list. Cleans up by `__test_hardened_e2e__` prefix.
2. **AC2 — Shim retired:** `gui/src/proxy.ts` no longer injects `CONTEXTHUB_GATEWAY_TOKEN`; the var
   is removed from `docker-compose.yml` (gui service) and `.env`. The cross-site / CSRF guard in
   `proxy.ts` is preserved unchanged.
3. **AC3 — Evidence gate green:** `npm test` (full suite incl. AC1), `npx tsc --noEmit`, `gui build`.
4. **AC4 — Adversary pass:** cold-start review of the shim removal + a live grep of every authn/authz
   fast-path confirming no route is left unauthenticated by removing the shim.
5. **AC5 — Live flip:** real secrets generated into `.env`
   (`AUTH_SESSION_SIGNING_SECRET`, `ROOT_BOOTSTRAP_TOKEN`), base compose up **without** the dev
   overlay (auth-ON), bootstrap root + system + backfill, issue invite, register the operator, enforce
   returns ready, and a live `login → cookie → /api/me` succeeds through the gateway. Operator
   credentials surfaced once to the user to rotate.

## Decisions / non-goals

- **Network bind stays loopback** (`GATEWAY_PORT=127.0.0.1:3002`) — the legitimacy gate is
  auth-ON + human login + shim-gone, which is orthogonal to LAN exposure. Removing `GATEWAY_PORT`
  to bind `0.0.0.0` is a one-line follow-up the operator does when they want LAN access; not done
  here (careful-path default on a personal machine).
- **Operator password:** generated strong, shown once, operator rotates on first login. (No
  interactive password capture in an automated session.)
- **MFA in the live flip is optional** — the automated test proves the MFA path; enrolling MFA on
  the live operator is the user's choice post-login.
- Auth residuals (DEFERRED-060 C1/C2, `/api/me` role mislabel) are **out of scope** — tracked.

## Test design (AC1)

Module scope: `MCP_AUTH_ENABLED=true`, `CONTEXT_HUB_WORKSPACE_TOKEN` (env validation),
`AUTH_SESSION_SIGNING_SECRET` (deterministic test secret), low argon2 params
(`AUTH_ARGON2_MEMORY_COST=8192`/`TIME_COST=1`/`PARALLELISM=1`) for speed, `_resetEnvCacheForTest()`.
`DEPLOYMENT_PROFILE` left dev so cookies aren't `Secure`-only over the in-test http loopback.
Setup seeds/reuses root, issues an invite via the service layer (attributed to root). Drives the rest
over HTTP with a tiny cookie-aware request helper (echoes `Set-Cookie` back). `/api/auth/*` routes sit
*before* the global `csrfGuard`, so the session-scoped MFA calls need only the cookie (no CSRF header)
— matching production.
