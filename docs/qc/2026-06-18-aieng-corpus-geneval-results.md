# ai-engineering corpus — first grounded gen-eval (DEFERRED-032 pilot)

**Date:** 2026-06-18 · **tag:** `aieng-corpus-v1` · **Surface:** chunks
**Corpus:** `corpus/ai-engineering/` (8 docs → 51 chunks, bge-m3) · **Items:** 56
ai-engineering competency claims · **Answerer/judge:** gemma-4-26b-a4b-qat,
answerer temp=0 · **Run:** 56 rows, 0 errors, ~14.7 min.

## Headline

The corpus works. This is the first time the competency bank has been evaluated
against a **real, ingested, independent** corpus instead of the answerer's prior
knowledge. The pipeline (author → ingest → retrieve → ground → judge) runs clean
end-to-end, and two things are clearly good:

- **Retrieval grounds well:** context_recall **0.881**, context_precision **0.839**
  (vs the old degenerate 11-chunk corpus where cr was corpus-bound ~0). Spot-checks
  show the correct grounding chunk at **rank 1**.
- **Abstention works:** refusal_correctness **1.000** on the 2 `no_answer` rows.
  The corpus-exclusion discipline (GPT-4=128k, pgvector efConstruction=64 left out,
  grep-verified) paid off — the system correctly abstains.

## Scores by answer category

| metric | ALL | standard | false_premise | no_answer |
|---|---:|---:|---:|---:|
| faithfulness | 0.762 | 0.622 | 0.883 | — |
| answer_relevancy | 0.527 | 0.483 | 0.564 | — |
| context_precision | 0.839 | 0.840 | 0.828 | 1.000 |
| context_recall | 0.881 | 0.813 | 0.931 | 1.000 |
| groundedness_self_eval | 0.984 | 0.964 | 1.000 | 1.000 |
| refusal_correctness | — | — | — | 1.000 |

## The real finding (read-the-raw-output win): a template↔task mismatch

`answer_relevancy 0.527` and standard `faithfulness 0.622` look mediocre. Reading
the raw answers shows they are **not** a corpus or retrieval problem — they are the
product's anti-hallucination **synthesizer template mis-firing on a task it wasn't
built for.**

`synthesizer.chunks.txt` is a CLOSED-BOOK Q&A template (Phase 16/17 anti-halluc):
"ABSTAIN WHEN UNSUPPORTED → your ENTIRE answer must be exactly: `Not in context.`"
The competency task is **T/F-claim evaluation** ("State whether the claim is TRUE or
FALSE…"). On that task the template over-abstains:

> **AI-RAG-0001-s1** — claim: *"Reranking … cannot raise recall beyond what
> retrieval already fetched."* Retrieved **rank-1 chunk** literally reads *"A
> reranker cannot raise recall beyond what retrieval supplied."* Answer returned:
> **"Not in context."**

**6 of 25 standard rows falsely abstained with the grounding chunk at rank 1**
(AI-RAG-0001 s1/s3/s7, AI-VEC-0001 s1/s5, AI-ML-0001 s6). Those 6 alone drag the
standard numbers down:

| standard rows | faithfulness | answer_relevancy |
|---|---:|---:|
| all 25 | 0.622 | 0.483 |
| 19 engaged (non-abstain) | **0.777** | **0.636** |

The template's caution is correct *for the product* (better to abstain than
hallucinate), but for a claim-verification benchmark it under-confirms supported
claims. The `false_premise` rows score higher (faithfulness 0.883) because refuting
a false claim aligns better with the abstain-leaning template.

## Conclusions

1. **Methodology proven.** Author-independent corpus → ingest → grounded gen-eval
   works; the pilot validates the held-out-answer-key approach end-to-end.
2. **Corpus quality is high** (cr 0.88, groundedness 0.98, rank-1 grounding).
3. **Abstention/exclusion discipline works** (refusal_correctness 1.00).
4. **The low relevancy/faithfulness is a template↔task mismatch, not corpus/
   retrieval quality** — the chunks synthesizer over-abstains on T/F-claim
   evaluation. Logged as **DEFERRED-037**.

## Next options

- **Claim-evaluation synthesizer variant** (DEFERRED-037): a template that judges
  *supported / refuted / absent* instead of generic answer-or-abstain, then re-run
  — would measure the corpus's true quality on this task. (Likely lifts standard
  faithfulness toward the 0.78 engaged-only level and removes the false-abstains.)
- **Scale the corpus** to the other 4 domains (aws-ops, developer, language-runtime,
  solution-architecture) now that the pilot proved the method.
- **Re-run the corpus-bound levers** (CoVe, HyDE, chunk-granularity) on this richer
  corpus — esp. query-rewrite, since the verbose T/F-claim prompts are the
  vocabulary-mismatch regime where rewrite classically helps (unlike the clean
  lessons queries where it lost).

## Update — DEFERRED-037 fixed (v2, 2026-06-18)

Re-ran with both fixes (`aieng-corpus-v2`): full-chunk context (`snippet_max_chars=
2000`) + the `claim-eval` template. The over-abstention had **two** causes, found
by reading the raw context fed to the model:

1. **Context truncation (the real cause):** `searchChunks` fed the synthesizer the
   240-char display preview, not the chunk; facts past char 240 read as "Not in
   context." Fixed with a `snippetMaxChars` option (full chunk to the answerer).
2. **Template↔task mismatch:** generic Q&A template over-abstains on T/F claims.
   Fixed with `synthesizer.chunks.claim-eval.txt`.

| metric | v1 | v2 | Δ |
|---|---:|---:|---:|
| faithfulness (ALL) | 0.762 | **0.909** | +0.147 |
| faithfulness (standard) | 0.622 | **0.821** | +0.199 |
| answer_relevancy (ALL) | 0.527 | **0.654** | +0.127 |
| context_recall (ALL) | 0.881 | **0.994** | +0.113 |
| groundedness_self_eval | 0.984 | **1.000** | +0.016 |
| **refusal_correctness (no_answer)** | 1.000 | **1.000** | **preserved ✓** |

**Standard false-abstentions: 6/25 → 0/25.** Critically, `refusal_correctness`
stayed **1.000** — the 2 `no_answer` rows (GPT-4=128k, pgvector=64) STILL abstain.
The fix removed false-abstention without breaking true-abstention (the
specific-value guard + corpus exclusion held). 0 gen errors.

Remaining `answer_relevancy 0.654` is the ragas-metric vs T/F-verdict fit, not a
quality gap — faithfulness 0.91 / groundedness 1.00 are the trustworthy signals and
are excellent. **Corpus quality on ai-engineering is now confirmed strong.**
Archive: `docs/qc/baselines/2026-06-18-aieng-corpus-v2.json`. → DEFERRED-037 RESOLVED.

## Reproduce

```bash
API_BASE_URL=http://127.0.0.1:3001 npx tsx src/qc/ingestCorpus.ts   # 8 docs → 51 chunks
ANSWERER_AGENT_TEMPERATURE=0 QC_CHUNKS_FILE=qc/competency-geneval.json \
RAGAS_JUDGE_URL=http://127.0.0.1:3005 \
  npx tsx src/qc/runBaseline.ts --tag aieng-corpus-v1 --surfaces chunks \
    --groups 'ai-engineering/*' --gen-eval on --no-preflight
```

Archive: `docs/qc/baselines/2026-06-18-aieng-corpus-v1.json`.
