# Phase 16 — Production-ready RAG (eval-first)

**Status:** CLARIFY (awaiting checkpoint)
**Owner:** main session
**Date:** 2026-05-23
**Size:** L (≥10 files across 3 sprints, new Docker service, new JSON schema field family, integration with `runBaseline.ts`)
**Mode:** default v2.2 (human checkpoint at CLARIFY end + POST-REVIEW end)

---

## 1. Goal

Push the RAG pipeline from "retrieval scores measured, generation un-measured" to "**generation faithfulness/relevance gated by automated LLM-as-judge**" so that downstream advanced techniques (RRF, semantic chunking, HyDE, query rewrite, reranker tuning) can be A/B'd against a real signal of answer quality — not just retrieval proxies.

Industry production targets (per 2026 RAG-eval consensus): `faithfulness > 0.9`, `answer_relevancy > 0.85`, `context_precision > 0.8`. These become the threshold gates on the new baseline diff.

## 2. Why now (motivation)

- **Retrieval is measured, generation is not.** Phase 12 shipped 127 golden queries with recall@k / MRR / nDCG / latency across 4 surfaces ([lessons 40 / code 67 / chunks 10 / global 10]). Generation is invisible: a retriever change that improves recall@5 by 5pp could still degrade answer faithfulness if the reranker pulls in distractors — and we'd never see it.
- **`JUDGE_AGENT_*` env was reserved for this.** `src/env.ts:262-265` declares `JUDGE_AGENT_BASE_URL/API_KEY/MODEL/TIMEOUT_MS` exactly for Phase 6+ eval loops. The wiring was deferred; this phase finishes it.
- **User-facing surfaces are uneval'd.** Chat sidebar, `qaAgent.ts`, `distiller.ts`, `documentLessonGenerator.ts` all call retriever → LLM → answer. Zero automated quality signal today.
- **Advanced techniques can't be tuned blind.** RRF/HyDE/semantic chunking are downstream candidates. Without gen-eval, each technique would A/B against retrieval metrics that may or may not translate to user-perceived quality.

## 3. Decisions locked (this CLARIFY)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Ragas as judge runtime** via Python sidecar (FastAPI + Docker) | User picked. Academic-validated prompts, fast initial build, isolation from TS stack. Cross-process latency acceptable for offline eval. |
| D2 | **Bootstrap dataset first**, harvest from `chat_history` later as DEFERRED-030 | Chat corpus today is 13 user msgs — too small to harvest meaningfully. Trigger condition: ≥200 user msgs. |
| D3 | **All 4 surfaces in scope** (~152 gen-eval rows: 127 existing + ~25 edge cases) | User picked thorough over fast. Code surface included for completeness even though synthesis matters less there. |
| D4 | **Judge model: `google/gemma-4-26b-a4b-it` via LM Studio** | User-validated locally, already loaded. MoE architecture (8/128 experts active per token, ~4B activated of 26B total) means inference runs at ~4B speed with ~26B quality — well-suited for nightly local eval. 256K context window — easily fits multi-chunk eval prompts. Released 2026-04-02. Free, no API key. Pinned in baseline manifest. |
| D5 | **Threshold gates as WARNINGS first**, not blocking, until 2 weeks of baseline data | Per industry practice — thresholds set in dev often fail in prod-distribution. Re-baseline after collecting real variance. **Concrete:** Sprint 16.3 ships with `warn` mode; flip to `block` in follow-up after data. |

## 4. Open questions (need answer before DESIGN)

### OPEN-Q1: Exact judge model id ✅ RESOLVED

User confirmed: **`google/gemma-4-26b-a4b-it`** (or the `-it-GGUF` quant variant Unsloth ships). MoE 8/128, 4B activated, 26B total, 256K context. Pin the LM Studio identifier exactly as it appears in `lms ls`; record both `judge.model_id` and `judge.quant` in baseline manifest if applicable.

**Sub-question still open:** when the user runs `lms ls`, is the model id literally `google/gemma-4-26b-a4b-it` or LM-Studio-prefixed (e.g. `lmstudio-community/...` or quant suffix `-Q5_K_M`)? Sprint 16.2 grabs the exact string from `lms ls` at build time and bakes it into a `JUDGE_MODEL` env default.

### OPEN-Q2: Generative pipeline — controlled or production-fidelity?

Two paths for "given a query, produce an answer to judge":

**Path A — Controlled (recommended for first pass):**
- Same retriever per surface (`search_lessons` for lesson queries, `search_document_chunks` for chunk queries, etc.)
- Single synthesizer prompt (templated, deterministic, pinned in baseline)
- Builder/Judge model invoked directly via OpenAI-compat client
- Pro: only one variable (retrieval) moves between baseline runs; faithful A/B for retrieval techniques
- Con: doesn't reflect chat sidebar's actual behavior (system prompt, multi-turn context, tool calls)

