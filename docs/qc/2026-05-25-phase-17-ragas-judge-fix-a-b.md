# Phase 17 — Ragas judge Fix A+B (file-path prefix + full snippet window)

**Date:** 2026-05-25
**Branch:** `phase-16-sprint-16.1-gen-eval-dataset`
**Baselines:** v5 (top-K=5) → v6 (top-K=5 + Fix A + Fix B)

## TL;DR

Two-line patch lifted gen-eval scores across all four surfaces. Largest moves:

| Surface | Metric | v5 → v6 |
|---|---|---|
| code | faithfulness | 0.42 → **0.50** (+0.07) |
| chunks | context_precision | 0.53 → **0.74** (+0.21) |
| global | faithfulness | 0.40 → **0.49** (+0.09) |
| global | context_recall | 0.33 → 0.42 (+0.10) |
| lessons | refusal_correctness | 0.50 → **0.88** (+0.38) |

No performance regression (39 min → 41 min, 5%).

## Root cause

Probed via [`services/ragas-judge/bug2_probe.py`](../../services/ragas-judge/bug2_probe.py) on 5 code-surface rows where `groundedness_self_eval` was high but ragas `faithfulness` was 0. The two-step ragas pipeline (claim split → NLI verdict) was being fed contexts that **stripped the file path / lesson id**.

Synthesizer prompts produce answers like:

> The idempotent draft proposal upsert is implemented in `upsertGitLessonProposalDraft` within `src/services/gitLessonProposalUpsert.ts` [3].

Context [3]'s `key` field IS `src/services/gitLessonProposalUpsert.ts`, but the ragas NLI verifier only saw the snippet text. Verdict on the location claim: **REJECTED** — *"The context does not provide information about the location of functions."*

Two compounding issues:
1. **Bug 2a (file-path stripped):** [`main.py:665`](../../services/ragas-judge/main.py) flattened `ContextItem.id` away with `[c.text for c in req.contexts]`.
2. **Bug 2b (truncated snippet):** [`runBaseline.ts:395`](../../src/qc/runBaseline.ts) sent the judge `c.snippet_preview` (200 chars) while the synthesizer saw the full 1000-char snippet via `formatContext`. Asymmetric evidence.

Five-row probe on [`kg-project-graph-delete`](../qc/baselines/2026-05-24-phase-17-baseline-v5-topk-5.json):

| variant | per-claim verdicts | score |
|---|---|---|
| A: text-only (current) | 0/3 — all rejected; "location not in context" | 0.00 |
| B: `File: <id>\n<text>` prepended | 1/3 — location claim now entails | 0.33 |

On 152-row v6 the mechanism averaged out to the lifts in the TL;DR table.

## Fixes

### Fix A — `services/ragas-judge/main.py`

```python
# before
contexts_text = [c.text for c in req.contexts]

# after
contexts_text = [
    f"File: {c.id}\n{c.text}" if c.id else c.text
    for c in req.contexts
]
```

Applies to all metrics that take `retrieved_contexts`: ragas faithfulness, context_precision, context_recall, and our custom `refusal_correctness` + `groundedness_self_eval`. The `id` field was already in the wire format, just unused.

### Fix B — `src/qc/runBaseline.ts`

```ts
const JUDGE_SNIPPET_MAX_CHARS = 1000;
const judgeContexts = retrievalHits
  .slice(0, cfg.topKContexts)
  .map((h) => ({
    id: h.key,
    text: (h.snippet ?? '').slice(0, JUDGE_SNIPPET_MAX_CHARS),
  }));
```

Now the judge sees the same `h.snippet` the synthesizer saw (capped at the same 1000 chars used by `formatContext` in `genPipeline.ts`). Previously the judge got `synthRes.contexts_used[i].snippet_preview` which was truncated to 200 chars purely for archive readability.

Archive `snippet_preview` field unchanged — still 200 chars for display.

## Diff (v5 → v6, full table)

