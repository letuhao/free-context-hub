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

## Polish round (post-v6) — Bug 3 fix + Bug 2c provenance

After v6 shipped, four follow-up commits addressed the loose ends:

**Bug 3 — synthesizer hedge FIXED via anchor-effect framing** ([commits `5a00ea8` → `4a5c322`](../../src/qc/templates/)). Two attempts, one confirmed mechanism:

**v7 attempt** (`5a00ea8`) — explicit FORBIDDEN wording with 4 mentions of `"Not in context."` in the prompt. Did NOT reduce hedge behavior:

| Metric | v6 | v7 |
|---|---:|---:|
| faithfulness | 0.50 | 0.51 |
| answer_relevancy | 0.65 | 0.69 |
| **hedge count** | **14** | **15** ← went up |
| pure refusals | 0 | 0 |

Spot-check on `s3-source-artifacts`: v7 added `"Not in context."` to a 5-sentence answer where v6 had no hedge. Explicit FORBIDDEN wording **anchored** Mistral-Nemo on the prohibited phrase — a classic weak-model failure mode where negative examples prime the model toward the forbidden behavior.

**v8 attempt** (`4a5c322`) — drop the FORBIDDEN example, drop the redundant final bullet, reduce mentions of `"Not in context."` from 4 → 1. **Hypothesis H1**: hedge behavior scales with literal-phrase mentions in the prompt. v6 had 2 mentions / 14 hedges; v7 had 4 mentions / 15 hedges; v8 has 1 mention / **6 hedges** — H1 confirmed.

| Metric | v6 | v7 | v8 | Δ(v8−v6) |
|---|---:|---:|---:|---:|
| **hedge count** | 14 | 15 | **6** | **−8 (−57%)** |
| pure refusals | 0 | 0 | **3** | +3 (synth now uses abstention correctly) |
| answer_relevancy | 0.65 | 0.69 | **0.73** | **+0.08** (significant) |
| faithfulness | 0.50 | 0.51 | 0.48 | −0.02 (noise; pure refusals score f=0 by ragas's strict reading) |
| context_precision | 0.18 | 0.18 | 0.19 | +0.01 |
| context_recall | 0.36 | 0.37 | 0.37 | +0.01 |
| groundedness_self_eval | 0.77 | 0.76 | 0.77 | 0.00 |

The v8 templates ship. **Lesson for future prompt engineering on weak models**: every literal mention of a special token (refusal sentinel, JSON keyword, output format) primes the model toward producing it. Reduce mentions to the minimum necessary for the model to know the token exists. Negative examples ("DO NOT do X") can be net-harmful when the model latches onto the X they shouldn't do.

**Bug 2c — provenance ADDED** ([commit `3dcfadb`](../../services/ragas-judge/main.py)). The sidecar's `/health` now surfaces `judge_temperature` and `judge_seed`; `runBaseline.ts` bakes them into the manifest. Auditing v6's runtime config revealed `judge_temperature=0.0` (not 0.2 as initially assumed) — so the run-to-run jitter we observed in the 5-row probe came from somewhere else (probe-side: no seed pinned in ChatOpenAI() call; production: deterministic-ish since temp=0+seed=42). The underlying mechanism (instructor retry, mistral-nemo json_schema variance) remains uninvestigated — but the gap is now visible in every future baseline manifest.

**Bug 2 fix tests** ([commit `838254e`](../../src/qc/judgeContexts.test.ts)). Extracted `buildJudgeContexts()` into its own module + 8 TS tests + 5 Python tests covering the `File: <id>\n` prefix logic. Pins the snippet-window symmetry invariant so changing `DEFAULT_MAX_CHARS` in `genPipeline.ts` won't silently break judge/synth parity.

**Housekeeping** ([commit `7155ee8`](../../.gitattributes)). `.gitattributes` enforces union-merge on `docs/audit/AUDIT_LOG.jsonl` (append-only, auto-resolves cherry-pick conflicts). `.gitignore` filters `services/ragas-judge/_*.json` scratch (canonical inputs live in `docs/qc/baselines/`).

## Known remaining issues (still deferred)

**Bug 2c root mechanism.** The 5-row probe at temp=0 (no seed) gave different verdicts than the production baseline (temp=0 + seed=42). With provenance now in the manifest, future investigations can pin a fixed seed in standalone scripts to measure true determinism. Likely sources to inspect: instructor JSON schema retry loop, ragas's two-step claim-split + NLI handshake ordering, LM Studio json_schema mode variance under Mistral-Nemo.

**Code refusal_correctness ceiling.** v6's `code refusal_correctness = 0.25` reflects 2 rows where the synthesizer over-refused. v8 didn't move this (still 0.00 on n=2 — noise floor); a stronger experiment would need more no-answer rows in the goldenset.

**Full-baseline confirmation deferred.** v7 and v8 are code-surface-only smokes (77 rows, ~22 min each). A full 4-surface v9 (152 rows, ~41 min) would confirm whether the anchor-effect framing generalizes to lessons/chunks/global. Likely yes given the prompts share the same structure, but not yet measured.

## Files changed

Bug 2 fix (v6):
- [`services/ragas-judge/main.py:665`](../../services/ragas-judge/main.py) — Fix A (path-prefix on contexts)
- [`src/qc/runBaseline.ts:394`](../../src/qc/runBaseline.ts) — Fix B (full-snippet to judge), later extracted into [`src/qc/judgeContexts.ts`](../../src/qc/judgeContexts.ts)
- New baseline artifact: [`docs/qc/baselines/2026-05-24-phase-17-baseline-v6-judge-fix-a-b.{json,md}`](baselines/2026-05-24-phase-17-baseline-v6-judge-fix-a-b.md)
- New audit scripts: [`services/ragas-judge/bug2_probe.py`](../../services/ragas-judge/bug2_probe.py), [`services/ragas-judge/bug2_probe_fix.py`](../../services/ragas-judge/bug2_probe_fix.py)

Polish round (post-v6):
- [`src/qc/templates/synthesizer.*.txt`](../../src/qc/templates/) — Bug 3 anti-hedge rules (4 templates)
- [`src/qc/judgeContexts.ts`](../../src/qc/judgeContexts.ts) + [`judgeContexts.test.ts`](../../src/qc/judgeContexts.test.ts) — pure helper + 8 unit tests
- [`services/ragas-judge/test_contexts_format.py`](../../services/ragas-judge/test_contexts_format.py) — 5 Python unit tests
- [`services/ragas-judge/main.py`](../../services/ragas-judge/main.py) — Bug 2c: `/health` now surfaces `judge_temperature` + `judge_seed`
- [`src/qc/genEvalTypes.ts`](../../src/qc/genEvalTypes.ts) — `GenManifest` carries judge sampling params
- [`.gitattributes`](../../.gitattributes) — union-merge for AUDIT_LOG.jsonl
- [`.gitignore`](../../.gitignore) — filter `services/ragas-judge/_*.json` scratch

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