**Path B — Production-fidelity:**
- Call the actual `qaAgent.ts` / chat-sidebar endpoint
- Reflects real user experience
- Pro: catches end-to-end regressions
- Con: multiple variables move at once; hard to attribute regressions to retrieval vs prompt vs model

**Recommendation:** Path A in Sprint 16.3, Path B as follow-up sprint 16.5 (post-techniques). Path A is what most published RAG eval setups do.

### OPEN-Q3: Dataset storage — extend existing files or new files?

Two options:
- **Extend** `qc/queries.json`, `qc/lessons-queries.json`, etc. with new optional fields (`ideal_answer`, `must_contain_facts`, `forbidden_facts`, `answer_style`). Pro: single source of truth per surface. Con: bigger files, mixed retrieval-eval and gen-eval data.
- **New companion files**: `qc/queries.gen.json`, `qc/lessons-queries.gen.json`, etc., keyed by query `id`. Pro: clean separation, lets retrieval-only eval skip the gen file. Con: two files to keep in sync.

**Recommendation:** Extend existing files. The schema already supports optional fields, and downstream readers (runBaseline.ts) can branch on presence of `ideal_answer`. Keeps the golden set unified.

### OPEN-Q4: Edge-case taxonomy — which ~25 to add?

Suggested distribution of the ~25 hand-curated edge cases:
- **5 multi-hop** ("Which guardrails apply when adding a migration AND the project uses Redis?") — combines facts from 2+ sources
- **5 no-answer** ("What's the rate limit for the bulk-import endpoint?" when no such endpoint exists) — judge should give faithful "not in context"
- **5 contradictory-source** (two retrieved chunks disagree — does answer flag uncertainty?)
- **5 paraphrase-robustness** (same intent, different phrasings — answers should converge)
- **5 distractor-stress** (query has obvious lexical match to wrong doc — does answer still ground in right source?)

**Action:** Sprint 16.1 task list includes drafting these manually. Spec to be authored in 16.1 design.

## 5. Surface coverage map (decision context)

| Surface | Retrieval-eval rows | Gen-eval new rows | LLM in production loop? | Notes |
|---|---|---|---|---|
| lessons | 40 | 40 + 8 edge = 48 | Yes (chat sidebar, qaAgent) | Highest-value surface per CLAUDE.md |
| code | 67 | 67 + 10 edge = 77 | Partial (search returns refs, LLM synthesizes) | Generation matters less; ground-truth is file path, answer is usually "see file X" |
| chunks | 10 | 10 + 3 edge = 13 | Yes (document Q&A) | Small N, high value |
| global | 10 | 10 + 4 edge = 14 | Yes (Cmd+K search synthesis) | Cross-surface routing |
| **Total** | **127** | **~152** | | |

## 6. Out of scope (defer to Phase 17 or later)

- **Path B (production-fidelity eval):** wait until controlled-eval pipeline proves itself.
- **Real chat_history harvest:** DEFERRED-030, trigger ≥200 user msgs.
- **Advanced retrieval techniques** (RRF, HyDE, semantic chunking, query rewrite): Phase 17, each A/B'd against the new baseline.
- **Human review UI:** if needed for judge-score sanity checks, build later. For now, manual review of scored baseline JSON.
- **CI integration / PR gating:** Sprint 16.3 emits warnings; PR-blocking comes after 2 weeks of baseline data per D5.

## 7. Sprint plan (3 sprints, ~7 days total)

```
Sprint 16.1  Gen-eval dataset bootstrap          ~3 days
  - schema extension (GoldenQuery + GenEvalFields)
  - LLM-assisted ideal-answer drafting tool
  - human review pass (~70 min)
  - hand-curate ~25 edge cases per §4 OPEN-Q4

Sprint 16.2  Ragas judge sidecar                 ~2 days
  - services/ragas-judge/{main.py, Dockerfile, requirements.txt}
  - POST /score { question, answer, contexts[], ground_truth, metrics[] }
  - judge model pinning + manifest
  - docker-compose entry, healthcheck
  - TS client src/qc/judge.ts (retry, timeout, error mapping)
  - pytest smoke test against gemma-4-26b-a4b-it

Sprint 16.3  Wire judge into runBaseline         ~2 days
  - extend runBaseline.ts: gen pipeline for queries with ideal_answer
  - baseline JSON schema bump (1.0 -> 1.1, generation[] block)
  - scorecard.md additions (gen-metric tables, fail-list, thresholds in WARN mode)
  - diffBaselines.ts gen regression detection
  - npm scripts: qc:baseline:gen + qc:baseline (combined)
```

## 8. Acceptance criteria

