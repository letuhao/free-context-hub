# Query-rewrite A/B — does HyDE (or expand) increase quality?

**Date:** 2026-06-18 · **Resolves:** DEFERRED-036 · **Code:** `f5d4b06`
**Surface:** lessons (48 golden queries) · **Retrieval-only** (gen-eval off — the
answer-independent metrics are the clean primary signal) · **Answerer:**
`gemma-4-26b-a4b-qat` @ **temperature=0, seed=42** (deterministic rewrite per the
review MED-1 caveat, so the comparison is not contaminated by LLM sampling).

## Result — NO. Query rewrite does not improve quality; it degrades ranking.

| mode   | recall@5 | recall@10 | **MRR** | nDCG@5 | nDCG@10 | coverage | p50 ms |
|--------|---------:|----------:|--------:|-------:|--------:|---------:|-------:|
| **none** (raw query) | **0.889** | 0.889 | **0.856** | **0.845** | **0.826** | 0.889 | 90 |
| expand | 0.867 | 0.867 | 0.772 | 0.787 | 0.774 | 0.867 | 86 |
| hyde   | 0.822 | **0.911** | 0.751 | 0.747 | 0.772 | **0.911** | 105 |

48 queries, 0 errors in every mode. Lessons-retrieval tie-breaking noise floor
≈ **0.026** recall@5 (established in prior `--control` runs).

### Reading the numbers
- **MRR is the dominant signal** (where does the correct lesson land?). Both
  rewrites hurt it well beyond the noise floor: none 0.856 → expand 0.772
  (−0.084) → **hyde 0.751 (−0.105)**. The right answer, when found, lands at a
  *worse rank*.
- **nDCG (rank-weighted relevance) drops** at both @5 and @10 for both rewrites.
- **recall@5 drops** for hyde (0.889 → 0.822, −0.067, real) and is within noise
  for expand (−0.022).
- **The only thing hyde improves is deep recall** — recall@10 +0.022 and
  coverage +0.022 (both ~at the noise floor). hyde drags a couple more relevant
  docs into the top-10 but *pushes them down the ranking* — a bad trade for a
  system where the top hit is what matters.

### Why rewrite loses here
1. **bge-m3 already embeds the raw question well** against lesson titles/content;
   a rewrite adds noise and dilutes the exact-term signal that was already
   landing the hit at rank 1.
2. **The golden set is rich in adversarial intentional-misses** (unicorn,
   astrophysics, falconry). HyDE dutifully writes a *plausible passage even for an
   unanswerable query*, which pulls in spurious near-matches → precision falls.

### Why this generalizes (best-case-and-still-lost)
Lessons is the **most semantic** surface — the best case for HyDE. The others are
worse fits: `code` is lexical/identifier search (prose HyDE would hurt more),
`chunks` is a degenerate 11-chunk corpus, `global` is ILIKE. HyDE losing on its
best surface is strong evidence it won't help the lexical ones.

## Recommendation

**Keep production retrieval on the raw query. Do not wire HyDE or expand into the
default path.** The lever stays in the harness as a measurement tool — useful to
re-run if the corpus ever shifts to vocabulary-mismatched documents (the regime
where HyDE classically wins), but for *this* system + corpus + embedder it is a
net negative.

## Reproduce

```bash
ANSWERER_AGENT_TEMPERATURE=0 ANSWERER_AGENT_SEED=42 \
ANSWERER_AGENT_BASE_URL=http://127.0.0.1:1234/v1 \
  npx tsx src/qc/runBaseline.ts --tag hyde-ab-<mode> \
    --rewrite-mode <none|expand|hyde> --gen-eval off --surfaces lessons --no-preflight
```

Archives: `docs/qc/baselines/2026-06-18-hyde-ab-{none,expand,hyde}.json`.
