# DESIGN — M1 / FIX-3: MCP `ingest_document` tool

**Gap (from scenario brainstorm):** agents can `search_document_chunks` but cannot
**ingest** a document — `/api/documents/ingest-url` + `/upload` are REST/GUI only.
So an agent that finds a useful URL can't pull it into project knowledge.

**Goal:** add an MCP tool `ingest_document` that ingests a document **by URL**,
reusing the existing SSRF-hardened fetch → dedup → store flow, with caller-scope
enforcement. URL-only for v0.1.0 (base64/file upload deferred — see Non-goals).

Tracker: [`../qc/RELEASE_READINESS.md`](../qc/RELEASE_READINESS.md) FIX-3.

---

## 1. Approach — extract a shared service (DRY)

Today the fetch→hash→dedup→`createDocument` flow lives **inline** in the REST
`/ingest-url` handler (`src/api/routes/documents.ts` ~L157–245). The MCP tool must
not duplicate it. Extract a single service both surfaces call:

### `src/services/documentIngest.ts` (new)

```ts
export type IngestUrlResult =
  | { status: 'created'; document: Document }
  | { status: 'duplicate'; existing_doc_id: string; existing_name: string; existing_uploaded_at: string };

export async function ingestUrlAsDocument(params: {
  projectId: string;
  actingPrincipalId?: string | null;
  sourceUrl: string;
  name?: string;
  description?: string;
  tags?: string[];
  // testability: inject the fetcher; defaults to the real SSRF-hardened one
  fetcher?: (url: string) => Promise<FetchResult>;
}): Promise<IngestUrlResult>;
```

**Flow (verbatim port of the REST inline logic):**
1. `fetcher(sourceUrl)` → `fetchUrlAsDocument` (SSRF-hardened: private-range DNS
   reject, IP pinning, redirect re-check, size cap, MIME allowlist). `UrlFetchError`
   propagates to the caller unchanged.
2. `name = sanitizeFilename(params.name ?? fetched.filename)`.
3. `contentHash = sha256(fetched.buffer)`.
4. Dedup: `SELECT doc_id… WHERE project_id=$1 AND content_hash=$2` → if hit, return
   `{ status:'duplicate', … }`.
5. Encode: binary docTypes (`pdf/docx/image/epub/odt/rtf`) → `data:base64;…`; else
   utf-8 (matches `/upload`).
6. `createDocument({ projectId, actingPrincipalId, name, docType, url: finalUrl,
   content, contentHash, fileSizeBytes, description, tags })`.
7. On the `23505 idx_documents_project_hash` race → re-query and return `duplicate`.

**Scope enforcement:** `createDocument` already calls
`assertAuthorized(actingPrincipalId, 'write', { kind:'project', id: projectId })`.
The service adds **no** new bypass — scope is enforced at the same chokepoint the
REST path uses. (Safety-sensitive: see §5.)

### Refactor the REST route to delegate

`/api/documents/ingest-url` keeps its HTTP-specific concerns (status codes, the
`UrlFetchError → err.httpStatus` map, the 201/409 envelope) but calls
`ingestUrlAsDocument` for the core. Behavior is identical — same primitives,
same dedup, same SSRF fetch. This removes the duplication the MCP tool would
otherwise create.

## 2. The MCP tool

Registered in `src/mcp/index.ts` mirroring `index_project`'s shape:

