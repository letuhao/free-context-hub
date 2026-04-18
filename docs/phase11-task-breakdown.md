# Phase 11 — Knowledge Portability

> Self-hosted persistent memory needs a way out. Phase 11 ships an exchange
> hub for moving a project's full state between ContextHub instances:
> bundle format → export → import → GUI → cross-instance pull → polish.

## Status: 5.33/6 sprints complete (◐ in progress — 11.6 split into a/b/c)

| Sprint | Focus | Status | Commit |
|--------|-------|--------|--------|
| 11.1 | Bundle format v1 (zip + manifest + JSONL) | ✅ | `62ae0d9` + review `6d49a76` |
| 11.2 | Full project export (`GET /api/projects/:id/export`) | ✅ | `f0988b3` + review `561b3e2` |
| 11.3 | Full project import + conflict policy (`POST /api/projects/:id/import`) | ✅ | `0d6b3b5` + review `694878c` |
| 11.4 | GUI Knowledge Exchange panel (in Project Settings) | ✅ | `ffe9ea8` + review `6270ff8` |
| 11.5 | Cross-instance pull (`POST /api/projects/:id/pull-from`) | ✅ | 2026-04-18 — `cd73629` |
| 11.6a | Test infrastructure (import scenarios + Playwright) | ✅ | 2026-04-18 — see SESSION_PATCH.md |
| 11.6b | Streaming polish (JSONL decoder + base64 import) | ○ | — |
| 11.6c | Perf + security polish (ON CONFLICT, body-stall timeout, DNS pinning) | ○ | — |

## Architecture

```
                 ┌────────────────────────────────────────┐
                 │   bundle.zip (schema_version 1)       │
                 │  ┌───────────────────────────────────┐ │
                 │  │ manifest.json (sha256 per entry)  │ │
                 │  │ lessons.jsonl                     │ │
                 │  │ guardrails.jsonl                  │ │
                 │  │ lesson_types.jsonl                │ │
                 │  │ chunks.jsonl                      │ │
                 │  │ documents.jsonl                   │ │
                 │  │ document_lessons.jsonl            │ │
                 │  │ documents/<doc_id>.<ext>          │ │
                 │  └───────────────────────────────────┘ │
                 └────────────┬───────────────────────────┘
                              │
   exportProject() ───────────┘────────────── importProject()
   (pg-cursor streaming)                      (transactional, FK order,
   ↓                                           cross-tenant guard)
   GET /api/projects/:id/export       POST /api/projects/:id/import
                              │
                              ▼
                    ┌──────────────────┐
                    │ Project Settings │
                    │ Knowledge Exchg  │  Sprint 11.4
                    │  panel           │
                    └──────────────────┘
```

## Key files

```
src/services/exchange/
├── bundleFormat.ts          11.1 — encoder/decoder, no DB knowledge
├── bundleFormat.test.ts     11.1 — 14 unit tests via node:test
├── exportProject.ts         11.2 — DB → bundle, pg-cursor streaming
└── importProject.ts         11.3 — bundle → DB, transactional, conflict policies

src/api/routes/projects.ts   11.2 + 11.3 — the two HTTP routes

gui/src/lib/api.ts           11.4 — exportProjectUrl + importProject methods
gui/src/app/projects/settings/exchange-panel.tsx
                             11.4 — full panel with dry-run preview UI
```

## Sprint-by-sprint summary

### 11.1 — Bundle format v1
- `encodeBundle(BundleData, Writable)` accepts async iterables for every
  entity kind so the encoder can stream from a DB cursor without buffering
  the whole project. Each entry is hashed (SHA-256) and length-counted into
  a manifest written last so its index is complete.
- `openBundle(path|Buffer)` reads via yauzl, validates the manifest, and
  exposes async generators per entity. Per-entry checksums are verified at
  EOF for jsonl, and at stream-close for binary documents.
- 5 corruption cases tested: missing manifest, schema_version mismatch,
  jsonl checksum mismatch, malformed jsonl line, doc id collision after
  sanitization. Plus a 1MB streaming regression test.
- Code review caught 4 real bugs: digest() called twice on the same hash,
  yauzl central directory can't be re-walked, stream.pipeline() drains
  before returning (broke files >16KB), safeDocId collisions silently
  overwrote entries.

### 11.2 — Full project export
- New `src/services/exchange/exportProject.ts` opens a single dedicated
  PoolClient and walks 6 entity tables via cursor. project, lessons,
  guardrails, lesson_types, chunks, documents, document_lessons.
- Embeddings parsed from pgvector text format (`"[0.1,0.2,...]"`) into
  number[] for clean JSON serialization.
- Document binaries: cursor over METADATA only (no content column), then
  per-row separate SELECT for `content` so peak memory is bounded to one
  document at a time. Earlier draft selected content inline and would
  spike to 1+ GB on projects with several large vision-extracted PDFs.
