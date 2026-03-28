---
id: CH-T6-RAG-QC
date: 2026-03-28
module: Phase6-RAG-Retrieval-Quality
phase: Phase 6
---

# Session Patch — 2026-03-28

## Where We Are
Phase: **Phase 6 complete.** Tiered search pipeline, 3 search profiles, hybrid lesson search with LLM reranking, 8-model embedding benchmark, 17/17 test plan executed, 91% lesson search accuracy at 40 lessons scale.

## Completed This Session

### Tiered Search Pipeline
- **12-kind chunk classification**: source, type_def, test, migration, config, dependency, api_spec, doc, script, infra, style, generated
- **4-tier deterministic-first search**: ripgrep → symbol ILIKE → FTS → semantic fallback
- **3 search profiles** auto-selected by kind parameter:
  - `code-search` (default): deterministic-first for source/config/types
  - `relationship` (kind=test): convention paths → KG imports → filtered ripgrep
  - `semantic-first` (kind=doc/script): semantic at full weight + FTS parallel

### Review & Bug Fixes (20 issues fixed)
- Query classification: identifier priority over NL words
- Short token extraction (2+ chars: env, db, api)
- FTS AND mode for identifier queries
- `.sql` file misclassification fix
- Ripgrep circuit breaker + multi-ecosystem ignore patterns
- Path traversal validation on workspace root
- Workspace root caching (5min TTL)
- Redis caching for tiered search results
- pg_trgm index on symbol_name for ILIKE performance
- **Guardrails bug fix**: superseded/archived lessons were still blocking actions
- `kind:"test"` + `includeTests:false` conflict resolved

### Lesson Search Quality
- **Hybrid search**: semantic embedding + 0.40 * FTS keyword boost
- **Title+content embedding**: prepend title for better query-document alignment
- **LLM reranking**: top 8 candidates re-ordered by qwen3-reranker-4b
- FTS tsvector column + GIN index on lessons table (migration 0019)

### Embedding Model Benchmark (8 models)
- Tested: mxbai-large, nomic-v2, bge-m3, qwen3-4b, nomic-embed-code, qwen3-0.6b, embeddinggemma-300m, jina-v5-retrieval
- **Winner: qwen3-embedding-0.6b** (1024d, 18/18 pass, avg 0.652)
- Key finding: code-specific models hurt lesson search (lessons are text, not code)
- Documented in `docs/benchmarks/2026-03-28-embedding-model-benchmark.md`

### Integration Test Runner
- 13 automated tests via live MCP tool calls (`npm run test:integration`)
- Covers: lesson CRUD, guardrails enforcement, session bootstrap, all 3 search profiles
- All 13 tests pass on final configuration

### Scale Testing
- 40 lessons (30 real session decisions + 10 seed), 33 queries
- **91% accuracy** (30/33), avg score 0.722, discrimination gap 0.277
- Scores improve with more lessons (0.652 → 0.722 avg from 10 to 40 lessons)

### Documentation Updates
- README: reframed priorities (lessons > guardrails > code search), model recommendations
- WHITEPAPER: updated abstract and goals for persistent memory focus
- Benchmark report, test plan, QC reports

### Project Priority Reframe
- **Core**: persistent cross-session knowledge, guardrails, session bootstrap
- **Supplementary**: code search (agents have Grep/Glob), git intelligence
- Code search is assistive, not the main value proposition

## Measured Outcomes

| Metric | Baseline | Final | Change |
|--------|----------|-------|--------|
| Integration tests | 0 | 13/13 pass | New |
| Lesson search (10 lessons) | — | 18/18 (100%) | New |
| Lesson search (40 lessons) | — | 30/33 (91%) | New |
| Lesson avg score | — | 0.722 | New |
| Golden set recall@3 | 0.731 | 0.761 | +4.1% |
| Golden set MRR | 0.673 | 0.714 | +6.1% |
| Tiered search baseline | — | recall@3=0.687 | New |

## Final Model Combo

| Role | Model |
|------|-------|
| Embeddings | qwen3-embedding-0.6b (1024d) |
| Distillation | qwen2.5-coder-7b-instruct |
| Reranker | qwen.qwen3-reranker-4b |

## Next
- Collect real usage data to identify remaining lesson search failures
- Consider fine-tuning embedding adapter on domain data if accuracy plateaus
- Phase 7: Multi-agent knowledge sharing
- Phase 8: Interactive GUI for knowledge exploration

## Open Blockers / Risks
- 3/33 lesson queries fail at 40 lessons — vague queries competing against many topics
- Ripgrep binary must be installed in Docker container for tier 1 search
- Multiple dimension migration files (0020-0028) from model testing — squash before release
