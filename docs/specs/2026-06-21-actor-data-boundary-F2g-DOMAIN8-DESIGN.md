# Domain 8 — DESIGN: retire the legacy auth middleware (authorize() becomes the sole gate)

**Date:** 2026-06-21 · Size **XL** · auth OFF (inert). The last structural prerequisite before the flip.
Tenant-isolation change → cold-start adversary mandatory at REVIEW-CODE.

## Why
`requireRole` (coarse key role), `requireScope` / `requireProjectScope` / `requireResourceScope` /
`requireBodyProjectScope` / `requireBodyTopicScope` (key's single `project_scope` vs URL/body) enforce the OLD
key-derived model. The NEW model is `authorize()` over principal grants. The two can DISAGREE (a `role=reader`
key bound to a principal holding `write@P` would be wrongly rejected by `requireRole('writer')`), so leaving the
middleware in place would BLOCK legitimately-granted actions at the flip. Domain 8 removes it so authorize() is
the single coherent gate.

## Coverage audit (verified — fanned out, then spot-checked each flagged site)
~85 legacy-guarded routes; the large majority already reach a service-layer `assertAuthorized`/`authorize`/
`hasGlobalGrant` at an appropriate action@kind (the middleware is redundant for these). The exceptions:

### 6 removal-induced GAPS — MUST add authorize() before removing the net
1. **POST `/api/chat`** (chat.ts) — resolves `project_id` but authorizes only INSIDE optional AI-tool executors;
   a tool-less answer runs no authz. → add `read@project` up front.
2. **POST `/api/projects/:id/reflect`** (projects.ts) — `reflectOnTopic` takes no principal. → route-level
   `write@project` (mirrors `/lessons/:id/improve`).
3. **POST `/api/taxonomy-profiles`** (taxonomy.ts) — `createTaxonomyProfile` no principal; only an inline
   `apiKeyScope` (legacy) check. → route-level `write@project` on `owner_project_id`; drop the inline check.
4. **POST `/api/documents/:id/extract/estimate`** (documents.ts) — inline SQL, no authz. → `read@doc` up front.
5. **GET `/api/documents/:id/extraction-status`** (documents.ts) — inline SQL, no authz. → `read@doc` up front.
6. **GET `/api/documents/:id/thumbnail`** (documents.ts) — inline SQL returns RAW BYTES (content). → `read@doc`.

### 2 ADMIN-ONLY routes — preserve the admin-vs-writer distinction
- **POST `/review-requests/:reqId/approve`** + **`/return`** (reviewRequests.ts) — `requireRole('admin')` is the
  ONLY thing stopping a writer self-approving (BUG-13.3-1). The services authorize `write@project`. → bump the
  service gate to **`admin@project`** so the human-review distinction survives in the grant model.

### Pre-existing hole (NOT removal-induced) → DEFER
- **GET `/api/projects/`** → `listAllProjects()` returns ALL tenants' projects unfiltered, with NO middleware
  today. Removal doesn't change it. It is a cross-project READ catalog (like the `listGroups` decision in
  DEFERRED-049). Logged as a new DEFERRED (its own axis; fixing it changes the GUI "All Projects" view).

## Plan
- **Stage A (gap fixes):** the 6 authorize() additions + the 2 `admin@project` bumps. Verify.
- **Stage B (removal):** delete `requireRole`/`requireScope`/`requireResourceScope` usages from all route files
  + their imports; delete `requireRole.ts`, `requireScope.ts`, `requireResourceScope.ts` + the two middleware
  tests (`requireScope.test.ts`, `requireResourceScope.test.ts`); update any route test that asserted a
  middleware 403 (board/requests/topics). Keep `bearerAuth` (it sets the principal — that stays).
- **Stage C:** cold-start adversary over the removed-middleware state (hunt for any now-open route); full suite.
- **Defer:** `listAllProjects` → new DEFERRED.

## Acceptance criteria
1. Every one of the 6 gaps has an authorize()/assertAuthorized at the right action@scope; approve/return require
   `admin@project`.
2. No `requireRole`/`requireScope`/`requireResourceScope`/`requireProjectScope`/`requireBody*Scope` references
   remain in `src/api/` (grep clean); the three middleware files + 2 tests are deleted.
3. `bearerAuth` still attaches the principal; auth-OFF behavior unchanged.
4. Cold-start adversary finds no now-open route (or all findings fixed).
5. Full suite green, tsc clean. `MCP_AUTH_ENABLED` flip NOT touched.
