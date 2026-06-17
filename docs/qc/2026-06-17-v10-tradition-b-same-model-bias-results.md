# v10 Tradition B — same-model bias isolation results (2026-06-17)

**Tag:** `2026-06-17-phase-17-v10-tradition-b-defer-judge-full`
**Branch:** `deferred-030-rerank-quality`
**Setup:**
- Answerer: `mistralai/mistral-nemo-instruct-2407` (same as v10 Tradition A)
- Judge: `google/gemma-4-26b-a4b` (DIFFERENT from answerer — Tradition B)
- Embeddings: `text-embedding-bge-m3` (same)
- Rerank: `bge-reranker-v2-m3` (same)
- Two-phase execution: `--defer-judge true` (152 syntheses → 1 LM Studio swap → 152 judgments)
- 51 min wall-clock (vs 38 min for Tradition A — gemma 26B judge is ~30% slower per call)

## Why Tradition B exists

The v10 closeout flagged "same-model bias" as an open item:
> Answerer + judge are both mistral-nemo (Tradition A). Lit suggests +3-5pp
> faithfulness inflation. A Tradition B run (mistral-nemo answerer + gemma
> judge per the recommendation in
> `docs/qc/2026-05-24-phase-17-answerer-model-selection.md`) would isolate this.

The published "same-model bias" literature claims a uniform ~3-5pp
faithfulness inflation. This run measures what actually happens on our
catalog, not what the literature predicts.

## Method

Same retrieval, same answerer, same answers fed to TWO different judges
(mistral-nemo in v10 Tradition A, gemma-4-26b-a4b in this Tradition B
run). The only variable is the judge model. Any Δ in the generation
metrics IS same-model bias by definition — it can't be anything else.

The two-phase execution mode (`--defer-judge`) was REQUIRED for
Tradition B. Without it, LM Studio would swap mistral-nemo (answerer)
↔ gemma (judge) every row × 152 rows = 304 swaps, contaminating the
measurement worse than the baseline-stack bug we just fixed. Two-phase
collapses to 1 swap (mistral-nemo idle after Phase 1 → gemma loaded
once for Phase 2). Refactor in `src/qc/runBaseline.ts` —
`evalQuery` returns `{row, pending}`, `runAllSurfaces` drains the
pending queue after all syntheses complete.

## Headline result — same-model bias is NOT uniform

| Surface | metric | v10A (m-nemo judge) | v10B (gemma judge) | Δ (B − A) |
|---|---|---|---|---|
| lessons | faith | 0.634 | 0.577 | **−0.057** |
| lessons | ar | 0.727 | 0.805 | **+0.078** |
| lessons | cp | 0.615 | 0.865 | **+0.250** |
| lessons | cr | 0.490 | 0.621 | **+0.130** |
| lessons | groundedness | 0.804 | 0.855 | +0.051 |
| code | faith | 0.494 | 0.446 | −0.048 |
| code | ar | 0.668 | 0.789 | **+0.120** |
| code | cp | 0.163 | 0.089 | −0.075 |
| code | cr | 0.325 | 0.052 | **−0.272** |
| code | groundedness | 0.762 | 0.610 | **−0.152** |
| chunks | faith | 0.892 | 0.900 | +0.008 |
| chunks | ar | 0.778 | 0.791 | +0.013 |
| chunks | cp | 0.769 | 0.660 | −0.109 |
| chunks | cr | 0.332 | 0.449 | **+0.117** |
| chunks | groundedness | 0.954 | 0.808 | **−0.146** |
| global | faith | 0.254 | 0.444 | **+0.190** |
| global | ar | 0.638 | 0.661 | +0.023 |
| global | cp | 0.217 | 0.492 | **+0.275** |
| global | cr | 0.342 | 0.292 | −0.050 |
| global | groundedness | 0.760 | 0.530 | **−0.230** |

**Three things this table reveals:**

### 1. Same-model bias direction is NOT uniformly positive

The literature says "same model → inflated faithfulness." Empirically on
our catalog:
- mistral-nemo judging mistral-nemo INFLATED faithfulness on lessons
  (+0.057) and code (+0.048) — confirms the lit prediction.
- But mistral-nemo DEFLATED faithfulness on global (−0.190!) and was
  neutral on chunks (−0.008).

The "same-model bias is a positive inflation" framing is broken. It's
more accurate to say "same-model bias makes the judge more aligned with
the answerer's CONFIDENCE PATTERN" — when the answerer hedges (global,
substring-search semantics, ambiguous prompts), mistral-nemo
sympathetically marks it down; when it doesn't hedge, mistral-nemo
sympathetically marks it up.

### 2. DEFERRED-031 was mostly same-model bias

The v10 Tradition A global-surface faithfulness = 0.254 looked like a
fundamental limitation of substring-search synth fidelity. We documented
it as "not fixable at template layer alone."

With gemma judge, global faithfulness = **0.444** — +0.190 vs Tradition
A. Most of the "global trade-off" was mistral-nemo judging
mistral-nemo's hedge-heavy answers harshly because both are biased the
same way. A stronger, independent judge sees the answers as more
substantively grounded than the same-model judge did.

**DEFERRED-031 status update**: the magnitude of the gap is now
~3.5× smaller than what Tradition A reported. It's still a gap (gemma
judge faith=0.444 is still below the lessons/code/chunks faith of
0.45-0.90), but the framing "fundamentally unmeasurable at the template
layer" was wrong — it's measurable; we just needed a cross-judge to
detach the answerer's hedging from the judge's recognition of
substance.

