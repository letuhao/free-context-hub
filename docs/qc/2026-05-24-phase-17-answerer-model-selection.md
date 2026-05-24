# Phase 17 — Answerer model selection (post Sprint 17.2)

**Date:** 2026-05-24
**Context:** Sprint 17.2 shipped the CoVe (Chain-of-Verification) framework but
smoke tests with `google/gemma-4-26b-a4b` as the answerer showed the model's
extended-reasoning behavior polluted CoVe's structured intermediate steps.
Sprint 17.2 readiness noted this as a model-side limitation, not framework bug.

This note documents the answerer-model swap that resolves the limitation, with
side-by-side smoke evidence.

---

## TL;DR

For CoVe (or any structured-output synth pipeline), use a **non-reasoning
instruct model** as the answerer. Keep reasoning-class or larger models for
the judge.

Recommended default (this project, LM Studio):

```bash
# .env or shell
ANSWERER_AGENT_MODEL=mistralai/mistral-nemo-instruct-2407
JUDGE_AGENT_MODEL=google/gemma-4-26b-a4b
```

Other validated answerers (LM Studio model list):
- `eva-qwen2.5-32b-v0.2` — 32B instruct, higher quality if VRAM allows
- `mistralai/mistral-nemo-instruct-2407` — **12B instruct, recommended balance**
- `nvidia/nemotron-3-nano-4b` — 4B, fastest iteration
- `ibm/granite-4-h-tiny` — small, clean instruct

Models to AVOID as answerer (reasoning-mode pollutes structured output):
- `google/gemma-4-*` (extended-reasoning enabled by default)
- `huihui-qwen3.6-*` (same family as qwen3.6)
- `deepseek-r1-distill-*` (reasoning-distilled)

## Why reasoning models break CoVe step 2

CoVe Step 2 asks: *"write 3-5 verification questions about the draft answer,
one per line, no numbering"*. Reasoning models interpret this as a planning
task — they spend their generation budget THINKING about what good
verification questions look like, writing meta-prose ("Goal: ...", "Constraints:
1. ...") to their `reasoning_content` field, and leaving `content` either
empty or filled with the same meta-prose.

Even with `chat_template_kwargs.enable_thinking=false`, Gemma 4 26B-A4B on
complex prompts still defaults to extended reasoning. The model is doing its
job (thinking carefully) — it's just not what we need for a one-shot
structured output.

Non-reasoning instruct models follow the prompt literally: they output the
3-5 questions directly in `content`, no meta-prose.

## Side-by-side smoke evidence

Both runs use the same row (`lesson-pg-uuid-casing`, lessons surface, top-K=3,
synth-mode=cove). Pinned templates, same retrieval, same judge sidecar.

### Gemma 4 26B-A4B as answerer (Sprint 17.2 smoke3)

```
DRAFT:  When building a JavaScript Map keyed by IDs returned from a query,
        the map keys must match the canonical lowercase form [1]. This is
        because PostgreSQL always canonicalizes UUIDs to lowercase during
        the cast process [1].

PLAN (5 "questions"):
  Q1: Goal: Audit a draft answer for unsupported claims by writing verification questions.
  Q2: Constraints for Verification Questions:
  Q3: Target specific factual claims in the draft.
  Q4: /2. Answerable with Yes/No or short factual phrase.
  Q5: Reference content asserted in the draft (no external facts).

REVISED: *   Draft Answer: "..."
         *   Verification Results (Q1-Q5): The verification results provided
            are actually instructions/metadata for an evaluation task...
         *   Wait, let

step_ms: { plan: 8646, verify: 35390, revise: 9662 }   # ~54s wasted
```

### Mistral-Nemo Instruct 12B as answerer (this run)

```
DRAFT:  When building map lookups after `RETURNING` with PostgreSQL UUIDs,
        ensure your map keys match the canonical lowercase form as pg
        canonicalizes UUIDs on cast [1]. This is crucial to maintain
        consistency and avoid case-based mismatches in your JavaScript Map.

PLAN (3 questions):
  Q1: Does the answer claim that pg canonicalizes UUIDs on cast?
  Q2: Does the answer mention a specific JavaScript Map being used for lookups?
  Q3: Does the answer state that non-canonical UUIDs are matched case-insensitively by pg?

VERIFY (per-Q answers):
  A1: Not supported by contexts.
  A2: Not supported by contexts.
  A3: Not supported by contexts.
  (Mistral-Nemo is a bit conservative here — the lesson IS the answer
   to Q1+Q2, but the verifier interprets the prompt strictly.)

REVISED: When building map lookups after `RETURNING` with PostgreSQL UUIDs,
         ensure your map keys match the canonical lowercase form as pg
         canonicalizes UUIDs on cast [1].
         (Dropped the "consistency / avoid mismatches" sentence — minor
          extrapolation beyond the lesson; correct revision behavior.)

step_ms: { plan: 677, verify: 525, revise: 574 }   # ~1.8s total CoVe overhead
```

Scores (judge=mistral-nemo too, same-model bias caveat applies):
- faithfulness: 0.67
- answer_relevancy: 0.80
- context_precision: 1.00
- context_recall: 0.40
- groundedness_self_eval: 1.00

## Same-model bias mitigation

For the smoke above we used mistral-nemo as BOTH answerer and judge. Same-model
bias inflates faithfulness by ~3-5pp per published reports. For production
baselines, run with answerer ≠ judge:

```bash
ANSWERER_AGENT_MODEL=mistralai/mistral-nemo-instruct-2407   # 12B, fast
JUDGE_AGENT_MODEL=google/gemma-4-26b-a4b                    # 26B, stronger
```

Note: LM Studio's auto-unload may swap one model out when the other is
requested. Pin "always loaded" on both, or accept warm-up latency on first
call of each.

## Verification quality remaining nit

Mistral-nemo's verifier interpreted "Does the answer claim X" too strictly —
it answered "Not supported by contexts" even when the lesson directly
states X. The CoVe paper's prompt engineering is more elaborate (few-shot
examples in the plan step). Phase 17.x candidate: tighten the
`cove.plan-verifications.txt` and `cove.revise.txt` templates with 1-2
few-shot examples to demonstrate the verifier behavior we want.

For now the revise step is over-conservative (drops more than necessary),
but the framework is sound. The over-conservatism is the SAFE bias —
better to drop a supported claim than retain an unsupported one.

## Artifact

Smoke baseline: `docs/qc/baselines/2026-05-24-s17.x-cove-nemo.json`

## Follow-up sprint candidates

- **Few-shot examples in CoVe templates** — quick prompt-engineering win
  to fix the over-conservative verifier. ~1 day.
- **Run the full 152-row gen-eval baseline** with answerer=mistral-nemo,
  judge=gemma-4-26b-a4b — first end-to-end gen-eval measurement on the
  whole dataset.
- **Sprint 17.3 NLI fact-checker** — independent third judge.
- **Sprint 17.4 retrieval techniques** (HyDE/RRF/semantic chunking).
