# Actor Data Boundary — MCP + FE design (the foundation's external surface)

**Status:** DESIGN (drafts) · **Date:** 2026-06-19 · **Branch:** `feature/actor-data-boundary`
**Parent:** [`-FOUNDATION.md`](./2026-06-19-actor-data-boundary-FOUNDATION.md) (the model + F1–F4 build plan).
**Scope of this doc:** the *external* surface only — the MCP tool contract and the FE pages that
make the boundary **auditable and self-explaining**. The DB/service internals are F1–F4 in FOUNDATION.

> Why this doc exists: the foundation introduces *identity that is real instead of asserted* and a
> *delegation boundary*. Both are invisible unless we (a) give agents tools to know who they are and
> why an action was allowed, and (b) give humans pages that show the principal directory, the
> delegation tree, and the allow/deny decision log. "Huge feature with a lot of audit and explanation"
> → the surface is the audit + the explanation.

---

## 1. Shared vocabulary (used identically by MCP + FE + migrations)

These names are the contract. The HTML drafts and the F1–F4 migrations MUST use them verbatim.

### Principal
The single subject of every action. Replaces the current *asserted* `actor_id` string.

| Field | Type | Notes |
|---|---|---|
| `principal_id` | ULID (opaque) | never a human-typed name; un-spoofable |
| `kind` | `human` \| `agent` \| `system` | an **attribute**, not the authz axis (FOUNDATION line 4) |
| `status` | `active` \| `suspended` \| `retired` | suspended/retired ⇒ all `authorize()` deny |
| `display_name` | text | UI label only; never used for authz |
| `is_root` | derived | the one seeded root principal (F1); not a stored privilege flag you can grant |

`api_keys.principal_id → principals.principal_id`. A credential authenticates **to a principal**;
the principal is what gets authorized. Auth-off ⇒ caller resolves to the **root/dev** principal
(documented posture, not a leak — FOUNDATION F4).

### Scope
What a grant ranges over. Reuses the existing tenant machinery at the project level.

```
global              — whole deployment (root only, by default)
project:<id>        — reuses callerScope / assertProjectScope (DEFERRED-029)
topic:<id>          — Phase-15 topic (assertTopicScope)
task:<id>           — Phase-15 board task (assertTaskScope)
```

A scope **covers** a resource if the resource sits at-or-below it (project covers its topics/tasks;
global covers everything). Cross-scope access returns the existing `NOT_FOUND` shape, never a leak.

### Capability
Foundation keeps this a **small fixed set**. A Codex later is just a *named bundle* referenced by the
same grant row — no schema change (FOUNDATION "Codex seam").

```
read     — see resources in scope
write    — create/modify resources in scope
admin    — manage resources + settings in scope
delegate — re-grant a subset of one's own capabilities downward (bounded by own grant)
```

### Grant  (the delegation edge — the data boundary made of rows)
```
grant_id          ULID
grantee_principal → principals
scope             global | project:<id> | topic:<id> | task:<id>
capability        read | write | admin | delegate
granted_by        → principals   (root is the origin of the tree)
granted_at        timestamptz
revoked_at        timestamptz?   (null = active)
```
Invariant: `granted_by` must itself hold `delegate` (or be root) for `capability` at a scope that
**covers** the new grant's scope. You cannot grant upward or sideways out of your own subtree.

### authorize(principal, action, resource) → decision
Pure function, the single chokepoint:
```
ALLOW  iff principal.status = active
       ∧ ∃ grant: grant.grantee = principal
                ∧ grant.revoked_at IS NULL
                ∧ grant.capability covers action     (read⊂write⊂admin; delegate is orthogonal)
                ∧ grant.scope covers resource
DENY   otherwise, with a machine-readable reason:
       NO_PRINCIPAL | PRINCIPAL_INACTIVE | NO_COVERING_GRANT | OUT_OF_SCOPE | GRANT_REVOKED
```
The **reason** is what the FE "why" inspector and the MCP `explain_authorization` tool both render.
Root short-circuits to ALLOW (axiomatic — FOUNDATION line 1); that short-circuit is itself logged.

Every decision (allow and deny) appends one row to the existing append-only
`coordination_events` log (Phase-15), tagged `authz.decision`, carrying principal, action, resource,
result, reason, and matched `grant_id` (if any). That row is the audit trail the FE reads.

---

## 2. MCP tool surface

### 2.1 New tools

| Tool | Scope to call | Returns / does |
|---|---|---|
| `whoami` | any authenticated caller | the caller's **authenticated** principal: `{principal_id, kind, status, is_root, display_name}`. Lets an agent discover its own identity instead of asserting one. |
| `explain_authorization` | any caller, about itself; admin+ about others | input `{action, resource, principal_id?}` → `{decision, reason, matched_grant?, scope_chain[]}`. The agent-facing "why". Read-only; never mutates. |
| `list_principals` | `admin` at global, or root | directory filtered to caller's scope (a project admin sees principals with grants in that project). |
| `list_grants` | `read`+ on the scope, or the grantee themselves | grants filtered by `{principal_id?, scope?}`; a principal can always list its own. |
| `grant_capability` | `delegate` covering the target scope, or root | creates a grant bounded by the caller's own subtree; rejects upward/sideways grants. |
| `revoke_grant` | `delegate`/`admin` over the grant's scope, or `granted_by`, or root | sets `revoked_at`; idempotent. |

