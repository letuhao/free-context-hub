# F2 — Delegation + scope (the boundary): CLARIFY

**Branch:** `feature/actor-data-boundary` · **Date:** 2026-06-19 · **Phase:** F2 (after F1 COMPLETE)
**Mandate (FOUNDATION line 3 + build plan):** `grants(grantee, scope, capability, granted_by)`; root
is the delegation source; `authorize(principal, action, resource)` = covering grant ∧ project/task
scope (reuse `assertXScope`). **AC:** a scoped actor cannot read/act outside its grants; cross-project
still `NOT_FOUND`.

## What F1 established (the substrate F2 builds on)
- `principals` (opaque UUID id, kind, status active|suspended|retired, single `is_root`).
- Credentials bind to principals; the **acting principal** is derived from the credential
  (`resolveActingActor`), un-spoofable under auth-ON.
- `CallerScope = string | null | undefined` (`src/core/security/callerScope.ts`): `undefined` =
  auth-off (unrestricted), `null` = admin/global key (unrestricted), `string` = project-scoped key
  (must equal the resource's project_id, else `NOT_FOUND`). This is today's de-facto authority.
- The coordination namespace is principal-keyed (F1f migration); auth stays OFF until F4.

## The core design (from -mcp-fe-design.md §1, code-accurate)
**Scope** (what a grant ranges over): `global | project:<id> | topic:<id> | task:<id>`. A scope
*covers* a resource if the resource sits at-or-below it (project covers its topics/tasks; global
covers everything). Out-of-scope = the existing `NOT_FOUND` shape, never a leak.

**Capability** (small fixed set; a Codex is a named bundle on the same row later):
`read ⊂ write ⊂ admin`; `delegate` is orthogonal.

**Grant** (the delegation edge): `grant_id UUID` (UUID per F1 codebase convention, not ULID),
`grantee_principal → principals`, `scope_type + scope_id`, `capability`, `granted_by → principals`
(root = origin), `granted_at`, `revoked_at?` (null = active).
*Delegation invariant:* `granted_by` must itself hold `delegate` (or be root) for `capability` at a
scope that **covers** the new grant's scope — no upward/sideways grants out of one's own subtree.

**authorize(principal, action, resource) → decision** (the single chokepoint):
```
ALLOW iff principal.status = active
      ∧ ∃ grant: grantee = principal ∧ revoked_at IS NULL
               ∧ capability covers action ∧ scope covers resource
DENY  otherwise, reason ∈ { NO_PRINCIPAL | PRINCIPAL_INACTIVE | NO_COVERING_GRANT
                          | OUT_OF_SCOPE | GRANT_REVOKED }
```
Root short-circuits to ALLOW (axiomatic), and that short-circuit is itself logged. Every decision
(allow + deny) appends one `coordination_events` row tagged `authz.decision`.

**New MCP tools:** `explain_authorization` (read-only "why"), `list_principals` (admin@global/root),
`list_grants` (read+ on scope, or the grantee), `grant_capability` (delegate covering target, or
root), `revoke_grant` (delegate/admin over scope, or granted_by, or root). `whoami` already shipped
in F1.

## Proposed decomposition (mirrors F1's TDD + per-phase adversary rhythm)
- **F2a** — `grants` substrate: migration (`grants` table + indexes) + grants service skeleton
  (`createGrant`, `revokeGrant`, `listGrants`) with status/shape guards. Adversary.
- **F2b** — `authorize()` pure core: capability lattice, scope-coverage (`global⊃project⊃topic/task`
  with topic/task→project resolution), ALLOW/DENY + reason tokens, root short-circuit,
  principal-status gate. Pure where possible; DB only for grant lookup + scope resolution. Adversary
  (this is THE chokepoint — multi-pass).
- **F2c** — delegation invariant at grant time (`granted_by` must hold `delegate` covering the new
  scope; reject upward/sideways) + decision logging to `coordination_events` (`authz.decision`).
  Adversary.
- **F2d** — MCP tools (`grant_capability`, `revoke_grant`, `list_grants`, `explain_authorization`,
  `list_principals`) wired to their own self-authorization via `authorize()`. Adversary.
- **F2e** — **representative** resource enforcement proving the AC (one read path + one write path:
  scoped actor denied outside grants; cross-project `NOT_FOUND`) + live cross-actor denial test.
  Blanket enforcement across all ~70 endpoints stays F4. Adversary + live test.

## RESOLVED decisions (2026-06-19 checkpoint)
1. **Authority model → REPLACE NOW.** `authorize()` becomes the sole gate; `api_keys.role` +
   `project_scope` are deprecated as the enforcement axis (kept as columns for backfill provenance,
   no longer consulted at decision time). `is_root` short-circuits ALLOW.
2. **Enforcement breadth → FULL NOW.** authorize() is wired into all resource handlers this phase;
   F4 (separate "posture" phase) is effectively collapsed into F2. The MCP_AUTH_ENABLED *default*
   flip remains a deliberate, separately-checkpointed step (the one-way door — see below).

### Consequences of replace + full-enforce (the one-way-door risk)
- **Mandatory grant backfill.** Before auth-ON, every active credential's `(role, project_scope)`
  must become an equivalent grant on its bound principal:
  `admin+null → admin@global`, `admin+project → admin@project:<id>`, `writer+project →
  write@project:<id>`, `reader+project → read@project:<id>`. A new CLI
  (`npm run backfill:grants`) does this idempotently. Root needs no grant (short-circuit).
- **Unbound keys (principal_id NULL) are denied under auth-ON** — already the F1 hardened posture;
  operators must rebind them to principals (F1 tools) or they lose access. Documented, not a leak.
- **`assertEnforceReady` gains a gate:** refuse enforce-ready while any active, principal-bound,
  non-root credential lacks a covering grant (otherwise the flip locks that caller out).
- The actual `MCP_AUTH_ENABLED` default flip + removal of the legacy `requireScope`/role middleware
  is the LAST sub-phase and gets its own checkpoint + cold-start security adversary + live auth-ON
  verification. Everything before it is inert while auth is OFF (dev/root posture unchanged).

### Revised decomposition (replace + full-enforce)
- **F2a** — `grants` substrate: migration + service skeleton (`createGrant`/`revokeGrant`/
  `listGrants`). Inert while auth OFF. *(on the critical path under every option — safe to build now)*
- **F2b** — `authorize()` pure core (lattice + scope-coverage + reasons + root short-circuit +
  status gate). Pure/DB-read only; changes no runtime behavior yet. Adversary (multi-pass).
- **F2c** — delegation invariant at grant time + `authz.decision` logging to `coordination_events`.
- **F2d** — MCP tools (`grant_capability`, `revoke_grant`, `list_grants`, `explain_authorization`,
  `list_principals`), self-authorized via authorize().
- **F2e** — backfill migration/CLI (`role+scope → grant`) + `assertEnforceReady` grant-coverage gate.
- **F2f** — wire authorize() into the service/handler layer, REPLACING `assertCallerScope` + role
  checks (the blast radius — done methodically, domain by domain, each with re-test). Adversary.
- **F2g** — posture flip prerequisites + docs; the `MCP_AUTH_ENABLED` default flip itself stays gated
  behind a final checkpoint. Cold-start security adversary + live auth-ON cross-actor denial test.

## Assumptions (will hold unless you say otherwise)
- `grant_id` is UUID (`gen_random_uuid()`), following F1, not the spec's literal "ULID".
- Auth stays OFF by default through F2; F2's AC is verified in an auth-ON test lane, not by flipping
  the deployment default (that's F4).
- Scope set is exactly `global | project | topic | task` (no custom scopes this phase).
- `coordination_events` is the decision-log sink (no new audit table) — reuses Phase-15 machinery.
- No FE this phase (the `delegation.html` / `authorization.html` drafts exist; building them is a
  separate FE pass after the MCP surface is proven, same as F1 deferred its FE).
```
