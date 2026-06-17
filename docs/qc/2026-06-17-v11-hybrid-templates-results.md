# v11 Hybrid Templates — Tradition B Pareto improvement (2026-06-17)

**Tag:** `2026-06-17-phase-17-v11-hybrid-tradition-b-defer-judge-full`
**Branch:** `v11-hybrid-templates`
**Setup:** Same as v6-B and v10B runs — mistral-nemo answerer, gemma judge, bge-m3
embeddings, bge-reranker-v2-m3 reranker, two-phase `--defer-judge true`, 152 rows.

**Template state:**
- `synthesizer.lessons.txt` → v6 (from commit `b52ca3a`)
- `synthesizer.code.txt` → v6 (from commit `b52ca3a`)
- `synthesizer.chunks.txt` → v6 (from commit `b52ca3a`)
- `synthesizer.global.txt` → v8 (HEAD, unchanged)

Per-surface mapping based on the v6 vs v8 verdict on Tradition B
(see `2026-06-17-bug3-v6-vs-v8-tradition-b-results.md`): use v6 where v6
wins, use v8 where v8 wins.

## Headline — Pareto improvement over both pure-v6 and pure-v8

### Catalog-wide weighted-mean (n=152 across 4 surfaces)

| Metric | v6 | v8 | **v11** | Δ(v11−v6) | Δ(v11−v8) |
|---|---|---|---|---|---|
| Faithfulness | 0.620 | 0.528 | **0.618** | −0.002 | **+0.089** |
| Answer relevancy | 0.763 | 0.786 | **0.798** | **+0.035** | **+0.013** |

v11 matches v6's faith (within 0.002, noise floor) AND beats BOTH v6
and v8 on answer relevancy.

**Noise-floor caveat (from /review-impl MED-3).** This run did not use
`--control` (single-run, not duplicate-run). The +0.089 catalog faith
lift over v8 is robust to any plausible per-run jitter. But the
+0.013 catalog ar lift over v8 is small enough to plausibly live in
single-run noise — we have no quantified noise floor to confirm. The
honest framing is: **v11 achieves faith parity with v6 (the better-faith
template set) while keeping ar at-least-comparable to v8 (the
better-ar-on-global template).** The "beats both on ar" claim should
not be cited as load-bearing without a `--control` duplicate.

**Per-surface scope caveat.** The Pareto win is **catalog-weighted on
faith + ar.** Per-surface, **chunks cp drops −0.076 and chunks cr
drops −0.077 vs pure-v8** — the price of switching chunks from v8 to v6.
Net chunks impact is still positive (faith +0.043, grd +0.046) but
operators evaluating v11 for chunk-heavy workloads should know about
this regression. Logged as v12 follow-up below.

### Per-surface confirmation

| Surface | template src | metric | v6 | v8 | v11 | Verdict |
|---|---|---|---|---|---|---|
| lessons | v6 | faith | 0.662 | 0.577 | 0.668 | ✓ matches v6 |
| lessons | v6 | ar | 0.834 | 0.805 | 0.832 | ✓ matches v6 |
| lessons | v6 | grd | 0.841 | 0.855 | 0.846 | ≈ tied |
| code | v6 | faith | 0.563 | 0.446 | 0.553 | ✓ keeps v6's +0.107 over v8 |
| code | v6 | ar | 0.742 | 0.789 | **0.793** | beats both alone |
| code | v6 | grd | 0.716 | 0.610 | 0.694 | ✓ keeps v6's +0.084 over v8 |
| chunks | v6 | faith | 0.941 | 0.900 | 0.943 | ✓ matches v6 |
| chunks | v6 | cp | 0.563 | 0.660 | 0.584 | regression: −0.076 vs v8 |
| chunks | v6 | cr | 0.397 | 0.449 | 0.372 | regression: −0.077 vs v8 |
| chunks | v6 | grd | 0.839 | 0.808 | 0.854 | beats both alone |
| global | v8 | faith | 0.439 | 0.444 | 0.450 | ✓ matches v8 |
| global | v8 | ar | 0.540 | 0.661 | 0.678 | ✓ keeps v8's +0.137 over v6 |
| global | v8 | grd | 0.430 | 0.530 | 0.500 | ✓ keeps most of v8's +0.100 |

### One regression to call out

chunks `cp` and `cr` dropped vs pure-v8 (−0.076, −0.077). v6 has
weaker chunks cp/cr than v8 by design, and v11 inherits that. This is
the cost of choosing v6 over v8 on chunks. Net chunks impact is still
positive (faith +0.043, grd +0.046) but cp/cr trade-off is real.

## Method note — first attempt was corrupted

The first v11 run produced `faithfulness=null` for 147/152 rows.
Investigation: between the v6 run (15:32) and the v11 run (17:18) LM
Studio's gemma-4-26b runtime had switched to reasoning-by-default mode.
Every `chat.completions.create` dumped a long internal reasoning trace
into `reasoning_content` BEFORE emitting visible output, exhausting
`max_tokens` mid-stream. The RAGAS faithfulness metric uses Instructor
for structured JSON parsing → `IncompleteOutputException` →
`scores.faithfulness = null`.