- `URL-only` docs (no stored binary) round-trip as metadata-only via
  `BundleDocument.content = null` (extension to bundleFormat).
- New route `GET /api/projects/:id/export?include_documents=&include_chunks=`
  streams archiver directly into res. 404 on missing project.
- Code review caught: improper `as never` type cast (replaced with proper
  `Writable` typing), `lesson_types` global-table caveat (documented),
  headers-sent race on mid-stream errors (documented), per-doc memory
  blowup (fixed via per-row content fetch), `rowCount` null safety.

### 11.3 — Full project import + conflict policy
- New `src/services/exchange/importProject.ts` decodes via openBundle,
  begins a transaction, walks entities in FK-safe order, applies each row
  under one of three conflict policies, commits or rolls back.
- FK order: lesson_types → documents → chunks → lessons → guardrails →
  document_lessons (chunks/links need parents to exist first).
- project_id is rewritten on every row from bundle's source to URL target.
  UUIDs preserved so re-import under `skip` is idempotent.
- Document binaries always re-encoded as `data:base64;<...>` regardless of
  doc_type (uniform with the read path, no asymmetry vs export).
- Embeddings cast to pgvector via `$N::vector` literal.
- Conflicts captured into a bounded list (`conflictsCap`, default 50,
  hard ceiling 1000) with a `conflicts_truncated` flag.
- New route `POST /api/projects/:id/import` accepts multipart bundle via
  multer.diskStorage with **500 MB cap** (vs 10 MB default). Query params:
  `policy` / `dry_run` / `conflicts_cap`. Auto-creates target project.
  Always cleans up the temp upload in finally.
- ImportError codes: malformed_bundle, schema_version_mismatch, conflict_fail,
  invalid_row, io_error. Mapped to HTTP 400/409/500.
- bundleFormat extended with `document_lessons.jsonl` (backwards-compat;
  schema_version stays at 1).
- Built-in lesson_type protection: overwrite refuses to clobber `is_builtin=true`.
- **Critical security fix in code review**: cross-tenant document hijacking
  via overwrite. A user with writer access to project B could craft a bundle
  containing rows with project A's UUIDs, POST to /api/projects/B/import,
  and the UPDATE rewrote those rows' project_id to B — silently transferring
  A's data into B. Fix: SELECT project_id from the existing row before
  applying any policy; if owner != target, refuse and record a conflict.
  Applied to documents, chunks, lessons, guardrails. (lesson_types is global,
  document_lessons inherits ownership from FK.)
- Live round-trip tested end-to-end on the docker stack: create fresh
  project + 1 lesson → export → delete → import → lesson restored
  byte-identical (same UUID, title, content, tags, created_at).

### 11.4 — GUI Knowledge Exchange panel
- Single component `gui/src/app/projects/settings/exchange-panel.tsx`
  embedded in the existing Project Settings page (between Features and
  Danger Zone). No new top-level route.
- **Export subsection**: two checkboxes (include_documents, include_chunks)
  drive a reactive href on a download `<a>`. No JS fetch — browser handles
  streaming via Content-Disposition.
- **Import subsection**: drag-drop + click-to-browse `.zip` picker (500 MB
  cap), policy radio (skip / overwrite / fail, skip default), Preview
  (dry-run) and Apply buttons (both permissive — no required preview).
- **Result panel**: green ✓ Imported / blue Dry-run preview / amber Not
  applied. Source/generated metadata, per-entity counts table with
  color-coded values and em-dash for zeros, conflicts list with truncation
  indicator.
- New API client methods: `exportProjectUrl(opts)` (URL builder) and
  `importProject(file, opts)` (multipart POST).
- State resets on project switch via `useEffect([projectId])`.
- Live test via MCP playwright: full round-trip in browser — created
  sp114-test + 1 lesson via API, exported to disk, dropped the bundle in
  the GUI, deleted the source project, dry-run preview rendered correct
  counts, clicked Apply, header changed to ✓ Imported, lesson_id
  5baa274c-... restored byte-identical.
- Code review fixes: state reset on project switch, stale-result clear on
  policy change, documented cross-origin `<a download>` footgun.

## Sprint 11.5 — Cross-instance pull ✅ (complete 2026-04-18)

### Scope
New endpoint `POST /api/projects/:id/pull-from` that accepts a remote
ContextHub URL + optional API key, fetches the remote project's bundle,
and applies it locally via `importProject`. Idempotent under repeat pulls
because UUIDs are preserved and `skip` is the default policy.

