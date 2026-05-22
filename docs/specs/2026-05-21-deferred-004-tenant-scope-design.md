# DEFERRED-004 — tenant-scope service-handler audit — DESIGN

**Date:** 2026-05-21
**Spec:** `docs/specs/2026-05-21-deferred-004-tenant-scope-clarify.md` (Q1–Q4 approved, strict-reject)
**Status:** DRAFT rev 2 — F1 BLOCK (derive-on-id) + F2/F3 addressed
**Size:** L · no migration

## rev 2 principle (F1)
Split guards by route shape: a route with a **project-owned resource `:id`** uses
`requireResourceScope(entity, param)` — DERIVE the project from the id (never trust a
caller-declared `project_id`, which a cross-tenant id would bypass). Only **collection
routes** (no resource id; project genuinely in body/query) use `requireProjectScope`.

## §0 Posture
- `req.apiKeyScope` undefined (auth-off / env-token) OR null (global) → `next()`
  (unrestricted; dev posture, no regression).
- Scoped key: must declare a project that equals scope.
  - Absent → **400 BAD_REQUEST `project_scope_required`**.
  - Present, single, ≠ scope → **404 NOT_FOUND** (no existence oracle).
  - Multi `project_ids[]`: any entry ≠ scope → 404; absent → 400.

## §1 `requireProjectScope` middleware (new, in requireResourceScope.ts)

```ts
type ProjectSource = 'body' | 'query' | 'query-or-body';

export function requireProjectScope(source: ProjectSource, opts: { multi?: boolean } = {}) {
  return (req, res, next) => {
    const scope = (req as { apiKeyScope?: string|null }).apiKeyScope;
    if (scope === undefined || scope === null) return next();

    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = req.query as Record<string, unknown>;

    // multi: project_ids[] (csv or repeated) — query only
    if (opts.multi) {
      const raw = query.project_ids;
      if (raw !== undefined) {
        const ids = Array.isArray(raw) ? raw.map(String)
          : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length === 0) return reject400(res);
        for (const id of ids) if (id !== scope) return notFound404(res);
        return next();
      }
      // fall through to single project_id below
    }

    let declared: string | undefined;
    if (source === 'body') declared = strOrUndef(body.project_id);
    else if (source === 'query') declared = strOrUndef(query.project_id);
    else /* query-or-body */ declared = strOrUndef(query.project_id) ?? strOrUndef(body.project_id);

    if (declared === undefined) return reject400(res); // project_scope_required
    if (declared !== scope) return notFound404(res);
    next();
  };
}
```
`reject400` → `{status:'error', code:'BAD_REQUEST', error:'project_scope_required: a scoped key must declare project_id'}`.
`notFound404` → `{status:'error', code:'NOT_FOUND', error:'project not found'}`.
`strOrUndef(v)` → `typeof v === 'string' && v ? v : undefined`.

## §2 Resource resolvers (extend requireResourceScope RESOLVERS)
Add three resolvers (confirm column names in BUILD):
- `document`: `SELECT project_id FROM documents WHERE doc_id = $1`
- `learning_path`: `SELECT project_id FROM learning_paths WHERE path_id = $1`
- `conversation`: `SELECT project_id FROM chat_conversations WHERE conversation_id = $1`

(Add `'document' | 'learning_path' | 'conversation'` to the `ScopeEntity` union.)
rev 2 (F2): no `job`/`chunk` resolver needed — chunk/job/lesson sub-routes are guarded
via their parent `:id`=doc_id (`document` resolver), which is the authoritative owner.

## §3 Application matrix (rev 2 — derive-on-id vs collection)

**Collection routes (no project-owned `:id`) → `requireProjectScope`:**

### git.ts (commits are keyed by (project_id, sha) — project guard is authoritative)
- `POST /git/ingest` → `requireProjectScope('body')`
- `GET /git/commits` → `requireProjectScope('query')`
- `GET /git/commits/:sha` → `requireProjectScope('query')` (sha scoped within project_id)
- `POST /git/suggest-lessons` → `requireProjectScope('body')`
- `POST /git/analyze-impact` → `requireProjectScope('body')`

### jobs.ts
- `POST /jobs` → `requireProjectScope('body')`
- `GET /jobs` → `requireProjectScope('query', { multi: true })`
- `POST /jobs/run-next` → **Tier-2 deferred** (cross-project pop; new deferred item).

### workspace.ts (no resource id; project in body/query)
- `POST /workspace/register` → body · `GET /workspace/roots` → query
- `POST /workspace/scan` → body · `POST /sources/configure` → body
- `GET /sources` → query · `POST /sources/prepare` → body

