---
phase: 12
title: RAG Quality — Biological-Memory-Inspired Improvements
status: draft
owner: free-context-hub
created: 2026-04-18
branch: phase-12-rag-quality
---

# Phase 12 — RAG Quality (Biological-Memory-Inspired)

## Macro sequence (approved 2026-04-18)
**A → B → C** — measure before we move.

- **A. Baseline** (sprint 12.0) — establish the scorecard. Every later sprint cites before/after.
- **B. Consolidation** (sprints 12.1.x) — storage-side: dedup, near-duplicate merge, prune-on-decay ("sleep consolidation"). Attacks the duplicate-noise we already dogfooded.
- **C. Tiering** (sprints 12.2.x) — retrieval-side: access-frequency counter (Redis hot), salience weighting, promotion/demotion, hierarchical pointer retrieval.

The A/B/C order is deliberate: B makes C's numbers cleaner; A gives both a scorecard to hit.

## Motivating observation (2026-04-18)
First `search_lessons("RAG retrieval quality tiered search...")` call returned **10 near-duplicate "Global search test retry pattern" rows out of top 15**, plus 4 auto-generated test fixtures. 602 lessons in the project, top-k dominated by duplication noise. This is not a hypothesis — it is live friction inside our own tool.

---

# Sprint 12.0 — Baseline (this spec)

## Goal
Produce a reproducible, archived **RAG scorecard** across all four retrieval surfaces so every later sprint has a numeric target. "Check RAG quality" → concrete numbers.

## Scope — what's IN
1. **Metrics module** (`src/qc/metrics.ts`) — one file, pure functions:
   - `recallAtK(ranks, k)` (already exists — port from goldenTypes.ts)
   - `mrr(ranks)` (already exists — port)
   - `ndcgAtK(gradedHits, k)` — **NEW**, graded relevance (0/1/2)
   - `duplicationRate(items, keyFn)` — **NEW**, fraction of near-duplicate pairs in top-k by title/snippet similarity (≥0.9 cosine on TF-IDF char-3-gram, or exact-title match as v0)
   - `latencyP50P95(ms[])` — **NEW**
   - `coveragePct(queries)` — **NEW**, fraction with ≥1 relevant hit in top-10
2. **Golden sets** — extend existing `qc/queries.json` structure:
   - `qc/queries.json` — code search (exists: 67 queries)
   - `qc/lessons-queries.json` — **NEW**, ~20 seeded queries (extract + expand from `rerankBenchmark.ts`'s inline 33)
   - `qc/chunks-queries.json` — **NEW**, ~15 seeded queries (Phase-10 doc chunks)
   - `qc/global-queries.json` — **NEW**, ~10 seeded queries (Phase-7 global search)
3. **Unified baseline runner** (`src/qc/runBaseline.ts`) — **NEW**, orchestrates all four surfaces, emits:
   - `docs/qc/baselines/YYYY-MM-DD-<tag>.json` — machine-readable
   - `docs/qc/baselines/YYYY-MM-DD-<tag>.md` — human-readable scorecard
4. **Archived-run format** — schema'd JSON with commit SHA, timestamp, per-surface metrics, per-query outcomes.
5. **Cross-run diff generator** (`src/qc/diffBaselines.ts`) — **NEW**, pointed at two archived runs, emits a Markdown delta table. This is the "nail" — future sprints post their diff row as evidence.
6. **Friction-class catalog** (`docs/qc/friction-classes.md`) — **NEW**, typed list of observed failure modes (duplicate-domination, no-relevant-hit, wrong-domain-leakage, stale-fixture-noise, …). Seeded from today's live finding.
7. **First baseline run archived.** Tagged `phase-12-sprint-0` so 12.1/12.2 have a concrete "before."

## Scope — what's OUT (explicit non-goals)
- No changes to retrieval algorithm, ranker, or storage.
- No GUI dashboard (may come later if friction bites).
- No Redis hot-cache, no salience weight, no dedup — those are sprints B/C.
- No new model evals (rerankBenchmark already covers that axis).

## Metrics we'll record per surface
| Metric | Lessons | Code | Chunks | Global |
|---|---|---|---|---|
| recall@5, recall@10 | ✓ | ✓ | ✓ | ✓ |
| MRR | ✓ | ✓ | ✓ | ✓ |
| nDCG@5, nDCG@10 | ✓ | ✓ | ✓ | ✓ |
| duplication-rate@10 | ✓ | ✓ | ✓ | ✓ |
| coverage% | ✓ | ✓ | ✓ | ✓ |
| latency p50/p95 (ms) | ✓ | ✓ | ✓ | ✓ |

## Task size classification
- **Files touched:** ~10 new, ~0 modified (existing harness untouched)
- **Logic changes:** metrics math (5 fns), runner orchestration (1 runner × 4 surfaces), diff generator (1)
- **Side effects:** no prod code change, no migration, no API contract change. Adds npm script entries only.
- **Classification: M (medium)** → no phase skips. Full 12-phase workflow.

## Definition of done
- [ ] `npm run qc:baseline` runs all four surfaces end-to-end on a live stack.
- [ ] One timestamped baseline archived under `docs/qc/baselines/`.
- [ ] Markdown scorecard rendered and readable (tables, per-surface sections, friction examples).
- [ ] Diff generator produces a valid delta Markdown given two archived JSON files (tested with a synthetic second run).
- [ ] Friction-class catalog has ≥ 4 seeded classes with 1+ concrete example each.
- [ ] Numbers stable across two consecutive `qc:baseline` runs (± 5% on latency, identical on quality metrics given deterministic seeds where possible).
- [ ] Phase-7 REVIEW + Phase-8 QC pass; optional `/review-impl` if numbers look suspicious.

## CLARIFY decisions (locked 2026-04-18)
1. **Golden-set seeding:** I seed queries from observing real project data (lessons, docs, code). User may revise post-hoc.
2. **Baseline scope:** **Tight** — metrics + 4 golden sets (~60 queries) + runner + archive + diff + catalog. CLI only, no GUI this sprint.
3. **Run environment:** **Live docker-compose stack** — realistic latency. `docker compose up -d` is a prerequisite of `npm run qc:baseline`.

## Phase-12 sprint board (tentative, subject to dogfooding)
| Sprint | Topic | Status |
|---|---|---|
| 12.0 | Baseline scorecard (this spec) | [C] CLARIFY |
| 12.1a | Lesson dedup — exact-title collapse | — |
| 12.1b | Near-duplicate merge — cosine-threshold clustering | — |
| 12.1c | Prune-on-decay — access-count + age-based archive | — |
| 12.2a | Access-frequency counter in Redis | — |
| 12.2b | Salience weight (git-incident / error-site boost) | — |
| 12.2c | Hierarchical pointer retrieval (summary + deref) | — |
| 12.2d | Sleep-mode consolidation worker | — |

Sprints below 12.1 subject to whatever the baseline and dogfooding surface as highest-impact. We commit to 12.0 only; the rest is planning, not contract.
