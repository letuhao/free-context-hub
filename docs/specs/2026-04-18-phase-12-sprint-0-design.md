---
phase: 12
sprint: 12.0
title: Baseline scorecard — DESIGN
status: draft
depends_on: docs/specs/2026-04-18-phase-12-rag-quality.md
created: 2026-04-18
---

# Sprint 12.0 — DESIGN

Concrete contracts for every new module. Numbers come later; shapes must be stable first.

## 1. Metrics module — `src/qc/metrics.ts`

Pure functions, no I/O. Re-exports `recallAtK` / `mrr` from `goldenTypes.ts` so callers have one import site.

```ts
export type GradedHit = 0 | 1 | 2;  // 0=irrelevant, 1=partial, 2=exact

export function recallAtK(foundRanks: number[], k: number): 0 | 1;  // re-export
export function mrr(foundRanks: number[]): number;                  // re-export

export function ndcgAtK(gradedHitsInRankOrder: GradedHit[], k: number): number;
export function duplicationRateAtK(
  items: ReadonlyArray<{ key: string }>,
  k: number,
): number;
export function latencySummary(samplesMs: number[]): {
  p50: number; p95: number; mean: number; n: number;
};
export function coveragePct(hasRelevantHit: boolean[]): number;
```

**Duplication formula (v0):** fraction of top-k items whose `key` (normalized title for lessons, path+line for code, doc_id+chunk_idx for chunks) appears more than once in top-k. `10/10 identical → 1.0`; `one pair → 2/10 = 0.20`. Tunable threshold deferred — v0 is exact-match on normalized key.

**nDCG formula:** standard DCG = Σ (2^rel - 1) / log2(rank+1), normalized by IDCG of ideal ordering. For binary golden sets (target_files only, no graded labels), an exact-target hit = 2, a partial-keyword hit = 1, else 0.

**Determinism:** latency excluded from "stable across runs" guarantee; everything else must be byte-identical given the same goldenSet + retriever state.

## 2. Golden-set schema (unified)

Existing `qc/queries.json` migrates to shape below (backwards-compatible: add `surface: 'code'`, keep `target_files` field).

```ts
export type Surface = 'code' | 'lessons' | 'chunks' | 'global';

export type GoldenQuery = {
  id: string;
  group: string;
  query: string;
  must_keywords?: string[];

  // Exactly one populated per set (matches parent `surface`):
  target_files?: string[];        // set.surface='code'
  target_lesson_ids?: string[];   // set.surface='lessons'
  target_chunk_ids?: string[];    // set.surface='chunks'
  target_any?: Array<              // set.surface='global' (heterogeneous)
    { type: 'file' | 'lesson' | 'chunk'; id: string }
  >;

  graded?: Array<{ id: string; grade: GradedHit }>;  // optional
};

export type GoldenSet = {
  version: string;
  surface: Surface;   // set-level only; queries inherit
  project_id_suggested: string;
  notes?: string[];
  queries: GoldenQuery[];
};
```

Design note: `surface` is set-level only (one surface per golden-set file). Mixing surfaces in one set is a non-goal for v0.

File locations:
- `qc/queries.json` — code (exists, 67q; one-line bump to add `surface:'code'` if any code reads it unconditionally)
- `qc/lessons-queries.json` — **NEW**, ~20 queries seeded by me from real lessons
- `qc/chunks-queries.json` — **NEW**, ~15 queries seeded from real doc chunks
- `qc/global-queries.json` — **NEW**, ~10 queries seeded from a cross-surface real-intent list

## 3. Runner — `src/qc/runBaseline.ts`

Orchestrator, calls existing MCP/REST endpoints. No retrieval logic here — thin shim.

```ts
type RunOpts = {
  tag: string;              // e.g. 'phase-12-sprint-0'
  projectId: string;        // 'free-context-hub'
  mcpUrl: string;           // from env
  apiUrl: string;           // from env (for global + chunks REST fallback if no MCP tool)
  kForMetrics: 5 | 10;      // default 10; we record both
  samplesPerQuery: 3;       // for latency noise reduction
  outDir: string;           // 'docs/qc/baselines'
};

async function runBaseline(opts: RunOpts): Promise<{ jsonPath: string; mdPath: string }>;
```

