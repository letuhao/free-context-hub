# DEFERRED-034 closeout — chunks cp/cr was a golden↔corpus mismatch, not a retrieval gap

**Date:** 2026-06-19. **Verdict:** the chunks surface retrieval/grounding is **fine**;
the "low chunks cp/cr" that DEFERRED-034 chased was a **measurement artifact** of a
broken legacy golden set. Fixed by making the matched **ai-engineering** set the default
chunks golden. No retrieval-pipeline change.

## What the prior diagnosis got wrong

DEFERRED-034's update (2026-06-18) concluded chunks `cr` was **corpus-bound** — "the
facts aren't in any chunk → need corpus expansion (032)." That was read off the v11
baseline's `cr≈0`. **It's wrong.** Per "verify metric inputs first," pulling the actual
chunk content showed the limiter is the **answer key**, not the corpus or retrieval.

## Evidence (3 rows, DB-pulled chunk content vs golden facts)

The legacy `qc/chunks-queries.json` targets `test-data/sample.*` fixtures. The target
chunks **are retrieved at rank 1** (so retrieval is correct — `cp` is high), but the
golden `must_contain_facts` **contradict the ingested chunk content**:

| row | golden fact | actual chunk (DB) | |
|---|---|---|---|
| retry-strategy | "base delay **100ms**", "with **jitter**" | "base delay **1 second**", no jitter | ✗ |
| retry-config-table | "base_delay_ms **100**", "jitter_fraction **0.2**", "max_delay_ms **5000**" | "baseDelay **1000ms**", "jitter **true**", *(no max_delay row)* | ✗ |
| role-definitions | roles "admin, **editor**, **viewer**" | roles "admin, **writer**, **reader**" | ✗ |

The target chunk for retry-strategy is **166 chars** — well under the 240-char preview
cutoff — so this is **not** the DEFERRED-037/038 truncation bug either. It is a pure
**golden↔corpus authoring mismatch**: `chunks-queries.json` was written against a
*fictional* corpus, not the ingested fixtures. `cr=0` is a **false negative** — the
system retrieves the right chunk and could answer from it, but the answer key checks for
facts that aren't in the (correct) chunk. No retrieval lever and no corpus expansion (032)
can fix a wrong answer key.

## Proof the pipeline is actually fine

Run the **same chunks pipeline** against a corpus whose golden set **matches** it — the
ai-engineering corpus (51 chunks) + its golden (`competency-geneval.json` ai-engineering
subset, 56 rows): **`cr` mean = 0.994** (`aieng-corpus-v2`). Retrieval + grounding on the
chunks surface is excellent. The v11 `cr≈0` was entirely the broken legacy set.

## Fix — adopt the matched ai-engineering set as the default chunks golden

- New `qc/chunks-queries.aieng.json` (56 ai-engineering rows, derived from
  `competency-geneval.json`, matched to `corpus/ai-engineering/`).
- `runBaseline.ts` `GOLDEN_FILES.chunks` default → `qc/chunks-queries.aieng.json`
  (`QC_CHUNKS_FILE` still overrides). Added to `validateGoldenSet.ts`.
- Fixed an R4 violation surfaced by validating the extracted set: 2 `no_answer` rows
  (`AI-LLM-0001-s7`, `AI-VEC-0001-s7`) carried a meta-statement in `must_contain_facts`;
  emptied (abstention is checked via the `[NO_ANSWER]` prefix / `refusal_correctness`).
  Fixed in the master `competency-geneval.json` too.
- **Legacy `qc/chunks-queries.json` is retained, NOT deleted** — `chunksRerankAbProbe.ts`
  and `noiseFloorChunksCpCr.ts` use it for retrieval/noise probes, where its
  `target_chunk_ids` are valid (only its gen-eval facts are stale).

## Verification

Default chunks baseline (no `QC_CHUNKS_FILE`), ai-engineering/rag slice, claim-eval
template: **`cr=1.00` on all 7 rows**, `cp` 0.50–1.00, faithfulness 0.75–1.00, 0 gen
errors — vs the old default's `cr≈0`. tsc clean; 1000/1000 unit suite.

## Known gap (belongs to DEFERRED-032, not 034)

The ai-engineering rows have **empty `target_chunk_ids`**, so retrieval `recall@k`/`MRR`
on the default chunks baseline are N/A (rows log "MISS"). Gen-eval `cp/cr/faithfulness/
answer_relevancy` ARE valid. Populating `target_chunk_ids` is DEFERRED-032's remaining
work. Also: run the ai-eng chunks set with `--synth-template claim-eval` for valid
faithfulness (the rows are T/F-claim tasks); `cr` is answer-independent so it's valid
regardless.

## Status

- **DEFERRED-034 → RESOLVED.** Root cause was a broken golden set, not retrieval; the
  pipeline is proven good (cr 0.994). The cp/cr levers it listed (rerank shipped;
  granularity/top-k/FTS) were chasing a phantom — no retrieval change was ever needed.
- **DEFERRED-032** absorbs the residual (more domains + `target_chunk_ids` for recall@k).
