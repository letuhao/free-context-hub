# Semantic vs hierarchical chunking (Phase 17.4) — A/B result

**Date:** 2026-06-18 · **Surface:** chunks (ai-engineering corpus, 56 items) ·
**Hierarchical (control):** `aieng-corpus-v2` (51 chunks) · **Semantic:**
`aieng-corpus-v4-semantic` (22 chunks) · Same config (claim-eval, full chunk, temp=0).

## Result — semantic chunking is NET-NEGATIVE. Keep hierarchical (the default).

| metric | hierarchical (51 chunks) | semantic (22 chunks) | Δ |
|---|---:|---:|---:|
| faithfulness | 0.909 | 0.812 | −0.097 |
| answer_relevancy | 0.654 | 0.565 | −0.089 |
| context_precision | 0.873 | 0.778 | −0.095 |
| **context_recall** | 0.994 | 0.853 | **−0.141** |
| groundedness_self_eval | 1.000 | 0.995 | −0.005 |
| refusal_correctness | 1.000 | 1.000 | 0.000 |

0 gen errors both arms.

## Why hierarchical wins here

Semantic chunking merged the corpus into **22 coarser, topic-blended chunks** (2–4
per doc) vs hierarchical's **51 concept-clean chunks** (one per `##` section). The
corpus was authored with clean `##` headings, so hierarchical already produces the
*optimal* concept-level chunks — one fact per chunk. Semantic chunking ignores those
headings and merges adjacent sentences on embedding similarity, producing chunks
that blend two concepts; their embedding is a blend → a specific claim matches them
less precisely → the grounding chunk ranks lower (**context_recall −0.141**) and
chunks are less focused (**context_precision −0.095**).

**Takeaway:** for well-structured documents (headings), heading-aware hierarchical
chunking beats embedding-drift semantic chunking. Semantic chunking's niche is
*unstructured* documents where naive token-splitting would cut mid-concept — not the
regime this corpus (or most curated docs) is in. Kept as an off-by-default option
(`template: 'semantic'`, `SEMANTIC_BREAKPOINT_PERCENTILE` env).

Same pattern as CoVe / HyDE / RRF: the pipeline is already strong; these levers
chase headroom that isn't there.

## Bonus — a real CRLF bug surfaced (and was fixed)

Restoring the corpus to hierarchical after the semantic run produced **16 chunks,
not 51**. Root cause: git's autocrlf had rewritten the corpus files to **CRLF** on a
checkout this session, and `chunkDocument`'s heading regex `^(#{1,3})\s+(.+)$`
**silently fails on `\r`-terminated lines** (JS `.` doesn't match `\r`, and `$`
doesn't match before it) → **0 headings detected → naive fallback**. This affected
**any CRLF document in production**, not just the corpus — a Windows-authored or
pasted doc would get naive token-chunks instead of heading-aware ones.

**Fix:** `normalizeNewlines()` (CRLF/CR → LF) at the top of `chunkDocument` +
`chunkDocumentSemantic`, with a CRLF regression test. Re-ingest after the fix →
**51 chunks restored**. (The semantic arm was unaffected — `splitSentences`
normalizes whitespace — so the A/B above stands.)

## Decision

- **Production stays on hierarchical/auto chunking.** Semantic kept off-by-default.
- **The CRLF fix ships** — real bug, applies to all document chunking.

## Reproduce

```bash
CHUNK_TEMPLATE=semantic API_BASE_URL=http://127.0.0.1:3001 npx tsx src/qc/ingestCorpus.ts
ANSWERER_AGENT_TEMPERATURE=0 QC_CHUNKS_FILE=qc/competency-geneval.json \
RAGAS_JUDGE_URL=http://localhost:3005 \
  npx tsx src/qc/runBaseline.ts --tag aieng-corpus-v4-semantic --surfaces chunks \
    --groups 'ai-engineering/*' --gen-eval on --synth-template claim-eval --no-preflight
API_BASE_URL=http://127.0.0.1:3001 npx tsx src/qc/ingestCorpus.ts   # restore hierarchical
```
