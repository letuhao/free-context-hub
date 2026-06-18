# CoVe synthesizer — edge-case A/B → SHELVE (2026-06-18)

**Status:** Chain-of-Verification (CoVe) synthesizer measured at scale on the
hallucination-prone edge-case rows and **shelved**. CoVe is net-negative on
every answer-dependent metric; nothing improved. The code stays as a validated
experiment harness (`runGenPipelineCoVe`, `--synth-mode cove`) but is **not**
wired into the production synth path and is not recommended.

## Why this experiment

CoVe (Dhuliawala et al. 2023, "Chain-of-Verification Reduces Hallucination")
was the third Phase-17 anti-hallucination experiment (ROADMAP §Phase 2 →
README Phase 17): draft → plan verification questions → answer each against
context → revise. It was **built + wired + 1-row smoke-tested on 2026-05-24**
but never A/B'd at scale, so we did not know whether it actually helps here.

CoVe's paper win is on long-form, hallucination-prone QA — so we measured on the
**25 hand-curated edge-case rows** (`edge-no-answer`, `edge-multi-hop`,
`edge-distractor`, `edge-contradictory`, `edge-paraphrase`), where the
verification step should bite, rather than the full 152-row set (mostly easy
confident-hits where CoVe just adds cost + noise — the lesson from the
chunks-rerank A/B).

## Method

- **New harness flag** `--groups <exact|prefix-*>` on `runBaseline.ts`
  (`src/qc/groupFilter.ts`, 16 unit tests) restricts a run to specific golden
  `group` values without authoring a throwaway golden file. Used `--groups
  'edge-*'`.
- **Two arms, identical except `synth-mode`:** `standard` vs `cove`. Both with
  **answerer = judge = `google/gemma-4-26b-a4b-qat`** (Tradition-C style, single
  model both sides → zero LM Studio swap → the only difference between arms is
  the synth mode). `--gen-eval on`, top-K=5, judge temp=0 seed=42 (near-
  deterministic judge), `--no-preflight` (Tradition-A preflight pins mistral-nemo;
  deliberately N/A for a gemma cross-judge run).
- Stack: live `mcp`/`API`/`db` + `ragas-judge` sidecar (recreated onto `-qat`
  via the CHAT_MODEL single-source-of-truth default — live-verified).
- Artifacts: `docs/qc/baselines/2026-06-18-cove-ab-standard-edge.{json,md}` and
  `…-cove-ab-cove-edge.{json,md}`.

## Result — CoVe net-negative on every answer-dependent metric

Per-surface gen-eval means (rows judged in parens):

| Surface | Metric | standard | cove | Δ |
|---|---|---:|---:|---:|
| lessons (8) | faithfulness | 0.79 | 0.67 | **−0.12** |
| | answer_relevancy | 0.51 | 0.12 | **−0.39** |
| | groundedness_self_eval | 0.88 | 0.63 | **−0.25** |
| | refusal_correctness | 1.00 | 0.00 | **−1.00** (n=1) |
| code (10) | faithfulness | 0.63 | 0.50 | **−0.13** |
| | answer_relevancy | 0.25 | 0.00 | **−0.25** |
| | groundedness_self_eval | 1.00 | 1.00 | 0.00 |
| chunks (3) | faithfulness | 1.00 | 1.00 | 0.00 |
| | answer_relevancy | 0.98 | 0.68 | **−0.30** |
| global (1) | faithfulness | 1.00 | 0.75 | −0.25 |
| | answer_relevancy | 0.66 | 0.48 | −0.18 |
| | groundedness_self_eval | 1.00 | 0.40 | −0.60 |

**Findings:**

1. **answer_relevancy collapses uniformly** (−0.25 to −0.39 on three
   independent surfaces). CoVe's revise step pads the answer with
   verification meta-commentary / hedging, hurting directness. The magnitude
   dwarfs any plausible judge noise (judge is temp=0; deltas are real answer
   changes).
2. **Abstention got WORSE — the opposite of CoVe's purpose.** The lessons
   `edge-no-answer` row that `standard` correctly refused (refusal_correctness
   1.0) was *answered* by CoVe (0.0): the revise step pulled thin context into
   a fabricated answer instead of abstaining.
3. **faithfulness flat or down** on every surface; **nothing improved** on any
   metric on any surface.
4. **Cost:** CoVe synth ≈ 50–62 s/row vs ~7 s standard (**~8×**, not the
   nominal 3–4×, because each of the 4 steps is a full gemma generation) — for
   strictly worse quality.

**Sanity check (harness validity):** `context_precision` / `context_recall`
are answer-*independent* (scored from question + ground_truth +
retrieved_contexts only — see the v12 closeout). They barely moved between arms
(lessons cp/cr identical 0.69/0.48; chunks identical; code within retrieval
jitter), confirming the harness isolated the synth-mode effect cleanly and the
answer-dependent deltas above are caused by CoVe, not retrieval drift. This is
the [[verify-metric-inputs]] discipline applied as a control.

## Decision

**SHELVE.** Do not wire CoVe into the production synth path. Keep the code
(`runGenPipelineCoVe`, `cove.*.txt` templates, `--synth-mode cove`) as a
validated, reproducible experiment harness so a future attempt — with a
different model, a leaner revise prompt that forbids meta-commentary, or a
verifier that only *removes* unsupported claims rather than *rewriting* — can
re-measure against these two archives as the baseline.

Why not iterate the CoVe prompts now: the failure is structural for this
answerer (gemma-qat over-revises and breaks abstention), and the standard
single-shot synth with v11 templates already does well on the easy bulk. The
ROI of a CoVe prompt-tuning loop is low versus the retrieval-layer levers
(DEFERRED-034 chunk granularity, query rewrite) that move metrics the synth
template cannot.

## What stays shipped from this work

- `src/qc/groupFilter.ts` + `--groups` flag on `runBaseline.ts` — a general,
  reusable way to run a baseline against a subset of golden groups (e.g.
  `--groups 'edge-*'`, `--groups confident-hit`). 16 unit tests; tsc clean.

## Reproduce

```bash
# bring up the stack on the chosen model (CHAT_MODEL single-source-of-truth)
docker compose up -d --build mcp ragas-judge   # judge inherits CHAT_MODEL=-qat

# standard arm
ANSWERER_AGENT_MODEL=google/gemma-4-26b-a4b-qat RAGAS_JUDGE_URL=http://localhost:3005 \
  npx tsx src/qc/runBaseline.ts --tag cove-ab-standard-edge \
  --synth-mode standard --groups 'edge-*' --gen-eval on --no-preflight

# cove arm
ANSWERER_AGENT_MODEL=google/gemma-4-26b-a4b-qat RAGAS_JUDGE_URL=http://localhost:3005 \
  npx tsx src/qc/runBaseline.ts --tag cove-ab-cove-edge \
  --synth-mode cove --groups 'edge-*' --gen-eval on --no-preflight
```

## Known harness wart (pre-existing, affects both arms equally)

The `global` surface 422s on empty-result-set rows (`judge sidecar HTTP 422`)
— 3 of 4 global edge rows. This predates this experiment and hits both arms
identically, so it does not affect the comparison; the single judged global row
is reported above for completeness. Logged as a follow-up, not a CoVe issue.
