# DEFERRED-030 — Rerank quality measurement + harness hygiene

**Branch:** `deferred-030-rerank-quality`
**Date:** 2026-06-16
**Status:** DESIGN

## Problem

Three follow-ups left open after the 2026-06-16 cross-encoder rerank deploy:

1. **`src/qc/rerankBenchmark.ts` measures the wrong thing.** Labels are
   `expect: string` substring matches authored for the Phase-12 lesson set;
   the current catalog has 175 lessons and a different distribution. Pass/fail
   substring is also not recall@k or MRR.
2. **Harness baseline is contaminated.** Now that `RERANK_TYPE=api`, the
   `(no-rerank)` row prefetches via `search_lessons` which itself cross-encoder
   reranks server-side. The "no-rerank" baseline is actually "server rerank
   without further client rerank."
3. **No off-topic rejection.** Cross-encoder returns N docs; even very
   low-relevance items can rank #1 if all others are worse. No floor exists.

## Fix

### Part A — `rerank: boolean` param (default `true`)

Add `rerank?: boolean` to `SearchLessonsParams`. When `false`, skip the
rerank dispatcher block in `searchLessons`. Thread through:

- MCP `search_lessons` tool: optional `rerank: boolean` (default `true`)
- REST `GET /api/lessons/search`: optional `rerank` query param

Backward compatible: omitted → `true` → identical to today.

### Part B — `RERANK_MIN_SCORE` floor

Add env `RERANK_MIN_SCORE` (z.coerce.number().min(0).max(1).optional().default(0))
to `env.ts`. When non-zero and `RERANK_TYPE=api`:

- `rerankCohereApi`/`rerankExternalApi` filter `relevanceScore < threshold`
  docs out of `ranked`.
- Dispatcher returns `{ order: number[]; dropIndices?: Set<number> }`.
- `searchLessons` removes `dropIndices` items from `matches` after rerank.
- An explanation is pushed: `rerank: floor=${threshold}, dropped=${dropCount}`.

`RERANK_MIN_SCORE=0` (default) → no floor → identical to today.

### Part C — `rerankBenchmark.ts` refactor

- Load `qc/lessons-queries.json` (48 queries, 66 unique `target_lesson_ids`,
  all 66 verified active in current catalog 2026-06-16).
- Use `target_lesson_ids` substring on `lesson_id` (exact match) instead of
  `expect: string` substring on `(title + snippet)`.
- Compute per-model: recall@1, recall@3, recall@5, recall@10, MRR, mean
  latency. Replace pass/fail tally.
- For `adversarial-miss` queries (empty `target_lesson_ids`): use score-floor
  semantics — "PASS" iff top-1 score < `ADVERSARIAL_SCORE_FLOOR` (default 0.5).
- Prefetch with `rerank: false` so client-side rerankers compare on the same
  raw retrieval pool.
- Keep `RERANK_BENCH_MODELS` env override.

## Acceptance criteria

| # | Criterion | Verification |
|---|---|---|
| AC1 | `SearchLessonsParams.rerank` defaults to `true` (back-compat) | unit test |
| AC2 | `rerank: false` skips the dispatcher (no rerank call) | unit test (mock dispatcher) |
| AC3 | MCP `search_lessons` accepts optional `rerank` arg | tools/list smoke + unit |
| AC4 | `RERANK_MIN_SCORE=0` (default) → identical behavior to today | unit test |
| AC5 | `RERANK_MIN_SCORE>0` drops sub-floor docs from result + explanation logged | unit test |
| AC6 | `rerankBenchmark.ts` reports recall@k + MRR per model, not pass/fail | live run produces JSON output |
| AC7 | Prefetch uses `rerank: false` (verified in logs) | live run |

## Out of scope

- chunks/code surfaces: no bypass param (only `lessons` is benchmarked).
- Updating historical Phase 12 baseline reports.
- `RERANK_MIN_SCORE` per-surface (lessons-only for now; same env knob).

## Test plan

- Unit: `lessons.test.ts` extend with rerank-bypass + min-score-floor cases.
- Unit: `rerankClient.test.ts` already covers cohereRerank; no change needed.
- E2E: live `rerankBenchmark.ts` run vs current stack → snapshot recall@k/MRR
  to `docs/benchmarks/2026-06-16-rerank-quality-recall.md`.
