# Chunks cp/cr "regression" is judge noise, not a template effect — v12 closeout

**Date:** 2026-06-18
**Author:** main session (diagnostic-first)
**Verdict:** v12 (modifying the chunks synthesizer template to recover
context_precision / context_recall) is **causally impossible** and is **CLOSED
WON'T-FIX**. The −0.076 / −0.077 chunks cp/cr "regression" attributed to v11 in
`docs/qc/2026-06-17-v11-hybrid-templates-results.md` is a judge-noise artifact,
not a consequence of switching the chunks template from v8 to v6.

## The causal argument (sufficient on its own)

`context_precision` and `context_recall` are computed by the ragas-judge
sidecar from **(question, ground_truth, retrieved_contexts)** only. The
synthesized **answer is never passed** to either metric — see
`services/ragas-judge/main.py:585-614`:

```python
# context_precision
metric.ascore(user_input=question, reference=ground_truth, retrieved_contexts=contexts)
# context_recall
metric.ascore(user_input=question, retrieved_contexts=contexts, reference=ground_truth)
```

The synthesizer template (`synthesizer.chunks.txt`) only changes the **answer**.
Therefore it is *structurally incapable* of moving cp or cr. Three facts make
this airtight:

1. **cp/cr don't read the answer** (code above).
2. **Retrieval is template-independent and deterministic** (DEFERRED-033). The
   v6, v8, and v11 Tradition-B runs retrieved **byte-identical** chunks
   contexts on all 13 rows (`top_k_keys` compared across the three baseline
   JSONs: `v6==v8==v11 = true`).
3. **v6 and v11 use the byte-identical chunks template** — manifest hash
   `a01005e0d102b2c1` in both runs (v8 uses `4684749e32568cec`). Yet v6 and v11
   scored *different* cp/cr (cp 0.563 vs 0.584, cr 0.397 vs 0.372). Same
   template + same contexts + same ground_truth → different score. The only
   remaining free variable is the judge LLM.

## The measurement (confirms it empirically)

`src/qc/noiseFloorChunksCpCr.ts` fixes the template AND the retrieved contexts
(one retrieval per row), then re-runs ONLY the cp/cr judge calls **N=8 times**
against the same Tradition-B judge (`google/gemma-4-26b-a4b`, temp=0, seed=42).
The answer passed is a dummy string — cp/cr ignore it. Any spread is pure judge
non-determinism.

Artifact: `docs/qc/baselines/2026-06-18-noise-floor-chunks-cp-cr.json`

### Surface-mean jitter (the headline-number noise band)

| metric | per-repeat surface means (n=8) | mean | std | **range** |
|---|---|---|---|---|
| context_precision | 0.584, 0.633, 0.658, 0.629, 0.658, **0.731**, 0.633, 0.623 | 0.644 | 0.042 | **0.146** |
| context_recall | 0.397×5, 0.372×3 | 0.391 | 0.012 | 0.026 |

### Per-row, same input, 8 repeats — selected swings

| row | cp range | note |
|---|---|---|
| chunk-cross-retry-auth-storage | **1.000** | 7×0.000, 1×1.000 — full-scale flip on identical input |
| chunk-adr-intro-dup | 0.500 | |
| chunk-retry-implementation-code | 0.417 | also the only cr-variable row (cr range 0.333) |
| chunk-retry-strategy-overview | 0.361 | |

## Reading it against the claimed regression

```
        v6      v8      v11    claimed v11−v8   v6−v11 (SAME template)   noise band (this probe)
cp     0.563   0.660   0.584      −0.076            +0.021                 range 0.146 (0.584–0.731)
cr     0.397   0.449   0.372      −0.077            −0.026                 range 0.026 (back-to-back)
```

- **context_precision:** the claimed −0.076 regression is **half the measured
  noise band (0.146)**. The whole v6/v8/v11 spread fits inside a single
  template's back-to-back band; v8's 0.660 is an ordinary high draw (repeat #6
  reached 0.731 on the v6/v11 template). **Regression = noise. Definitive.**

- **context_recall:** back-to-back the surface mean is stable (range 0.026), so
  the −0.077 vs v8 is *not* explained by back-to-back jitter alone. But it is
  still **not a template effect**, because:
  1. cp/cr are answer-independent (causal argument) — the template cannot move them.
  2. v6 and v11 are the **identical** template and differ by 0.025 (within the
     measured band) — so "v6 has weaker chunks cr by design" is incoherent;
     there is no per-template cr property to inherit.
  3. Back-to-back repeats **underestimate** cross-run noise. The v6/v8/v11 runs
     were hours apart with LM Studio model reloads between them
     (cf. lesson `bb39fe5e`: "determinism holds for back-to-back runs only;
     hours-separated runs jitter"). cr surface mean here is governed by ~3
     bimodal rows (0↔0.333, 0.333↔0.667); a high cross-run draw on those rows
     produces v8's 0.449 without any template involvement.

## If you actually want higher chunks cp/cr

It is a **retrieval-layer** task, not a synthesizer-template task: cp/cr score
the *retrieved contexts* against the ground truth. Levers: chunk
ranking/reranking quality, chunk granularity, `top-k-contexts`, embedding model.
Logged as a retrieval follow-up in DEFERRED.md (not v12).

## Caveats / honesty notes

- N=8 back-to-back is a **lower bound** on noise; cross-run noise is wider.
- The probe re-runs retrieval against the *current* index. Chunks contexts are
  byte-identical to the recorded v6/v8/v11 runs (verified via `top_k_keys`), so
  this is faithful.
- no_answer rows (3 of 13) score cp/cr ~1.0 and inflate the surface mean
  identically in all runs and in the probe — comparability preserved.

## Reproduce

```bash
bash scripts/start-baseline-stack.sh   # gemma judge + bge-m3, controlled stack
NF_REPEATS=8 RAGAS_JUDGE_URL=http://localhost:3005 \
  npx tsx src/qc/noiseFloorChunksCpCr.ts \
  --out docs/qc/baselines/<date>-noise-floor-chunks-cp-cr.json
```
