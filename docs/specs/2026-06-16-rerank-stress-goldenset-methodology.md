# Spec — "rerank-stress" golden subset methodology

- **Date:** 2026-06-16
- **Why:** The existing lessons golden set is near-ceiling (MRR 0.85; target usually rank 1),
  so reranking has no headroom and the A/B showed a true null. To measure rerank value we need
  queries where raw retrieval **buries** the relevant lesson (present but rank 4–20), plus hard
  negatives. Grounded in: difficulty-aware eval (MHTS, RARE), hard-negative mining (DocReRank),
  synthetic-from-doc generation + diversity (rag-gs / Practical RAG Eval), Anyscale/Braintrust
  query-type taxonomy.

## Methods (combined)

- **M1 — Headroom mining (core, non-circular).** For a deterministic sample of lessons, an LLM
  (gemma-4-26b, reasoning off) reads the lesson and writes ONE *indirect* question (symptom/scenario
  framing, avoids title vocabulary). Run **raw** retrieval (rerank OFF). Record the rank of the
  source lesson. Keep queries where rank ∈ [4,20] = **headroom band** (rerank can act). Tag rank
  1–3 = easy (control), rank >20/absent = retrieval-ceiling (rerank cannot help). The reranker
  under test never participates in selection or labeling → no circularity. Raw retrieval is the
  baseline, not the system under test.
- **M2 — Hard negatives.** Pick lesson pairs sharing keywords but differing in meaning; phrase a
  query that lexically favors the WRONG lesson. Label = the semantically-correct lesson. Tests
  whether the cross-encoder's joint scoring beats lexical/semantic confusion.
- **M3 — Taxonomy coverage.** Span factual / multi-hop / ambiguous / no-answer / paraphrase /
  hard-negative (reuse the `answer_category` field).
- **M4 — Diversity gate.** Reject near-duplicate queries (high pairwise cosine of query embeddings).
- **M5 — Stratified reporting.** Tag each query easy/medium/hard by raw rank; report metrics per
  band. Keep the existing 48 easy queries as a control band — no cherry-picking only-favorable cases.

## Anti-illusion invariants

- Selection/label NEVER uses the reranker under test (only raw retrieval + the source lesson).
- Human review required before ship (`reviewed_by`), per existing golden-set invariants — guards
  against false negatives (LLM query that genuinely matches a *different* lesson better).
- Report easy + headroom + ceiling bands separately; headline = headroom band, but all bands shown.
- A/B re-run uses the same controlled stack (no-rerank vs cross-encoder), 0 fallbacks verified.

## Pipeline

1. `src/qc/mineRerankStressQueries.ts` — sample lessons (deterministic), gemma-generate indirect
   query, raw-retrieve, bucket by rank → write candidates to `qc/lessons-stress-candidates.json`.
2. Human review of candidates (fix/drop bad labels, set `reviewed_by`).
3. Add M2 hard-negatives by hand.
4. `validateGoldenSet.ts` over the merged set.
5. Re-run A/B (retrieval recall@k/MRR/nDCG, then ragas context_precision) on the stress set,
   stratified by band.