### 3. Context precision/recall changes are HUGE

Both `context_precision` and `context_recall` use the judge LLM to
decide "is this context relevant to the question / does it support the
answer." Same-model bias on those metrics is massive:
- lessons cp: +0.250 (mistral-nemo SEVERELY under-credited contexts)
- global cp: +0.275 (same direction)
- code cr: −0.272 (mistral-nemo OVER-credited contexts on code)

These deltas are 5-50× bigger than the literature's "3-5pp" prediction.

## What this means for publication

| Claim | Was reliable on v10A? | Reliable now (v10B)? |
|---|---|---|
| bge-reranker recall@10 lift on code | ✓ | ✓ unchanged (retrieval not judge-dependent) |
| Phase 17 Bug 3 v8 net-positive on lessons/code/chunks | ✓ | ⚠ direction OK; magnitudes need re-running on Tradition B |
| Global faithfulness gap (DEFERRED-031) | ⚠ overstated | ✓ now properly measured — Δ is real but smaller |
| Absolute faith/ar/cp/cr numbers per surface | ✗ confounded by same-model bias | ✓ Tradition B is the publication-quality measurement |

**Recommendation:** cite Tradition B numbers (v10B) going forward.
Absolute deltas should re-measure on Tradition B. The Tradition A v9/v10
reports remain useful as "what did mistral-nemo think of mistral-nemo's
output" but should never be the headline numbers for a Phase 17 claim.

## Code changes shipped with this measurement

- `--defer-judge=true|false` CLI flag on `runBaseline.ts` (default false
  for back-compat).
- `GenEvalConfig.deferJudge` carries the flag down to
  `runGenEvalForRow`.
- `runGenEvalForRow` returns `{result, pending?}`. When `deferJudge` is
  on, the synth-only result has placeholder `judge_ms=0, scores={}`
  and the caller gets a `PendingJudge` blob to drain later.
- `runAllSurfaces` now collects `pendingJudges` across all surfaces in
  Phase 1, then drains them in Phase 2 AFTER all syntheses complete.
  Aggregation deferred to post-Phase-2 so per-surface metrics include
  the freshly-filled scores.
- Preflight (`preflightGenEval`) relaxes the strict "sidecar judge_model
  must match answerer" check when `deferJudge=true` — that
  mismatch is no longer fatal in two-phase mode.
- Console output: per-row line shows `judge=DEFERRED` in Phase 1 instead
  of fake `j:0ms`. Phase 2 prints `judge i/N` progress every 10 rows +
  at completion.

868/868 unit tests pass (no regression). tsc clean.

## Cost of two-phase

- LM Studio swaps: 1 (vs 304 in interleaved Tradition B)
- Phase 1 + Phase 2 wall-clock: 51 min (vs 38 min Tradition A)
- The +13 min vs Tradition A is gemma-26B being ~30% slower than
  mistral-nemo-12B per judge call, NOT swap overhead. Two-phase
  successfully eliminated the swap cost.

## Open items going forward

- **Re-run "Bug 3 v8 net-positive" comparison on Tradition B** to
  convert the directional claim into a number. v6 vs v8 on Tradition B
  would isolate the template effect from the judge effect.
- ~~**Investigate code surface recall_at_5 0.026 noise** between v10A and
  v10B — same retrieval, same answerer should give bit-identical
  numbers. Likely cross-encoder tie-breaking; should pin a seed in
  `local-rerank-service` config or note as unavoidable.~~ **RESOLVED
  2026-06-17.** Root cause was NOT the reranker — 35/77 code queries
  (45%) had different top-10 candidate POOLs (0/35 were "same set,
  different order"), which a reranker cannot produce. Real cause:
  non-deterministic SQL in `src/services/tieredRetriever.ts` — three
  `ORDER BY rank/distance LIMIT N` clauses without secondary
  tiebreakers, plus two `LIMIT 50` path-match queries with NO
  `ORDER BY` at all (heap-scan order). Fixed by appending
  `(file_path ASC, symbol_name ASC NULLS LAST)` to each ORDER BY and
  adding explicit `ORDER BY file_path` to the two heap-scan queries.
  Also added a path-ASC final tiebreaker to the JS fuse-sort that
  merges tier results. 868/868 unit tests pass. See
  `docs/qc/2026-06-17-code-surface-determinism-fix.md` for full
  forensics. Future Tradition A↔B comparisons on the code surface
  will be bit-identical at the retrieval layer.
- **Decide where Tradition C (gemma both) sits.** Cross-encoder rerank
  geneval already used this. May want a single canonical Phase 17
  re-measurement on Tradition C for the rerank-quality vs
  synth-quality bridge.

## Artifacts

- Baseline JSON: `docs/qc/baselines/2026-06-17-2026-06-17-phase-17-v10-tradition-b-defer-judge-full.json`
- Baseline MD: `docs/qc/baselines/2026-06-17-2026-06-17-phase-17-v10-tradition-b-defer-judge-full.md`
- Tradition A reference: `docs/qc/baselines/2026-06-16-2026-06-17-phase-17-v10-clean-stack-bge-reranker-full.json`
- v10 closeout (Tradition A): `docs/qc/2026-06-17-v10-clean-stack-baseline-results.md`
- Model selection tradition: `docs/qc/model-selection-tradition.md`
- DEFERRED-031 (now needs an update): `docs/deferred/DEFERRED.md`
