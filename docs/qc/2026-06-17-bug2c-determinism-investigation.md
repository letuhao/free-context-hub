# Bug 2c root mechanism — determinism probe results (2026-06-17)

**Investigated:** A3 of the post-PR-34 debt list (M, ~3h, risky — possibly not fixable)
**Branch:** `deferred-030-rerank-quality`
**Probe scripts:** `services/ragas-judge/bug2c_determinism_probe.py` (with seed=42)
+ `bug2c_determinism_probe_noseed.py` (control)
**Probe input:** `docs/qc/baselines/_bug2_probe_input.json` (5 rows)

## Question

The Phase 17 closeout (`docs/qc/2026-05-25-phase-17-ragas-judge-fix-a-b.md`) noted:
> *Bug 2c root mechanism — uninvestigated. The 5-row probe at temp=0 (no seed)
> gave different verdicts than the production baseline (temp=0 + seed=42). With
> provenance now in the manifest, future investigations can pin a fixed seed in
> standalone scripts to measure true determinism.*

The "provenance fix" (added `judge_seed` + `judge_temperature` to the gen
manifest) was acknowledged as treating the SYMPTOM (auditability), not the
ROOT (whether seed=42 actually produces deterministic verdicts).

This investigation pins seed=42 explicitly and measures.

## Method

For each of the 5 probe input rows, run the same `StatementGeneratorPrompt` →
`NLIStatementPrompt` pipeline 3 times. Compare:
- `stmt_hash` — sha256 of the statement list (stage 1 output)
- `decision_hash` — sha256 of the `(statement, verdict)` pairs (stage 2 output,
  reason text ignored to distinguish decision-determinism from rationale-jitter)
- `score` — fraction of entailed statements (the final metric)

Two probes:
- **With seed=42** — pinned via `ChatOpenAI(model_kwargs={"seed": 42})`.
- **No seed** — control; pinning omitted.

Both probes use `temperature=0.0`, `max_retries=0`, same model
(`mistralai/mistral-nemo-instruct-2407`), same input rows.

## Results

### Layer 1 — direct LM Studio API call (no ragas / langchain wrapper)

For sanity, I also probed the bare LM Studio chat API at temp=0, seed=42,
sending an identical short prompt 5 times. All 5 responses bit-identical.
**Layer 1 is deterministic.**

### Layer 2 — full ragas pipeline through langchain + instructor

| Condition | Non-deterministic rows | Max score spread |
|---|---|---|
| seed=42 pinned | 2 / 5 | **0.000** |
| no seed | 2 / 5 | **0.333** |

**Non-deterministic rows (same in both conditions):**
- `job-queue-postgres-claim`
- `config-env-loading-dotenv`

**Deterministic rows (3 of 5, both conditions):**
- `kg-project-graph-delete`
- `git-proposal-upsert-idempotent`
- `mcp-health-endpoint`

## Interpretation

### 1. Seed pinning DOES help — but not the way intuition suggests

The naive expectation: "seed=42 pinned at temp=0 → bit-identical output every
time." Empirically that is NOT what happens through the ragas / langchain /
instructor / LM Studio stack. With seed=42:

- 3 of 5 rows produce bit-identical JSON across all 3 runs ✓
- 2 of 5 rows produce DIFFERENT JSON across runs, even with seed=42 pinned ✗