### 2.2 Contract change to EXISTING write tools (the F1 breaking note)

Today many MCP tools accept an **asserted** `actor_id` / `created_by` / agent name in the payload and
trust it. After F1:

- The acting principal is **derived from the credential**, never from the body.
- If a tool still receives an `actor_id` in its args and auth is ON, it must **reject on mismatch**
  (`ASSERTED_IDENTITY_REJECTED`) rather than honor the asserted value.
- Auth OFF (dev/root posture): the asserted value is accepted as today — behavior unchanged, so dev
  loops and the auth-off CI lane don't break. This split is the whole F1 acceptance criterion.

Affected tools (audit during F1, not exhaustive here): `add_lesson`, anything writing
`coordination_events`, board/claim/motion writers, request/intake writers. The grep target is every
handler that reads an actor/author field from `args`.

### 2.3 Unchanged
Knowledge tools (`search_lessons`, `search_code_tiered`, `check_guardrails`, `get_project_summary`)
keep their shape; they gain *enforcement* (scope-filtered results when auth is on) but no new args.

---

## 3. FE pages (drafts in `docs/gui-drafts/pages/`)

All four follow the house style: standalone HTML, Tailwind CDN, dark zinc theme, draft comment citing
the source `page.tsx`, breadcrumb → header → stat row → tabs → cards/table → slide-over/modal, with
alternate states stacked under `mt-12` section labels.

| Draft | Route (proposed) | Foundation phase | Job |
|---|---|---|---|
| `identity.html` | `/identity` | F1, F4 | principal directory; root marked + out-of-band note; auth-on/off **posture banner**; principal slide-over (kind, status, bound keys, grants summary) |
| `delegation.html` | `/delegation` | F2 | the **delegation tree** (root → … ), grant rows with scope+capability+granted_by, grant modal, revoke, "scope coverage" explainer |
| `authorization.html` | `/authorization` | F2, F3 | the **decision log** (allow/deny + reason) and the **"why" inspector** (simulate: can X do Y on Z → the matched grant chain or the denial cause) |
| `access-control-v2.html` | `/settings/access` (rework) | F1 | api_keys now show the **principal** they bind to; "role" reframed as the principal's grants; revoke unchanged |

Design intent the drafts must carry through (the "explanation" requirement):
- **Never show a bare allow/deny.** Always show the *reason token* and, for allows, the *matched grant*;
  for denies, *which condition failed*.
- **Root is visually distinct and labeled "out-of-band / axiomatic"** everywhere it appears — it is
  never presented as a grantable privilege.
- **Posture banner** (auth on vs off) is always visible on identity + authorization, because the same
  action's outcome differs by posture and a reviewer must never confuse dev-mode allow with a real grant.

---

## 3b. Resolved contract decisions (from the FE+MCP coverage eval)

The eval (`-fe-mcp-eval.md`) surfaced three MED contract gaps. Decisions:

- **G3 — Agent credential-expiry / re-auth contract.** When a bound credential is expired/revoked/
  rotated-out mid-use, the tool layer returns a structured error **`CREDENTIAL_EXPIRED`** (distinct from
  authz `DENY`) carrying `{principal_id, reason: expired|revoked|rotated, retry_after?}`. The agent must
  **stop and surface it**, not retry-loop. Recovery is out-of-band: a human re-issues, or an ephemeral
  key is re-minted. `whoami` also returns the credential's `expires_at` so a long-running agent can
  pre-empt. (Implemented in F1's auth layer; tested in the F1 adversary pass.)
- **G6 — Agent self-service via MCP.** **Allowed, bounded by the subtree.** An agent holding `delegate`
  at a covering scope MAY call `grant_capability` for a child principal and MAY mint an **ephemeral**
  child key (`POST /api/keys/ephemeral`, also exposed as MCP tool `mint_ephemeral_key`), strictly within
  its own grants. It MAY NOT create durable keys or register human principals (invite-only stays
  human/REST). Every agent-initiated grant/mint writes a `coordination_events` row attributed to the
  parent principal. This gives sub-agent fan-out a real credential path.
- **G11 — "Rebind key → principal".** **Removed as a direct action.** Re-pointing a credential to a
  different principal is a silent privilege change; the UI offers **revoke + reissue** instead (mint a
  new key on the target principal, revoke the old). If a true rebind is ever needed it is **root/admin-
  only, requires re-auth, and emits a high-signal `credential.rebind` audit event** — the foundation
  ships without it. The access-control-v2 draft's "Rebind" button should read "Revoke" in the built page.

## 4. Out of scope here (DLF-growth track, not the foundation)
Codex bundles, sealing/re-consecration, refer-back, collective-decision routing, retention/erasure
surfaces. Each becomes an *added* page + MCP tool on this same vocabulary later (FOUNDATION
"Deferred → DLF growth track"). The drafts intentionally leave header room (a disabled "Codices" tab
placeholder is allowed) but implement none of it.
