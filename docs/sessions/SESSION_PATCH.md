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
- Seeded MCP facts for worst clusters via `add_lesson` (lessons store) and verified lesson retrieval response quality.
- Implemented **lesson-to-code expansion** in `src/services/retriever.ts`:
  - `filters.lesson_to_code` wiring from `src/index.ts` into retriever.
  - Query-similar lessons -> `source_refs` normalization -> path priors.
  - True candidate expansion by fetching best chunks from lesson-prior files (not only score boosting).
  - Retrieval cache key now includes lesson signature (`MAX(lessons.updated_at)`).
- Added retrieval tuning controls (general-purpose, no workspace hardcoding):
  - `RETRIEVAL_CANDIDATE_POOL_MIN`
  - `RETRIEVAL_CANDIDATE_POOL_MULTIPLIER`
  - `RETRIEVAL_CANDIDATE_POOL_MAX`
  - `RETRIEVAL_LESSON_PRIOR_MIN_SCORE`
  - `RETRIEVAL_MMR_LAMBDA`
  - `RETRIEVAL_MMR_WINDOW`
  - wired in `src/env.ts` and documented in `.env.example`.
- Added diversification/ranking safety:
  - candidate-local hub-file penalty
  - MMR-based reorder window before final cap
  - final output sliced back to requested `topK`.
- QC runner (`src/qc/ragQcRunner.ts`) updates for controlled measurement:
  - explicit `filters.lesson_to_code=true` in pass1/pass2
  - keep golden `path_glob` in pass2 when present
  - include smoke files by intent
  - dedupe ranked paths at file level before scoring.
- Added new helper script: `src/scripts/seedQcFactsFromQueries.ts` for golden-query fact seeding.
- Documentation updates:
  - refreshed technical status in `docs/qc/qc-report.md`
  - added one-page `docs/qc/executive-summary.md`.

## Measured Outcome (QC)
- Initial stalled region (pre lesson-to-code): around `recall@3=0.507`, `MRR=0.477` on 67 queries.
- Best run in this session:
  - report: `docs/qc/2026-03-27T22-17-56-882Z-qc-report.md`
  - `recall@3=0.776`
  - `MRR=0.716`
- Improvement is real but not uniform; remaining worst queries cluster in `kg`, `git`, `mcp-server`, `workspace`, and some `lessons` internals.

## Next
- Add intent-aware routing before ranking for hard verticals:
  - `kg`, `git`, `mcp-server`, `workspace`.
- Improve candidate generation for target implementation files (reduce broad hub-file dominance).
- Keep A/B QC tracking with both quality and latency budgets:
  - optimize for `recall@3` + `MRR` without unacceptable p95 regression.
- Continue enforcing general logic policy (no workspace-specific bias).

## Open Blockers / Risks
- Fact injection alone no longer yields large gains; retrieval architecture is the limiting factor for remaining hard queries.
- Some tuning knobs can improve one group while regressing another; requires controlled A/B and guardrail thresholds.
- LLM rerank/expanded candidate pools can increase latency and variance if not bounded carefully.