**Fix:** patched `services/ragas-judge/main.py:_build_openai_client` to
wrap every `client.chat.completions.create` and inject
`extra_body={"reasoning_effort": "none"}`. Harmless for non-reasoning
models (LM Studio silently ignores it for mistral-nemo).

Sidecar smoke-tested at faith=1.0 in ~3s before re-running v11
(corrupted run was 50s per judge → null). Re-run elapsed 48.5 min vs
52 min for v6-B and 51 min for v10B — back to expected.

Corrupted artifacts archived as forensic evidence at
`docs/qc/baselines/_archive/2026-06-17-v11-broken-pre-reasoning-effort-patch.{json,md}`
(see the `_archive/README.md` for the symptom shape).

The sidecar patch ships with unit-test coverage —
`services/ragas-judge/test_reasoning_effort_patch.py` (7 tests, pure
stdlib). Tests verify the wrapper is installed on both async + sync
paths, injects `extra_body["reasoning_effort"] = "none"` when caller
doesn't set it, preserves caller's other `extra_body` keys, respects
explicit caller override, and handles `extra_body=None` without
crashing. Run inside the container:

```
docker exec free-context-hub-ragas-judge-1 \
  sh -c "cd /app && python -m unittest test_reasoning_effort_patch -v"
```

If a future refactor of `_build_openai_client` drops the wrapper, these
tests fail loudly instead of letting the bug silently re-surface as
null faith scores in a baseline run.

**Reproducibility note (CRLF on Windows).** Templates were materialized
via `git show b52ca3a:path > path`, which produces CRLF on Windows. The
manifest `synthesizer_prompt_hashes` cross-check confirms v11's lessons/
code/chunks hashes equal v6's exactly (`13ac4e950489bde6` for lessons,
`3a2ea1624ae0a1fc` for code, `a01005e0d102b2c1` for chunks) and v11's
global hash equals v8's (`bbfc552fbd293364`). Node's `readFileSync`
plus git's autocrlf normalize the bytes consistently across runs.
Hash equality validates byte-for-byte template identity at the
prompt-input layer — the relevant comparison surface.

## What ships with this commit

| File | Change |
|---|---|
| `services/ragas-judge/main.py` | reasoning_effort=none monkey-patch on `_build_openai_client` |
| `src/qc/templates/synthesizer.lessons.txt` | reverted to v6 (from `b52ca3a`) |
| `src/qc/templates/synthesizer.code.txt` | reverted to v6 |
| `src/qc/templates/synthesizer.chunks.txt` | reverted to v6 |
| `src/qc/templates/synthesizer.global.txt` | UNCHANGED (v8 wins on global) |
| `docs/qc/baselines/…v11-hybrid-tradition-b-defer-judge-full.{json,md}` | new |
| `docs/qc/2026-06-17-v11-hybrid-templates-results.md` | this doc |

## What doesn't ship

- The corrupted first-attempt artifacts (kept in `/tmp`, not committed).
- Changes to global template (intentional — v8 wins on global).
- Any retroactive edits to v6 or v10B baselines (those stand as reference).

## Implications for production

`synthesizer.lessons.txt`, `synthesizer.code.txt`, `synthesizer.chunks.txt`
should ship at v6 framing in the default `main` branch. The v8 framing
should remain only for `synthesizer.global.txt`. This is the change
shipped on this branch.

The sidecar `reasoning_effort=none` patch is a permanent fix — it
prevents future degradation if LM Studio adds reasoning-by-default to
other models or to mistral-nemo. The patch is judge-model-agnostic.

## Open follow-ups

- **Tradition C measurement (gemma both)** — still deferred. v11 has
  not been measured under same-model gemma-judge conditions; we don't
  know if the +0.013 ar lift is real or a Tradition B artifact.
- **Chunks cp/cr regression** (−0.076 / −0.077 vs pure-v8) — likely
  rooted in v6's stricter abstention language causing the answerer to
  drop borderline-relevant context citations. A "v12" that adds the v8
  context-acknowledgement bullet to the v6 chunks template (without the
  rest of v8's framing) might recover cp/cr without losing faith.

## Artifacts

- v6-B baseline JSON: `docs/qc/baselines/2026-06-17-2026-06-17-phase-17-v6-tradition-b-defer-judge-full.json`
- v8-B (=v10B): `docs/qc/baselines/2026-06-17-2026-06-17-phase-17-v10-tradition-b-defer-judge-full.json`
- **v11 baseline JSON**: `docs/qc/baselines/2026-06-17-2026-06-17-phase-17-v11-hybrid-tradition-b-defer-judge-full.json`
- v6 vs v8 closeout: `docs/qc/2026-06-17-bug3-v6-vs-v8-tradition-b-results.md`
- v10B same-model-bias closeout: `docs/qc/2026-06-17-v10-tradition-b-same-model-bias-results.md`
- Model selection tradition: `docs/qc/model-selection-tradition.md`
- DEFERRED-031: `docs/deferred/DEFERRED.md`
