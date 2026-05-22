# DEFERRED-004 — tenant-scope service-handler audit — CLARIFY

**Date:** 2026-05-21
**Workflow:** v2.2 human-in-loop
**Branch:** `tenant-scope-audit-deferred-004` (from `phase-15-sprint-15.12`-era main line)
**Status:** DRAFT — pending human approval

## Scope

Resolve **DEFERRED-004** (MED) — the writer-role routers (git/jobs/workspace/chat/
chatHistory/documents/learning-paths/groups) read `project_id` from body/query (or
operate on a resource id) with **no `req.apiKeyScope` check**. A key scoped to project A
can act on project B by passing B's `project_id` (or B's resource id). This is the
service-handler complement to Sprint 15.12's route-param tenant-scope (which covered the
`/api/topics/:id/*` coordination surface).

## Inventory (from a read-only mapping pass)

| Project source | Count | Examples |
|---|---|---|
| BODY.project_id | ~23 | git/ingest, chat, documents/upload, workspace/scan |
| QUERY.project_id | ~12 | git/commits, documents (GET), workspace/roots |
| QUERY.project_ids[] (multi) | 1 | `GET /api/jobs` (also lists ALL projects if no param) |
| URL param = project_id | 3 | groups `DELETE .../members/:projectId`, `GET by-project/:projectId`; `POST .../members` (body) |
| URL param = non-project id | 3 | groups `:id` (group_id) |
| NONE / derivable holes | 9 | see below |

**9 holes (no `apiKeyScope`-checkable project on the operated resource):**
1. `PATCH /chat/conversations/:id/messages/:msgId/pin` — no project read (derivable via conversation).
2-4. `POST/DELETE/GET /documents/:id/lessons[/:lessonId]` — `document_lessons` has no project_id (derivable via `documents.doc_id → project_id`).
5-7. `DELETE /learning-paths/:pathId`, `POST|DELETE /learning-paths/:pathId/complete` — `learning_paths.path_id → project_id` exists but is ignored.
8. `GET /api/jobs` (no param) — lists all projects' jobs.
9. `POST /api/jobs/run-next` — pops the next job across ALL projects (`runNextJob` has no project filter).

## Size

