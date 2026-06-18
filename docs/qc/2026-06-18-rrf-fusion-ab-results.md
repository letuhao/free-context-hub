# RRF vs weighted-sum fusion (Phase 17.4) — A/B result

**Date:** 2026-06-18 · **Surface:** chunks (ai-engineering corpus, 56 items) ·
**Weighted (control):** `aieng-corpus-v2` · **RRF:** `aieng-corpus-v3-rrf` ·
Same config otherwise (claim-eval template, full chunk, answerer temp=0, judge gemma-4).

## Result — RRF is metric-NEUTRAL. Keep weighted-sum (RRF stays off-by-default).

| metric | weighted (v2) | RRF (v3) | Δ |
|---|---:|---:|---:|
| faithfulness | 0.909 | 0.916 | +0.007 |
| answer_relevancy | 0.654 | 0.651 | −0.003 |
| context_precision | 0.873 | 0.872 | −0.001 |
| context_recall | 0.994 | 0.994 | 0.000 |
| groundedness_self_eval | 1.000 | 1.000 | 0.000 |
| refusal_correctness | 1.000 | 1.000 | 0.000 |

All deltas are within run-to-run noise (±0.007). 0 gen errors both arms.

## Why neutral despite RRF changing retrieval a lot

A cheap diagnostic first showed RRF is **not** inert — it changes the **top-5 set in
50/56 (89%)** of queries and the order in 54/56. So the neutrality isn't "RRF does
nothing"; it's that **the changes don't matter here**:

- **`context_recall` is saturated at 0.99** under weighted fusion — the grounding
  chunk is already retrieved into the top-5. RRF reshuffles *which other* chunks
  fill the remaining slots, but the answer's grounding chunk is present either way,
  so faithfulness/groundedness don't move.
- The corpus chunks are concept-clean (one ## section each), so the candidate pool
  is full of on-topic chunks; reordering among them is a wash.

This is the same pattern as CoVe (neutral) and HyDE (net-negative): **the
retrieval+answer pipeline is already strong enough that fusion/rewrite tweaks have
no headroom on this corpus.**

## Caveat — the one place RRF *might* help (untested)

This corpus has no recall headroom (cr 0.99). RRF's theoretical win is on
**lexical-mismatch** queries (exact identifiers, error codes, version strings) where
the weighted sum lets a high-magnitude semantic score swamp an exact keyword hit —
a regime this conceptual-prose corpus doesn't contain. A surface *with* recall
headroom (e.g. lessons, recall@5 0.89) on identifier-heavy queries could still show
a gain. Not pursued: RRF would need extending to the lessons search + a recall A/B,
and given CoVe/HyDE/RRF all came back neutral-to-negative, the expected value of
chasing it further is low. The `CHUNKS_FUSION=rrf` knob + `rrfFuse()` remain in
the codebase (off by default, unit-tested) for that future test if it's ever worth it.

## Decision

- **Production stays on weighted-sum** (`sem + 0.30·fts`). Container reverted to
  the default (`CHUNKS_FUSION` unset).
- RRF kept as an off-by-default, tested option — not wired into any default path.

## Reproduce

```bash
# RRF arm (weighted = aieng-corpus-v2):
CHUNKS_FUSION=rrf docker compose up -d mcp
ANSWERER_AGENT_TEMPERATURE=0 QC_CHUNKS_FILE=qc/competency-geneval.json \
RAGAS_JUDGE_URL=http://localhost:3005 \
  npx tsx src/qc/runBaseline.ts --tag aieng-corpus-v3-rrf --surfaces chunks \
    --groups 'ai-engineering/*' --gen-eval on --synth-template claim-eval --no-preflight
docker compose up -d mcp   # revert to weighted
```
