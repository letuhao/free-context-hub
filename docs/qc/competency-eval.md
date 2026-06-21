# SA Competency Bank — RAG hallucination eval (run procedure)

The [SA Competency Assessment bank](../../../sa-competency-assessment) (42 items / 294
T/F statements across 5 domains) doubles as a RAG hallucination eval for free-context-hub.
Each statement is one eval row; the held-out gold key grades whether the grounded RAG reaches
the right verdict **and explains it from retrieved source** (understand) or confirms a
plausible-false claim / fabricates support (hallucinate).

**Circularity guard:** only the **corpus** is ingested into the RAG; the **bank/key**
(`sa-competency-assessment/bank/*.items.yaml`) is never ingested. The compiled query feeds the
RAG the *claim* + a verify instruction — it must retrieve source and reason to the verdict.

## Artifacts

| Artifact | Location |
|---|---|
| Bank (held-out key, 294 stmts) | `sa-competency-assessment/bank/*.items.yaml` |
| Corpus → gen-eval compiler | `sa-competency-assessment/tools/compile_geneval.py` |
| Corpus → hub stager (copy+flatten) | `sa-competency-assessment/tools/stage_corpus_to_hub.py` |
| Compiled gen-eval set (294 rows) | `qc/competency-geneval.json` |
| Ingested corpus (5 domains, ~288 chunks) | `corpus/{ai-engineering,language-runtime,aws-ops,developer,solution-architecture}/` |
| Ingestion tool (domain-agnostic) | `src/qc/ingestCorpus.ts` |

`answer_category` mapping (blueprint §10.2): `polarity supports→standard` (grounded-confirm),
`refutes→false_premise` (grounded-refute / hallucination probe), `absent→no_answer` (abstention).

## Reproduce

```bash
# 1. (in sa-competency-assessment) compile the bank → gen-eval set + stage corpus into the hub
python tools/compile_geneval.py --out ../free-context-hub/qc/competency-geneval.json
python tools/stage_corpus_to_hub.py        # ai-engineering already staged (DEFERRED-032)

# 2. (in free-context-hub, API + LM Studio bge-m3 up) ingest each domain
for d in ai-engineering language-runtime aws-ops developer solution-architecture; do
  API_BASE_URL=http://127.0.0.1:3001 CORPUS_DIR=corpus/$d npx tsx src/qc/ingestCorpus.ts
done

# 3. run the eval (controlled stack: chat=judge=gemma-4-26b-a4b-qat, embeddings=bge-m3, judge sidecar :3005)
QC_CHUNKS_FILE=qc/competency-geneval.json RAGAS_JUDGE_URL=http://localhost:3005 \
  npx tsx src/qc/runBaseline.ts --surfaces chunks --gen-eval on --samples 1 \
  --tag <date>-competency-full
# smoke a single domain: add  --groups 'aws-ops/*' --max-rows 7
```

`QC_CHUNKS_FILE` is env-scoped — it overrides the chunks golden for this run only and does NOT
disturb the default (`qc/chunks-queries.aieng.json`).

## Full result (2026-06-19, all 294 statements, 5 domains)

Baseline: `docs/qc/baselines/2026-06-19-2026-06-19-competency-full.json` (samples=1, ~85 min,
answerer=judge=gemma-4-26b-a4b-qat, embeddings=bge-m3). Verdict/abstention correctness computed
by parsing each generated answer's TRUE/FALSE/abstain against the held-out gold key:

| Category | Correct | Rate |
|---|---|---|
| `standard` (confirm true) | 144/148 | 97% |
| `false_premise` (refute false) | 140/141 | **99%** |
| `no_answer` (abstain) | 4/5 | 80% |
| **OVERALL** | **288/294** | **98%** |

Per domain: ai-engineering 100%, solution-architecture 100%, language-runtime 98%, aws-ops 97%,
developer 95%. Judge aggregates (grounded rows): faithfulness 0.79 (standard) / 0.92 (false_premise).

**★ Hallucinations: 0.** Across 141 false_premise probes the grounded RAG refuted 140 and abstained
on 1 — it never confirmed a false claim or fabricated support. The 6 non-perfect rows are all *safe*
failures: 4 over-abstentions ("Not in context" on an answerable claim — conservative), 1 hedge
("partially supported"), and 1 invalid probe (see below). E.g. it correctly refuted the textbook
probe **"S3 is eventually consistent for new objects"** with a citation — a model on stale
(pre-Dec-2020) training would confirm it; grounding caught it.

**Probe-design note (LANG-NET-0001-s6):** abstention probes were authored assuming single-cell
ingest. Under full-corpus ingest, the dev/api-design cell legitimately answers the .NET "201 vs
200" probe, so the RAG correctly answered instead of abstaining. To preserve such probes, either
ingest per-domain or choose absent-probe claims not covered by *any* ingested cell.

**Follow-up (`verdict_correctness` metric):** verdicts were parsed from answer text here; a
dedicated judge metric (blueprint §10.3) would score this inside the pipeline rather than via a
post-hoc script.

## Known follow-up (non-blocking)

`target_chunk_ids` is empty in the compiled set, so retrieval `recall@k` shows MISS — gen-eval
(faithfulness/abstention) does not need it; the high cp/cr from the judge confirm retrieval
worked. The verdict (TRUE/FALSE) currently lives in the answer text and is recoverable, but
`answer_relevancy` compares to full ideal-answer prose rather than the verdict. A dedicated
`verdict_correctness` + `refutation_groundedness` judge metric (blueprint §10.3, in
`services/ragas-judge`) would make false_premise scoring crisp. Quality lift, not a blocker.
