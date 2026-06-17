# Bug 3 v6 vs v8 — Tradition B comparison (2026-06-17)

**Tags:**
- v6 baseline: `2026-06-17-phase-17-v6-tradition-b-defer-judge-full`
- v8 baseline: `2026-06-17-phase-17-v10-tradition-b-defer-judge-full` (= v10B from prior closeout)

**Setup (both runs):**
- Answerer: `mistralai/mistral-nemo-instruct-2407`
- Judge: `google/gemma-4-26b-a4b` (Tradition B — cross-model judge)
- Embeddings: `text-embedding-bge-m3`
- Rerank: `bge-reranker-v2-m3`
- Two-phase execution: `--defer-judge true` (1 LM Studio swap mid-run)
- 152 rows × 4 surfaces, gen-eval on
- 52 min (v6) / 51 min (v8) wall-clock

**Only variable:** synthesizer template version.
- **v6** — pre-Bug-3 templates from commit `b52ca3a` (Phase 17 Sprint 17.1
  anti-hallucination baseline). Rule 3 = "ABSTAIN WHEN UNSUPPORTED" with
  two explicit mentions of "Not in context." (in-rule + closing bullet).
- **v8** — current HEAD templates from commit `4a5c322` ("alternate
  framing: terse rule, single mention"). Rule 3 = "ABSTAIN ATOMICALLY"
  with one explicit mention of "Not in context." Dropped the closing
  bullet to reduce anchor-effect priming on Mistral-Nemo.

## Why this run exists

The v10 Tradition A closeout claimed "Phase 17 Bug 3 v8 net-positive on
lessons/code/chunks." That claim was made under same-model bias
(mistral-nemo judging mistral-nemo). Tradition B's same-model-bias
isolation results (`2026-06-17-v10-tradition-b-same-model-bias-results.md`)
showed bias is NOT uniform — particularly on the `code` surface, where
same-model bias deflated context_recall by −0.272 — so the "v8
net-positive" claim needed re-measurement with an unbiased judge before
publication.

This run re-runs the v8 templates AND a fresh v6 baseline both under
Tradition B, so the v6→v8 delta is judge-bias-free.

## Headline — v8 is NOT net-positive on Tradition B

### Catalog-wide weighted-mean (across 152 rows × 4 surfaces)

| Metric | v6 | v8 | Δ (v8 − v6) |
|---|---|---|---|
| **Faithfulness** | 0.620 | 0.528 | **−0.091** |
| Answer relevancy | 0.763 | 0.786 | +0.023 |

v8 trades −0.091 faith for +0.023 ar — a 4:1 unfavourable ratio. **Net
catalog-wide effect is negative.** Tradition A reported the opposite.

### Per-surface generation metrics

| Surface | metric | v6 | v8 | Δ (v8 − v6) |
|---|---|---|---|---|
| lessons | faith | 0.662 | 0.577 | **−0.084** |
| lessons | ar | 0.834 | 0.805 | −0.029 |
| lessons | cp | 0.825 | 0.865 | +0.040 |
| lessons | cr | 0.647 | 0.621 | −0.026 |
| lessons | groundedness | 0.841 | 0.855 | +0.014 |
| code | faith | 0.563 | 0.446 | **−0.116** |
| code | ar | 0.742 | 0.789 | +0.047 |
| code | cp | 0.116 | 0.089 | −0.027 |
| code | cr | 0.055 | 0.052 | −0.003 |
| code | groundedness | 0.716 | 0.610 | **−0.105** |
| chunks | faith | 0.941 | 0.900 | −0.041 |
| chunks | ar | 0.798 | 0.791 | −0.006 |
| chunks | cp | 0.563 | 0.660 | **+0.097** |
| chunks | cr | 0.397 | 0.449 | **+0.051** |
| chunks | groundedness | 0.839 | 0.808 | −0.031 |
| global | faith | 0.439 | 0.444 | +0.005 |
| global | ar | 0.540 | 0.661 | **+0.121** |
| global | cp | 0.492 | 0.492 | +0.000 |
| global | cr | 0.333 | 0.292 | −0.042 |
| global | groundedness | 0.430 | 0.530 | **+0.100** |

### Refusal correctness (abstention quality)

| Surface | v6 | v8 | Δ | Notes |
|---|---|---|---|---|
| lessons | 0.750 | 0.667 | −0.083 | low n (1 fail each) |
| code | 0.000 | 0.500 | **+0.500** | low n (2/1 fails) — wide CI |
| chunks | 0.333 | 0.333 | 0.000 | tied |
| global | 0.000 | 0.000 | 0.000 | tied |

The code-surface +0.500 abstention gain is real-directional but small-sample.

## Interpretation

### v8 wins (where it does win) are surface-specific

- **global** is the only clean win: ar +0.121 and groundedness +0.100
  with neutral faith. v8's terse framing helps the answerer commit to a
  cited answer when contexts are abundant but fuzzy.
- **chunks** wins on cp/cr (+0.097, +0.051) but loses faith (−0.041).
  Net: roughly even.

### v8 losses are concentrated on code

- **code faith −0.116** and **groundedness −0.105** is the dominant
  signal. Loosening the abstention rule (v6 → v8) made the answerer
  commit to code answers it shouldn't have committed to. Code's hard
  contexts (47% of code queries have a different candidate pool —
  see DEFERRED-033) reward conservative abstention.

### lessons is mildly negative

- faith −0.084 (significant) trades off with cp +0.040 and grd +0.014.
  Net mildly negative.

## What changed about the Phase 17 Bug 3 narrative

| Phase 17 closeout claim (Tradition A, mistral-nemo judge) | Tradition B verdict |
|---|---|
| "v8 net-positive on lessons" | Wrong — v8 mildly negative on lessons (faith −0.084) |
| "v8 net-positive on code" | Wrong — v8 LARGELY negative on code (faith −0.116, grd −0.105) |
| "v8 net-positive on chunks" | Partial — mixed (cp/cr win, faith loss) |
| "Hedge behavior cut 57% (14→6) on code" | Probably real (hedge-rate is a synth-output property, not judge-dependent) |
| "AR +0.08 on code Tradition A" | Holds direction-wise (Tradition B sees +0.047), magnitude smaller |

The hedge-rate reduction is real (a synthesizer output statistic,
judge-independent). But the *value* of that reduction was overstated by
the same-model bias on Tradition A: gemma sees the v8 answers as less
faithful AND less grounded, not more.

## What to do about the templates

**Recommendation: revert lessons + code surfaces to v6 framing.**
- Code is where the regression is largest (−0.116 faith, −0.105 grd)
  and is the most important surface for the Bug 3 use case.
- Lessons is mildly negative.
- chunks is mixed (a wash, not a clear winner either way).
- global benefits from v8 framing.

The cleanest move forward is a hybrid: keep v8 for global, restore v6
for lessons/code/chunks. But for shipping THIS PR (#35), keeping all
four on v8 is fine because:
1. The regression is real but bounded (catalog-wide faith only drops
   ~9pp; this is a 50% bigger faith loss than v8 won by the Tradition A
   measurement, but it's not catastrophic).
2. Changing templates again now would invalidate the v10A and v10B
   measurements that already shipped to PR #35 and the closeout doc.
3. The fix should be its own PR with a deliberate hybrid-template
   decision, not be smuggled in here.

**Logged as deferred:** a follow-up "v11" measurement with hybrid
v6-lessons-code-chunks + v8-global templates against Tradition B would
be the next publication-quality run. See DEFERRED-031 update below.

## DEFERRED-031 update

DEFERRED-031 was originally written as "global-surface faithfulness gap
of 0.254 is fundamental — not fixable at template layer alone." The v10B
result (faith=0.444 with gemma judge) showed the gap is ~3.5× smaller
than first reported. THIS run confirms a stronger conclusion:

- The v6 templates ALSO score faith=0.439 on global Tradition B —
  essentially identical to v8's 0.444. So the global faith gap is
  NEITHER (a) a same-model bias artifact alone NOR (b) a Bug 3 template
  effect. It's an intrinsic property of substring-search semantics on
  ambiguous queries.
- The "global gap" is now properly bounded at ~0.44 faith (vs
  0.55-0.94 on the other three surfaces).

## Artifacts

- v6 baseline JSON: `docs/qc/baselines/2026-06-17-2026-06-17-phase-17-v6-tradition-b-defer-judge-full.json`
- v6 baseline MD:   `docs/qc/baselines/2026-06-17-2026-06-17-phase-17-v6-tradition-b-defer-judge-full.md`
- v8 baseline (=v10B): `docs/qc/baselines/2026-06-17-2026-06-17-phase-17-v10-tradition-b-defer-judge-full.json`
- v10 Tradition A reference: `docs/qc/2026-06-17-v10-clean-stack-baseline-results.md`
- v10 Tradition B closeout: `docs/qc/2026-06-17-v10-tradition-b-same-model-bias-results.md`
- DEFERRED.md: `docs/deferred/DEFERRED.md` § DEFERRED-031
- Model selection tradition: `docs/qc/model-selection-tradition.md`

## Reproducibility

The v6 templates were materialized from commit `b52ca3a` directly into
the working copy (`git show b52ca3a:path > path` for each of 4
templates), the baseline was run with `--defer-judge true --gen-eval on`,
then the v8 templates were restored via `git checkout HEAD -- src/qc/templates/*.txt`
before commit. No template-layer changes are committed by this measurement —
only docs + the v6 baseline artifacts. The HEAD state of `src/qc/templates/`
remains v8.