### Acceptance criteria (all met)
1. ✅ `POST /api/projects/:id/pull-from` body: `{ remote_url, remote_project_id, api_key?, policy?, dry_run?, conflicts_cap? }`
2. ✅ Builds the remote export URL from `remote_url + /api/projects/<remote_project_id>/export`
3. ✅ Fetches via `fetch()` with `Authorization: Bearer <api_key>` if provided
4. ✅ Streams the response body into a temp file, then calls `importProject({ bundlePath })`
5. ✅ Returns an `ImportResult` superset with a `remote: { url, project_id, bytes_fetched }` field
6. ✅ Cleans up the temp file + dir in finally (best-effort)
7. ✅ SSRF-hardened: reuses `assertHostAllowed` from `urlFetch.ts` (exported for this sprint)
8. ✅ 502 for unreachable / remote non-2xx, 504 for connect timeout, 403 for SSRF, 413 for too-large, 400 for validation
9. ✅ Self-pull integration test against loopback (`ALLOW_PRIVATE_FETCH_FOR_TESTS=true`)

### Files shipped
- `src/services/urlFetch.ts` — exported `assertHostAllowed` (one-line change)
- `src/services/exchange/pullFromRemote.ts` — new orchestrator (~330 lines)
- `src/api/routes/projects.ts` — `POST /:id/pull-from` route (+78 lines)
- `test/e2e/api/phase11-pull.test.ts` — 9 integration tests (new)
- `test/e2e/api/runner.ts` — registration

### Review outcome — 10 issues caught + fixed across 3 review passes
- **Phase-7 REVIEW (1 MED):** `AbortSignal.timeout` was capping body drain; replaced with `AbortController + clearTimeout` after headers so 500 MB pulls on slow links don't abort mid-stream.
- **`/review-impl` pass 1 (3 MED + 2 LOW):** api_key echo in error response (pre-validated before fetch), Content-Type loose match (type/subtype parse), DNS rebinding TOCTOU (documented, matches urlFetch.ts precedent), temp dir leak window before try (moved inside try), no remoteProjectId length cap (256-char cap).
- **`/review-impl` pass 2 (1 MED + 2 LOW):** docstring claimed `AbortSignal.timeout` contradicting actual `AbortController` (rewrote file header), stale step numbers in inline comments (stripped), `HEADER_INJECTION_RE` deny-list (swapped for allow-list `/^[\x20-\x7E\t]+$/`).

### Live test results
Full E2E suite: **56/56 passed, 0 failed, 113-134 s** across 3 run cycles. 9 phase11-pull tests green:
- `phase11-pull-happy-path` (12s, self-pull round-trips a 6,388-byte bundle)
- `phase11-pull-dry-run` (9s, applied=false, 0 rows written)
- `phase11-pull-missing-remote-url` (400)
- `phase11-pull-missing-remote-project-id` (400)
- `phase11-pull-bad-scheme` (400, code=bad_scheme)
- `phase11-pull-invalid-url` (400, code=invalid_url)
- `phase11-pull-api-key-injection` (400, code=invalid_api_key, no credential echo in message)
- `phase11-pull-long-project-id` (400, code=invalid_project_id)
- `phase11-pull-nonexistent-remote` (502, code=upstream_error)

### Out of scope / deferred to 11.6 polish
- GUI for cross-instance pull (API-only this sprint)
- Bundle caching
- Webhook-driven pulls
- Body-stall timeout (slow-loris defense — bounded by `MAX_BUNDLE_BYTES` for now)
- DNS-rebinding pinning (needs custom agent with `lookup` override; matches urlFetch.ts precedent)

### Self-pull caveat (documented in test header + pullFromRemote.ts)
Because source and target share a database in self-pull, the Sprint 11.3
cross-tenant UUID guard correctly refuses to re-own a lesson_id. Net
result for self-pull: `counts.lessons.skipped=1 + conflict entry`, not
`created=1`. True cross-instance pull targets a separate DB where UUIDs
are fresh — the test asserts EITHER outcome.

## Sprint 11.6 — split into three sub-sprints

Original 11.6 scope was too large for one workflow run (10-15 files,
~3-5 hrs, risk profiles differ across the items). Split so each slice
is independently shippable + reviewable.

## Sprint 11.6a — Test infrastructure ✅ (complete 2026-04-18)

### Scope
Coverage gaps from Sprints 11.1-11.5 that weren't automated:
1. API integration — round-trip checksums + conflict scenarios
2. Direct tests for importProject's ID remapping + conflict resolution
3. One Playwright scenario for the Knowledge Exchange panel

### Shipped
- `test/e2e/api/phase11-import.test.ts` — 5 scenario tests hitting the
  live Docker Postgres via REST. Strengthened after `/review-impl` pass:
  each test now verifies a real invariant rather than a counter or tautology.
- `test/e2e/api/runner.ts` — registered `allPhase11ImportTests`
- `test/e2e/gui/phase11-exchange.spec.ts` — 1 Playwright scenario:
  seed two projects → switch to src → click Export (download handler)
  → switch to dst → dropzone upload → Preview → Apply → "Imported" header