**L** — a unified scope guard + ~50 route applications + a few resource resolvers +
multi-project handling + tests across the 8 routers. Tiered (Q3) to keep it bounded:
the service-level scheduling holes (#8/#9 run-next/global-list) + the document_lessons
link ops are deferred to a follow-up if they need handler logic beyond a guard.

## Proposed design

### A. `requireProjectScope({ sources })` middleware (the bulk)
A generalized tenant-scope guard (extends the 15.12 pattern) that reads the project_id
from the configured sources and compares to `req.apiKeyScope`:
- `sources: ['body']` / `['query']` / `['query','body']` (DELETE routes use query ?? body).
- Auth-off (`apiKeyScope === undefined`) / global (`null`) → `next()` (unrestricted).
- Scoped key:
  - **Single project_id present** → must equal scope, else **404 NOT_FOUND** (no
    existence oracle, matching 15.12).
  - **Omitted** → inject the key's scope into the source (body or a query default) so
    the handler operates on the caller's own project, never `DEFAULT_PROJECT_ID`
    (the 15.12 F1 lesson) — Q1.
  - **Multi `project_ids[]`** → every requested id must equal scope (a scoped key has
    exactly one project); if absent, inject `[scope]` so a list is scope-restricted,
    not global — Q2.

### B. Resource-derived guard for id-keyed holes
Extend `requireResourceScope` (15.12) with resolvers for the derivable holes:
- `document` — `SELECT project_id FROM documents WHERE doc_id=$1` → guards
  `/documents/:id/lessons*`, the pin/chunk routes already carry project but get this as
  defense-in-depth.
- `learning_path` — `SELECT project_id FROM learning_paths WHERE path_id=$1` → guards
  `DELETE /learning-paths/:pathId` + `/complete`.
- `conversation` — `SELECT project_id FROM chat_conversations WHERE conversation_id=$1`
  (confirm the column in DESIGN) → guards the pin route.

### C. Deferred to a follow-up (Tier 2 — Q3)
- `POST /api/jobs/run-next` cross-project pop — needs a `runNextJob(queue, projectScope?)`
  service change (filter the pop by scope). A scheduling-semantics change, not a guard.
- `GET /api/jobs` global-list-when-no-param — handled by B's inject (`[scope]`); the
  no-scope (global key / auth-off) behavior unchanged.
- `groups` cross-project container ops — a group spans projects by design; `POST
  .../members` (BODY.project_id) + `DELETE .../members/:projectId` + `GET
  by-project/:projectId` get the project guard; the group_id itself is not a project.

## Acceptance criteria
- **AC1** — `requireProjectScope` rejects a scoped key passing a cross-tenant
  body/query `project_id` → 404.
- **AC2** — a scoped key omitting project_id has its scope injected (body) / defaulted
  (query) — operates on its own project, never DEFAULT_PROJECT_ID.
- **AC3** — multi `project_ids[]`: any out-of-scope id → 404; absent → injected `[scope]`.
- **AC4** — auth-off / global-scope → unrestricted (no regression; existing tests pass).
- **AC5** — resource-derived guards (document/learning_path/conversation): cross-tenant
  resource id → 404.
- **AC6** — applied across all 8 writer routers' project-bearing routes.
- **AC7** — Tier-2 items (run-next cross-project pop) documented as a new deferred.
- **AC8** — light tenant-isolation security checklist CLEAR.

## Open Questions
**Q1 — Omitted body/query project_id for a scoped key:** inject the key's scope
(recommended, matches 15.12 F1) vs reject (force explicit).
**Q2 — Multi-project `GET /jobs` for a scoped key:** reject any out-of-scope id +
inject `[scope]` when absent (recommended) vs reject when absent.
**Q3 — Tier-2 deferral:** defer the service-level scheduling holes (run-next
cross-project pop) + accept the resource-derived guards for documents/learning_paths/
conversations this sprint (recommended) vs do everything now (XL).
**Q4 — Security review depth:** light tenant-isolation checklist (recommended; same
class as 15.12, enforcing an existing scope model) vs full cold-start adversary.

## Risks
1. **Breadth** — ~50 route applications across 8 files; mechanical but wide. Mitigated
   by a single configurable guard + a scripted application (verify each route's source
   from the inventory).
2. **Existing tests run auth-off** → guard no-ops → no regression. New scoped tests use
   an `x-test-key-scope` shim (15.12 pattern).
3. **Inject mutating req.body/query** — the 15.12 precedent; a handler reading the
   field after the guard sees the injected scope.
4. **Multi-project semantics** — a scoped key is single-project by definition; the
   `project_ids[]` reject is correct (a scoped key can't legitimately request others).

## Decisions (2026-05-21)
- **Q1 — REJECT on omission (stricter than 15.12 inject).** A scoped key MUST declare
  `project_id`; omission → **400 BAD_REQUEST `project_scope_required`** (never silently
  default to DEFAULT_PROJECT_ID). Present-but-cross-tenant → **404 NOT_FOUND** (no oracle).
- **Q2 — REJECT when absent (multi).** A scoped key must pass `project_ids` (or
  `project_id`); absent → 400. Any `project_ids[]` entry ≠ scope → 404. (A scoped key
  is single-project, so the only valid `project_ids` is `[scope]`.)
- **Q3 — Defer the run-next cross-project pop** (new deferred); ship the guard +
  document/learning_path/conversation resource resolvers across all 8 routers now.
- **Q4 — Light tenant-isolation security checklist** at POST-REVIEW.

**Posture summary:** auth-off (`apiKeyScope` undefined) / global (`null`) →
unrestricted (no behavior change, dev posture). Scoped key → must explicitly declare a
project that equals its scope; absent → 400, cross-tenant → 404.

## Sign-off
- [x] Q1 — reject on omission (400 project_scope_required) (2026-05-21)
- [x] Q2 — multi-project reject-when-absent + reject out-of-scope (2026-05-21)
- [x] Q3 — Tier-2 deferral (run-next) (2026-05-21)
- [x] Q4 — light security review (2026-05-21)
- [x] Spec approved → DESIGN
