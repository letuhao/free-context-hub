# DEFERRED-004 — REVIEW-DESIGN round 1 (security-aware self-review)

**Date:** 2026-05-21
**Subject:** `docs/specs/2026-05-21-deferred-004-tenant-scope-design.md` rev 1 (hash `fe44cfe45b29c36e90f7eee12df4f16dcd59d040`)
**Method:** "Where does the guard fail to actually isolate tenants?"

---

## F1 (BLOCK) — Guarding the DECLARED project_id on resource-`:id` routes is insufficient (cross-tenant id bypass)

**Where:** §3 application matrix — `requireProjectScope('body'|'query'|'query-or-body')`
applied to routes that ALSO carry a resource `:id` (documents/:id/*, chat/conversations/:id/*,
documents/:id/chunks/:chunkId, documents/:id/jobs/:jobId/cancel, etc.).

**The problem:** `requireProjectScope` validates that the **caller-declared** `project_id`
(body/query) equals the key's scope. It does NOT validate that the **resource** named by
`:id` belongs to that project. A project-A-scoped key can call:

```
DELETE /api/documents/<project-B-doc-id>?project_id=A
```

The guard sees `project_id=A === scope` → PASS. The handler then operates on
`<project-B-doc-id>`. Whether this is actually blocked depends entirely on whether each
service query filters by BOTH id AND project_id (`WHERE doc_id=$1 AND project_id=$2`) — a
per-handler property this audit has NOT verified for all ~25 resource routes. If any
service filters by id alone, the declared-project guard is trivially bypassed.

**The robust primitive is `requireResourceScope(entity, :idParam)`** (Sprint 15.12) — it
DERIVES the project from the resource id and compares to scope, so it never trusts a
caller-declared field. This is exactly why 15.12 used resolvers for `/topics/:id/*`.

**Recommended fix (rev 2):** split the matrix by route shape:
- **Resource routes (have a project-owned `:id`)** → `requireResourceScope(entity, param)`
  — derive from the id. Add resolvers as needed: `document`, `learning_path`,
  `conversation`, `job` (jobs.project_id), and chunk routes guard via the parent
  `:id`=doc_id (`document` resolver).
- **Collection routes (no resource id; project only in body/query)** →
  `requireProjectScope` — e.g. `POST /git/ingest`, `POST /documents/upload`,
  `GET /documents` (list), `POST /jobs`, `GET /jobs` (multi), `POST /chat`,
  `POST /workspace/scan`, `POST /sources/configure`, `POST /groups/:id/members`
  (the group_id is not a project; the added project is in the body).

This makes the guard authoritative (derive, don't trust) on every resource route.

**Severity:** BLOCK — without this, the audit leaves the exact hole it set out to close
on the majority of routes (the resource-id surface).

---

## F2 (WARN) — Missing `job` resolver; chunk routes need parent-document derivation

**Where:** §2 resolvers / §3 jobs + documents/:id/chunks.

**The problem:** rev 1 lists `document`/`learning_path`/`conversation` resolvers but the
job-keyed route (`POST /documents/:id/jobs/:jobId/cancel`) and any future `/jobs/:id`
route have no `job` resolver, and `documents/:id/chunks/:chunkId` is best guarded via
its parent `:id`=doc_id (`document` resolver) — both unstated.

**Recommended fix (rev 2):** add a `job` resolver (`SELECT project_id FROM async_jobs
WHERE job_id=$1` — confirm table/column in BUILD). Guard `documents/:id/chunks/:chunkId`
via `requireResourceScope('document','id')` (the :id is the doc). The cancel route's
authoritative id is the doc `:id` → `requireResourceScope('document','id')` suffices
(the job belongs to the doc's project); a separate job resolver is only needed if a
`/jobs/:id`-style route exists (it does not in the current surface — `POST /jobs/run-next`
is Tier-2-deferred).

**Severity:** WARN — completeness of the resolver set; resolved by deriving via the
parent document for the chunk/cancel routes (no new job resolver strictly required for
the current routes).

---

## F3 (WARN) — Strict-reject 400 on scoped GETs is a client-facing behavior change

**Where:** §0 / §3 GET routes under `requireProjectScope('query')`.

**The problem:** a scoped key calling a collection GET (e.g. `GET /api/documents`,
`GET /api/git/commits`) WITHOUT `project_id` now gets **400 `project_scope_required`**
(was: silent `DEFAULT_PROJECT_ID`). Clients/GUI using a scoped key must pass `project_id`
explicitly. Auth-off (dev) is unaffected (guard no-ops).

**Recommended fix (rev 2):** ACCEPT-with-doc — this is the chosen Q1 posture (explicit
over silent-default is more secure). Document in the security checklist + the deferred
closure note that scoped REST clients must send `project_id` on collection reads. No
code change.

**Severity:** WARN — intended behavior; just needs to be called out so it isn't a
surprise regression for an auth-on client.

---

## Summary
| F# | Severity | Where | Action |
|----|----------|-------|--------|
| F1 | BLOCK | resource-:id routes guarded by declared project_id | rev 2: use requireResourceScope (derive from id) on all project-owned `:id` routes; requireProjectScope only for collection routes |
| F2 | WARN | resolver completeness (job/chunk) | rev 2: chunk/cancel via parent `document` :id; note job resolver only if a /jobs/:id route appears |
| F3 | WARN | strict-reject 400 on scoped GETs | ACCEPT-with-doc (chosen posture) |

**Verdict:** REJECTED — 1 BLOCK. Revise to rev 2 (split matrix: derive-on-id vs declared-on-collection).
