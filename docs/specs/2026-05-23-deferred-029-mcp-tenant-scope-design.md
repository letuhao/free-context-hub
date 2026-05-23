# DEFERRED-029 — MCP tenant-scope enforcement — DESIGN

**Date:** 2026-05-23
**CLARIFY:** `2026-05-23-deferred-029-mcp-tenant-scope-clarify.md`
**Branch:** `deferred-029-mcp-tenant-scope-design`

This DESIGN locks the technical contract: the helper, the type, the service-fn shape, the MCP
token resolution, the per-domain classification, the migration sequence, the test strategy,
and the security review checklist.

---

## 1. The `CallerScope` type

A three-valued type that exactly mirrors the existing REST `req.apiKeyScope` semantics:

```ts
// src/core/security/callerScope.ts
export type CallerScope = string | null | undefined;
// undefined → auth-off / env-token / no middleware attached → UNRESTRICTED
// null      → admin/global key (api_keys.project_scope IS NULL)  → UNRESTRICTED
// string    → project-scoped key (api_keys.project_scope = '<id>') → enforced
```

The three-valued shape is deliberate: it preserves backward compatibility with **every existing
test that does not set a scope** (they pass `undefined`), and with **global admin keys** (they
pass `null`). Only project-scoped string keys are gated. This mirrors `requireScope.ts` exactly.

## 2. The helper — `assertCallerScope`

A single shared enforcement point, in one file, with one contract:

```ts
// src/core/security/callerScope.ts
import { ContextHubError } from '../errors.js';

export function assertCallerScope(callerScope: CallerScope, resourceProjectId: string): void {
  if (callerScope === undefined) return; // auth-off / env-token
  if (callerScope === null) return;      // global key
  if (callerScope !== resourceProjectId) {
    // No existence oracle — cross-tenant looks identical to unknown.
    throw new ContextHubError('NOT_FOUND', 'not found');
  }
}

/** Multi-project variant — strict-reject if the request reaches outside the caller's scope. */
export function assertCallerScopeMulti(callerScope: CallerScope, resourceProjectIds: string[]): void {
  if (callerScope === undefined || callerScope === null) return;
  // A scoped key may reach at most its own project.
  if (resourceProjectIds.length !== 1 || resourceProjectIds[0] !== callerScope) {
    throw new ContextHubError('NOT_FOUND', 'not found');
  }
}
```

