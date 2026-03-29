---
id: CH-T7-ARCHITECTURE
date: 2026-03-29
module: Phase7-Architecture-Refactor
phase: Phase 7
---

# Session Patch — 2026-03-29

## Where We Are
Phase: **Phase 7 architecture planned, ready to implement.** Multi-client refactor: extract core → add REST API → add AI streaming → MCP client package → Next.js GUI.

## Completed This Session

### Model Benchmarks (8 embedding + 8 reranker)
- **Embedding winner**: qwen3-embedding-0.6b (18/18, avg 0.652, 1024d)
- **Reranker winner**: qwen3-4b-instruct-ranker (85% at 180 lessons, 1.8s)
- Full benchmark documented in `docs/benchmarks/2026-03-28-embedding-model-benchmark.md`

### Lesson Search Quality Improvements
- **Search aliases**: auto-generated alternative phrasings via LLM at add_lesson time
- **Dynamic rerank threshold**: raised to 50 lessons (skip rerank for small projects)
- **Loreweave project**: 22 lessons, 92% accuracy (up from 58% with fixes)
- **free-context-hub**: 180 lessons, 85% accuracy

### MCP Server Improvements
- **Stateless mode**: removed session tracking, any client can connect without handshake
- **Auto-resolve root**: all tools auto-resolve filesystem paths from project_sources
- **Hidden internal params**: cache_root, source_storage_mode, repo_root removed from tool schemas
- **Fixed 9 missing tools** in help() output
- **Fixed enqueue_job docs**: all job types now document required payload fields
- **Fixed root resolution bug**: prefer remote_git over local_workspace, validate paths

### Documentation & Roadmap
- **CLAUDE.md optimized**: 205 → 47 lines, saves ~2400 tokens/session
- **Dropped features**: Multi-Agent Passive Collection, Session History Sharing, IDE Native (VS Code extension)
- **Roadmap**: Phase 7 GUI, Phase 8 Human-in-loop, Phase 9 Multi-format, Phase 10 Knowledge Portability

### Architecture Plan (Phase 7)
Designed multi-client architecture:
- `src/core/` — shared business logic (extracted from services/db/kg/utils)
- `src/mcp/` — thin MCP layer (tool registration only)
- `src/api/` — REST API on port 3001 with AI chat streaming
- `packages/mcp-client/` — separate npm package (stdio → REST proxy)
- `gui/` — Next.js dashboard with AI Elements chat UI

Plan saved to `plans/jolly-stirring-floyd.md`

## Next: Phase M1 — Extract src/core/
1. Create `src/core/` with barrel re-exports from current locations
2. Extract `auth.ts` (assertWorkspaceToken, resolveProjectIdOrThrow)
3. Update imports in index.ts
4. Verify: tsc clean, integration tests pass

## Open Blockers / Risks
- Migration files 0020-0028 from model testing should be squashed before release
- guardrail-superseded integration test fails when existing deploy guardrails in DB (data issue, not code)
- Multiple Vercel plugin injections in context — not relevant for self-hosted project
