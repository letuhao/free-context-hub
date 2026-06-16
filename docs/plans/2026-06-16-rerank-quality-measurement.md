# Plan — Cross-encoder rerank QUALITY measurement (lessons surface)

- **Date:** 2026-06-16
- **Goal:** Final, trustworthy QUALITY comparison of **no-rerank vs cross-encoder** (bge-reranker-v2-m3)
  on the **lessons** retrieval surface, using the existing labeled golden set + ragas, in a
  controlled stack. (Latency already measured: 90 ms cross-encoder.)

## Corrected premises (post-investigation — avoids the misconceptions)

- **The golden set is NOT stale.** `qc/lessons-queries.json` (~40 queries, real `target_lesson_ids`
  + `must_keywords` + graded relevance) + 48 gen-eval rows (`ideal_answer`, `must_contain_facts`,
  `reviewed_by`). The staleness was ONLY in the throwaway `rerankBenchmark.ts` substring script —
  **discard it for quality**. No label authoring needed.
- **`runBaseline.ts` is the proper harness** — computes recall@k / MRR / nDCG (retrieval) AND ragas
  faithfulness / answer_relevancy / **context_precision** / context_recall (gen-eval).
- **Cross-encoder is in the lessons path** (`search_lessons` → `searchLessons` → `rerankLessons`
  → cohere when `RERANK_TYPE=api`). It is **NOT** in `search_code_tiered` (the code surface), so
  the code surface cannot measure it via runBaseline — **measure lessons only.**
- **Rerank-sensitive metric = `context_precision`** (did rerank put relevant lessons on top).
  faithfulness/answer_relevancy are answerer-bound — report but don't headline.
- A/B is driven by the **server `RERANK_TYPE`** (search_lessons has no per-call rerank param) →
  toggle via container env + restart per config. (Trap #0, the omitted-`rerank_mode`→`api` default,
  is a *code-surface* issue and does not affect lessons — deferred.)

## Controlled stack (neutralizes the confound traps)

1. **LM Studio:** exactly the models needed, reasoning OFF (already toggled in UI), each loaded:
   - answerer + judge = **one** chat model to avoid swaps (`google/gemma-4-26b-a4b-qat`, reasoning off,
     verified 2.1 s/distill earlier). Same-model answerer/judge bias is CONSTANT across the two
     rerank configs → does not affect the delta.
   - embeddings = `text-embedding-bge-m3`.
   - cross-encoder = `local-rerank-service` :28417 (separate, already up, prewarmed).
2. **Align judge model:** docker `JUDGE_AGENT_MODEL` default is `...-it`; LM Studio has `...-qat`.
   Set `JUDGE_AGENT_MODEL=google/gemma-4-26b-a4b-qat` (+ `ANSWERER_AGENT_MODEL` same).
3. **Kill swap source:** `DISTILLATION_MODEL=''` (worker no-ops) during measurement — prevents the
   gemma-distill background swap. (Restore after.)
4. **Preflight:** `scripts/preflight-baseline.mjs` + confirm cross-encoder `keep_warm`/loaded and
   judge `/health` OK before each run.

## Validity checks before measuring

- **Golden IDs resolve:** confirm `target_lesson_ids` in `qc/lessons-queries.json` exist in the
  queried project's DB (else recall is structurally 0 — a corpus mismatch, not a rerank result).
- **Candidate-pool recall ceiling:** confirm the relevant lesson is in the pre-rerank candidate pool
  (rerank can only reorder what retrieval returns). Report ceiling separately.
- **Zero silent fallbacks:** grep mcp logs for `cohere-api rerank: failed` during the cross-encoder
  run — any fallback contaminates that config; re-run if found.

## Execution

Per config: restart mcp with the config's env, preflight, run, archive.

```bash
# Config A — no-rerank (raw hybrid order)
RERANK_TYPE=generative DISTILLATION_ENABLED=false DISTILLATION_MODEL= docker compose up -d mcp
ANSWERER_AGENT_MODEL=google/gemma-4-26b-a4b-qat RAGAS_JUDGE_URL=http://localhost:3005 \
  npx tsx src/qc/runBaseline.ts --tag 2026-06-16-lessons-norerank --gen-eval on --surfaces lessons

# Config B — cross-encoder
RERANK_TYPE=api docker compose up -d mcp
ANSWERER_AGENT_MODEL=google/gemma-4-26b-a4b-qat RAGAS_JUDGE_URL=http://localhost:3005 \
  npx tsx src/qc/runBaseline.ts --tag 2026-06-16-lessons-crossencoder --gen-eval on --surfaces lessons
```

- Optionally a back-to-back `--control` run of one config for the **noise floor**; only call a
  metric delta real if it exceeds the floor.
- (Optional Config C — llm ranker — only if a purpose-built ranker is loaded, reasoning off.)

## Report

- `diffBaselines.ts` A vs B → table: recall@5/10, MRR, nDCG@10, **context_precision**, context_recall
  (+ faithfulness/answer_relevancy as secondary), with noise-floor flags.
- Append a "Quality" section to `docs/benchmarks/2026-06-16-cross-encoder-rerank-benchmark.md`.
- Honest framing: deterministic cross-encoder; same-model judge bias constant; deltas vs noise floor.

## Tasks

1. Verify golden `target_lesson_ids` resolve in the queried project (DB check).
2. Confirm `runBaseline.ts` CLI: `--surfaces`, `--tag`, `--gen-eval`, judge URL flags (read the arg parser).
3. Set controlled env (judge/answerer = gemma-qat, DISTILLATION off), stop worker.
4. Preflight (cross-encoder loaded, judge healthy, answerer reachable, reasoning off).
5. Run Config A (no-rerank) + archive.
6. Run Config B (cross-encoder) + archive; grep for zero rerank fallbacks.
7. (Optional) control run for noise floor.
8. Diff + write report.
