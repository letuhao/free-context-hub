---
phase: 12
sprint: 12.1d
title: Query-conditional salience — popularity-feedback-loop suppression
status: complete
branch: phase-12-rag-quality
commits: [25c6c18, 3c00826, d3d4ecb, c7ae0ef, 0b53781]
archive_path: docs/qc/baselines/2026-04-18-sprint-12.1d-*
---

# Sprint 12.1d — Query-Conditional Salience (retrospective plan)

Written retrospectively after sprint closed. Sprint 12.1d was approved
and executed in-session via CLARIFY/DESIGN discussion rather than a
pre-written plan doc; this file records the actual task decomposition
for future-session traceability.

## Motivation
Sprint 12.1c's A/B revealed a popularity-feedback-loop: rank-weighted
`consideration-search` access-log rows accumulate cheaply, popular
lessons climb out of relevance. MRR dropped −0.0373 (delta-from-
control). Mitigation option #1 from the friction-class catalog:
scale the salience boost by how semantically close the lesson is to
the current query.

## Approved design (CLARIFY output)
```
finalScore = hybrid × (1 + α × salience × relevance)
```
where `relevance ∈ [0, 1]` is the query-lesson match quality.

Biologically: memory activation requires BOTH retrieval-cue match
AND recency/frequency signals. The 12.1c form only used the latter.

## Task decomposition (as executed)

**Commit `25c6c18` — core implementation**
- T1: Extend `blendHybridScore` signature — add optional `semSimilarity` param with undefined→1.0 backward-compat
- T2: Plumb `sem_score` through `searchLessons` match-building via parallel `Map<lesson_id, number>`
- T3: Same plumbing in `searchLessonsMulti`
- T4: Unit tests — 7 new tests covering suppression matrix + clamping + backward-compat

**Commit `3c00826` — A/B measurement**
- T5: Run `--control --samples 3` A/B (salience OFF vs ON with query-conditional); archive JSON + MD + diff

**Commit `d3d4ecb` — /review-impl fixes (MED-1, MED-2, LOW-2, LOW-3, COSMETIC-1)**
- T6: MED-1 — `Number.isFinite` guard in blend to prevent NaN propagation from pgvector zero-magnitude vectors
- T7: MED-2 — Change callers to pass `max(sem_score, fts_score)` composite relevance, not pure sem_score (prevents FTS-only-relevant matches from losing boost)
- T8: LOW-2 — Extract `applyQueryConditionalSalienceBlend` pure helper for unit-testability
- T9: LOW-3 — Document the silent cap at 1.0 in the block comment
- T10: COSMETIC-1 — Explanation string now reports `Z effective after relevance-gating`
- T11: +12 new unit tests covering NaN, Infinity, FTS-preservation, plumbing, empty, α=0

**Commit `c7ae0ef` — A/B verification after fixes**
- T12: Re-run `--control --samples 3` A/B across all 4 surfaces to confirm no regression from fixes

**Commit `0b53781` — SESSION_PATCH update + LOW-1 narrative correction**
- T13: Add CH-PHASE12-S121D entry; correct cross-sprint MRR claim to delta-from-control form

## Acceptance criteria (achieved)
- Unit tests: 226/226 pass (was 214, +12)
- tsc --noEmit: clean
- A/B (lessons): MRR=0.9412 parity with control, nDCG@10 +0.0073 within floor
- Delta-from-control recovery vs 12.1c: +0.0373 (popularity-feedback-loop suppressed)
- Zero regressions flagged on 20-query lessons goldenset

## Friction classes touched
- `popularity-feedback-loop` (mitigated via mitigation path #1)
- Implicit: `conditioning-signal-gap` (sem-only vs composite relevance) — addressed preemptively via MED-2

## Durable lessons captured
- `db9027fb` — delta-from-control vs raw cross-sprint MRR (measurement methodology)
- `ac91bc6c` — composite relevance for query-conditional salience (design decision)
- `05fde055` — `Number.isFinite` guard for NaN propagation through Math.max/min clamp chains (defensive-programming pattern)

## Workflow compliance
Full 12-phase v2.2 workflow completed. `/review-impl` invoked once (user menu option 2 at POST-REVIEW), found 5 issues (2 MED, 2 LOW, 1 COSMETIC), all fixed before SESSION.
