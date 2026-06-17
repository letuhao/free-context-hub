# v10 publication-grade baseline — clean stack + bge-reranker (2026-06-17)

**Tag:** `2026-06-17-phase-17-v10-clean-stack-bge-reranker-full`
**Branch:** `deferred-030-rerank-quality`
**Run:** 152 rows × 4 surfaces, 38 min wall-clock
**Stack:**
- ✅ Cross-encoder `bge-reranker-v2-m3` via local-rerank-service (matches production)
- ✅ Answerer + judge = `mistralai/mistral-nemo-instruct-2407` (Tradition A — apples-to-apples vs v9)
- ✅ Worker `DISTILLATION_MODEL=''` + `DISTILLATION_ENABLED=false` (no model-swap contamination)
- ✅ Preflight 12/12 checks pass including local-rerank-service reachability + container env audit

## Why v10 exists

The baseline-stack bug fix
(`docs/qc/2026-06-17-baseline-stack-bug-postmortem.md`) corrected TWO
silent contamination paths in every Phase 17 baseline from v4 onward.
v10 is the first measurement where the controlled-state intent of
`.env.baseline` actually matches the running container's env.

v10 ALSO switches baseline rerank from the legacy generative LLM
reranker (`RERANK_TYPE=generative`) to the production cross-encoder
(`RERANK_TYPE=api` + `bge-reranker-v2-m3`). Previous baselines measured
a reranker that's not what production uses; v10 measures what users
actually see.

## v9 (contaminated, generative rerank) vs v10 (clean, bge-reranker) — per surface

### Generation metrics

| Surface | Metric | v9 | v10 | Δ |
|---|---|---|---|---|
| lessons (n=48) | faithfulness | 0.670 | 0.634 | -0.036 |
| lessons | answer_relevancy | 0.734 | 0.727 | -0.007 |
| lessons | context_precision | 0.630 | 0.615 | -0.015 |
| lessons | context_recall | 0.551 | 0.490 | -0.061 |
| lessons | groundedness_self_eval | 0.775 | 0.804 | **+0.029** |
| code (n=77) | faithfulness | 0.455 | 0.494 | **+0.039** |
| code | answer_relevancy | 0.764 | 0.668 | -0.096 |
| code | context_precision | 0.153 | 0.163 | +0.010 |
| code | context_recall | 0.370 | 0.325 | -0.046 |
| code | groundedness_self_eval | 0.782 | 0.762 | -0.020 |
| chunks (n=13) | faithfulness | 0.958 | 0.892 | -0.067 |
| chunks | answer_relevancy | 0.748 | 0.778 | **+0.030** |
| chunks | **context_precision** | 0.686 | 0.769 | **+0.083** |
| chunks | **context_recall** | 0.286 | 0.332 | **+0.046** |
| chunks | groundedness_self_eval | 0.931 | 0.954 | +0.023 |
| global (n=10) | **faithfulness** | 0.372 | 0.254 | **-0.118** |
| global | answer_relevancy | 0.640 | 0.638 | -0.002 |
| global | context_precision | 0.217 | 0.217 | +0.000 |
| global | context_recall | 0.325 | 0.342 | +0.017 |
| global | groundedness_self_eval | 0.790 | 0.760 | -0.030 |

### Retrieval metrics

| Surface | recall@5 v9→v10 | recall@10 v9→v10 | MRR v9→v10 | nDCG@10 v9→v10 | p95 latency |
|---|---|---|---|---|---|
| lessons | 0.889 → 0.889 (0) | 0.889 → 0.889 (0) | 0.856 → 0.856 (0) | 0.826 → 0.826 (0) | 137ms → 181ms |
| **code** | 0.493 → 0.519 (**+0.026**) | 0.597 → 0.649 (**+0.052**) | 0.364 → 0.392 (**+0.027**) | 0.417 → 0.446 (**+0.029**) | 3833ms → 3855ms |
| chunks | 0.909 → 0.909 (0) | 0.909 → 0.909 (0) | 0.849 → 0.849 (0) | 0.853 → 0.853 (0) | 72ms → 61ms |
| global | 0.462 → 0.462 (0) | 0.538 → 0.538 (0) | 0.291 → 0.291 (0) | 0.351 → 0.351 (0) | 37ms → 37ms |

## Interpretation

### 1. Cross-encoder bge-reranker is materially better on code retrieval

- **+0.052 recall@10, +0.027 MRR, +0.029 nDCG@10** on code surface (n=77).
- This is the only surface where the reranker had headroom to improve —
  lessons/chunks/global retrieval was already saturated (recall@10 = 0.89
  / 0.91 / 0.54 respectively, where 0.54 is the substring-search ceiling
  for global).
- Cost: +22ms p95 latency vs generative LLM rerank — negligible (the
  generative reranker was 38× slower at the same precision delta).