Per-surface dispatch table:
| Surface | Tool / endpoint | Returns |
|---|---|---|
| lessons | MCP `search_lessons` | `{ matches: [{lesson_id, title, content_snippet, score}] }` |
| code | MCP `search_code_tiered` kind=source | `{ files: [{path, score}] }` |
| chunks | MCP `search_document_chunks` | `{ chunks: [{document_id, chunk_index, snippet}] }` |
| global | **verify first** — MCP `search_code_tiered` kind=doc OR REST `/api/search` (see open-item below) | heterogeneous |

**Open-item (resolved in BUILD):** global-search MCP surface. If no dedicated tool exists, runner falls back to REST `/api/search`. Either way, the runner's surface-adapter layer hides it from the metrics computation.

Error policy: per-query failure → `{ error: string, latency_ms }` recorded, excluded from aggregates, surfaced in the Markdown scorecard's "failures" section. Never abort the whole run.

## 4. Archived-run JSON schema — `docs/qc/baselines/YYYY-MM-DD-<tag>.json`

```json
{
  "schema_version": "1.0",
  "tag": "phase-12-sprint-0",
  "run_started_at": "2026-04-18T15:30:00Z",
  "run_ended_at": "2026-04-18T15:33:12Z",
  "elapsed_ms": 192000,
  "git_commit": "abc1234",
  "git_branch": "phase-12-rag-quality",
  "project_id": "free-context-hub",
  "retriever_version": "phase-11-closeout",
  "surfaces": {
    "lessons": {
      "query_count": 20,
      "errors": 0,
      "metrics": {
        "recall_at_5": 0.65, "recall_at_10": 0.75,
        "mrr": 0.43,
        "ndcg_at_5": 0.51, "ndcg_at_10": 0.57,
        "duplication_rate_at_10": 0.33,
        "coverage_pct": 0.80,
        "latency_p50_ms": 142, "latency_p95_ms": 387, "latency_mean_ms": 178
      },
      "per_query": [
        {
          "id": "lesson-q-001",
          "group": "retrieval",
          "query": "...",
          "top_k_keys": ["a","b","a","a"],
          "found_ranks": [3],
          "graded_hits_in_rank_order": [2,0,2,2],
          "latency_ms_samples": [151, 142, 188],
          "latency_ms_median": 151,
          "friction_class": "duplicate-domination | null"
        }
      ]
    },
    "code": { "…": "same shape" },
    "chunks": { "…": "same shape" },
    "global": { "…": "same shape" }
  }
}
```

Schema is forward-compatible: unknown fields ignored by diff generator; `schema_version` bumps only on breaking change.

## 5. Markdown scorecard — `docs/qc/baselines/YYYY-MM-DD-<tag>.md`

```markdown
---
tag: phase-12-sprint-0
commit: abc1234
branch: phase-12-rag-quality
run_at: 2026-04-18T15:30:00Z
elapsed_ms: 192000
---

# RAG Baseline — phase-12-sprint-0

## Summary (all surfaces)
| Surface | Queries | recall@10 | MRR | nDCG@10 | dup@10 | coverage | p95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| lessons | 20 | 0.75 | 0.43 | 0.57 | 0.33 | 0.80 | 387 |
| code | 67 | ... | ... | ... | ... | ... | ... |
| chunks | 15 | ... | ... | ... | ... | ... | ... |
| global | 10 | ... | ... | ... | ... | ... | ... |

## Lessons — details
[per-query outcomes, friction callouts]

## Code — details
...

## Friction observed
[5–10 concrete examples, classified — this is what future sprints aim at]

## Known limitations
- Latency varies ±10% across runs; quality metrics are deterministic.
- Global-search golden set is small (10q) — expand in 12.1 if signal is noisy.
```

## 6. Diff generator — `src/qc/diffBaselines.ts`

```ts
// CLI: npx tsx src/qc/diffBaselines.ts <from.json> <to.json> [--out <file.md>]
async function diffBaselines(fromPath: string, toPath: string): Promise<string>;
```

