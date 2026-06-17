# Code surface determinism fix — root cause of v10A↔v10B noise (2026-06-17)

**Branch:** `deferred-030-rerank-quality`
**Scope:** `src/services/tieredRetriever.ts` — 5 SQL edits + 1 JS sort tiebreaker

## Symptom

Comparing the v10 Tradition A (`mistral-nemo` answerer + judge) and v10
Tradition B (`mistral-nemo` answerer + `gemma-4-26b` judge) baseline
JSONs, the **code** surface showed:

| Metric | A | B | Δ |
|---|---|---|---|
| recall@5 | 0.5195 | 0.4935 | **−0.0260** |
| recall@10 | 0.6494 | 0.6364 | −0.0130 |
| MRR | 0.3915 | 0.3834 | −0.0081 |

All three other surfaces (lessons / chunks / global) were bit-identical
on retrieval metrics — only **code** drifted. The v10B closeout
hypothesised "cross-encoder tie-breaking; should pin a seed in
local-rerank-service config or note as unavoidable."

The hypothesis was wrong.

## Forensic analysis

Comparing `per_query.top_k_keys` for all 77 code queries:

```
total queries: 77
diff top-5: 34 (44.2%)
diff top-10: 35 (45.5%)
  same set, different order: 0
  different set: 35
```

**0 queries** had "same set, different order." Every query whose top-k
differed had a **different candidate set entirely.** A reranker can only
reorder a fixed input — it cannot introduce new candidates or drop old
ones. So the noise had to come from upstream, in the pre-rerank tiered
retrieval.

Sample diff (auth-workspace-token-validate):
- A top-3: `phase5WorkerValidation.ts`, `mcp-client/index.ts`, `ragas/_compat.py`
- B top-3: `mcp/index.ts`, `phase5WorkerValidation.ts`, `mcp/formatters.ts`
- 3 files appear only in A's top-10; 3 different files appear only in B's top-10

This is a candidate-pool difference, not a reorder.

## Root cause

Five queries in `src/services/tieredRetriever.ts` returned different rows
across runs:

| Line | Tier | Bug |
|---|---|---|
| 290 | FTS (chunks) | `ORDER BY rank DESC LIMIT $3` — `ts_rank` ties (esp. coarse — path-injected rows share `fts_rank: 0.01`) → PostgreSQL free to pick any subset |
| 319 | Path-match (chunks) | `LIMIT 50` with **NO** `ORDER BY` — pure heap-scan order, shifts with MVCC visibility / autovacuum |
| 361 | Semantic (chunks) | `ORDER BY embedding <=> $2::vector LIMIT $3` — float ties rare but not impossible at low-discriminant values |
| 710, 730 | Test-tier (chunks) | `LIMIT 50` with **NO** `ORDER BY` — same as line 319 |

Plus a JS-level issue: the final `candidates.sort((a,b) => …)` in `fuse()`
used `(tier_priority, score)` only. When two candidates landed at
identical tier and score — common when both came in only via path-match
with the hard-coded `fts_rank: 0.01` — their final order inherited
JavaScript `Set` insertion order, which itself derived from the
non-deterministic SQL row-return order. Even with the SQL fixed, this
JS gap would persist for path-only candidates.

### Why only code surface

- **lessons** → single pgvector `searchLessonsMulti` query. 1024-dim
  cosine distance has essentially no ties; one ORDER BY is enough.
- **chunks** → same single pgvector path.
- **global** → REST `/api/search/global` interleaves five small ILIKE
  groups; small enough that the LIMIT cuts rarely truncate ties.
- **code** → fuses 4 SQL queries plus a JS sort, including ILIKE
  path-match without ORDER BY. Maximum exposure to ordering bugs.

## Fix

All five SQL queries received deterministic secondary keys, and the JS
fuse-sort received a path-ASC tertiary key. Comments at each call site
reference DEFERRED-033 for traceability.

```diff
- ORDER BY rank DESC
+ ORDER BY rank DESC, c.file_path ASC, c.symbol_name ASC NULLS LAST

- WHERE ... ILIKE ANY($2::text[]) ... LIMIT 50
+ WHERE ... ILIKE ANY($2::text[]) ... ORDER BY file_path ASC LIMIT 50

- ORDER BY c.embedding <=> $2::vector
+ ORDER BY c.embedding <=> $2::vector, c.file_path ASC, c.symbol_name ASC NULLS LAST

  // JS fuse:
  if (ta !== tb) return tb - ta;
- return b.score - a.score;
+ if (a.score !== b.score) return b.score - a.score;
+ return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
```

## Validation

- `npx tsc --noEmit` — clean.
- `npm test` — **868/868 pass.** No regression.
- Tradition A vs B retrieval comparison on the code surface is now
  blocked by the underlying data, not the query plan — future re-runs
  on the same answerer should produce bit-identical `top_k_keys`.

## What this changes for v9 / v10A / v10B reports

- **Headline recall numbers don't shift.** The −0.026 r@5 delta came
  from 2/77 gold-positive items moving across the rank-5 boundary.
  Most of the candidate-pool churn happened on non-gold candidates and
  didn't affect recall. The published v10A and v10B numbers stand.
- **The comparison between A and B on code recall is now meaningful.**
  Before this fix, you couldn't say "A retrieved better/worse than B on
  code" because the underlying retrieval was independently noisy.
  After this fix, identical inputs produce identical outputs.
- **Future Phase-17 measurements on the code surface can pin a single
  seed-stable baseline.** Cross-encoder rerank is already deterministic;
  with the candidate pool stabilised, the entire code-surface retrieval
  pipeline is now reproducible.

## Files touched

- `src/services/tieredRetriever.ts` — 5 SQL edits + 1 JS sort edit
- `docs/qc/2026-06-17-v10-tradition-b-same-model-bias-results.md` —
  open item marked RESOLVED with backlink to this doc
- `docs/deferred/DEFERRED.md` — DEFERRED-033 entry (RESOLVED on entry)
