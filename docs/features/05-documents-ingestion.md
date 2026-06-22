# Documents & Ingestion

Bring external knowledge in: upload files or point at a URL, and free-context-hub
extracts the text, chunks it, embeds it, and makes it searchable — and can generate
lessons from it.

## Key concepts

- **Multi-format extraction** — PDF, DOCX, images, Markdown, and URLs. Three
  extraction modes trade speed for fidelity: *fast*, *quality*, and *vision*
  (image/diagram understanding via a vision model).
- **Chunking + embeddings** — extracted text is split into chunks, each embedded for
  [hybrid semantic + FTS search](02-search-retrieval.md).
- **Optimistic-locked chunk editing** — chunks can be edited/deleted with a version
  check to avoid lost updates.
- **SSRF-hardened URL ingestion** — URL fetches are pinned against DNS-rebinding and
  defended against slow-loris.
- **Vision jobs** — heavy vision extraction runs asynchronously with progress and
  cancel (see [Jobs](11-jobs-operations.md)).
- **Generated documents** — the system also produces docs (FAQ, RAPTOR summaries, QC
  reports, benchmarks) that can be promoted into active knowledge.

## How to use it

### MCP (agents)

| Tool | Purpose |
|------|---------|
| `search_document_chunks` | Hybrid search over extracted chunks |
| `list_generated_documents` | List generated FAQ/RAPTOR/QC/benchmark docs |
| `get_generated_document` | Fetch one generated doc |
| `promote_generated_document` | Promote a draft generated doc to active |

### REST

- `POST /api/documents/upload` — multipart upload (10MB limit), with extraction mode
- `POST /api/documents/ingest-url` — ingest from a URL (SSRF-hardened)
- `GET /api/documents`, `GET /api/documents/:id`, `DELETE /api/documents/:id`
- `GET /api/documents/:id/chunks`, update/delete chunk endpoints
- Link/unlink a document to lessons
- `/api/generated-docs` — list/get/promote generated docs

### GUI

- **Documents** (`/documents`) — upload, manage, extract, chunk, and search; image
  upload UX and mermaid rendering; AI-assisted extraction.
- **Generated Docs** (`/knowledge/docs`) — browse FAQ/RAPTOR/QC/benchmarks and
  promote to lessons.

## Related

- [Search & Retrieval](02-search-retrieval.md) · [Memory & Lessons](01-memory-lessons.md) · [Jobs & Operations](11-jobs-operations.md)
