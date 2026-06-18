# DEFERRED-034 — Chunks retrieval rerank + relevance gate (DESIGN)

**Date:** 2026-06-18
**Status:** DESIGN → BUILD
**Size:** M-L
**Goal:** Raise chunks `context_precision` (and where possible `context_recall`)
by adding a reranker + relevance gate to the chunks retrieval surface — the
**only** retrieval surface that has neither. This is the legitimate
retrieval-layer lever that v12 (a template change) could not touch, because
cp/cr score the *retrieved contexts*, not the answer.

## Diagnosis (why this, grounded in data)

Per-row analysis of the v11 chunks baseline vs the noise-floor probe
(`docs/qc/2026-06-18-chunks-cp-cr-noise-floor-v12-closeout.md`):

| cp/cr loss mechanism | example rows | this design helps? |
|---|---|---|
| Junk chunks pad top-k (target already rank-1) | most confident-hit rows | **yes** — minScore gate drops junk |
| Relevant chunks buried behind junk (ranks 3/5/6) | `chunk-cross-retry-auth-storage` (cp 0.12) | **yes** — reranker promotes them |
| Judge says even rank-1 chunk not "useful" for gt | `config-table`, `role-definitions` | no — corpus/snippet issue |
| Multi-hop needs cross-chunk synthesis | `chunk-edge-multi-hop-1` | no — not a ranking fix |
| cr coverage gaps (gt claims absent from retrieved set) | several | mostly no — corpus granularity (L, re-deferred) |

So the realistic target is **cp** (precision): reranking promotes buried
relevant chunks; the relevance gate evicts junk that pads top-k. cr is largely
corpus-bound and is **not** the goal of this change.

**Measurement caveat (load-bearing):** cp judge-noise band is **0.146** over N=8
on this 13-row set. Any A/B MUST use ≥3 runs (or `--control`) and report the
spread; a single-run delta below ~0.1 is meaningless.

## Design

Reuse the existing rerank stack (the one lessons/code already use:
`RERANK_TYPE=api`, cohere protocol, local-rerank-service @ 28417, bge reranker).
No new rerank infra.

### 1. Share the rerank dispatcher (`src/services/lessons.ts`)
- Rename the already-generic private dispatcher `rerankLessons` →
  **`rerankCandidates`** and `export` it (its body only uses `query` +
  `RerankCandidate[]` = `{index,title,snippet}` — it was never lesson-specific).
- `export rerankConfigured()`.
- `applyRerankMinScore` + `RerankCandidate` are already exported.
- Update the single internal caller. No behavior change → existing lessons tests
  are the regression guard.

### 2. Wire rerank + pool + gate into `searchChunks` (`src/services/documentChunks.ts`)
- New param `rerank?: boolean` (default `true`, mirrors `searchLessons`).
- **Widen the candidate pool when reranking:** fetch
  `poolSize = rerankActive ? max(limit, CHUNKS_RERANK_POOL) : limit` rows
  (env `CHUNKS_RERANK_POOL`, default 30). Reranking only adds value if the pool
  is wider than the returned `limit`.
- After hybrid scoring + `minScore` filter, if `rerankActive`
  (`rerank !== false` AND `rerankConfigured()` AND NOT `CHUNKS_RERANK_DISABLED`):
  build `RerankCandidate[]` from the pool, call `rerankCandidates`, reorder via a
  **pure helper `reorderByRerank(matches, order)`** (TDD target), then trim to
  `limit`. Dispatcher already applies `RERANK_MIN_SCORE` internally and returns
  identity order on any failure (graceful).
- Order of ops: hybrid SQL (pool) → `minScore` sem gate → rerank reorder → trim
  to `limit` → near-semantic dedup (unchanged). Emit an `explanations` line
  (reranked N/pool, dropped via min_score, or skipped+reason) mirroring lessons.
- **Server kill-switch / A/B knob:** `CHUNKS_RERANK_DISABLED=true` (mirrors
  `CHUNKS_DEDUP_DISABLED`). This is how the baseline A/B toggles rerank off
  without harness changes.

### 3. MCP `search_document_chunks`
- Add a `rerank` input param (mirror `search_lessons`); thread to `searchChunks`.

### 4. Product impact (intended, not just QC)
Production chat / global-search chunk queries also go through `searchChunks`, so
they get the same precision improvement + a bounded rerank round-trip
(`RERANK_TIMEOUT_MS`=1800ms, graceful fallback). Toggle off via
`CHUNKS_RERANK_DISABLED` if latency is a concern.

## Tests (TDD)
- `reorderByRerank(matches, order)` pure helper: full order, partial order
  (RERANK_MIN_SCORE dropped tail), out-of-range/duplicate indices ignored,
  empty order → unchanged.
- minScore pre-rerank filtering behavior (pure where possible).
- `CHUNKS_RERANK_DISABLED` / `rerank:false` → no reorder, explanation emitted.
- Existing lessons tests guard the shared-dispatcher rename.

## Verify
- `tsc --noEmit` + unit suite.
- A/B baseline, chunks surface, **≥3 runs each** arm, controlled stack:
  - Arm A (rerank ON): default env.
  - Arm B (rerank OFF): `CHUNKS_RERANK_DISABLED=true`.
  - Compare cp/cr surface means **with spread**; only claim a win if Arm A's cp
    clears Arm B by more than the measured noise band.
- Honest reporting: if cp gain is within noise, say so and keep the change on
  architectural-consistency grounds (chunks should rerank like every other
  surface) rather than overclaiming a metric win.

## Out of scope (re-defer)
- Chunk granularity / re-chunking the corpus — the main `cr` lever. Logged as a
  sub-item under DEFERRED-034; L effort, needs re-ingestion + re-baseline.
