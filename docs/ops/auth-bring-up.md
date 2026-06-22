# Hardened (auth-ON) bring-up runbook

The order below matters: the backend **FATAL-refuses to boot** under `MCP_AUTH_ENABLED=true`
if the coordination substrate still holds legacy free-text actor ids, and the GUI is unusable
until a human operator exists to log in. Follow these steps once per deployment when enabling
enforcement.

## 0. Prerequisites

- `.env` has a high-entropy `ROOT_BOOTSTRAP_TOKEN` (out-of-band deployment secret; gates
  `POST /api/bootstrap/*`) and `AUTH_SESSION_SIGNING_SECRET`.
- The stack is running with `MCP_AUTH_ENABLED=false` (or not yet flipped on).

## 1. Migrate legacy coordination actors → principals

```bash
npm run migrate:coordination-actors
```

Idempotent. Rewrites every coordination ownership/membership/ballot column from legacy
free-text actor strings onto imported `agent` principals. **Required before enabling auth** —
`assertEnforceReady` (and the boot gate) count un-migrated actors and block the flip while any
remain. A no-op on already-migrated data.

> Skipping this is the #1 cause of a hardened backend that won't start. The FATAL log names
> this exact command.

## 2. Establish the root of trust + the first operator

All bootstrap calls carry the bootstrap token: `Authorization: Bearer $ROOT_BOOTSTRAP_TOKEN`.

```bash
# a. Seed root + mint the root credential (SHOWN ONCE — store it in your secret manager).
curl -s -X POST http://localhost:3002/api/bootstrap/root \
  -H "Authorization: Bearer $ROOT_BOOTSTRAP_TOKEN" -H 'Content-Type: application/json' \
  -d '{"display_name":"root"}'

# b. Issue the human operator invite (root is NOT a daily login).
curl -s -X POST http://localhost:3002/api/bootstrap/operator \
  -H "Authorization: Bearer $ROOT_BOOTSTRAP_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"operator@your-org.example"}'
# → returns { invite_token, ... }. Convey it out-of-band.
```

The operator completes setup at the GUI `/register` (or `POST /api/auth/register` with
`{ token, password, display_name }`), which mints the human principal + password credential and
a session. The operator still needs a grant to act — root grants it after first login
(`POST /api/grants` or the Authorization UI). For a full-console operator, grant global `admin`.

## 3. Confirm the flip is safe (lockout guard)

```bash
curl -s -X POST http://localhost:3002/api/bootstrap/enforce \
  -H "Authorization: Bearer $ROOT_BOOTSTRAP_TOKEN"
# → 200 { status:"enforce_ready" } means flipping auth ON will not strand callers/worker.
# → 409 names the blocker (e.g. un-migrated actors → go back to step 1).
```

## 4. Flip enforcement on + restart

Set `MCP_AUTH_ENABLED=true` in the environment and restart the backend + worker:

```bash
docker compose up -d mcp worker
```

The backend re-runs the enforce-ready check at boot and starts only if it passes.

## 5. GUI sign-in

The single-port GUI (`:3002`) now requires a session. Visiting any page while unauthenticated
redirects to `/login` (FIX-5 auth gate). The operator signs in with the email + password from
step 2; the httpOnly session cookie then authenticates every same-origin `/api/*` call — **no
client-side token is baked into the GUI bundle.** Agents continue to authenticate with their own
Bearer `api_key` (minted via the access-control surface), independent of the human session.

> Do **not** bake `NEXT_PUBLIC_CONTEXTHUB_TOKEN` into a shared GUI build for human use — that
> inlines a credential into the client bundle (anyone loading the page inherits it). It exists
> only for headless/single-operator automation, never for a multi-user console.
