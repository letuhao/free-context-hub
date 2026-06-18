# Query-rewrite A/B lever (DESIGN)

**Date:** 2026-06-18
**Status:** DESIGN → BUILD
**Size:** L (new module + 2 templates + tests; threads a flag through runBaseline;
new row trace + archive manifest). Default-off, fully reversible.

## Goal

Add the 4th Phase-17 A/B lever: **query rewrite**, a *retrieval-side*
transformation applied to the golden query before it hits the retriever. Parallel
to CoVe (`--synth-mode`, synth-side), this is `--rewrite-mode none|expand|hyde`.

Two techniques, shared scaffolding:
- **expand** — LLM rewrites the question into a keyword/synonym-rich retrieval
  query (acronym expansion, key terms). 1 extra LLM call. Embeds the rewritten
  query string.
- **hyde** — LLM writes a short *hypothetical answer passage*; we retrieve on that
  passage instead of the raw question (Gao et al. 2022, "Precise Zero-Shot Dense
  Retrieval without Relevance Labels"). Strongest when the question's phrasing
  differs from the document's.

## Why this is cleanly measurable now

The lever's PRIMARY signal is the **answer-independent** retrieval metrics
(recall@k, MRR, nDCG, coverage) — they read `dispatch(rewrittenQuery)` directly,
so they have **zero** exposure to the reasoning-leak class that invalidated the
first CoVe A/B. gen-eval metrics (faithfulness etc.) are a secondary readout: a
better context set should lift them, but they are not the gate. This lever can
therefore run **with gen-eval OFF** (retrieval-only, the cleanest comparison) or
ON (full readout).

Verify-metric-inputs check (per feedback): the metric that moves IS the metric
whose input we change. recall@k is computed from `topK = dispatch(rewritten, k)`.
Changing the query string changes `topK`. ✓ No metric reads the original query
after rewrite except the row's provenance `query` field (unchanged on purpose).

## Architecture — mirror CoVe, but on the retrieval side

New module `src/qc/queryRewrite.ts`:
- `RewriteMode = 'none' | 'expand' | 'hyde'`
- `loadRewriteTemplate(mode)` + `allRewriteTemplateHashes()` (cached, same shape
  as `loadCoVeTemplate`).
- `parseRewrittenQuery(raw, mode)` — **pure**. Strips a leading label
  (`Rewritten query:` / `Search query:` / `Query:`), strips surrounding
  quotes/backticks. expand → first non-empty line. hyde → all non-empty lines
  joined, capped to `HYDE_MAX_CHARS` (2000). Returns `null` on empty → caller
  falls back to the original query (graceful degradation).
- `rewriteQuery(question, mode, answerer, opts?)` — calls the shared
  `chatComplete` transport (so reasoning-suppression + answer extraction are
  consistent with every other caller — no leaked CoT in the retrieval query).
  Returns `QueryRewriteTrace`. On LLM error or empty parse → `fallback:true`,
  `rewritten_query === question`, retrieval proceeds on the original query
  (never blocks a row).

Types (exported from queryRewrite.ts):
```ts
type QueryRewriteTrace = {
  mode: 'expand' | 'hyde';      // never 'none' when a trace is present
  original_query: string;
  rewritten_query: string;      // what was dispatched (== original on fallback)
  rewrite_ms: number;
  fallback: boolean;
  error?: string;
};
type RewriteManifest = {
  mode: 'expand' | 'hyde';
  template_hashes: { expand: string; hyde: string };
  answerer_model_id: string;
  answerer_endpoint: string;
  answerer_temperature: number;
  answerer_seed: number;
};
```

## Threading through runBaseline

- `parseArgs` → `rewriteMode = (args.get('rewrite-mode') ?? 'none')`.
- `main` builds an `AnswererConfig` via a new extracted `buildAnswererConfig()`
  (so it's available even when gen-eval is OFF — today that block builds it
  inline). When `rewriteMode !== 'none'`, build `rewrite = { mode, answerer }`
  and a top-level `rewrite_manifest`.
- `runAllSurfaces` opts gains `rewrite?: { mode; answerer }`.
- `evalQuery` gains a `rewrite?` param. When active, compute the rewrite **once**
  per query (not per latency-sample) BEFORE `runSamples`, dispatch with
  `trace.rewritten_query`, and attach `trace` to the row. The row's `query`
  field stays the original golden query (provenance); a new `rewrite?` field
  holds the trace.
- `BaselineArchive` gains `rewrite_manifest?: RewriteManifest` (top-level, present
  iff `rewriteMode !== 'none'` — recorded even on retrieval-only runs where
  `gen_manifest` is absent).

Bit-identical default: `rewriteMode === 'none'` ⇒ no answerer call, no trace,
`dispatch(q.query)` exactly as today.

## Tests (TDD)

`src/qc/queryRewrite.test.ts`:
- `parseRewrittenQuery` table: expand single-line; expand strips label + quotes;
  expand multi-line takes first; hyde joins lines + caps length; both empty → null;
  whitespace-only → null; reasoning already stripped upstream (assume clean input).
- `rewriteQuery` with an injected `fetchImpl` stub: happy path (expand + hyde),
  LLM error → `fallback:true` + original query, empty completion → fallback.
- mode='none' is never passed to `rewriteQuery` (caller gates); no test needed
  beyond the type.

## Verify

- `tsc --noEmit` + full unit suite (existing rows unchanged: rewrite default off).
- Live smoke: `--rewrite-mode expand --gen-eval off --max-rows 2` on lessons →
  confirm the row carries a `rewrite` trace with a non-empty `rewritten_query`
  and the dispatched retrieval used it; repeat `--rewrite-mode hyde`. Cold/failed
  LLM → `fallback:true`, run still completes.

## Out of scope

- A/B *measurement run* (none vs expand vs hyde across the full golden set) — that's
  a follow-up experiment once the lever is verified, same pattern as the CoVe A/B.
- Per-surface rewrite templates — one expand + one hyde template for all surfaces
  (the question is surface-agnostic; the retriever differs, not the query intent).
