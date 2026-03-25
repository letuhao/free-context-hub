---
id: CH-M02  status: not-started  phase: MVP  depends-on: M04(schema)  updated: 2026-03-25
---

# Module Brief: M02 — Ingestion / Indexing Service

## Outcome
Discovers, chunks, embeds, and stores code files from allowed roots.
Supports incremental re-indexing (hash-based) and secret-aware file exclusion.

## Scope
IN: File discovery, ignore rules (`.contexthub/ignore`), chunking,
    embedding generation, chunk + metadata storage, incremental re-indexing
OUT: Real-time file watching/hot-reload (deferred), distributed/parallel indexing

## Acceptance
- [ ] AT-M02-01: `index_project(root)` discovers all non-ignored files under root
- [ ] AT-M02-02: Files matching `.env`, `*.key`, credential patterns are excluded
- [ ] AT-M02-03: Re-indexing skips unchanged files (file hash comparison)
- [ ] AT-M02-04: Each chunk stored as `{path, start_line, end_line, content, embedding}`
- [ ] AT-M02-05: Indexing status queryable: `{last_run, files_processed, error_count}`
- [ ] AT-M02-06: Custom ignore patterns from `.contexthub/ignore` are respected

## API Surface
Internal service; invoked via M01 `index_project` tool.
Returns: `{ status: "ok"|"error", files_indexed, duration_ms, errors[] }`

## Sub-phases
| SP | Scope | Status |
|---|---|---|
| SP-1 | File discovery + ignore rule engine | not-started |
| SP-2 | Chunking strategy (pending DEC-003) | not-started |
| SP-3 | Embedding generation (pending DEC-002) | not-started |
| SP-4 | Storage write to pgvector/SQLite | not-started |
| SP-5 | Incremental re-indexing (hash-based diff) | not-started |

## Risks (open)
- R-M02-01: Large repos may exceed memory with naive in-memory chunking [medium]
- R-M02-02: LM Studio must be running for indexing — service dependency [low — documented in setup]

## Recent Decisions
- DEC-002: Embedding = OpenAI-compatible API; `base_url` configurable → LM Studio default [2026-03-25]
- DEC-embedding-model: `nomic-embed-text-v1.5` as default (8192 ctx, code-capable, 4GB RAM) [2026-03-25]
- (DEC-003 chunking strategy still open — blocks SP-2)
