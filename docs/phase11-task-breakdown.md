# Phase 11 — Knowledge Portability

> Self-hosted persistent memory needs a way out. Phase 11 ships an exchange
> hub for moving a project's full state between ContextHub instances:
> bundle format → export → import → GUI → cross-instance pull → polish.

## Status: 4/6 sprints complete (◐ in progress)

| Sprint | Focus | Status | Commit |
|--------|-------|--------|--------|
| 11.1 | Bundle format v1 (zip + manifest + JSONL) | ✅ | `62ae0d9` + review `6d49a76` |
| 11.2 | Full project export (`GET /api/projects/:id/export`) | ✅ | `f0988b3` + review `561b3e2` |
| 11.3 | Full project import + conflict policy (`POST /api/projects/:id/import`) | ✅ | `0d6b3b5` + review `694878c` |
| 11.4 | GUI Knowledge Exchange panel (in Project Settings) | ✅ | `ffe9ea8` + review `6270ff8` |
| 11.5 | Cross-instance pull (`POST /api/projects/:id/pull-from`) | ○ | — |
| 11.6 | Polish + test plan (unit + integration + Playwright) | ○ | — |

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

## Sprint 11.5 — Cross-instance pull (planned)

### Scope
New endpoint `POST /api/projects/:id/pull-from` that accepts a remote
ContextHub URL + optional API key, fetches the remote project's bundle,
and applies it locally via `importProject`. Idempotent under repeat pulls
because UUIDs are preserved and `skip` is the default policy.

### Acceptance criteria
1. `POST /api/projects/:id/pull-from` body: `{ remote_url, remote_project_id, api_key?, policy?, dry_run? }`
2. Builds the remote export URL from `remote_url + /api/projects/<remote_project_id>/export`
3. Fetches via `fetch()` with the API key header if provided
4. Streams the response body into a temp file, then calls `importProject(tempPath, ...)`
5. Returns the same `ImportResult` shape as the import route
6. Cleans up the temp file in finally
7. SSRF-hardened: same allowlist/denylist as `urlFetch.ts` from Sprint 10.7
8. Returns 502 if the remote is unreachable, 4xx if the remote returns an error
9. Test: pull from one local instance to another (could use docker compose with two stacks, or run two ports)

### Out of scope
- GUI for cross-instance pull (defer)
- Bundle caching (defer)
- Webhook-driven pulls (defer)

## Sprint 11.6 — Polish + test plan (planned)

### Scope
Per the test plan we discussed before starting Phase 11:

1. **API integration tests** — round-trip with checksums, cross-version
   migration (import a fixture bundle from an older schema once we have
   one), conflict scenarios.
2. **Unit tests** for serializer/deserializer ID remapping, FK rewriting,
   conflict resolution policies.
3. **One Playwright scenario** — click Export, download, click Import,
   see a success toast.
4. **Polish** items deferred from earlier sprints:
   - Streaming JSONL parser on the decoder side (currently buffers each
     entry into memory)
   - Streaming base64 encoding on import (currently buffers full binary)
   - Switching to `INSERT ... ON CONFLICT` for the N+1 perf win on import
   - Cross-instance sync polish

### Out of scope
- Merge conflict policy
- ID remapping
- Async background export/import jobs
- Encryption / signing
