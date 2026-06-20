# F2f — enforcement wiring rollout (REPLACE assertCallerScope with authorize())

**Decision:** PURE REPLACE NOW — `authorize()` becomes the sole tenant/authorization gate; the legacy
`assertCallerScope`/role checks are **removed** as each site is migrated. No backstop. Tenant isolation
then rests entirely on correctly-seeded grants (F2e backfill + the enforce-ready coverage gate).

## The primitive (frozen — built + tested in F2b/F2f)
`assertAuthorized(principalId, action, resource, executor?)` (src/services/authorize.ts):
- ALLOW (covering grant / root / **auth-off AUTH_DISABLED**) → returns void.
- `read` deny or unresolvable resource → throws `NOT_FOUND` (same no-leak shape assertCallerScope gave
  a cross-tenant resource — no existence oracle).
- write/admin/delegate deny on a resolvable resource → throws `FORBIDDEN` (403).
Every migrated site calls this. **Inert while `MCP_AUTH_ENABLED=false`** ⇒ the migration is incrementally
safe: a half-migrated tree behaves exactly as today until the F2g flip.

## The shape of one replacement
Today a service asserts deep, with the tenant value threaded as `callerScope`:
```
assertCallerScope(callerScope, resourceProjectId);          // DEFERRED-029
```
After F2f the same point asserts with the acting principal + the action + the resolved resource:
```
await assertAuthorized(actingPrincipalId, ACTION, { kind: 'project', id: resourceProjectId });
```
So each domain migration is three mechanical moves:
1. **Thread the acting principal** where `callerScope` is threaded. The handlers already resolve it
   (`resolveActingActorOrThrow` → `actingPrincipalId`; REST `bearerAuth`). Evolve the threaded
   `callerScope: CallerScope` param into `actingPrincipalId: string | null` (drop the legacy scope —
   pure replace), or add it alongside per-fn where mixed callers exist.
2. **Map the action** per call site: `read` (search_*/get_*/list_*), `write` (add/post/claim/cast/
   write/update), `admin` (settings/delete/manage). `assert*Scope` for a topic/task uses
   `{kind:'topic'|'task', id}` instead of `{kind:'project', id}`.
3. **Delete** the `assertCallerScope`/`assert*Scope` call and the now-unused `callerScope` plumbing.

## Domain ordering (mirror DEFERRED-029's slices — largely DISJOINT file sets)
Each domain: wire `assertAuthorized`, delete the legacy asserts, add an **auth-ON cross-actor denial
test** (a scoped principal is NOT_FOUND/FORBIDDEN outside its grants; cross-project still NOT_FOUND),
re-run the suite, commit. Domains:
1. **lessons** (`lessons.ts`, route, `add_lesson` MCP) — smallest, establishes the pattern.
2. **coordination board** (`board.ts`, `topics.ts`, `artifacts.ts`, `claims`) + the ~24 coordination MCP tools.
3. **decisions** (`decisionBodies.ts`, `motions.ts`, `proxies.ts`, `requests.ts`, `intake.ts`, `disputes.ts`).
4. **documents** (`documents.ts`, `documentChunks.ts`, `generatedDocs.ts`, `extraction/*`).
5. **git / workspace** (`gitIntelligence.ts`, `repoSources.ts`, `workspaceTracker.ts`, `snapshot.ts`).
6. **search / retrieval** (`retriever.ts`, `tieredRetriever.ts`, `search` route).
7. **jobs / exchange / taxonomy / guardrails / projectGroups** (the remainder).
8. **REST middleware** — once every route's service enforces, retire `requireScope`/`requireResourceScope`/role middleware.

~120 `assert*Scope` calls + 29 routes total. **This is a /warp candidate** — domains are disjoint
file sets behind the frozen `assertAuthorized`, so they can fan out as independent slices and reconcile
trivially. Or run serially domain-by-domain under /loom.

## Action-mapping reference (resolve ambiguity up front)
| Operation class | action |
|---|---|
| search_*, get_*, list_*, read a resource | `read` |
| add_*, post_*, claim_*, release_*, cast_vote, write_artifact, submit_*, propose/second, update_* | `write` |
| settings, feature toggles, delete_*, create_decision_body, manage members, close_topic | `admin` |
| grant_capability, revoke_grant | `delegate` (already wired in F2d) |

## After F2f
- F2g: posture-flip PREREQUISITES + docs only. The `MCP_AUTH_ENABLED` default flip itself is a
  **separate, explicitly human-gated** step (run bootstrap:root → migrate:coordination-actors →
  backfill:grants → verify enforce-ready → flip). NOT done in this build.
- A 3rd cold-start adversary pass over the wired enforcement (new high-risk surface).
- callerScope tenant-containment (F2-adv2-deferred): resolved by pure-replace — callerScope is gone.