### Tests
- `phase11-import-roundtrip-checksum` — per-entry sha256 stable across
  re-exports; import result carries correct `source_project_id`,
  `schema_version`, `counts.lessons.total` from manifest
- `phase11-import-id-remapping` — delete src, import bundle into dst,
  verify lesson lands on dst with `project_id=dst` via list endpoint's
  `items` field
- `phase11-import-policy-overwrite` — re-import with overwrite →
  `counts.lessons.updated=1` AND title actually reverts in the list
- `phase11-import-policy-fail` — re-import with fail → 409 + code,
  AND `items.length` unchanged (transaction rolled back)
- `phase11-import-cross-tenant-guard-under-overwrite` — guard refuses
  overwrite of a UUID owned by another project; `updated=0, skipped=1`;
  lesson does NOT leak onto dst
- Playwright — export download → localStorage project switch → dropzone
  `setInputFiles` → Preview → Apply → header asserts

### Review outcome — 5 findings caught + fixed
- Initial REVIEW (0 MED): clean first pass
- `/review-impl` (2 MED + 2 LOW + 1 COSMETIC):
  - **MED 1** roundtrip-checksum's main assertion (lesson_types sha256
    match through import) was tautological — lesson_types are globally
    scoped, hashes match between any two exports on the same instance
  - **MED 2** id-remapping was a renamed cross-tenant guard test —
    actual project_id rewriting never exercised because src still
    existed. Fixed by deleting src before import.
  - **LOW 3** policy-overwrite trusted `counts.updated=1` without
    verifying the data actually reverted
  - **LOW 4** policy-fail asserted 409 but not that the DB state rolled
    back
  - **COSMETIC** JSDoc on `readEntryAsBuffer` clarified "small entries only"

### Incidental catch
The list endpoint returns rows under `items`, not `lessons`/`results`.
An earlier test used the wrong shape and silently got `undefined`,
triggering a confusing "edit not visible" error. Fixed in all tests.

### Live test results
```
API suite:   61/61 passed, 0 failed (79s — down from 194s after
             /review-impl simplified the tautological round-trip cycle)
GUI suite:   52/52 passed, 0 failed (47s — 1 new phase11-exchange scenario)
```

### Out of scope / deferred to 11.6b or 11.6c
- Cross-version schema migration tests (deferred until v2 schema exists)
- FK integrity on chunks/documents (no chunk/doc fixtures in these tests)
- Streaming polish (11.6b)
- Perf + security polish (11.6c)

## Sprint 11.6b — Streaming polish (planned)

### Scope
Memory-bounded refactors to existing bundle services. Isolated to
`bundleFormat.ts` and `importProject.ts`; no API changes.

1. **Streaming JSONL parser on the decoder side** — `BundleReader`
   currently buffers each jsonl entry into memory before yielding
   records. Refactor to yield records as they stream off disk,
   bounded by the entry's chunk size.
2. **Streaming base64 encoding on import** — `materializeDocContent`
   buffers entire binaries into RAM before re-encoding. A 100 MB PDF
   holds ~233 MB in memory during import. Refactor to pipe raw → base64
   chunks.

### Acceptance
- bundleFormat unit tests still pass
- importProject live round-trip test still passes
- Peak memory during a 500 MB bundle import drops measurably (manual
  verification with `process.memoryUsage()`)

### Non-goals
- Encryption / signing
- Switching from jsonl to a binary format
- Cross-version migration (11.6 framing deferred)

## Sprint 11.6c — Perf + security polish (planned)

### Scope
1. **INSERT ... ON CONFLICT** migration on importProject — replaces the
   N+1 SELECT-then-INSERT pattern documented in Sprint 11.3 review.
   Challenge: currently the SELECT lets us emit per-conflict reports;
   ON CONFLICT needs a different path for conflict reporting (e.g.
   RETURNING + derive from xmin/xmax, or a staging table).
2. **Body-stall (slow-loris) timeout** on pullFromRemote — the 60 s
   connect timeout currently clears once headers arrive; a remote that
   trickles bytes can keep the stream open indefinitely (bounded only
   by MAX_BUNDLE_BYTES).
3. **DNS-rebinding pinning** — both `urlFetch.ts` and `pullFromRemote.ts`
   have a TOCTOU race between `assertHostAllowed` and undici's connect
   lookup. Fix with a custom undici agent that pins the lookup to the
   IP validated upstream.

### Acceptance
- Import N+1 SELECT pattern replaced; 61/61 phase11 tests still green
- Pull body-stall aborts after configurable idle timeout
- DNS-rebinding attack (resolver flips IPs between calls) blocked at
  connect time

### Non-goals
- Merge conflict policy
- Async background import/export jobs
- Webhook-driven pulls
- Encryption / signing
