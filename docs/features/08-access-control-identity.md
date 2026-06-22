# Access Control & Identity

free-context-hub is multi-tenant and multi-actor. Every caller is a **principal**
with a **scope**, and what they can do is governed by **capability grants**. This is
the security substrate for everything else.

## Key concepts

- **Principals** — users, agents, and system identities live in a principal
  directory. A credential (API key, session) resolves to exactly one authenticated
  principal.
- **Caller scope** — every service call is tenant-scoped; the scope is derived from
  the credential and enforced end-to-end (the DEFERRED-029 work threaded
  `callerScope` through ~115 functions).
- **Capability grants** — authorization is grant-based: a principal is granted a
  capability at a scope. `explain_authorization` evaluates a would-be action.
- **API keys** — minted per principal with roles (admin / writer / reader), stored as
  hashes. **Ephemeral keys** are short-lived (1–24h), principal-bound keys for CI and
  agents.
- **Authentication (humans)** — password login with MFA (TOTP + backup codes),
  session management, password reset, and account lockout — aligned to NIST 800-63B
  AAL2.
- **Bootstrap** — first-run wizard seeds the root/operator principal, gated by
  `ROOT_BOOTSTRAP_TOKEN`.

## How to use it

### MCP (agents)

| Tool | Purpose |
|------|---------|
| `whoami` | The caller's authenticated principal |
| `grant_capability` / `revoke_grant` / `list_grants` | Manage grants |
| `explain_authorization` | Evaluate whether a principal may act |
| `list_principals` | Directory listing (admin@global) |
| `mint_ephemeral_key` | Short-lived principal-bound key for CI/agents |

### REST

- `GET /api/me` — current identity, role, scope
- `/api/auth` — login, MFA, sessions, password reset
- `/api/principals`, `/api/grants`, `/api/authz`
- `/api/api-keys`, `/api/access-review` (key staleness audit)
- `/api/invites`, `/api/bootstrap`

### GUI

- **Login** (`/login`) — password + optional MFA, forgot-password.
- **Access Control** (`/settings/access`) — API keys, roles, permissions matrix.
- **Sessions & Security** (`/settings/sessions`) — list/revoke active sessions.
- **Access Review** (`/governance/access-review`) — credential rotation, ephemeral
  key minting, age/TTL tracking.
- **Identity / Delegation / Authorization** (`/identity`, `/delegation`,
  `/authorization`) — principal directory, grant/proxy management, authorization tree.

## Configuration

```bash
MCP_AUTH_ENABLED=true            # enforce auth on the MCP surface
ROOT_BOOTSTRAP_TOKEN=...         # first-run bootstrap gate
MCP_LEGACY_TOKEN_DISABLED=true   # retire the deprecated workspace token
```

## Safety note

This area is **safety-sensitive**: changes get a cold-start hostile-actor adversary
review and live end-state verification. See the
[safety-sensitive review policy](../../CLAUDE.md) and
[`../deferred-029-closeout.md`](../deferred-029-closeout.md).

## Related

- [Governance & Decisions](07-governance-decisions.md) · [Projects & Portability](09-projects-portability.md)