The `NOT_FOUND` choice (not `UNAUTHORIZED`) is load-bearing: it preserves the **no-existence-oracle** property the REST middleware already enforces (a 403/401 would leak that the resource exists; a 404 doesn't).

## 3. Service function shape

Every service function whose current resource target is `projectId` accepts an optional
`callerScope` and calls the helper at the top:

```ts
export async function searchLessons(params: {
  projectId: string;
  callerScope?: CallerScope;  // NEW — optional, defaults to undefined (unrestricted, back-compat)
  query: string;
  // ...existing
}): Promise<SearchLessonsResult> {
  assertCallerScope(params.callerScope, params.projectId);
  // ... rest unchanged
}
```

**Backward compat:** `callerScope?: CallerScope` is optional. Every existing test that calls a
service without setting `callerScope` continues to pass (`undefined` → unrestricted). Only
when a REST route or MCP handler explicitly passes a project-scoped string is enforcement on.

## 4. REST integration

REST routes already have `req.apiKeyScope` attached by `auth.ts`. Thread it into every service
call:

```ts
router.post('/api/lessons', requireRole('writer'), async (req, res, next) => {
  try {
    const callerScope = (req as { apiKeyScope?: CallerScope }).apiKeyScope;
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await addLesson({ ...payload, projectId, callerScope });
    res.json(result);
  } catch (e) { next(e); }
});
```

The existing REST middleware (`requireScope`, `requireProjectScope`, `requireResourceScope`)
**stays in place** as the request-boundary fail-fast (defense in depth). Service-layer
enforcement is added beneath them. A redundant 404 from middleware before the service-layer
check is fine — both paths converge on the same outcome.

## 5. MCP integration — scoped tokens

### 5a. The auth-resolver

`src/mcp/index.ts` currently calls `assertWorkspaceToken(token)` against a single env var. New
design: a resolver that returns the caller's scope from the token.

```ts
// src/mcp/auth.ts
export async function resolveMcpCallerScope(token: string | undefined): Promise<CallerScope> {
  const env = getEnv();
  if (!env.MCP_AUTH_ENABLED) return undefined;            // auth-off → unrestricted (dev)
  if (!token) throw new ContextHubError('UNAUTHORIZED', 'workspace_token required');

  // 1. Legacy single-shared token (deprecated): resolves to null = global.
  if (env.WORKSPACE_TOKEN && token === env.WORKSPACE_TOKEN) {
    logger.warn({ token_prefix: token.slice(0, 6) }, 'mcp: deprecated single-shared workspace_token in use; migrate to a scoped api_keys token');
    return null;
  }

  // 2. Scoped api_keys lookup (SHA-256 hash + active row).
  const key = await lookupApiKey(token); // existing helper from auth.ts
  if (!key) throw new ContextHubError('UNAUTHORIZED', 'invalid token');
  return key.project_scope; // string | null
}
```

### 5b. Every MCP tool handler

```ts
server.tool('add_lesson', schema, async (args, { workspace_token }) => {
  const callerScope = await resolveMcpCallerScope(workspace_token);
  const result = await addLesson({ ...args, callerScope });
  return mcpResponse(result);
});
```

A small wrapper (e.g. `withMcpAuth`) is recommended to avoid repeating `resolveMcpCallerScope`
in every handler, but the contract — service receives `callerScope` — is unchanged either way.

### 5c. Backward compatibility / deprecation

The legacy single-shared `WORKSPACE_TOKEN` continues to work and resolves to `null` (global
key semantics), logging a deprecation warning. Clients can migrate to scoped tokens at their
pace. After a documented deprecation window, the legacy path can be removed.

## 6. Service classification (which functions get `callerScope`)

Recommendation from CLARIFY-Q2 confirmed: **every service fn that takes `project_id`**.
Incomplete coverage is exactly the asymmetry that caused this bug. Categories:

| Domain | Example services | PR phase |
|---|---|---|
| Lessons | `searchLessons`, `searchLessonsMulti`, `addLesson`, `updateLesson`, `updateLessonStatus`, `batchUpdateLessonStatus`, `deleteLesson`, `listLessonVersions`, etc. | B |
| Coordination | `createTopic`, `joinTopic`, `getTopic`, `closeTopic`, `postTask`, `claimTask`, `completeTask`, `submitRequest`, `proposeMotion`, `castVote`, `raiseDispute`, `postIntake`, `triageIntake`, etc. | C |
| Documents / chunks | `addDocument`, `runExtraction`, `searchChunks`, `deleteDocument`, etc. | D |
| Exchange | `exportProject`, `importProject` (owner check already exists — re-validate via helper) | D |
| Generated docs / git / projects | `listGeneratedDocs`, `analyzeCommitImpact`, project-source CRUD | D |

Admin-global services (no `project_id`, e.g. `listApiKeys`, `listLessonTypes`) remain
**unscoped** (require admin role via existing middleware; documented as global-by-design,
matching the 13.7 audit decision).

## 7. Multi-project queries

`searchLessonsMulti(projectIds: string[])` and any future multi-project fn uses
`assertCallerScopeMulti`. A scoped key calling multi-project search either:
- has its scope present in `projectIds` AND `projectIds.length === 1` → allowed;
- otherwise → `NOT_FOUND`.

Filter-down vs strict-reject: **strict-reject** is chosen to mirror `requireProjectScope({multi:true})`'s
explicit `400 project_scope_required` posture (translated to 404 here for no-oracle parity).
Silently filtering would let a scoped caller probe whether other projects exist by varying
`projectIds` and seeing result counts change.

## 8. Migration sequence (per-domain PRs)

Land in this order; each phase its own reviewable PR:

| # | PR | Scope | Why first/last |
|---|---|---|---|
| A | **Foundation** | `CallerScope` type + `assertCallerScope`/`Multi` helpers + unit tests + `resolveMcpCallerScope` + the deprecated-shared-token warning | No behavior change yet; everything else depends on these |
| B | **Lessons** | thread `callerScope` through all lesson services + REST routes + MCP handlers + service-level tests | High-blast-radius user-facing area; do first when reviewers are fresh |
| C | **Coordination** | topics/board/requests/motions/disputes/intake services + their REST routes + MCP handlers + tests | The Phase 15 surface; biggest single phase |
| D | **Documents + Exchange + Misc** | remaining domains (chunks, exchange, generated docs, git, project sources) | Cleanup tail |
| E | **MCP scoped tokens** | retire (or formally deprecate-and-still-accept) the single-shared workspace_token; migration docs | Last code phase — only safe once all callers honor `callerScope` |
| F | **Auth-ON E2E slice** | WS2's auth-ON tenant-scope tests covering both REST and **MCP** paths; security-framed adversarial review | The proof phase |

Each PR runs through the standard 12-phase workflow (CLAUDE.md), and PR B/C/D/E + F each
trigger a **security-framed second adversary review** before merge (CLAUDE.md safety-sensitive
code requirement).

## 9. Tests

### Per-service unit tests (add per domain in phases B/C/D)
For each service fn that gained `callerScope`, add at minimum:
- `callerScope=undefined` → behaves as today (back-compat baseline).
- `callerScope=null` (global key) → behaves as today.
- `callerScope='proj-X'` + `projectId='proj-X'` → OK (matching scope).
- `callerScope='proj-X'` + `projectId='proj-Y'` → throws `NOT_FOUND` (cross-tenant).

### Helper unit tests (phase A)
- All four cases above, parameterized; no DB needed.
- Multi variant: scope+single-matching ✓, scope+single-mismatching ✗, scope+multi ✗, null/undefined+anything ✓.

### Auth-ON E2E slice (phase F)
- Issue two `api_keys`: one scoped to `proj-A`, one scoped to `proj-B`.
- Issue legacy shared workspace_token.
- For each tool/route that takes `project_id`, attempt cross-tenant access on **both
  transports** (REST and MCP):
  - scope=A, project=A → 200/OK.
  - scope=A, project=B → 404 (no oracle).
  - global (legacy or null) → 200/OK.
- Assert MCP returns the same 404 shape it would on REST.

## 10. Security review checklist

For each PR (A–F), confirm before merge:

- [ ] No bypass paths — every service fn that touches `project_id` calls the helper. Grep proof
  appended to the PR.
- [ ] No information leakage — error messages do not differentiate "wrong scope" from "not
  found". `assertCallerScope` returns the same `NOT_FOUND` shape as the existing-row 404.
- [ ] No-oracle preserved — verified by the cross-tenant E2E case yielding identical bytes to
  the unknown-id case.
- [ ] Safe defaults — `callerScope=undefined` and `=null` documented as unrestricted; no path
  in a deployed instance silently sets a project-scoped key to undefined.
- [ ] Test coverage — the four-case matrix landed for every fn touched in the PR.
- [ ] No regression in 728+ baseline; tsc clean.
- [ ] Second-adversary security review CLEAR (cold-start review focused on bypass/escape paths,
  per CLAUDE.md safety-sensitive policy).

## 11. Risks (re-stated from CLARIFY with mitigations)

| Risk | Mitigation |
|---|---|
| **Mechanical breadth** (hundreds of call sites) | Per-domain PRs (§8); optional `callerScope?` keeps every untouched test green |
| **Test breakage on existing services** | Optional param + back-compat semantics (`undefined` = unrestricted) |
| **Legacy single-token regression** | Deprecate-not-remove in phase A; clients migrate on their pace |
| **Subtle bypass via a missed service fn** | Grep proof + adversary security review per PR |
| **Service-layer + REST-middleware double-check** | Intentional defense in depth; both 404 = same observable outcome |

## 12. Non-obvious decisions (rationale)

- **404 not 403/401:** the existing REST middleware already returns 404 for cross-tenant to
  avoid an existence oracle. The helper must use the same shape, or the seam becomes the
  oracle itself.
- **Optional `callerScope?` not required:** an unmissable required param would break every
  unit test on day one. Optional + sensible default (undefined = unrestricted) lets the
  rollout be per-domain and reviewable.
- **Reuse `api_keys` for MCP tokens (no new table):** one source of truth for both transports.
  The api_keys auth path is already battle-tested for hashing/lookup.
- **Strict-reject in multi-project (not silent filter):** silent filtering would let a scoped
  caller probe other projects' existence via result-count changes.
- **Helper in `src/core/security/`** (not `src/api/middleware/`): the helper enforces in the
  **service layer**, so it must live below the transport boundary. Putting it under `api/`
  would imply REST-only.

## 13. Next step

Plan (PLAN phase) — sequenced PRs A–F, each with its own acceptance + commit map. Approval
required at end of DESIGN before PLAN starts.
