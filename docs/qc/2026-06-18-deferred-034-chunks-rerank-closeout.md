# DEFERRED-034 — Chunks retrieval rerank: closeout

**Date:** 2026-06-18
**Status:** SHIPPED (default-ON) on architectural-consistency grounds.
**Design:** `docs/specs/2026-06-18-deferred-034-chunks-rerank-design.md`

## What shipped

The chunks retrieval surface (`searchChunks`) now reranks like lessons/code — it
was the only retrieval surface with no reranker. Implementation:

- Reuse the shared (lesson-agnostic) rerank dispatcher (`rerankCandidates`,
  renamed+exported from `lessons.ts`).
- Widen the candidate pool when reranking (`CHUNKS_RERANK_POOL`=30) → rerank →
  trim to `limit`. Dedup runs on the full reranked pool first.
- `rerank` param on `searchChunks` + the MCP `search_document_chunks` tool;
  `CHUNKS_RERANK_DISABLED` server kill-switch / A/B knob.
- Pure `reorderByRerank(pool, order)` helper (TDD, 6 cases).
- Graceful fallback: dispatcher returns identity order on any rerank failure.

Tests: 18/18 chunks unit, 57/57 lessons+chunks (rename-safe), tsc clean.

## Verification — two halves

### Mechanism (low-noise, decisive) ✅
In-process A/B (`src/qc/chunksRerankAbProbe.ts`), rerank OFF vs ON over the 13
chunks golden queries:
- **rerank fired 13/13; top-5 order changed on 11/13.**
- Wider pool improves result **completeness**: `chunk-role-definitions` and
  `chunk-data-storage-pgvector` went 3→5 results (dedup had more unique
  candidates to fill from).
- `chunk-cross-retry-auth-storage` (relevant chunks buried at ranks 3/5/6 behind
  junk) is the textbook case the reranker is meant to fix.

### cp/cr quality (noisy) — METRIC-NEUTRAL
A/B with the judge, 3 passes/arm (Tradition-B gemma judge):

```
        off     on      Δ        judge-noise band (v12 closeout)
cp     0.676   0.664   -0.013    0.146
cr     0.380   0.389   +0.009    —
```

Per-pass cp: off 0.637/0.724/0.669, on 0.620/0.615/0.756 — the **on-arm alone
spans 0.615–0.756 (≈ the whole noise band)**. Both Δ are |<0.013|, far inside
the 0.146 band. **On this 13-row corpus, rerank neither measurably helps nor
hurts cp/cr** — exactly as the design predicted: most targets are already at
rank-1, so reranking has little cp headroom, and judge noise swamps any small
effect.

## Decision: ship default-ON

Justified on **architectural consistency** (chunks now behaves like every other
surface), **result completeness** (the wider pool is a real, if small, win), and
**no regression** (Δ within noise, graceful fallback, kill-switch). NOT on a
claimed metric win — there isn't one to claim on this corpus. When the chunk
corpus grows or harder/buried-relevant queries appear, the reranker has real
headroom; the infrastructure is now in place.

## Operational caveat (real)

The rerank service (local-rerank-service @ 28417) **times out at the default
`RERANK_TIMEOUT_MS`=1800ms on the FIRST call after it goes idle/cold** — the
chunk search then falls back to no-rerank (graceful, no error) until the service
warms. The same default applies to lessons/code. If first-query rerank coverage
matters, either warm the rerank service or raise `RERANK_API_TIMEOUT_MS`. Not
fixed here — it predates this change and affects all surfaces equally.

## Follow-ups (not done)

- `searchChunksMulti` (cross-project chunk search) does NOT rerank — only the
  single-project `searchChunks` was wired. Add for parity if multi-project chunk
  search becomes a measured path.
- Chunk granularity / re-chunking (the main `cr` lever) remains the larger,
  separate corpus-side task — still the honest answer for raising `cr`.
