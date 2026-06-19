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

## Smoke result (2026-06-19, AWS-STO-0001, 7 rows)

End-to-end validated on the freshly-ingested corpus: cp=1.00 / cr=1.00 on every row (corpus
retrieves), faithfulness 0.75–1.00, and **7/7 correct verdicts** — including the textbook
hallucination probe **s2 "S3 is eventually consistent for new objects"** which the grounded RAG
correctly **refuted with citation** ("The claim is FALSE. S3 provides strong read-after-write
consistency [1]"). A model relying on stale (pre-Dec-2020) training would confirm it; grounding
caught it.

## Known follow-up (non-blocking)

`target_chunk_ids` is empty in the compiled set, so retrieval `recall@k` shows MISS — gen-eval
(faithfulness/abstention) does not need it; the high cp/cr from the judge confirm retrieval
worked. The verdict (TRUE/FALSE) currently lives in the answer text and is recoverable, but
`answer_relevancy` compares to full ideal-answer prose rather than the verdict. A dedicated
`verdict_correctness` + `refutation_groundedness` judge metric (blueprint §10.3, in
`services/ragas-judge`) would make false_premise scoring crisp. Quality lift, not a blocker.
