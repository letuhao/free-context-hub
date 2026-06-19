# F2 — DESIGN: the `authorize()` chokepoint

**Phase:** F2 DESIGN (continuous-flow). Pins the adversary-sensitive core; the substrate (grants
table/service), tools, backfill and decomposition live in
[`-F2-clarify.md`](2026-06-19-actor-data-boundary-F2-clarify.md). F2a (grants table + service) is
shipped (`ecdf6b4`).

## 1. Capability lattice
```
read ⊂ write ⊂ admin       (rank: read=1, write=2, admin=3)
delegate                    (orthogonal — NOT implied by admin, implies nothing else)
```
`capabilityCovers(granted, action)`:
- `action ∈ {read,write,admin}` → `granted ∈ {read,write,admin} ∧ rank(granted) ≥ rank(action)`.
  (`delegate` does **not** cover resource actions.)
- `action === 'delegate'` → `granted === 'delegate'`. (`admin` does **not** confer delegate — the
  delegation invariant requires an explicit `delegate` grant or root.)

## 2. Scope coverage
Resource hierarchy (Phase-15): **project ⊃ topic ⊃ task** (`tasks.topic_id → topics`,
`topics.project_id → project`). A resource is expressed as a fully-resolved **ResourceScope**:
```
{ kind: 'global' }
{ kind: 'project', project_id }
{ kind: 'topic',   project_id, topic_id }
{ kind: 'task',    project_id, topic_id, task_id }
```
`scopeCovers(grant, resource)` (PURE — operates on the already-resolved chain):
| grant.scope_type | covers resource iff |
|---|---|
| `global` | always |
| `project` | `grant.scope_id === resource.project_id` |
| `topic`   | resource has a `topic_id` ∧ `grant.scope_id === resource.topic_id` |
| `task`    | resource has a `task_id` ∧ `grant.scope_id === resource.task_id` |

The **impure resolver** `resolveResourceScope(kind, id, callerScope?) → { ok: ResourceScope } |
{ unresolvable: 'NOT_FOUND' }` does the DB walk (task→topic→project). It **returns** (never throws)
so `authorize()` stays total and every decision is logged. `unresolvable` covers both a missing id
and a cross-tenant id (same outcome — no existence oracle). Keeping the walk out of the pure core
keeps `decide()` unit-testable. For `kind:'global'` the resolver is a no-op `{ ok: {kind:'global'} }`.

## 3. authorize()
```ts
type Action = 'read' | 'write' | 'admin' | 'delegate';
type AllowReason = 'ROOT' | 'GRANT';
type DenyReason  = 'NO_PRINCIPAL' | 'PRINCIPAL_INACTIVE' | 'NO_COVERING_GRANT'
                 | 'OUT_OF_SCOPE' | 'GRANT_REVOKED';
type Decision =
  | { allow: true;  reason: AllowReason; matched_grant_id?: string }
  | { allow: false; reason: DenyReason };
```
**Pure core** `decide(principal, action, resource, activeGrants) → Decision`:
```
if principal == null            → DENY NO_PRINCIPAL
if principal.is_root            → ALLOW ROOT            (short-circuit, still logged)
if principal.status != active   → DENY PRINCIPAL_INACTIVE
g = first active grant with capabilityCovers(g.capability, action) ∧ scopeCovers(g, resource)
if g                            → ALLOW GRANT matched=g.grant_id
else                            → DENY NO_COVERING_GRANT
```
- `OUT_OF_SCOPE` is produced by the **async wrapper** when the resolver returns `unresolvable`
  (BEFORE `decide` runs): wrapper logs `DENY OUT_OF_SCOPE` and returns `{allow:false, reason:
  'OUT_OF_SCOPE'}`. `authorize()` itself NEVER throws for an authz reason — it is total.
- **Handler mapping (no-leak):** on a false decision the handler maps `OUT_OF_SCOPE` (and a deny on a
  *read of a specific resource*) to `NOT_FOUND`; a write/admin deny with grants-present maps to
  `UNAUTHORIZED`/`FORBIDDEN`. The decision log keeps the precise reason; the wire stays non-oracular.