| AC | Description | Measured by |
|---|---|---|
| AC1 | ~152 gen-eval rows committed across 4 surfaces with `ideal_answer` populated | validator counts ≥ 150 rows with `ideal_answer` (152 target; small tolerance) |
| AC2 | Ragas sidecar runs via `docker compose up ragas-judge` and serves `/health` 200 | curl localhost:<port>/health |
| AC3 | `npm run qc:baseline:gen --tag phase-16-baseline` emits valid baseline JSON with `generation` block per query | JSON schema v1.1 validates |
| AC4 | Baseline diff catches a deliberately-introduced regression (e.g. swap retriever to one that returns random chunks) — faithfulness drops, reported in WARN | manual injection test |
| AC5 | Scorecard.md aggregates: per-surface mean ± std for each metric, fail-list at threshold | rendered output reviewed |
| AC6 | Judge model + version + pinned-prompts-hash recorded in baseline JSON so historical diffs stay comparable | `baseline.judge.model_id` + `judge.prompts_hash` fields present |
| AC7 | DEFERRED-030 (chat_history harvest) written to DEFERRED.md with trigger condition | grep DEFERRED-030 docs/deferred/DEFERRED.md |

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Local judge slow** | Gemma-4-26B-A4B's MoE architecture (4B active) makes it ~3-5× faster than a dense 26B — expect ~2-5s/call. At ~152 rows × 4 metrics ≈ 650 judgments × 3s ≈ ~30 min per baseline. Run nightly, not per-PR. Add `--concurrency` flag (MoE handles batched requests well). Cache by `(question, answer, contexts)` hash in Redis. |
| **Judge model drift** (LM Studio user swaps model between runs) | Pin model ID in baseline manifest; reject diff if pin mismatches; require explicit `--judge-override` flag to compare across judges. |
| **Drafted ideal_answers are wrong** (LLM bootstraps incorrectly, human-reviewer misses) | Two-pass review: drafting model ≠ judging model; human review captures dissent. Reviewer notes column added to schema. |
| **Threshold gating false-positives** | D5: WARN mode for 2 weeks before BLOCK. Re-baseline thresholds against observed variance. |
| **Code-surface gen-eval is noise** (answers are "see file X", judge can't score meaningfully) | Per §5: lower-priority for code surface; if scores are uniformly low, accept and reweight aggregates. Document in scorecard. |
| **Ragas version churn** (ragas evolves fast, metric definitions change) | Pin ragas version in `services/ragas-judge/requirements.txt`. Document upgrade procedure (re-baseline after upgrade). |

## 10. Dependencies & prerequisites

- LM Studio running with `google/gemma-4-26b-a4b-it` loaded at `http://localhost:1234` (host `host.docker.internal:1234` from ragas-judge container)
- Python 3.11+ in ragas-judge container
- `docker-compose.yml` extensible (it is)
- Free port for ragas-judge service (suggest `:3005`)
- Tests: existing `npm test` infra (vitest) for TS client

## 11. Files expected to change

```
NEW:
  services/ragas-judge/main.py
  services/ragas-judge/requirements.txt
  services/ragas-judge/Dockerfile
  services/ragas-judge/tests/test_score.py
  src/qc/judge.ts                                    # TS HTTP client
  src/qc/genEvalTypes.ts                             # generation schema additions
  src/qc/genEvalDraft.ts                             # bootstrap drafting tool
  qc/edge-cases.gen.json                             # ~25 hand-curated rows (or inline in existing files)
  docs/specs/2026-05-23-phase-16-rag-production-design.md   # Phase 2 DESIGN doc
  docs/plans/2026-05-23-phase-16-rag-production-plan.md     # Phase 4 PLAN doc

MODIFIED:
  src/qc/goldenTypes.ts                              # extend GoldenQuery w/ gen fields
  src/qc/runBaseline.ts                              # generative pipeline branch
  src/qc/diffBaselines.ts                            # gen regression detection
  src/qc/metrics.ts                                  # gen aggregates
  src/env.ts                                         # RAGAS_JUDGE_URL, JUDGE_PROMPTS_HASH (if not present)
  qc/queries.json                                    # add ideal_answer per query
  qc/lessons-queries.json
  qc/chunks-queries.json
  qc/global-queries.json
  docker-compose.yml                                 # ragas-judge service
  package.json                                       # qc:baseline:gen script
  docs/deferred/DEFERRED.md                          # add DEFERRED-030
  CLAUDE.md                                          # Phase 16 row in development phases table (after sprint complete)
  WHITEPAPER.md                                      # gen-eval addition (RETRO phase)
```

## 12. Checkpoint requested

Before moving to Phase 2 DESIGN, confirm:

1. **OPEN-Q1**: exact judge model id (e.g. `gemma-3-27b-it` or specific quant)?
2. **OPEN-Q2**: path A (controlled pipeline) for first pass, path B as follow-up — OK?
3. **OPEN-Q3**: extend existing `qc/*.json` files vs new companion `.gen.json` files — OK with extend?
4. **OPEN-Q4**: edge-case taxonomy distribution (5 each × 5 categories) — OK?
5. **D5**: ship Sprint 16.3 with WARN gating, flip to BLOCK after 2 weeks data — OK?
6. **Out of scope**: production-fidelity eval (Path B), CI integration, chat_history harvest — OK to defer?

Anything to add/remove from the sprint plan before I write the DESIGN doc?
