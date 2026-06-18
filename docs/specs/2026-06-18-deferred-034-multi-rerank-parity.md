# DEFERRED-034 — searchChunksMulti rerank parity (DESIGN)

**Date:** 2026-06-18
**Status:** DESIGN → BUILD
**Size:** M

## Goal

Bring multi-project chunk search (`searchChunksMulti`) to feature parity with
single-project `searchChunks`, which gained a reranker + wide-pool + min-score
gate in PR #39. This closes the second open DEFERRED-034 sub-item. (The first —
chunk-granularity for `cr` — was diagnosed **not measurable** on the current
11-chunk / 3-vision-failure corpus: cr is corpus-bound, not granularity-bound;
re-deferred behind corpus expansion. Evidence: `docs/deferred/DEFERRED.md`
DEFERRED-034 note + DB query 2026-06-18.)

## Gap (verified by reading both functions)

`searchChunksMulti` (`documentChunks.ts:426`) already has near-semantic dedup
(509-522) but lacks, vs `searchChunks`:
- **rerank** — no wide candidate pool, no `rerankCandidates` call, no
  `reorderByRerank`, no `RERANK_MIN_SCORE` eviction.
- a `rerank?` request param (for the MCP/A-B kill-switch parity).

(Out of scope here: multi's embedding call is unguarded — no FTS fallback on
embed failure, unlike single. That's a DEFERRED-025-class robustness gap, not a
rerank-parity gap; noted as a follow-up.)

## Design — extract the shared post-retrieval pipeline

Rather than copy the ~55-line rerank+dedup+trim block into multi (which would
re-introduce the exact drift this item is about), extract it once:

- `chunkRerankActive(rerankRequested)` — pure: `rerank !== false &&
  rerankConfigured() && !CHUNKS_RERANK_DISABLED`. Both callers use it BEFORE the
  SQL to size the candidate pool (`fetchSize`).
- `postProcessChunkMatches({query, matches, rerankTextByChunk, rerankActive,
  rerankRequested, fetchSize, limit, explanations})` — runs rerank → dedup →
  trim and pushes the same explanation lines. Both `searchChunks` and
  `searchChunksMulti` build `matches` + the wide-window `rerankTextByChunk` from
  their own SQL, then delegate. Drift becomes impossible.

`searchChunks` is refactored to call the helper (behavior must stay
byte-identical — guarded by existing `documentChunks.test.ts` +
`reorderByRerank` tests). `searchChunksMulti` gains: `rerank?` param, wide
`fetchSize` when active, `rerankTextByChunk` (1000-char window, same as single),
and the `postProcessChunkMatches` call.

## Tests (TDD)
- `chunkRerankActive` pure table: rerank=false → false; configured+enabled →
  true; `CHUNKS_RERANK_DISABLED` → false; not-configured → false.
- `reorderByRerank` already covers the reorder/min-score-drop/dup-index cases.
- Existing `documentChunks.test.ts` guards single-project behavior across the
  refactor.

## Verify
- `tsc --noEmit` + full unit suite (single-project behavior unchanged).
- Live smoke: a 2-project chunk query with rerank on vs `CHUNKS_RERANK_DISABLED`
  → confirm the reranked path fires (explanation line) and returns results.
