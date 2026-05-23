# DEFERRED-029 PR E — legacy `CONTEXT_HUB_WORKSPACE_TOKEN` migration

**Date:** 2026-05-23
**Branch:** `deferred-029-pr-e-retire-legacy-token`

PR E completes the MCP auth model introduced in PR A: scoped api_keys rows are the
preferred per-call identity for MCP, replacing the legacy single-shared
`CONTEXT_HUB_WORKSPACE_TOKEN`. The legacy token still works by default (warns
on use) for back-compat; deployments that have fully migrated should harden
themselves by setting `MCP_LEGACY_TOKEN_DISABLED=true`.

## Why migrate?

The legacy single-shared token was global: every MCP call shared one secret with
no per-tenant scope. After DEFERRED-029 (B → D4), every MCP tool resolves the
token to a `CallerScope` (one of `undefined`, `null`, or a project-id string)
and the service layer enforces cross-tenant access through that scope. The
legacy token still maps to `null` (global, unrestricted), so it bypasses the
new per-project guard.

For a multi-tenant deployment, that's a security gap; a leaked legacy token
exposes every project's data. Scoped api_keys rows (`api_keys.project_scope`)
let an operator mint a per-team or per-CI-runner token that can ONLY access its
assigned project.

## Migration steps

### 1. Provision scoped api_keys for each caller

For each MCP client/agent that needs access, issue a scoped api_keys row via
the existing GUI (`/settings/access`) or REST (`POST /api/api-keys`). Set
`project_scope` to the project_id the caller is allowed to operate on. Admin
callers (CI runners that drive group/taxonomy/help endpoints) get
`project_scope = NULL` (global, but still a per-key audit trail).

### 2. Update MCP client config

Replace the `workspace_token` value in each MCP client's config with the
scoped api_keys token. The token is presented to MCP exactly the same way
(`workspace_token` field on every call); only the value changes.

### 3. Verify the deprecation warnings stop

Run the system normally for a few minutes and tail the server logs:

```sh
docker compose logs -f mcp | grep deprecated
```

You should see **no** `deprecated single-shared CONTEXT_HUB_WORKSPACE_TOKEN in
use` warnings. If any persist, identify the client by `token_prefix` in the
log line and update its config.

### 4. Harden: opt out of legacy token

Set `MCP_LEGACY_TOKEN_DISABLED=true` in the server env. From now on, any
attempt to use the legacy token returns `UNAUTHORIZED` — operators should still
keep `CONTEXT_HUB_WORKSPACE_TOKEN` unset in this mode (the env validation in
`src/env.ts` no longer requires it when `MCP_LEGACY_TOKEN_DISABLED=true`).

### 5. Audit

A deployment with `MCP_AUTH_ENABLED=true` + `MCP_LEGACY_TOKEN_DISABLED=true`
+ no `CONTEXT_HUB_WORKSPACE_TOKEN` set is the target end-state. Every
authenticated call is now mapped to an api_keys row, every scoped key has a
project boundary, and there is no global override.

## Env var matrix

| `MCP_AUTH_ENABLED` | `MCP_LEGACY_TOKEN_DISABLED` | `CONTEXT_HUB_WORKSPACE_TOKEN` | Behavior |
|---|---|---|---|
| `false` | (any) | (any) | Auth off; `workspace_token` ignored; every caller is unrestricted (`CallerScope = undefined`). |
| `true` | `false` (default) | set | Legacy token accepted (→ `null`, warns) AND api_keys rows accepted. Back-compat. |
| `true` | `false` (default) | unset | **Rejected by env validation** — set the token, or set `MCP_LEGACY_TOKEN_DISABLED=true`. |
| `true` | `true` | (any) | api_keys-only. Legacy token rejected with `UNAUTHORIZED`. Hardened end-state. |

## Code changes in PR E

- `src/env.ts`: added `MCP_LEGACY_TOKEN_DISABLED` env (default `false`); env
  validation relaxes `CONTEXT_HUB_WORKSPACE_TOKEN` requirement when
  `MCP_LEGACY_TOKEN_DISABLED=true`.
- `src/mcp/auth.ts`: `resolveMcpCallerScope` rejects the legacy token with
  `UNAUTHORIZED` when `MCP_LEGACY_TOKEN_DISABLED=true`. Default path warns.
- `src/mcp/index.ts`: removed the local `assertWorkspaceToken` wrapper; all
  remaining admin handlers (`help`, `list_groups`, `create_group`,
  `delete_group`, `list_group_members`, `list_taxonomy_profiles`) now go
  through `resolveMcpCallerScopeOrThrow` for consistent deprecation/disable
  gating.
- `src/mcp/auth-legacy-disabled.test.ts`: 3 unit tests for the legacy + opt-out
  paths.

## After PR E

PR F closes DEFERRED-029 with the auth-ON E2E slice (REST + MCP) and a
second-adversary security review covering all entity-id-derive cross-tenant
tests deferred through C/D series.