Output shape:
```markdown
# Baseline diff — phase-12-sprint-0 → phase-12-sprint-1a

## Lessons
| Metric | Before | After | Δ | % |
|---|---:|---:|---:|---:|
| recall@10 | 0.75 | 0.88 | +0.13 | +17% 🟢 |
| dup@10 | 0.33 | 0.05 | -0.28 | -85% 🟢 |
| p95 ms | 387 | 412 | +25 | +6% ⚪ |

## Regressions flagged
(none) | or list of metrics that crossed thresholds
```

Regression thresholds: nDCG drop > 0.05, recall@10 drop > 0.05, latency p95 increase > 20%.

## 7. Friction-class catalog — `docs/qc/friction-classes.md`

Each class gets: definition, one concrete example, which metric exposes it.

Seed list:
1. **duplicate-domination** — top-k dominated by near-identical items. Exposed by `duplication_rate_at_10`. Example: 10/15 "Global search test retry pattern" rows in lesson-search top-15 on 2026-04-18.
2. **no-relevant-hit** — all top-10 irrelevant. Exposed by `coverage_pct`. Example: filled in at baseline run.
3. **wrong-domain-leakage** — cross-surface search returns fixture/test data as top result. Exposed by manual inspection + low nDCG with high recall.
4. **stale-fixture-noise** — auto-generated test lessons ("Valid: impexp-…") pollute results. Exposed by `duplication_rate` + manual inspection. Example: 4 hits in our 2026-04-18 finding.
5. **rank-order-inversion** — relevant hit exists but ranked below irrelevant. Exposed by `MRR << recall`.
6. **snippet-redundancy** — distinct DB rows, identical snippets. Exposed by `duplication_rate` when `key = content_snippet` vs `key = id`.

## 8. Package scripts (in `package.json`)

```json
{
  "scripts": {
    "qc:baseline": "tsx src/qc/runBaseline.ts",
    "qc:baseline:diff": "tsx src/qc/diffBaselines.ts"
  }
}
```

Neither runs in CI by default (docker-compose dependency). Intended for local + release-time execution.

## 9. File inventory (what BUILD will create)

| # | Path | Purpose | LOC est |
|---|---|---|---|
| 1 | `src/qc/metrics.ts` | new metrics (nDCG, dup, latency, coverage) + re-exports | ~150 |
| 2 | `src/qc/metrics.test.ts` | unit tests (5+ cases per metric) | ~200 |
| 3 | `src/qc/goldenTypes.ts` | extend with `surface` + new target fields (backwards-compat) | +25 |
| 4 | `qc/lessons-queries.json` | ~20 seeded queries | — |
| 5 | `qc/chunks-queries.json` | ~15 seeded queries | — |
| 6 | `qc/global-queries.json` | ~10 seeded queries | — |
| 7 | `qc/queries.json` | add `surface:'code'` field | +1 |
| 8 | `src/qc/runBaseline.ts` | unified runner | ~350 |
| 9 | `src/qc/diffBaselines.ts` | CLI diff generator | ~150 |
| 10 | `src/qc/surfaces.ts` | per-surface adapter (MCP/REST dispatch) | ~200 |
| 11 | `docs/qc/friction-classes.md` | catalog doc | — |
| 12 | `docs/qc/baselines/.gitkeep` | dir | — |
| 13 | `docs/qc/baselines/2026-04-18-phase-12-sprint-0.json` | first archived run | — |
| 14 | `docs/qc/baselines/2026-04-18-phase-12-sprint-0.md` | first scorecard | — |
| 15 | `package.json` | +2 scripts | +2 |

**Total new code ≈ 1050 LOC. M-size (10 new files, no prod changes).** Confirmed within original classification — no reclassification needed.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Global-search has no MCP tool → runner complexity | Surface adapter pattern isolates the REST-fallback case |
| Golden-set quality skewed by my judgement | Spec already accepted; user can add queries post-hoc |
| Latency dominates signal | N=3 samples per query + p50/p95 (not mean) |
| Baseline run flakes on stack | Partial-run archive always emitted; runner resumes on retry |
| First baseline numbers look bad | That's the point — they're the nail, not a grade |