- `GRANT_REVOKED` is an **explain-only** reason (`explain_authorization` naming a specific revoked
  grant_id); the live path loads active grants only, so a revoked grant simply fails to match.
- **Async wrapper** `authorize(principalId, action, resourceRef) → Decision` = load principal +
  active grants + `resolveResourceScope`; if unresolvable → log+return OUT_OF_SCOPE; else `decide`,
  then **log** (§4). Always returns a Decision; logging is best-effort and never alters it.

## 4. Decision log  *(BUILD correction)*
~~Reuse `coordination_events`~~ — that log is hard **topic-scoped** (`topic_id NOT NULL`, PK
`(topic_id, seq)`, `subject_type` CHECK without `authz`), so a global/project authz decision has no
valid topic to attach to. Instead, a **dedicated append-only `authz_decisions` table** (migration
0067) — which also IS the FE "decision log". Columns: `decision_id, ts, principal_id (TEXT, null when
NO_PRINCIPAL), action, resource_kind, resource_id (null for global), allow, reason, matched_grant_id`.
No FKs (audit immutability — logging must never fail a decision or block a principal delete). Logging
is **best-effort** (swallow errors, like `last_used_at`); it never alters the decision.

**AUTH-OFF fast path:** when `MCP_AUTH_ENABLED=false`, `authorize()` returns `{allow:true, reason:
'AUTH_DISABLED'}` immediately — no DB, no log (dev/root posture unchanged; the whole F2 build stays
inert until the posture flip). `AUTH_DISABLED` is added to `AllowReason`.

## 5. Delegation invariant (grant time — F2c)
`grant_capability(caller, grantee, scope, capability)` requires `authorize(caller, 'delegate',
scope) == ALLOW` (caller holds `delegate` covering — or above — the new grant's scope), or caller is
root. Rejects upward/sideways grants. `createGrant` (F2a) stays the low-level writer; the invariant
lives in the tool/service layer.

## 6. Backfill mapping (F2e — the lockout guard)
Each active, principal-bound, non-root credential's `(role, project_scope)` →
```
admin  + scope NULL  → grant: admin @ global
admin  + scope P     → grant: admin @ project:P
writer + scope P     → grant: write @ project:P
reader + scope P     → grant: read  @ project:P
writer/reader + NULL → grant @ global (admin keys are the only intended global writers; flag in log)
```
granted_by = root. Idempotent (the active-edge unique index). `assertEnforceReady` gains a gate:
refuse while any active non-root principal-bound credential lacks a covering grant.

## 7. Enforcement wiring (F2f — REPLACE)
`authorize()` replaces `assertCallerScope` + role middleware at the service/handler layer, domain by
domain. Action mapping: reads (`search_*`, `get_*`, `list_*`) → `read`; writes (`add_*`, `post_*`,
`claim_*`, `cast_vote`, …) → `write`; settings/admin ops → `admin`; `grant_capability`/`revoke_grant`
→ `delegate`. Each domain re-tested before the next. Auth-OFF posture unchanged (authorize() is a
no-op pass-through when `MCP_AUTH_ENABLED=false` — dev/root lane intact). The `MCP_AUTH_ENABLED`
default flip is **out of scope for this build** (explicit human go required).

## 8. Adversary targets (REVIEW-design + per-phase)
1. `delegate` leaking resource access (orthogonality break) or `admin` silently conferring delegate.
2. Scope-coverage confusion: a `topic` grant covering a sibling topic's task; a stale topic_id.
3. Resolver as an existence oracle (cross-tenant must be `NOT_FOUND`, not a distinct reason).
4. Root short-circuit bypassing the status gate for a *non-root* (ordering of checks).
5. Backfill minting a global write grant from a non-admin key (privilege inflation).
6. Decision-log failure flipping a deny to allow (fail-open).
