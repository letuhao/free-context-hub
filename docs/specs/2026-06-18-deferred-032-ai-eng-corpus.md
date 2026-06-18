# DEFERRED-032 — ai-engineering corpus (DESIGN/PLAN)

**Date:** 2026-06-18 · **Branch:** `deferred-032-ai-eng-corpus` (off main)
**Scope:** ai-engineering pilot — 56 of the 294 competency items, 8 sub-categories.
**Size:** L.

## Goal

The `qc/competency-geneval.json` answer key (294 held-out T/F claims) has no corpus
to ground against (`corpus/` does not exist), so gen-eval on it measures only the
answerer's prior knowledge, not RAG behavior. Author a **real, independent** corpus
for the ai-engineering domain so we can finally measure, on grounded retrieval:
faithfulness / groundedness / abstention (gen-eval) and recall@k (retrieval). This
is also the corpus that re-enables meaningful cr / chunk-granularity / lever
measurement (CoVe, HyDE all came back flat partly because the corpus was thin).

## The independence discipline (critical — or the benchmark is worthless)

The competency set is the **answer key**; the corpus must be authored
**independently of it**, from domain knowledge — NEVER by copying
`must_contain_facts`. If the corpus echoes the answer key, gen-eval measures
copy-retrieval, not grounding (the exact `label leakage / circularity` failure the
set's own AI-EVAL-0001-s4 item tests for). Discipline applied:
- Author each doc from the **topic** (`_meta.topic`), in natural reference prose.
- The true facts appear because they are true domain knowledge, phrased differently
  from the answer key.
- After authoring, verify each item is *answerable* (true claim → supported;
  false-premise claim → the TRUE version is present so the system can refute) — but
  do NOT phrase-match the key.

## Exclusions (abstention probes)

Two ai-engineering items are `no_answer` — the corpus must **NOT** contain the fact
so the system correctly abstains:
- `AI-LLM-0001-s7`: "GPT-4's max context window is exactly 128,000 tokens." → do not
  state any specific GPT-4 context-window number.
- `AI-VEC-0001-s7`: "pgvector default HNSW efConstruction is 64." → do not state any
  specific pgvector HNSW default parameter value.

## Corpus — 8 docs, one per sub-category (`corpus/ai-engineering/*.md`)

| doc | sub-category | topic | covers (facts to ground) |
|---|---|---|---|
| 01-llm-fundamentals.md | llm-fundamentals | tokens-context-embeddings | tokens vs words (~0.75); big context ≠ no RAG (cost, lost-in-the-middle); temp 0 ≠ determinism; embeddings = geometry not facts; lost-in-the-middle; next-token predictor → hallucination. **Exclude GPT-4 128k.** |
| 02-rag.md | rag | retrieval-rerank-eval | rerank reorders ≠ raises recall; cross-encoder vs bi-encoder; recall@k is retrieval not answer quality; more chunks ≠ better; hybrid BM25+vector + RRF. |
| 03-vector-retrieval.md | vector-retrieval | ann-hnsw-similarity | ANN approximate (recall/speed trade); HNSW layered graph (memory/build cost, M/ef*); similarity metric must match model; dimensionality trade-off. **Exclude pgvector efConstruction default.** |
| 04-agentic-ai.md | agentic-ai | toolcall-mcp-react | model requests / host executes; tool output is untrusted (injection); more tools ≠ better; ReAct doesn't validate args; MCP standardizes the contract; structured output ≠ semantic correctness. |
| 05-llm-evaluation.md | llm-evaluation | ragas-judge-pitfalls | faithfulness = grounded ≠ factual; judge non-deterministic + biased; self-preference bias; label leakage/circularity; noise floor; context_precision sensitive to rerank. |
| 06-prompt-context-engineering.md | prompt-context-engineering | patterns-structured-reasoning | CoT improves reasoning ≠ fixes facts; few-shot quality > quantity; "return JSON" ≠ valid JSON; prompting ≠ truth; reasoning-mode burns budget; position effects; reasoning-toggle is backend-specific. |
| 07-productionizing-llms.md | productionizing-llms | serving-cost-guardrails | guardrails reduce ≠ eliminate; RAG reduces ≠ removes hallucination; dedicated cross-encoder ≫ LLM-as-reranker; batching + KV-cache → throughput; cost ∝ tokens; batch latency/throughput tension; observability (tokens/latency/cost/groundedness). |
| 08-ml-mlops-basics.md | ml-mlops-basics | train-eval-drift-decision | RAG vs fine-tune vs prompt; overfitting; never eval on training data; data vs concept drift; train/val/test split; deployed models need monitoring. |

Each doc: a `#` title + `##` concept sections (so the hierarchical chunker yields
concept-level chunks → clean `target_chunk_ids` mapping later). ~400-600 words each.

## Ingestion (real path, not a shortcut)

Per document:
1. `POST /api/documents` `{project_id:'free-context-hub', name, content:<md>, doc_type:'markdown'}` → `doc_id`.
2. `POST /api/documents/:id/extract` `{project_id, mode:'fast', template:'hierarchical'}` → chunks + bge-m3 embeddings.

A small script (`src/qc/ingestCorpus.ts`) drives this over the 8 files so the run is
reproducible. (Uses the live API on :3001.)

## Measurement plan

1. **gen-eval first** (no `target_chunk_ids` needed): run the baseline `chunks`
   surface on the 56 ai-eng items with `--gen-eval on`, judge on. Read faithfulness,
   groundedness_self_eval, refusal_correctness (abstention on the 2 no_answer rows),
   answer_relevancy. **Pin `ANSWERER_AGENT_TEMPERATURE=0`** (per DEFERRED-036 MED-1).
2. **recall@k follow-up:** query the DB for the chunk that grounds each item,
   populate `target_chunk_ids`, re-run for recall@k / MRR.
3. Document under `docs/qc/`.

## Verify

- Corpus authored, 2 exclusions honored (grep the corpus for "128" and
  "efConstruction" → must be absent / not a default value).
- Ingestion: 8 docs → N chunks, all embedded (chunk count logged).
- gen-eval baseline runs clean on the 56-item slice; abstention rows score
  refusal_correctness sensibly.

## Out of scope (re-deferred)

- The other 4 domains (aws-ops, developer, language-runtime, solution-architecture,
  238 items) — author only if the ai-eng pilot proves the methodology pays off.
- `target_chunk_ids` population is a follow-up step, not blocking the gen-eval signal.