### chat.ts
- `POST /chat` → `requireProjectScope('body')`

### documents.ts — collection
- `POST /documents/upload|ingest-url|/documents|/bulk-extract|/chunks/search` → `requireProjectScope('body')`
- `GET /documents` (list) → `requireProjectScope('query')`

### chatHistory.ts — collection
- `POST /chat/conversations` (create) → `requireProjectScope('body')`
- `GET /chat/conversations` (list) → `requireProjectScope('query')`

### learningPaths.ts — collection
- `GET /learning-paths` → `requireProjectScope('query')` · `POST /learning-paths` → `requireProjectScope('body')`

### projectGroups.ts
- `POST /groups/:id/members` → `requireProjectScope('body')` (group_id is NOT a project; the added project is in the body)
- `DELETE /groups/:id/members/:projectId` → `requireScope('projectId')` (15.x param guard — :projectId IS a project_id)
- `GET /groups/by-project/:projectId` → `requireScope('projectId')`
- `GET /groups`, `POST /groups`, `DELETE /groups/:id`, `GET /groups/:id/members` → group-level (cross-project container by design) — NO project guard (documented).

---

**Resource routes (project-owned `:id`) → `requireResourceScope(entity, param)` (derive from id):**

### documents.ts — `requireResourceScope('document','id')` on EVERY `/documents/:id/*`
`GET /:id`, `DELETE /:id`, `POST /:id/generate-lessons`, `POST /:id/extract`,
`POST /:id/extract/estimate`, `GET /:id/extraction-status`, `GET /:id/chunks`,
`PUT /:id/chunks/:chunkId`, `DELETE /:id/chunks/:chunkId`, `POST /:id/jobs/:jobId/cancel`,
`GET /:id/thumbnail`, `POST /:id/lessons/:lessonId`, `DELETE /:id/lessons/:lessonId`,
`GET /:id/lessons`. (The `:id`=doc_id derivation is authoritative; chunk/job/lesson
sub-ids live under the doc's project. No separate chunk/job resolver needed — F2.)

### chatHistory.ts — `requireResourceScope('conversation','id')` on `/conversations/:id/*`
`GET /:id`, `POST /:id/messages`, `DELETE /:id`, `PATCH /:id/messages/:msgId/pin`.

### learningPaths.ts — `requireResourceScope('learning_path','pathId')` on `/:pathId*`
`DELETE /:pathId`, `POST /:pathId/complete`, `DELETE /:pathId/complete`.

## §4 Tier-2 deferral (new deferred item)
`POST /api/jobs/run-next` pops the next queued job across ALL projects. A scoped key
should only run its own project's jobs — needs `runNextJob(queue, projectScope?)` to
filter the pop. Scheduling-semantics change → **new DEFERRED item** (record at SESSION).

## §5 Tests
- Extend `requireResourceScope.test.ts`: `requireProjectScope` cases — body present/
  match/cross-tenant/absent (400); query single + multi (project_ids reject + absent
  400); query-or-body; auth-off/global pass. Plus the 3 new resolvers (document/
  learning_path/conversation) — seed a row, cross-tenant → 404.
- Existing route tests run auth-off → guards no-op → no regression (verify full suite).

## §6 Light security checklist (POST-REVIEW)
1. Scoped key cross-tenant body/query project_id → 404; absent → 400.
2. Scoped key multi project_ids with an out-of-scope id → 404.
3. Scoped key on a cross-tenant document/learning_path/conversation id → 404.
4. Auth-off / global → unrestricted (no regression — full suite green).
5. No id-probing oracle (cross-tenant + unknown both 404 on the resource resolvers).
6. Tier-2 hole (run-next) explicitly deferred + documented (not silently ignored).

## §7 Risks
1. **Breadth (~45 route edits across 8 files)** — mechanical; apply via a careful
   per-route script keyed on the inventory; tsc + the full auth-off suite verify wiring.
2. **Strict-reject behavior change** — a scoped key omitting project_id now gets 400
   (was: silent DEFAULT_PROJECT_ID). Auth-off unaffected. This is the chosen, more-secure
   posture (Q1/Q2).
3. **Column-name confirmation** — verify `documents.doc_id`, `learning_paths.path_id`,
   `chat_conversations.conversation_id` + their `project_id` columns in BUILD before
   wiring the resolvers.

## §8 Sign-off
- [ ] REVIEW-DESIGN (3 problems)
- [ ] DESIGN approved → PLAN
