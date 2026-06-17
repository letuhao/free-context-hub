# Model selection — two coexisting measurement traditions

**Date:** 2026-06-17
**Status:** unification doc — reconciles split between Phase 17 synth baselines
and Phase 16/cross-encoder retrieval baselines.

## Why this doc exists

Across the Phase 16/17 + cross-encoder rerank work three different model
selections coexist:

1. **Phase 17 synth baselines (v4–v9)** — both answerer + judge = mistral-nemo
2. **Phase 17 model-selection recommendation** — answerer = mistral-nemo,
   judge = gemma-4-26b-a4b (different from answerer for same-model bias)
3. **Cross-encoder rerank geneval baselines** — both answerer + judge =
   gemma-4-26b-a4b-qat

That is a real inconsistency, not a documentation gap. This doc names it,
explains where each tradition came from, and pins what the NEXT measurement
should use.

## The three configurations, in plain terms

### Tradition A — "Phase 17 anti-hallucination" (synth-focused)

- **Pin:** `.env.baseline` — `ANSWERER_AGENT_MODEL=mistralai/mistral-nemo-instruct-2407`,
  `JUDGE_AGENT_MODEL=mistralai/mistral-nemo-instruct-2407`.
- **Used by:** v4 (telemetry-off), v5 (top-K=5), v6 (judge fix A+B), v7
  (Bug 3 v1), v8 (Bug 3 v2), v9 (full 4-surface), all 2026-06-17 smoke
  iterations (this session).
- **Goal:** measure synthesizer fidelity (faithfulness / answer_relevancy)
  under controlled stack state. Determinism > absolute score.
- **Mechanism:** `scripts/start-baseline-stack.sh` restarts MCP + worker +
  ragas-judge with `.env.baseline` overrides so LM Studio doesn't auto-unload
  mid-run (CLAUDE.md baseline-stack invariant).
- **Why same model both sides:** pragmatism + LM Studio VRAM constraint.
  Same-model bias is ~3-5pp on faithfulness (literature) — known and
  documented in `docs/qc/2026-05-24-phase-17-answerer-model-selection.md` §
  "Same-model bias mitigation."
- **Documented in:** `docs/qc/2026-05-25-phase-17-ragas-judge-fix-a-b.md`
  (closeout) + `.env.baseline` (canonical pins) + this session's
  SESSION_PATCH.md entry.

### Tradition B — "Recommended config" (in spec, not in pins)

- **Spec:** `docs/qc/2026-05-24-phase-17-answerer-model-selection.md` §
  "Same-model bias mitigation":
  ```
  ANSWERER_AGENT_MODEL=mistralai/mistral-nemo-instruct-2407   # 12B
  JUDGE_AGENT_MODEL=google/gemma-4-26b-a4b                    # 26B
  ```
- **Used by:** NO BASELINE actually shipped. The Phase 17 work that landed
  on main (v4–v9) used Tradition A, not this recommendation.
- **Why it didn't land:** practical constraint — LM Studio with both models
  loaded simultaneously needs significant VRAM; pinning two large models
  "always loaded" is more brittle than pinning one. v4–v9 took the
  pragmatic-and-simpler same-model approach.

### Tradition C — "Cross-encoder rerank geneval" (retrieval-focused)

- **Pin:** Runtime ENV override (NOT in `.env.baseline`) — both answerer
  + judge = `google/gemma-4-26b-a4b-qat`.
- **Used by:** `2026-06-16-geneval-easy-{crossencoder,norerank}.json`,
  `2026-06-16-geneval-hard-{crossencoder,norerank}.json`,
  `2026-06-16-smoke-geneval.json`.
- **Goal:** stratified ragas measurement of rerank QUALITY (recall@k +
  context_precision + faithfulness) per band. Tests retrieval, not synth.
- **Why gemma:** the rerank work measured production-realistic answerers;
  gemma is the DISTILLATION_MODEL the rest of the system uses for distillation,
  so the geneval reflects what an end-user would actually see.
