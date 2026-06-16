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

**Bug 3 — synthesizer hedge: prompt strengthened, NOT validated on Mistral-Nemo** ([commit `5a00ea8`](../../src/qc/templates/)). All 4 synthesizer templates now spell out the abstention rule explicitly: EITHER a fully-cited substantive answer OR the three-word literal `Not in context.` — never both. Templates also list the FORBIDDEN failure mode (substantive answer + hedge appended) so the model can pattern-match the rule.

v7 smoke baseline (code surface, 77 rows, [`2026-06-16-phase-17-baseline-v7-bug3-fix-code`](baselines/2026-06-16-phase-17-baseline-v7-bug3-fix-code.md)) showed the change had **no measurable effect** on Mistral-Nemo:

| Metric | v6 | v7 | Δ |
|---|---:|---:|---:|
| faithfulness | 0.50 | 0.51 | +0.01 (within ±0.05 noise) |
| answer_relevancy | 0.65 | 0.69 | +0.04 |
| context_precision | 0.18 | 0.18 | 0.00 |
| context_recall | 0.36 | 0.37 | +0.01 |
| refusal_correctness | 0.25 | 0.00 (n=2) | noise |
| groundedness_self_eval | 0.77 | 0.76 | -0.01 |

**Hedged-refusal count moved 14 → 15** (UP). Spot-check on `s3-source-artifacts`: v7 added `"Not in context."` to a 5-sentence answer where v6 had no hedge. The explicit FORBIDDEN wording in the prompt appears to **anchor** Mistral-Nemo on the prohibited phrase rather than suppress it — a classic weak-model failure mode where negative examples prime the model toward the forbidden behavior.

The template change stays in place — it's conceptually correct and may help on stronger models — but is documented here as **not effective on Mistral-Nemo specifically**. Possible future framings: drop the literal "Not in context." from the rule (remove the anchor), or switch the refusal sentinel to something less common, or accept the model isn't strong enough to follow strict abstention.

**Bug 2c — provenance ADDED** ([commit `3dcfadb`](../../services/ragas-judge/main.py)). The sidecar's `/health` now surfaces `judge_temperature` and `judge_seed`; `runBaseline.ts` bakes them into the manifest. Auditing v6's runtime config revealed `judge_temperature=0.0` (not 0.2 as initially assumed) — so the run-to-run jitter we observed in the 5-row probe came from somewhere else (probe-side: no seed pinned in ChatOpenAI() call; production: deterministic-ish since temp=0+seed=42). The underlying mechanism (instructor retry, mistral-nemo json_schema variance) remains uninvestigated — but the gap is now visible in every future baseline manifest.

**Bug 2 fix tests** ([commit `838254e`](../../src/qc/judgeContexts.test.ts)). Extracted `buildJudgeContexts()` into its own module + 8 TS tests + 5 Python tests covering the `File: <id>\n` prefix logic. Pins the snippet-window symmetry invariant so changing `DEFAULT_MAX_CHARS` in `genPipeline.ts` won't silently break judge/synth parity.

**Housekeeping** ([commit `7155ee8`](../../.gitattributes)). `.gitattributes` enforces union-merge on `docs/audit/AUDIT_LOG.jsonl` (append-only, auto-resolves cherry-pick conflicts). `.gitignore` filters `services/ragas-judge/_*.json` scratch (canonical inputs live in `docs/qc/baselines/`).

## Known remaining issues (still deferred)

**Bug 2c root mechanism.** The 5-row probe at temp=0 (no seed) gave different verdicts than the production baseline (temp=0 + seed=42). With provenance now in the manifest, future investigations can pin a fixed seed in standalone scripts to measure true determinism. Likely sources to inspect: instructor JSON schema retry loop, ragas's two-step claim-split + NLI handshake ordering, LM Studio json_schema mode variance under Mistral-Nemo.

**Code refusal_correctness ceiling.** v6's `code refusal_correctness = 0.25` reflects 2 rows where the synthesizer over-refused. Bug 3 fix should address most of this; v7 smoke will quantify.

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