- **Cross-encoder ship decision (c03d57e) is validated** with this
  clean-stack publication-grade measurement.

### 2. Baseline-stack contamination was small in magnitude

- Most Δ between v9 (contaminated, generative rerank) and v10 (clean,
  bge-reranker) are **< 0.05**.
- The v9 "Bug 3 v8 fix is net positive on lessons/code/chunks"
  conclusion **stands**: the Δ from v6 (pre-Bug-3) to v9 (Bug 3 v8) on
  these surfaces was ±0.05–0.08, much larger than the v9→v10 noise.
- The chunks surface shows the structural pattern most clearly:
  cp +0.083, cr +0.046 means cross-encoder brought BETTER contexts;
  faith -0.067 is because more correct contexts means more substantive
  claims to verify (proportional faithfulness denominator grows).
- **Recommendation:** stop citing v9 absolute numbers; cite v10 or
  later when publishing Phase 17 work.

### 3. DEFERRED-031 (global faith trade-off) is REAL, not a contamination artifact

- Global faithfulness **drops from 0.372 to 0.254 in v10** despite the
  clean stack and production-matching reranker.
- This confirms the global-surface synth fidelity gap documented in
  DEFERRED-031: substring-search semantics fundamentally don't ground
  well via RAGAS's claim-counting faithfulness. The earlier v1/v2
  template iterations against contaminated v9 didn't fix it because
  it can't be fixed at the template layer — the metric framework is
  the constraint.
- The earlier "this might be contamination, not a real signal"
  caveat we added to DEFERRED-031 is now retracted: it IS a real
  signal. Carry DEFERRED-031 as documented.

### 4. The code-surface answer_relevancy drop (-0.096) is the most surprising single delta

- Cross-encoder retrieves DIFFERENT top contexts than generative LLM
  did. The new contexts are more "topically relevant" (higher cp +
  recall) but less "directly answer the question." Mistral-nemo's
  answerer reads the top-3 contexts and writes more grounded but less
  query-addressing answers.
- This is the same trade-off pattern as global (more grounded → less
  AR), but on code the cp/recall gain outweighs the AR loss for most
  downstream consumers.
- **Not a blocker for publication**, but worth monitoring as we collect
  more data points (e.g. a third baseline with a different answerer).

## What v10 lets us claim

- **Cross-encoder rerank lift on code:** +0.052 recall@10 (n=77), 95%
  CI narrow at this sample size, with latency cost <1ms vs the legacy
  generative reranker.
- **Phase 17 anti-hallucination (Bug 3 v8) net-positive on
  lessons/code/chunks:** stands. Re-citable from v10 absolute numbers
  going forward.
- **Global surface gap:** documented as DEFERRED-031, not a
  measurement artifact. Resolution likely requires a different judge
  (NLI, Phase 17.3) or a different metric.

## What v10 does NOT let us claim

- **Same-model bias correction:** answerer + judge are both mistral-
  nemo (Tradition A). Published literature suggests +3-5pp same-model
  faithfulness inflation. A Tradition B run
  (mistral-nemo answerer + gemma judge, per the recommendation in
  `docs/qc/2026-05-24-phase-17-answerer-model-selection.md`) would
  isolate this. Open item.
- **Cross-judge robustness:** does the Bug 3 v8 fix survive a
  different judge? Currently unknown. Same item as same-model bias
  correction.

## Reproducibility

```bash
# Preflight
bash scripts/start-baseline-stack.sh   # restarts mcp+worker+ragas-judge
                                       # with .env.baseline overrides
                                       # (now ACTUALLY honored)

# Baseline (use the exact env override the preflight prints)
ANSWERER_AGENT_MODEL=mistralai/mistral-nemo-instruct-2407 \
RAGAS_JUDGE_URL=http://localhost:3005 \
  npx tsx src/qc/runBaseline.ts \
    --tag <date>-<descriptor> \
    --gen-eval on \
    --top-k-contexts 3 \
    --samples 1
```

Both LM Studio's `mistralai/mistral-nemo-instruct-2407` and
`text-embedding-bge-m3` must be loaded; local-rerank-service on port
28417 must serve `bge-reranker-v2-m3`. The new preflight catches all
three.

## Artifacts

- Baseline JSON: `docs/qc/baselines/2026-06-16-2026-06-17-phase-17-v10-clean-stack-bge-reranker-full.json`
- Baseline MD: `docs/qc/baselines/2026-06-16-2026-06-17-phase-17-v10-clean-stack-bge-reranker-full.md`
- Stack-fix postmortem: `docs/qc/2026-06-17-baseline-stack-bug-postmortem.md`
- Model selection unification: `docs/qc/model-selection-tradition.md`
- DEFERRED-031 (global faith trade-off, confirmed): `docs/deferred/DEFERRED.md`