- **Documented in:** `docs/benchmarks/2026-06-16-cross-encoder-rerank-benchmark.md`
  + commit `c03d57e` body.

## How to read existing baselines

When comparing two baselines, FIRST check the `gen_manifest`:

```bash
node -e 'const d=require("./docs/qc/baselines/<name>.json");
  console.log("answerer:", d.gen_manifest?.answerer_model_id);
  console.log("judge:   ", d.gen_manifest?.judge_model_id);'
```

If they differ between the two files you're comparing, model variance can
explain part of any delta. The Phase 17 v4–v9 + 2026-06-17 smoke iterations
all share the same Tradition-A pinning, so deltas there reflect template /
retrieval / synth-mode variance, not model variance.

## What this session decided (2026-06-17)

The Bug 3 v8 → global-fix iteration investigation (DEFERRED-031) ran TWO
smoke iterations under Tradition A and confirmed the faithfulness/AR
trade-off is template-induced, not model-induced — both v9 (reference) and
the new smokes used identical pinning. That investigation result stands.

**OPEN question carried out of this session:** would Tradition B
(answerer=mistral-nemo, judge=gemma-4-26b-a4b — the documented
recommendation) give a different verdict on the global-surface synth
fidelity? That experiment was not run; it would isolate "judge-variance
on global substring matches" cleanly. Logged in DEFERRED-031.

## Recommendation for future measurements

| If you are measuring... | Use this pinning | Why |
|---|---|---|
| Synth fidelity (Bug 3, faithfulness deltas, template changes) | **Tradition A** (mistral-nemo both sides) | Reproduces v4–v9 baselines exactly. Determinism is the priority; absolute number has known +3-5pp bias inflated for free. |
| Retrieval quality (recall@k, rerank A/B, context_precision deltas) | **Tradition C** (gemma both sides) | Reproduces cross-encoder geneval baselines; reflects production answerer. |
| Cross-judge robustness (does a finding survive a different judge?) | **Tradition B** (mistral-nemo answerer, gemma judge) | Removes same-model bias; isolates "is this a real signal or a self-rating artifact?" |

For ANY new Phase 17 / synth baseline that wants to be comparable to v4–v9:
**use Tradition A unless explicitly testing cross-judge robustness**, and
note the choice in the baseline's tag / closeout doc.

For ANY new cross-encoder / retrieval geneval baseline: **use Tradition C**
to stay comparable to the `2026-06-16-geneval-*` set.

## Where the pins live

- `.env.baseline` (root): Tradition A canonical pins.
- `scripts/start-baseline-stack.sh`: restarts the stack with
  `.env.baseline` overrides. Run this before any Tradition-A baseline.
- `scripts/preflight-baseline.mjs`: refuses to run if Tradition A pins
  are violated.
- `docker-compose.yml` (`ragas-judge.environment`): defaults to gemma
  (`JUDGE_AGENT_MODEL: ${JUDGE_AGENT_MODEL:-google/gemma-4-26b-a4b-it}`)
  for a fresh container — relevant ONLY if you skip
  `start-baseline-stack.sh` (i.e., for retrieval/rerank work, not synth).

## File references

- Phase 17 model recommendation: `docs/qc/2026-05-24-phase-17-answerer-model-selection.md`
- Phase 17 Bug 3 closeout: `docs/qc/2026-05-25-phase-17-ragas-judge-fix-a-b.md`
- Cross-encoder rerank benchmark: `docs/benchmarks/2026-06-16-cross-encoder-rerank-benchmark.md`
- Baseline-stack invariant: `CLAUDE.md` § "Baseline-stack invariant (Phase 17.x)"
- This session's smoke baselines (Tradition A):
  - `docs/qc/baselines/2026-06-16-2026-06-17-phase-17-bug3-global-fix-smoke.json`
  - `docs/qc/baselines/2026-06-16-2026-06-17-phase-17-bug3-global-fix-v2-smoke.json`