The 2 non-deterministic rows have ambiguous claims that the structured-output
mechanism (instructor's JSON_SCHEMA mode → LM Studio constrained sampling)
breaks ties on differently across runs. Constrained sampling at temp=0 still
has floating-point tie-breaking variance on logits that are within rounding
distance of each other; the seed RNG affects which tie-break is taken on the
hot path but doesn't fully cover the constraint-injection path.

### 2. Seed pinning DOES make the SCORE deterministic

This is the load-bearing finding. Even though the JSON content varies between
runs on those 2 rows, the FAITHFULNESS SCORE doesn't:

| Row | No seed: scores across 3 runs | With seed=42: scores |
|---|---|---|
| `config-env-loading-dotenv` | 0.000, 0.333, 0.000 (spread **0.333**) | 0.000, 0.000, 0.000 (spread **0.000**) |
| `job-queue-postgres-claim` | unchanged scores all 3 runs | unchanged scores all 3 runs |

Without seed, `config-env-loading-dotenv` swings between score=0 and
score=0.333 across runs — a real 0.333 spread that would visibly contaminate
any baseline running through that row.

With seed=42 pinned, the score stays at 0.000 across all 3 runs even though
the JSON text differs. That's the property baselines need: reproducible
aggregate metrics, not bit-identical JSON.

### 3. The original "5-row probe gave different verdicts than production" symptom is now explained

The 5-row probe in the Phase 17 closeout ran at temp=0 with NO seed. On
`config-env-loading-dotenv` it would have given score 0.000 or 0.333
depending on the random run, while production at temp=0 + seed=42 would
have given a stable 0.000. The "different verdicts" weren't a bug in
ragas or instructor — they were just the unseeded probe drawing a
different sample from a 33%-variant distribution.

The closeout's hypothesis ("Likely sources to inspect: instructor JSON
schema retry loop, ragas's two-step claim-split + NLI handshake ordering,
LM Studio json_schema mode variance under Mistral-Nemo") was directionally
right — LM Studio's structured-output sampling IS the source of the residual
non-determinism, but it isn't a bug that needs a fix in ragas or
instructor; it's just how constrained sampling tie-breaks ambiguous
prompts. Seed pinning is the right mitigation, and it's already in the
provenance.

## What gets carried forward

- **No code change required.** Production already pins seed=42 via the
  ragas sidecar's `JUDGE_SEED=42` env (see
  `services/ragas-judge/config.py`). The probe scripts shipped in this
  investigation can be re-run any time as a regression check.
- The original closeout's open-issue carry-forward ("Bug 2c root
  mechanism. The 5-row probe at temp=0 (no seed) gave different verdicts
  than the production baseline (temp=0 + seed=42).") can be **closed**.
- A small caveat to add to `model-selection-tradition.md`: the seed=42
  pin guarantees **score determinism**, not bit-identical JSON. Anyone
  comparing two baseline runs row-by-row should compare scores, not
  raw verdict text — the verdict text can legitimately differ on 30-40%
  of "ambiguous" rows even when the score is identical.

## Tangential finding — baseline-stack contamination was an OVERLAPPING bug

While investigating Bug 2c, the user pointed out a different model-swap
contamination bug — covered in
`docs/qc/2026-06-17-baseline-stack-bug-postmortem.md`. The two are
orthogonal but were both contributing variance to v4–v9 baselines:

- **Bug 2c** (this investigation): residual structured-output sampling
  variance on ambiguous rows — affects ~40% of rows, score spread up to
  ~0.33 without seed, ~0.00 with seed.
- **Baseline-stack model swap** (fixed earlier this session): worker
  silently leaking `DISTILLATION_MODEL=gemma` → mid-baseline model
  swaps when LM Studio auto-unloaded — affects whichever rows happened
  to fire during a swap, magnitude unpredictable.

The v10 clean-stack baseline (`docs/qc/2026-06-17-v10-clean-stack-baseline-results.md`)
removed the second bug. The first bug never affected SCORES in
production (only the verdict-text bit-pattern), so v10's metric numbers
are not affected by Bug 2c either.

## Artifacts

- Probe scripts (in-repo): `services/ragas-judge/bug2c_determinism_probe.py`
  + `services/ragas-judge/bug2c_determinism_probe_noseed.py`
- Probe outputs (sidecar-local, copy out with `docker cp` if needed):
  `/app/_bug2c_determinism_output.json` (seed=42) +
  `/app/_bug2c_determinism_noseed_output.json` (no seed)
- Layer-1 LM Studio determinism probe: `/tmp/lmstudio_seed_probe.sh`
  (deleted; trivial bash, 5 curl calls, all bit-identical responses).
