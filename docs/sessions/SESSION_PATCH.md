---
id: CH-T6-RAG-QC
date: 2026-03-28
module: Phase6-RAG-Retrieval-Quality
phase: Phase 6
---

# Session Patch — 2026-03-28

## Where We Are
Phase: **Phase 6 retrieval quality tuning in-progress** with measurable gains on QC golden set, while preserving general (workspace-agnostic) retrieval logic.

## Completed This Session

### Earlier work (pre-continuation)
- Seeded MCP facts for worst clusters via `add_lesson` and verified lesson retrieval response quality.
- Implemented **lesson-to-code expansion** in `src/services/retriever.ts`.
- Added retrieval tuning controls (general-purpose, no workspace hardcoding).
- Added diversification/ranking safety (hub-file penalty, MMR reorder, topK cap).
- QC runner updates for controlled measurement.
- Removed all 7 hardcoded intent probe blocks (workspace-specific bias).
- Made retriever fully workspace-agnostic with universal token extraction.

### Continuation session (current)
- **AST-heuristic smart chunker** (`src/utils/smartChunker.ts`):
  - Detects function/class/interface boundaries for 11 languages (TS, JS, Python, Go, Rust, Java, C#, Ruby, PHP, Kotlin, Swift).
  - Falls back to line-based chunking for unknown/data languages (JSON, YAML, Markdown).
  - Populates `symbol_name`, `symbol_type` metadata on each chunk.
- **Language detection** (`src/utils/languageDetect.ts`):
  - Maps 35+ file extensions to language names.
  - Detects test files via path patterns (`is_test` flag).
- **Query decomposition** (`src/utils/queryDecomposer.ts`):
  - Rule-based splitting of multi-intent queries into sub-queries (max 3).
  - Parallel retrieval + merge by best score.
- **Language-aware search hints** (`src/utils/languageHints.ts`):
  - Per-language structural token generation based on query intent categories.
  - Enriches lexical tokens with language conventions (e.g., `export function` for TS).
- **PostgreSQL FTS integration** (replacing ILIKE-based hybrid search):
  - `src/utils/ftsTokenizer.ts`: camelCase/snake_case expansion for both indexing and querying.
  - `expandForFtsIndex()`: "parseBooleanEnv" -> "parse boolean env parsebooleanenv" in tsvector.
  - `buildFtsQuery()`: builds tsquery with expanded terms + stop-word filtering.
  - GIN index on `fts` tsvector column for fast full-text search.
- **DB migration** (`migrations/0013_chunk_metadata.sql`):
  - Added columns: `language`, `symbol_name`, `symbol_type`, `is_test`, `fts tsvector`.
  - GIN index on fts, partial indexes on language, is_test, symbol_type.
- **FTS backfill migrations** (`migrations/0014_backfill_fts.sql`, `0015_force_reindex_fts.sql`):
  - Backfills FTS for pre-existing chunks; forces full re-index for proper camelCase expansion.
- **Retrieval logging** added to `src/services/retriever.ts`:
  - Structured pino logs at search_code:start, :candidates, :kg_files, :done.
  - Logs: query, hybrid mode, token count, FTS query, candidate counts, timing, top-3 results.
  - Critical for diagnosing why specific queries fail.
- **Stop-word filtering** in lexical token extraction and FTS query builder:
  - Removes "how", "are", "where", "does", etc. from tokens to reduce noise.
- **Scaffolding penalty** in scoring:
  - De-prioritizes `scripts/verify*.ts`, `scripts/seed*.ts`, `qc/` files by 0.06-0.12 points.
  - Prevents QC/verification scripts (which REFERENCE features) from outranking actual implementations.
- **Indexer incremental guard fix**:
  - Now checks `fts IS NOT NULL` to force re-index when FTS column is missing.
- **Weight tuning**: lexical blend 0.25->0.40, file-level rerank 0.15->0.25.
- **Env default**: `RETRIEVAL_HYBRID_LEXICAL_LIMIT` 12->20.

## Measured Outcome (QC)

| Run | recall@3 | MRR | Notes |
|-----|----------|-----|-------|
| Pre lesson-to-code | 0.507 | 0.477 | Initial baseline |
| Best with hardcoded probes | 0.776 | 0.716 | Inflated by workspace-specific bias |
| Honest baseline (probes removed) | 0.716 | 0.637 | True workspace-agnostic baseline |
| + weight tuning | 0.716 | 0.660 | MRR +3.6% |
| + FTS fix + stop words + scaffolding penalty | **0.731** | **0.673** | recall +2.1%, MRR +2.0% |

Key group improvements in latest run:
- `distillation`: 0.500/0.625 -> **1.000/1.000** (perfect)
- `lessons` MRR: 0.238 -> **0.292** (+22.7%)

## Remaining Hard Queries (15 at recall@3=0)
Primary patterns in failing queries:
1. **Hub file problem**: `src/index.ts` (2500+ lines) is target for auth, health, config queries but embedding similarity is diffuse across its many chunks.
2. **KG namespace dominance**: `tsMorphExtractor.ts` dominates `src/kg/` namespace, drowning smaller files like `query.ts`, `ids.ts`, `linker.ts`, `projectGraph.ts`.
3. **Semantic gap**: Natural language queries ("How does X work?") don't embed close to pure code implementations.
4. **Git intelligence**: Two `gitIntelligence.ts` queries fail because `gitLessonProposalUpsert.ts` is semantically closer.

## Next
- Consider LLM rerank for worst groups (`mcp-server`, `config`, `kg`) to close the semantic gap.
- Explore file-path aware embedding (prepend file path to chunk content before embedding).
- Add symbol_name boosting in scoring (exact identifier match in query -> boost).
- Continue A/B QC tracking with both quality and latency budgets.

## Open Blockers / Risks
- Remaining hard queries require either LLM rerank or fundamentally different retrieval (e.g., code-specific embeddings).
- Scaffolding penalty is heuristic and may need per-project tuning for other workspaces.
- FTS effectiveness depends on chunk content having proper camelCase expansion (requires re-index after schema change).
