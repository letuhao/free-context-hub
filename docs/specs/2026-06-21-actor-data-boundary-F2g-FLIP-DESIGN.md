# F2g — `MCP_AUTH_ENABLED` flip · DESIGN

**Decisions (CLARIFY):** A3 (deployment-posture flip + boot guard; `env.ts` code default stays `false`) · SHIP
(commit the deployed hardened stack — explicit go) · B2 (full hardened: auth-ON + `MCP_LEGACY_TOKEN_DISABLED=true`
+ no `CONTEXT_HUB_WORKSPACE_TOKEN`, api_keys-only).

## A. The change surface (minimal, coherent)

### A1. Boot guard (code) — `src/env.ts` + `src/index.ts`
1. **New env `DEPLOYMENT_PROFILE`** in `env.ts`: `z.enum(['dev','production']).default('dev')`. The signal that a
   deployment is externally exposed. Dev/tests never set it → stays `'dev'` → all guards inert (suite stays green;
   `env.ts` `MCP_AUTH_ENABLED` default stays `false`).
2. **`src/index.ts` startup gate** (replaces the current warn-only block at :110):
   - `DEPLOYMENT_PROFILE==='production' && !MCP_AUTH_ENABLED` → `logger.fatal(...)` + `process.exit(1)`. (A3: a
     production deployment can NEVER boot unauthenticated — closes the findings-13.2 "auth accidentally left false
     in prod" risk.)
   - `MCP_AUTH_ENABLED===true && DEPLOYMENT_PROFILE==='production'` → `await assertEnforceReady()`; on throw →
     `logger.fatal` + `process.exit(1)`. This finally wires the existing lockout guard into boot (the "F4 hard
     boot-gating" its own comment anticipated): a *production* auth-ON deploy can't start into a bypassable /
     locked-out state (legacy token still live, no root cred, unmigrated actors, ungranted credentials, or no
     system identity). **Scoped to the production profile on purpose** — non-production auth-ON test rigs
     (`docker-compose.auth-test.yml`) legitimately run with the legacy token still present, which
     `assertEnforceReady` rejects; gating on the profile keeps those smokes working.
   - `MCP_AUTH_ENABLED===false && profile dev` → keep today's warning (unchanged dev behavior).
   - `assertEnforceReady()` hits the DB, so it must run AFTER the boot path has confirmed DB connectivity +
     migrations (ordering pinned in PLAN) — never before Postgres is reachable, or a healthy prod deploy could
     crash on a startup race.
   - The worker (`worker.ts:64`) already hard-exits on auth-ON-without-system-identity — leave as is (parallel
     guard); optionally also call `assertEnforceReady` there for symmetry (decide in PLAN; not required).

### A2. Production stack (deploy config) — `docker-compose.prod.yml` (NEW, committed)
A committed hardened overlay, composed from the existing `auth-test` + `hardened-test` rigs, used as:
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
```yaml
services:
  mcp:
    environment:
      DEPLOYMENT_PROFILE: "production"
      MCP_AUTH_ENABLED: "true"
      MCP_LEGACY_TOKEN_DISABLED: "true"
      # CONTEXT_HUB_WORKSPACE_TOKEN intentionally UNSET (api_keys-only, B2)
  worker:
    environment:
      DEPLOYMENT_PROFILE: "production"
      MCP_AUTH_ENABLED: "true"
      MCP_LEGACY_TOKEN_DISABLED: "true"
```
`docker-compose.yml` **stays dev (auth OFF)** so local `docker compose up` and the test suite are unchanged. The
flip is "shipped" by committing this overlay + the boot guard + the runbook — deploying = run the overlay.

> **Interpretation flag (confirm at checkpoint):** "commit the deployed stack as hardened auth-ON" is implemented
> as a **committed production overlay**, NOT by flipping `docker-compose.yml` itself — because the base compose
> doubles as the local-dev stack and flipping it would force tokens on every `docker compose up`. If you instead
> want the *base* `docker-compose.yml` hardened (single deploy stack, dev uses a dev overlay), say so and I'll
> invert it.

### A3. Docs — `.env.example`, `README`/runbook note
Document the hardened deploy + the operator runbook (below). `.env.example` keeps `MCP_AUTH_ENABLED=false` (dev) but
gains a commented hardened block + a pointer to `docker-compose.prod.yml`.

## B. Operator runbook (committed in the design + closeout)
1. `npm run bootstrap:root` — root principal + credential (out-of-band root secret).
2. `npm run bootstrap:system` — system-worker principal with **exactly** `global write` (DEFERRED-053: any extra
   grant fails enforce-ready; trim first).
3. `npm run migrate:coordination-actors` — ensure 0 legacy string actor_ids remain.
4. `npm run backfill:grants` — every active principal-bound credential gets a covering grant (re-grant/revoke any
   the backfill reports as deliberately-revoked/unmappable).
5. Mint an `api_keys` admin token (global scope, bound to a principal with global admin) — this is the operator/GUI
   credential **replacing** the retired `CONTEXT_HUB_WORKSPACE_TOKEN`.
6. Bring up the production overlay. Boot guard runs `assertEnforceReady()`; if anything above is incomplete the
   backend refuses to start with a precise message (no half-enforced state).

## C. Verification protocol (HARD pre-prod trigger — required before COMMIT)
1. **Unit suite + tsc** — full suite stays green (default `false`, `DEPLOYMENT_PROFILE` unset → guards inert). Add
   focused unit tests for the boot guard's branch logic (profile×auth matrix) using `_resetEnvCacheForTest`.
2. **Cold-start hostile-actor adversary** (read-only, fresh agent) over the whole authn/authz surface:
   `bearerAuth`, `mcp/auth.ts` resolver, `authorize()`/`scopeCovers`, `assertEnforceReady`, the boot guard,
   bootstrap (root/system), and the Domain 8 route surface. Find real auth-ON bypasses; fix every HIGH/MED;
   expect the 3→2→1→0 saturation curve (safety-sensitive policy: multi-pass).
3. **Live auth-ON hardened proof** (C2). If Docker (+ Postgres) reachable:
   - Bring up base + `prod` overlay; run the runbook (root/system/migrate/backfill/mint api-key).
   - Prove: (a) no-token request → 401; (b) the **legacy env token is REJECTED** (B2); (c) api_keys admin token
     works; (d) a project-scoped principal gets cross-tenant **404/forbidden** on another project's lesson/topic;
     (e) the **worker** runs (system identity) and processes a job; (f) the GUI same-origin path authenticates (or
     is correctly gated). Restore dev posture after.
   - If infra unavailable → record `LIVE-SMOKE deferred to <token>` and do NOT mark the milestone done as
     "live-proven"; the committed overlay still lands but flagged unproven.

## D. Out of scope / untouched
- `env.ts` `MCP_AUTH_ENABLED` **code default stays `false`** (A3).
- `corpus/**`, `docs/qc/**competency**`, `src/qc/ingestCorpus.ts` — untouched.
- The two ACCEPTED-as-documented LOW deferreds (grant-revoke oracle; FE/MCP polish) — not reopened.

## E. Acceptance criteria
- AC1: `DEPLOYMENT_PROFILE=production` + auth OFF → backend hard-exits at boot.
- AC2: auth ON + `DEPLOYMENT_PROFILE=production` + not enforce-ready → backend hard-exits with the precise
  `assertEnforceReady` message. (Non-production auth-ON test rigs are NOT enforce-ready-gated.)
- AC3: dev posture (no profile, auth OFF) → unchanged warn-only boot; full suite green.
- AC4: committed `docker-compose.prod.yml` encodes the B2 hardened end-state (auth ON + legacy disabled + no token).
- AC5: cold-start adversary saturates to 0 HIGH/MED.
- AC6: live proof of enforcement (or explicit `LIVE-SMOKE deferred`).