```
name: 'ingest_document'
description: 'Ingest a document into project knowledge by URL (SSRF-hardened
              fetch + dedup). Then it is searchable via search_document_chunks
              once extraction runs.'
inputSchema: {
  workspace_token?: string         // required only if MCP_AUTH_ENABLED
  project_id?: string              // optional if DEFAULT_PROJECT_ID set
  source_url: string  (min 1, .url())
  name?: string
  description?: string
  tags?: string[]
  output_format: OutputFormatSchema = 'auto_both'
}
outputSchema: {
  status: 'created' | 'duplicate'
  doc_id: string
  name: string
  doc_type: string
  source_url: string
  duplicate: boolean
}
handler:
  const { actingPrincipalId } = await resolveActingActorOrThrow(workspace_token)
  const projectId = resolveProjectIdOrThrow(project_id)
  try {
    const r = await ingestUrlAsDocument({ projectId, actingPrincipalId, sourceUrl, name, description, tags })
    → map created/duplicate to the flat outputSchema
  } catch (e) {
    if (e instanceof UrlFetchError) throw new McpError(InvalidParams, e.message)  // SSRF/format reject
    throw e  // ContextHubError → McpError mapping at the existing protocol edge
  }
```

**Extraction:** like the REST route, the tool **creates** the document; it does NOT
auto-run extraction (chunking/embedding) — that stays a separate step. Documented in
the tool description so the agent knows chunks aren't searchable until extraction
runs. (Auto-enqueue extraction = optional follow-up, noted in Non-goals.)

## 3. Files touched

| File | Change |
|------|--------|
| `src/services/documentIngest.ts` | NEW — `ingestUrlAsDocument` + `IngestUrlResult` |
| `src/services/documentIngest.test.ts` | NEW — dedup + created + duplicate-race (injected fetcher stub) |
| `src/api/routes/documents.ts` | refactor `/ingest-url` to delegate to the service |
| `src/mcp/index.ts` | register `ingest_document` |
| `src/core/index.ts` | export `ingestUrlAsDocument` if the route imports via core |
| `CLAUDE.md`, `FEATURES.md`, `docs/features/05-…`, in-app catalog | tool count 104→105; add to Documents area |

## 4. Tests (TDD)

`documentIngest.test.ts` (real test DB, injected `fetcher` stub — no network):
- **created:** stub returns a small text buffer → row inserted, `status:'created'`,
  doc_type/url/hash correct.
- **duplicate:** pre-insert a doc with hash H; stub returns the same bytes → returns
  `{status:'duplicate', existing_doc_id}` and inserts **no** second row.
- **binary encoding:** stub returns docType `pdf` → stored content is `data:base64;…`.
- **scope:** call with an `actingPrincipalId` lacking project write → rejects
  (authz at `createDocument`). *(auth-on harness)*

Plus a smoke check: `npm run build` green; live `ingest_document` MCP call against a
loopback fixture URL (harness `URL_FETCH_ALLOW_LOOPBACK`).

## 5. Safety-sensitive review (required by policy)

`ingest_document` is a **new MCP service boundary** that performs an outbound fetch.
Per CLAUDE.md "Safety-sensitive review policy":
- **SSRF:** inherits `fetchUrlAsDocument`'s defense unchanged (pinning, redirect
  re-check, private-range reject). Verify the MCP path can't bypass it (it calls the
  same fetcher; no alternate fetch).
- **Tenant scope:** the only authz is `createDocument`'s project-write assert. Verify
  a caller scoped to project A cannot ingest into project B by passing `project_id:B`
  — `resolveProjectIdOrThrow` + the assert must reject. Add this to the auth-on E2E.
- Run a cold-start adversary pass on the diff before marking M1 done.

## 6. Non-goals (v0.1.0)

- No base64/raw-bytes ingest over MCP (URL-only). File upload stays REST/GUI.
- No auto-extraction trigger (document is created; extraction is a separate step).
- No new SSRF policy — reuses the existing fetcher as-is.

## 7. Acceptance criteria

- [ ] `ingestUrlAsDocument` service + tests green (created/duplicate/binary/scope).
- [ ] REST `/ingest-url` delegates to the service; existing doc e2e still green.
- [ ] `ingest_document` MCP tool registered; live call ingests a fixture URL.
- [ ] Cross-tenant ingest rejected (auth-on).
- [ ] Tool count + docs updated (104→105); adversary pass clean.