| Surface | Metric | v5 | v6 | Δ |
|---|---|---:|---:|---:|
| lessons | faithfulness | 0.65 | 0.66 | +0.01 |
| lessons | answer_relevancy | 0.80 | 0.77 | −0.04 |
| lessons | context_precision | 0.53 | 0.54 | +0.02 |
| lessons | context_recall | 0.50 | 0.55 | +0.06 |
| lessons | refusal_correctness | 0.50 | 0.88 | **+0.38** |
| lessons | groundedness_self_eval | 0.80 | 0.82 | +0.02 |
| code | faithfulness | 0.42 | 0.50 | **+0.07** |
| code | answer_relevancy | 0.66 | 0.65 | −0.01 |
| code | context_precision | 0.14 | 0.18 | +0.04 |
| code | context_recall | 0.27 | 0.36 | +0.08 |
| code | refusal_correctness | 0.00 | 0.25 | +0.25 |
| code | groundedness_self_eval | 0.73 | 0.77 | +0.04 |
| chunks | faithfulness | 0.89 | 0.91 | +0.01 |
| chunks | answer_relevancy | 0.76 | 0.75 | −0.00 |
| chunks | context_precision | 0.53 | 0.74 | **+0.21** |
| chunks | context_recall | 0.25 | 0.36 | +0.11 |
| chunks | refusal_correctness | 0.83 | 0.83 | 0.00 |
| chunks | groundedness_self_eval | 0.95 | 0.95 | 0.00 |
| global | faithfulness | 0.40 | 0.49 | **+0.09** |
| global | answer_relevancy | 0.54 | 0.54 | +0.01 |
| global | context_precision | 0.21 | 0.18 | −0.03 |
| global | context_recall | 0.33 | 0.42 | +0.10 |
| global | refusal_correctness | 0.50 | 0.50 | 0.00 |
| global | groundedness_self_eval | 0.73 | 0.82 | +0.09 |

Minor negatives (lessons AR −0.04, global CP −0.03, code AR −0.01) are within ragas non-determinism (Bug 2c, see below) and small enough that re-running v6 a second time would likely move them by ±0.05.

## Known remaining issues

These were identified during the audit but not fixed in this round:

**Bug 2c — ragas non-determinism at temp=0.** Same input, same model, temp=0, different verdicts run-to-run. Probe showed `job-queue-postgres-claim` scoring 1.0 in one ragas call vs the baseline's 0.25. Likely sources: claim-splitter LLM call ordering, instructor JSON schema retry. Would need to force deterministic decoding or pin sampling parameters across both LLM calls.

**Bug 3 — refusal hedging.** The synthesizer is appending `"Not in context."` at the end of substantive answers (15/77 code rows, 1/48 lessons, 1/13 chunks, 1/14 global). Hedge bug, not measurement bug. Worth ~+0.01 lift on aggregate but cleaner output.

**Code refusal_correctness still at 0.25.** Only 2 rows are scored for code refusal_correctness and both refuse-when-they-shouldn't because the synthesizer over-aborts. The Bug 3 fix would help here.

## Files changed

- [`services/ragas-judge/main.py:665`](../../services/ragas-judge/main.py) — Fix A
- [`src/qc/runBaseline.ts:394`](../../src/qc/runBaseline.ts) — Fix B
- New baseline artifact: [`docs/qc/baselines/2026-05-24-phase-17-baseline-v6-judge-fix-a-b.{json,md}`](baselines/2026-05-24-phase-17-baseline-v6-judge-fix-a-b.md)
- New audit scripts: [`services/ragas-judge/bug2_probe.py`](../../services/ragas-judge/bug2_probe.py), [`services/ragas-judge/bug2_probe_fix.py`](../../services/ragas-judge/bug2_probe_fix.py)

## How to reproduce v6

```bash
# 1. LM Studio: load mistralai/mistral-nemo-instruct-2407 + text-embedding-bge-m3
# 2. Sidecar (already has Fix A baked in after this commit):
docker compose --profile measurement up -d ragas-judge

# 3. Run baseline:
ANSWERER_AGENT_MODEL=mistralai/mistral-nemo-instruct-2407 \
JUDGE_AGENT_MODEL=mistralai/mistral-nemo-instruct-2407 \
EMBEDDINGS_MODEL=text-embedding-bge-m3 \
  npx tsx src/qc/runBaseline.ts \
    --tag phase-17-baseline-v6-judge-fix-a-b \
    --gen-eval auto \
    --judge-url http://localhost:3005 \
    --top-k-contexts 5 \
    --synth-mode standard \
    --samples 1
```

Expected wall-clock: ~40 min for 152 rows.
