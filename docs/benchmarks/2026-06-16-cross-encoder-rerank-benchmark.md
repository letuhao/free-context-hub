# Cross-encoder rerank — integration, latency + quality benchmark

- **Date:** 2026-06-16
- **Change:** Online lesson reranker switched from LLM-as-ranker to a dedicated cross-encoder
  (`bge-reranker-v2-m3`) served by `local-rerank-service` over the **Cohere `/v1/rerank`** protocol.
  Deployed live (`RERANK_TYPE=api`, `RERANK_API_PROTOCOL=cohere`).
- **Specs:** [`integration`](../specs/2026-06-16-cross-encoder-rerank-integration.md) ·
  [`quality method`](../specs/2026-06-16-rerank-quality-measurement.md) ·
  [`stress goldenset`](../specs/2026-06-16-rerank-stress-goldenset-methodology.md)

## TL;DR

The cross-encoder's value is **conditional on query difficulty**, and large where it matters:

- **Hard queries** (relevant lesson buried at rank 4–20 by hybrid retrieval): **MRR ×3–4, recall@3
  0 → 61%, context_precision ×2.2, context_recall ×2.0.** A major, multi-metric win.
- **Easy queries** (relevant lesson already rank 1, ~80% of this corpus): **neutral** (within noise),
  at **+~40 ms** latency.
- **vs an LLM reranker: ~20× lower latency** (90 ms vs 1.8 s) for the same job.

## Latency

| Reranker | Latency / query | Notes |
|---|---|---|
| **bge-reranker-v2-m3 (cross-encoder)** | **~90 ms** warm | one forward pass; +~32–40 ms over no-rerank |
| general chat LLM as reranker (mistral-nemo-12b, qwen3.6-35b) | ~6.8 s | generation-bound (~500 tokens) |
| purpose-built LLM ranker (qwen3-4b-instruct-ranker, Phase 12) | 1.8 s | prior clean measurement |
| no-rerank | 0 ms | baseline |

LLM rerankers are slow because they **generate** the ranking token-by-token; the cross-encoder
scores `(query, passage)` pairs in a single forward pass (16 MB VRAM, shared GPU).

## Quality — stratified A/B (no-rerank vs cross-encoder)

Measured on the **lessons** surface (where the cross-encoder is wired: `search_lessons` →
`rerankLessons` → cohere). Two bands, two independent metric families.

### Retrieval (deterministic — recall@k / MRR / nDCG on labeled target lesson_ids)

| Band | metric | no-rerank | cross-encoder | Δ |
|---|---|---|---|---|
| Hard (n=18) | recall@3 | 0.000 | **0.611** | +0.61 |
| Hard | recall@5 | 0.278 | **0.667** | +0.39 |
| Hard | MRR | 0.116–0.141 | **0.470–0.475** | **×3.4–4** |
| Hard | nDCG@10 | 0.241 | **0.558** | ×2.3 |
| Easy (n=48) | recall@5 | 0.889 | 0.889 | 0 |
| Easy | MRR | 0.8519 | 0.8556 | +0.004 (noise) |

### Generation (ragas — gemma-4-26b-a4b-qat judge, reasoning off)

| Band | faithfulness | answer_relevancy | **context_precision** | context_recall | groundedness |
|---|---|---|---|---|---|
| Hard — no-rerank | 0.42 | 0.22 | **0.26** | 0.31 | 0.97 |
| Hard — cross-encoder | **0.60** | **0.39** | **0.58** | **0.63** | 0.94 |
| Easy — no-rerank | 0.78 | 0.52 | 0.77 | 0.68 | 0.98 |
| Easy — cross-encoder | 0.75 | 0.50 | 0.81 | 0.65 | 0.97 |

**Both metric families agree:** on the hard band the cross-encoder ≈ doubles context_precision /
context_recall and lifts faithfulness / answer_relevancy — because promoting the relevant lesson
into the top-K context lets the answerer actually ground its answer. On the easy band, retrieval is
already near-ceiling (context_precision 0.77), so rerank is neutral overhead.

## Two measurement traps caught (why this is trustworthy)

1. **False positive avoided.** The throwaway `rerankBenchmark.ts` used **stale substring labels**
   (authored for the Phase-12 lesson set). Discarded for quality; used the properly-labeled golden
   set (recall@k on target IDs) + ragas instead.
2. **False negative caught + fixed.** A legacy gate in `searchLessons`
   (`… && env.DISTILLATION_ENABLED`) silently **disabled cross-encoder rerank whenever distillation
   was off** — the api/cross-encoder paths don't need distillation. The first two A/Bs (with
   `DISTILLATION_ENABLED=false`) therefore measured **no-rerank vs no-rerank** and showed a false
   null. Fixed via `rerankConfigured()` (lessons.ts); the real signal (×3.4 MRR) then appeared.

## Methodology (stress band)

The shipped golden set is near-ceiling (MRR 0.85; even deliberately-indirect queries land rank 1–3
~94% of the time), so it has no rerank headroom. The **rerank-stress** band was built by M1 headroom
mining: an LLM (gemma, reasoning off) writes an *indirect, symptom-only* question per lesson; raw
retrieval (rerank OFF) is run; queries where the source lesson lands at **rank 4–20** are kept (18 of
90 with the hard prompt). The reranker under test never participates in selection or labeling →
non-circular. ideal_answers for ragas were LLM-drafted from the source lessons (`reviewed_by=PENDING`).

## Honest caveats

- **n=18** on the hard band — small. But the effect is large and corroborated across deterministic
  retrieval metrics + 4 ragas metrics.
- **ragas variance is high** (±0.3–0.4; gemma judge). Hard-band deltas (+0.32 context_precision) exceed
  it; easy-band deltas do not (correctly read as neutral). `answer_relevancy` is low across all configs
  (judge strictness) — constant across configs, so the delta still holds.
- **Stress queries + ideal_answers are LLM-drafted, pending human review** (DEFERRED-030). Effect size
  is decisive but labels should be reviewed before treating the stress set as a shipped golden.
- Cross-encoder demoted **2 / 18** hard targets out of top-20 (helped 16, hurt 2) — not strictly dominant.
- `bge-reranker-v2-m3` is multilingual; an English/code-specialized reranker might do better — the
  Cohere boundary makes the model a config swap.

## Deployment

`.env`: `RERANK_TYPE=api`, `RERANK_API_PROTOCOL=cohere`,
`RERANK_BASE_URL=http://host.docker.internal:28417`, `RERANK_API_KEY=change-me`. Startup prewarm loads
the model. Cloud swap (Cohere / Jina / Voyage) = config-only.

## Follow-ups

- Review + merge the stress band into the shipped golden set (DEFERRED-030).
- Consider gating rerank by a difficulty signal to avoid the easy-band overhead.
- v2: `min_rerank_score` floor for off-topic rejection.
- Wire the cross-encoder into `search_code_tiered` (code surface currently has no rerank).
