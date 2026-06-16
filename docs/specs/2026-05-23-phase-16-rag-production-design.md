# Phase 16 — Production-ready RAG: DESIGN

**Status:** DESIGN (awaiting review)
**Phase:** 2 of 12 (default v2.2 workflow)
**Date:** 2026-05-23
**Predecessor:** [2026-05-23-phase-16-rag-production-clarify.md](./2026-05-23-phase-16-rag-production-clarify.md)

---

## 0. Scope & decisions inherited from CLARIFY

| Ref | Decision | Status |
|---|---|---|
| D1 | Ragas sidecar (Python FastAPI in Docker) | locked |
| D2 | Bootstrap dataset first; chat-harvest as DEFERRED-030 | locked |
| D3 | All 4 surfaces, ~152 gen-eval rows (127 retrieval + 25 edge) | locked |
| D4 | Judge model: `google/gemma-4-26b-a4b-it` via LM Studio | locked |
| D5 | Threshold gates WARN-only for 2 weeks | locked |
| Q2 | Generative pipeline path: **A (controlled)** — same retriever + pinned synthesizer prompt + JUDGE_AGENT LLM as answerer | resolved |
| Q3 | Storage: **extend existing `qc/*.json`** (single source of truth) | resolved |
| Q4 | Edge-case taxonomy: **5 each × 5 categories** (multi-hop / no-answer / contradictory / paraphrase / distractor) | resolved |

---

## 1. Data flow (the new pipeline end-to-end)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    runBaseline.ts --tag phase-16-baseline           │
│                                                                     │
│  For each query in qc/<surface>-queries.json:                       │
│                                                                     │
│  ┌────────────────────┐                                             │
│  │ 1. Retrieval        │  callLessons / callCode / callChunks /     │
│  │    (existing path)  │  callGlobal → ranked hits[]                │
│  └─────────┬──────────┘                                             │
│            │ recall@k, MRR, nDCG (existing metrics)                 │
│            ▼                                                        │
│  ┌────────────────────┐                                             │
│  │ 2. IF query has     │  hits[] + question + synthesizer prompt    │
│  │    ideal_answer:    │       │                                    │
│  │    Generation       │       ▼                                    │
│  │    (NEW)            │  ANSWERER_AGENT (LM Studio :1234)          │
│  │                     │       │                                    │
│  │                     │       ▼                                    │
│  │                     │  generated_answer: string                  │
│  └─────────┬──────────┘                                             │
│            │                                                        │
│            ▼                                                        │
│  ┌────────────────────┐                                             │
│  │ 3. Judge            │  POST http://ragas-judge:8000/score        │
│  │    (NEW)            │  { question, answer, contexts[], gt }      │
│  │                     │       │                                    │
│  │                     │       ▼                                    │
│  │                     │  ragas (Gemma-4-26B-A4B as judge LLM)      │
│  │                     │       │                                    │
│  │                     │       ▼                                    │
│  │                     │  { faithfulness, answer_relevancy,         │
│  │                     │    context_precision, context_recall,      │
│  │                     │    noise_sensitivity? }                    │
│  └─────────┬──────────┘                                             │
│            ▼                                                        │
│  4. Aggregate + write baseline JSON v1.1:                           │
│     docs/qc/baselines/2026-05-23-phase-16-baseline.json             │
│     docs/qc/baselines/2026-05-23-phase-16-baseline.md (scorecard)   │
│                                                                     │
│  5. diffBaselines.ts vs prior tag → WARN on regression              │
└─────────────────────────────────────────────────────────────────────┘
```

**Key separation:** the **ragas-judge** container holds the judge prompts + ragas library; the **main MCP/API stack** holds the retriever + the answerer (ANSWERER_AGENT). Two distinct LLM roles, both can point at the same LM Studio in dev (one container = one LLM instance is fine since calls are sequential).

---

## 2. Schema: GoldenQuery extension

Extend [src/qc/goldenTypes.ts](src/qc/goldenTypes.ts) — new optional fields, backward-compatible.

### 2.1 Additions to `GoldenQuery`

```ts
export type GoldenQuery = {
  // ... existing fields (id, group, query, target_files, must_keywords, etc.)

  // NEW: gen-eval fields (all optional; if `ideal_answer` is absent, query is
  // retrieval-only and gen-eval is skipped)
  ideal_answer?: string;                    // canonical reference answer
  must_contain_facts?: string[];            // factual atoms the answer MUST cover
  forbidden_facts?: string[];               // anti-facts the answer MUST NOT assert
  answer_style?: 'concise' | 'detailed' | 'list' | 'code'; // synthesizer hint
  answer_category?: AnswerCategory;         // taxonomy for edge cases (see §2.3)

  // NEW: drafting metadata (kept for traceability, never used at scoring time)
  drafted_by?: 'llm' | 'human';             // bootstrap pass marks 'llm', edge cases 'human'
  drafted_at?: string;                      // ISO-8601
  reviewed_by?: string;                     // user/email of human reviewer
  reviewer_notes?: string;                  // free-form
};

export type AnswerCategory =
  | 'standard'           // ~127 bootstrap rows
  | 'multi_hop'          // requires combining 2+ sources
  | 'no_answer'          // intentional gap; correct answer = "not in context"
  | 'contradictory'      // sources disagree; answer should flag uncertainty
  | 'paraphrase'         // intent-matches an existing query, different phrasing
  | 'distractor';        // lexical match to wrong source; tests grounding
```

### 2.2 Schema invariants (validated at load time in `runBaseline.ts`)

| Invariant | Check |
|---|---|
| If `ideal_answer` set, `must_contain_facts` MUST have ≥1 entry (except `no_answer` category) | runtime assert in `loadGoldenSet()` |
| `no_answer` category: `ideal_answer` MUST start with prefix `[NO_ANSWER]` and contain no facts | runtime assert |
| `forbidden_facts` only meaningful when `ideal_answer` set | warning if mismatch |
| `answer_category` MUST be set when `ideal_answer` is set | runtime assert |
| `drafted_by='llm'` rows MUST have `reviewed_by` set before sprint-16.1 ships | sprint AC |

### 2.3 Edge-case taxonomy (§4 OPEN-Q4 resolved here, 25 rows total)

Authored manually in Sprint 16.1; spec'd here for review. Per-surface targets aligned to **CLARIFY §5 surface coverage map** (lessons 8 / code 10 / chunks 3 / global 4).

**Rebalanced distribution (post REVIEW-DESIGN BLOCK-3):**

| Category | N | Lessons | Code | Chunks | Global | Description | Example |
|---|---|---|---|---|---|---|---|
| `multi_hop` | 5 | 2 | 1 | 1 | 1 | Combine facts from ≥2 sources | "Which guardrails apply when adding a migration AND the project uses Redis?" |
| `no_answer` | 5 | 1 | 2 | 1 | 1 | No matching source exists | "What's the rate limit for the bulk-import endpoint?" (no such endpoint) |
| `contradictory` | 5 | 2 | 2 | 0 | 1 | Sources disagree | (two lessons with different "default port" advice) |
| `paraphrase` | 5 | 2 | 2 | 0 | 1 | Same intent, rephrased | "stale data after pushing schema" vs "Redis cache after migration" |
| `distractor` | 5 | 1 | 3 | 1 | 0 | Lexical match to wrong target | "auth flow" lexically matches lessons-about-chat-auth, not actual auth code |
| **Total** | **25** | **8** | **10** | **3** | **4** | matches CLARIFY §5 | |

**Rationale for per-surface weighting** (now consistent with CLARIFY):
- **Code (10 edge):** distractor-stress and paraphrase-robustness matter most here — code retrieval is strong baseline, edge cases test the weak spots
- **Lessons (8 edge):** balanced across categories; lessons are the highest-value gen-eval surface
- **Chunks (3 edge):** smallest set; one multi_hop + one no_answer + one distractor to cover the broadest categories
- **Global (4 edge):** one of each except distractor (global router rarely sees pure lexical distractors after merging surfaces)

**Acceptance:** all 25 edge-case rows have `drafted_by='human'` + `reviewed_by` populated before 16.1 ships. Per-surface counts match this table exactly (validated by `npm run qc:validate-golden` in Sprint 16.1).

---

## 3. Baseline JSON schema v1.1

[runBaseline.ts](src/qc/runBaseline.ts) currently emits schema v1.0. Bump to v1.1 — additive, v1.0 readers can still parse via field-presence checks.

### 3.1 Top-level additions

```jsonc
{
  "schema_version": "1.1",                  // was "1.0"
  "tag": "phase-16-baseline",
  "started_at": "2026-05-24T08:00:00Z",
  "finished_at": "2026-05-24T08:32:00Z",

  // NEW: judge config snapshot — pinned per-run so historical diffs stay valid
  "judge": {
    "endpoint": "http://ragas-judge:8000",
    "model_id": "google/gemma-4-26b-a4b-it",
    "model_quant": "Q5_K_M",                // from `lms ls` at run time
    "ragas_version": "0.2.x",               // pinned in requirements.txt
    "prompts_hash": "<sha256 of compiled ragas prompts at startup>",
    "synthesizer_model_id": "google/gemma-4-26b-a4b-it",  // same instance; could split
    "synthesizer_temperature": 0.0,
    "synthesizer_max_tokens": 1024,
    "synthesizer_prompt_hash": "<sha256 of templates/synthesizer.txt>"
  },

  // NEW: threshold config used for WARN/BLOCK decisions
  "thresholds": {
    "mode": "warn",                         // "warn" | "block" (D5: warn first)
    "faithfulness_min": 0.90,
    "answer_relevancy_min": 0.85,
    "context_precision_min": 0.80,
    "context_recall_min": 0.75,
    "regression_pct_max": 0.05              // any metric dropping >5% vs prior tag
  },

  "surfaces": { /* existing per-surface aggregates, extended below */ }
}
```

### 3.2 Per-surface aggregate additions

```jsonc
"surfaces": {
  "lessons": {
    "retrieval": {                          // EXISTING (renamed for clarity)
      "recall_at_5": 0.92,
      "mrr": 0.78,
      // ... existing fields
    },
    // NEW
    "generation": {
      "rows_with_gt": 48,                   // queries that had ideal_answer
      "rows_judged": 48,                    // successfully judged (no judge errors)
      "rows_skipped": 0,
      "metrics": {
        "faithfulness":         { "mean": 0.91, "std": 0.07, "p10": 0.82, "fail_count": 3 },
        "answer_relevancy":     { "mean": 0.87, "std": 0.09, "p10": 0.74, "fail_count": 4 },
        "context_precision":    { "mean": 0.83, "std": 0.11, "p10": 0.68, "fail_count": 6 },
        "context_recall":       { "mean": 0.78, "std": 0.14, "p10": 0.60, "fail_count": 8 }
      },
      "by_category": {
        "standard":      { "n": 40, "faithfulness_mean": 0.93, ... },
        "multi_hop":     { "n": 2,  "faithfulness_mean": 0.78, ... },
        "no_answer":     { "n": 2,  "faithfulness_mean": 0.95, ... },
        "contradictory": { "n": 3,  "faithfulness_mean": 0.81, ... },
        "paraphrase":    { "n": 0,  ... },
        "distractor":    { "n": 1,  ... }
      }
    }
  },
  // ... other surfaces
}
```

### 3.3 Per-query rows (existing array gets new fields)

```jsonc
"queries": [
  {
    "id": "auth-workspace-token-validate",
    "surface": "code",
    "retrieval": { /* existing */ },
    // NEW: only present when ideal_answer was set
    "generation": {
      "generated_answer": "<full LLM output, kept for replay/debug>",
      "contexts_used": [
        { "source": "src/index.ts", "snippet_id": "...", "char_count": 1240 }
      ],
      "judge_call_ms": 2840,
      "metrics": {
        "faithfulness":      0.94,
        "answer_relevancy":  0.88,
        "context_precision": 0.82,
        "context_recall":    0.79
      },
      "judge_reasons": {
        "faithfulness": "All 4 claims supported by retrieved context.",
        "answer_relevancy": "Answer addresses question; minor digression on workspace_token history."
      },
      "fail_reasons": []                    // ["faithfulness<0.90"] when below threshold
    }
  }
]
```

---

## 4. Ragas judge sidecar API contract

### 4.1 Service definition

| Property | Value |
|---|---|
| Service name | `ragas-judge` |
| Container | `services/ragas-judge/` (new) |
| Port | `8000` internal, `3005` host (exposed for direct debug) |
| Base image | `python:3.11-slim` |
| Dependencies | `ragas==0.2.x`, `fastapi`, `uvicorn`, `httpx`, `pydantic`, `openai` (for OpenAI-compatible judge calls) |
| LLM endpoint (judge) | `http://host.docker.internal:1234/v1` (LM Studio); overridable via `JUDGE_AGENT_BASE_URL` |
| Healthcheck | `GET /health` → `{ "status": "ok", "ragas_version": "...", "judge_model": "..." }` |
| Boot time | ≤10s (no model load on container start; LLM stays in LM Studio) |

### 4.2 POST /score

**Request:**
```jsonc
{
  "request_id": "phase-16-baseline-row-042",   // for logging / cache key
  "question": "How does the system find test files for a function?",
  "answer": "The tiered search uses a relationship profile when kind='test'...",
  "contexts": [
    { "id": "lesson-7c2", "text": "..." },     // ordered, top-K from retrieval
    { "id": "lesson-a1f", "text": "..." }
  ],
  "ground_truth": "Three search profiles exist...",   // = ideal_answer; optional
  "metrics": [
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall"
  ],
  "options": {
    "include_reasons": true,                    // judge's natural-language reasoning per metric
    "temperature": 0.0,                         // override judge temp; default 0.0
    "cache_key": "<sha256 of (question||answer||contexts)>"  // opt-in dedup
  }
}
```

**Response (success):**
```jsonc
{
  "request_id": "phase-16-baseline-row-042",
  "scores": {
    "faithfulness":      0.94,
    "answer_relevancy":  0.88,
    "context_precision": 0.82,
    "context_recall":    0.79
  },
  "reasons": {
    "faithfulness":      "All claims supported.",
    "answer_relevancy":  "Directly addresses question.",
    "context_precision": "Top 2 of 3 contexts relevant.",
    "context_recall":    "Ground-truth mentions 3 profiles; answer mentions 2."
  },
  "judge_call_count": 4,                       // ragas issues N calls per metric set
  "judge_latency_ms": 2840,
  "cache_hit": false
}
```

**Response (partial / errors):**
```jsonc
{
  "request_id": "phase-16-baseline-row-042",
  "scores": { "faithfulness": 0.94, "answer_relevancy": null },
  "errors": [
    { "metric": "answer_relevancy", "error": "judge_timeout", "detail": "..." }
  ],
  "judge_call_count": 3,
  "judge_latency_ms": 12500
}
```

### 4.3 Error model

| Status | Code | When |
|---|---|---|
| 200 | OK | All requested metrics scored |
| 200 | partial | Some metrics scored, some errored (per-metric error array) |
| 400 | invalid_request | Schema validation fails |
| 422 | empty_contexts | `contexts` empty AND `context_precision`/`context_recall` requested |
| 503 | judge_unreachable | LM Studio not responding after retries (3× 5s backoff) |
| 504 | judge_timeout | Single metric exceeded 60s |
| 500 | internal | Unexpected (logged with traceback) |

### 4.4 Health endpoint

```
GET /health
→ 200 { "status": "ok", "ragas_version": "0.2.x",
        "judge_endpoint": "http://host.docker.internal:1234/v1",
        "judge_model_resolved": "google/gemma-4-26b-a4b-it",
        "prompts_hash": "<sha256>" }
```

When LM Studio is unreachable: 503 with `"judge_endpoint_reachable": false`.

### 4.5 Caching

- Optional: in-memory LRU on `cache_key` (1024 entries default). Survives container lifetime only.
- Redis cache is **not** added in 16.2 — keep the sidecar stateless. Caching is a 16.3 concern via Redis at the runBaseline.ts level (the harness owns the cache).

### 4.6 Per-category metric selection (BLOCK-2 from REVIEW-DESIGN)

Standard ragas metrics (`faithfulness`, `answer_relevancy`) are designed for queries that *have* an answer in the context. They behave pathologically on `no_answer` rows: a correct refusal makes zero claims (faithfulness → undefined/trivial 1.0) and doesn't address the question literally (answer_relevancy → low score, false negative).

**Solution:** the sidecar implements **category-aware metric routing** server-side:

```python
# services/ragas-judge/main.py — pseudo
def metrics_for_category(category: str, requested: list[str]) -> dict:
    if category == "no_answer":
        # Skip faithfulness/answer_relevancy — replace with refusal_correctness
        return {
            "metrics": ["refusal_correctness", "context_recall"],  # context_recall still meaningful
            "skipped": ["faithfulness", "answer_relevancy"],
            "skip_reason": "no_answer category: standard metrics undefined on refusal"
        }
    return { "metrics": requested, "skipped": [], "skip_reason": None }
```

**Custom metric `refusal_correctness`** (sidecar implements; not in ragas):

```
Given:
  question:     Q
  answer:       A (LLM output)
  contexts:     C[]  (retrieved chunks)
  ground_truth: "[NO_ANSWER] <human-written explanation of why no answer exists>"

Judge LLM is asked (single call):
  "The ground truth indicates this question has no answer in the provided contexts.
   Evaluate the given answer A on two binary axes:

   1. EXPRESSES_INABILITY:
      Does A acknowledge that it cannot answer / lacks the info / says 'not in context'?
      (1 = yes, 0 = no)

   2. ABSTAINS_FROM_FABRICATION:
      Does A avoid asserting facts not supported by C?
      (1 = yes, 0 = no — answer makes up content)

   Return JSON: { 'expresses_inability': 0|1, 'abstains_from_fabrication': 0|1 }"

Score = (expresses_inability + abstains_from_fabrication) / 2
```

Contract additions in §4.2 request:
- `query.answer_category` is passed in the request (new field): `"standard" | "multi_hop" | "no_answer" | "contradictory" | "paraphrase" | "distractor"`
- Sidecar uses it for metric selection
- Response `scores` block reflects actually-evaluated metrics; `skipped` list documents what was skipped and why

For `contradictory` category, standard metrics work but we **add** a custom `uncertainty_flagged` metric (binary: does answer acknowledge source disagreement?). Sprint 16.2 includes this as a stretch goal.

For `standard | multi_hop | paraphrase | distractor` categories, use the full standard metric set unchanged.

---

## 5. Generation pipeline (Path A: controlled)

### 5.1 Where it lives

New module: `src/qc/genPipeline.ts`. Called by `runBaseline.ts` after retrieval, before judge.

### 5.2 Inputs / outputs

```ts
export type GenPipelineInput = {
  query: GoldenQuery;
  retrievalHits: SurfaceResult;             // existing type from surfaces.ts
  surface: Surface;
  config: {
    answererModel: string;                   // pinned from manifest
    answererBaseUrl: string;                 // ANSWERER_BASE_URL env
    temperature: 0.0;                        // deterministic
    maxTokens: 1024;
    topK: number;                            // how many retrieval hits to feed in
    promptTemplate: string;                  // loaded from src/qc/templates/synthesizer.<surface>.txt
  };
};

export type GenPipelineOutput = {
  generated_answer: string;
  contexts_used: Array<{ source: string; id?: string; snippet?: string; char_count: number }>;
  prompt_used: string;                       // full prompt sent to LLM (for replay)
  llm_call_ms: number;
};
```

### 5.3 Synthesizer prompt templates (one per surface)

Stored in `src/qc/templates/`:
- `synthesizer.lessons.txt`
- `synthesizer.code.txt`
- `synthesizer.chunks.txt`
- `synthesizer.global.txt`

Each template is **pinned by hash** in the baseline manifest (§3.1: `synthesizer_prompt_hash`). Changes to the template invalidate prior baselines (intentionally).

Template skeleton (lessons example):
```
You are answering a user question using only the lessons provided below.
Stay grounded in the lesson content — do NOT invent facts not present.
If the lessons don't contain enough information, say so explicitly.

QUESTION:
{question}

LESSONS:
{numbered_lesson_list}

ANSWER:
- Style: {answer_style or "concise"}
- Be specific about which lesson(s) support each claim.
```

### 5.4 Determinism

- temperature=0.0
- top_p=1.0
- seed=42 (LM Studio supports the OpenAI-compat `seed` param on Gemma 4)
- max_tokens=1024 (per-surface overridable)

Same `(question, contexts, prompt_hash, model_id)` MUST yield the same answer across runs. This is required for fair A/B of retrieval changes — if the answer is non-deterministic, judge variance gets attributed to retrieval.

### 5.5 Failure modes

| Mode | Handling |
|---|---|
| LLM returns empty answer | Mark row `generation.error = "empty_answer"`, skip judge, fail row |
| LLM exceeds context window | Per-surface topK is tuned in 16.1 (typical 5 hits × ~500 tokens = ~2.5K well under 256K Gemma context) |
| LLM timeout (>30s) | Retry once; if still fails, mark row as judge-skip |
| Retrieval returns zero hits | Generate "[NO_CONTEXT_AVAILABLE]" answer; judge sees this; useful for `no_answer` category |

---

## 6. runBaseline.ts integration contract

### 6.1 New CLI flags

```bash
npx tsx src/qc/runBaseline.ts \
  --tag phase-16-baseline \
  --gen-eval [auto|on|off]                  # default 'auto' — runs when ideal_answer present
  --judge-url http://localhost:3005         # default from RAGAS_JUDGE_URL env
  --answerer-model "google/gemma-4-26b-a4b-it" \
  --concurrency 4 \                         # parallel judge calls
  --no-judge-cache                          # disable Redis cache for judge results
```

New npm scripts in `package.json`:
- `qc:baseline:gen` → runs full pipeline (retrieval + gen + judge)
- `qc:baseline` → retrieval-only (existing behavior; explicit `--gen-eval=off`)
- `qc:baseline:retrieval` → alias of above for clarity

### 6.2 Execution sequence (per query)

```
for each query in goldenSet.queries:
  retrievalHits = runRetrieval(query, surface)
  computeRetrievalMetrics(retrievalHits, query.target_*)

  if query.ideal_answer is None:
    continue                                  # retrieval-only row

  # Synthesizer cache key (NEW — was missing in rev 1)
  synth_cache_key = sha256(
      query.query
      || canonicalize(retrievalHits)         # ordered list of (source, id, snippet)
      || config.synthesizer_prompt_hash
      || config.answerer_model_id
      || config.answerer_seed
      || config.answerer_temperature
  )

  if cache.has(synth_cache_key):
    genResult = cache.get(synth_cache_key)
  else:
    genResult = genPipeline(query, retrievalHits, config)
    cache.set(synth_cache_key, genResult)

  # Judge cache key (matches §6.4 — single canonical form)
  judge_cache_key = sha256(
      query.query
      || genResult.generated_answer
      || canonicalize(genResult.contexts_used)
      || query.ideal_answer                  # required for context_recall, gt-dependent
      || judge.model_id
      || judge.prompts_hash
      || metricSet                           # which metrics requested
  )

  if cache.has(judge_cache_key):
    judgeResult = cache.get(judge_cache_key)
  else:
    judgeResult = await judge.score({
      question:     query.query,
      answer:       genResult.generated_answer,
      contexts:     genResult.contexts_used,
      ground_truth: query.ideal_answer,
      metrics:      metricSelector(query.answer_category)  # see §6.5 below
    })
    cache.set(judge_cache_key, judgeResult)

  attachToBaseline(query.id, genResult, judgeResult)
  checkThresholds(judgeResult, baselineThresholds) → WARN/PASS

writeBaselineJson()
writeScorecard()
```

**Critical:** both cache keys include the runtime artifacts (`retrievalHits` for synth, `generated_answer`+`contexts` for judge), NOT just static row identifiers. This is what makes retrieval A/B'ing work — when the retriever changes, `retrievalHits` changes → synth cache misses → new answer generated → judge cache misses → new score. (BLOCK-1 from REVIEW-DESIGN.)

### 6.3 Concurrency

- Default `--concurrency 4` — 4 parallel judge HTTP calls. LM Studio handles batched MoE inference well; tested ceiling adjusted in 16.3 based on observed latency.
- Retrieval is sequential per surface (existing behavior; surfaces serve from shared MCP client).
- Judge calls are per-query independent → parallelize freely.

### 6.4 Cache layer (Sprint 16.3)

- Redis key: `qc:judge:v1:<sha256(question||answer||contexts||judge.model_id||judge.prompts_hash)>`
- TTL: 7 days (long, since baseline manifests pin everything)
- Bypass with `--no-judge-cache`
- Cache invalidates automatically on judge model change (model_id is in the key)

---

## 7. diffBaselines.ts updates

### 7.1 New regression checks

For each surface × metric pair in `generation.metrics`:
- **Absolute fail:** `current.mean < threshold` → emit WARN (D5: not BLOCK in 16.3)
- **Regression:** `current.mean < prior.mean × (1 - regression_pct_max)` → emit WARN
- **Per-category regression:** same checks on `by_category` block — catches "no_answer faithfulness dropped" even when aggregate masks it
- **Coverage drop:** `rows_judged < prior.rows_judged - 5` → emit WARN (suggests judge errors or data corruption)

### 7.2 Diff scorecard sections

Existing diff scorecard gets new tables:
1. **Generation summary** — per-surface/per-metric Δ vs prior tag
2. **Threshold violations** — list of (surface, metric, value, threshold)
3. **Regressions** — list of (surface, metric, prior, current, Δ%)
4. **Per-category drift** — table per category × surface × metric

### 7.3 Exit codes

| Code | Meaning |
|---|---|
| 0 | All checks pass |
| 1 | WARN-mode violations present (continues, emits warnings to stderr + scorecard) |
| 2 | BLOCK-mode violations (only after D5 flip; not reachable in 16.3) |
| 3 | Diff infra error (missing prior, schema mismatch) |

---

## 8. File layout (final)

```
NEW files:
  services/ragas-judge/
    Dockerfile
    requirements.txt          # ragas==0.2.x, fastapi, uvicorn, httpx, pydantic, openai
    main.py                   # FastAPI app, /score, /health
    prompts.py                # ragas metric prompt loader (computes prompts_hash)
    config.py                 # env: JUDGE_AGENT_BASE_URL, JUDGE_AGENT_MODEL, ...
    tests/test_score.py       # pytest: schema validation, mock-LLM smoke, partial-error
  src/qc/
    judge.ts                  # TS HTTP client (typed, retries, error mapping)
    genPipeline.ts            # synthesizer pipeline (Path A)
    genEvalTypes.ts           # GenEvalScore, JudgeResult, GenPipelineInput/Output
    templates/
      synthesizer.lessons.txt
      synthesizer.code.txt
      synthesizer.chunks.txt
      synthesizer.global.txt
    genEvalDraft.ts           # Sprint 16.1 drafting tool
  qc/
    edge-cases.gen.json       # 25 hand-curated rows (separate file for review focus)
  docs/specs/
    2026-05-23-phase-16-rag-production-plan.md   # Phase 4 PLAN doc

MODIFIED files:
  src/qc/goldenTypes.ts       # +ideal_answer, +must_contain_facts, +forbidden_facts, +answer_style, +answer_category, +drafted_by, +drafted_at, +reviewed_by, +reviewer_notes
  src/qc/runBaseline.ts       # gen-eval branch, judge integration, schema v1.1
  src/qc/diffBaselines.ts     # gen regression detection
  src/qc/metrics.ts           # GenAggregate type + helpers (mean/std/p10/fail_count, by_category breakdown)
  src/env.ts                  # +RAGAS_JUDGE_URL, +RAGAS_JUDGE_TIMEOUT_MS, +ANSWERER_AGENT_BASE_URL/MODEL (alias to JUDGE_* if unset)
  qc/queries.json             # +ideal_answer per row (Sprint 16.1)
  qc/lessons-queries.json
  qc/chunks-queries.json
  qc/global-queries.json
  docker-compose.yml          # +ragas-judge service block
  package.json                # +qc:baseline:gen, qc:baseline:retrieval scripts
  docs/deferred/DEFERRED.md   # +DEFERRED-030 (chat_history harvest)
```

Total new files: 13. Modified: 10. Total touch: 23. Confirms size L from CLARIFY.

---

## 9. Sequencing & state transitions

### 9.1 Sprint dependencies

```
16.1 (dataset) ── independent ──┐
                                │
16.2 (sidecar) ── independent ──┼──► 16.3 (wire)
                                │
                                └── 16.1 + 16.2 needed for 16.3
```

Sprints 16.1 and 16.2 can be developed in parallel if desired (no shared files except ANSWERER prompt templates). For this session: sequential to maintain single-track focus.

### 9.2 Per-sprint workflow phase coverage

Each sprint runs the v2.2 12-phase workflow independently:
- 16.1: CLARIFY (light, inherits this DESIGN) → DESIGN-light → REVIEW-DESIGN → PLAN → BUILD → VERIFY → REVIEW-CODE → QC → POST-REVIEW → SESSION → COMMIT → RETRO
- 16.2: same
- 16.3: same; gets cross-sprint integration testing

---

## 10. Open risks (post REVIEW-DESIGN)

### Resolved in DESIGN rev 2 (were BLOCKs in REVIEW-DESIGN)
- ✅ **BLOCK-1: Cache key inconsistency** → §6.2 cache key rewritten to include `retrievalHits` + `generated_answer` (runtime artifacts, not just static row id)
- ✅ **BLOCK-2: `no_answer` rows broke ragas semantics** → §4.6 adds per-category metric routing + custom `refusal_correctness` metric implemented in sidecar
- ✅ **BLOCK-3: Edge-case distribution contradicted CLARIFY** → §2.3 rebalanced to match CLARIFY §5 surface coverage

### Carried into BUILD phase as risks-to-validate

| ID | Risk | Mitigation (where applied) |
|---|---|---|
| **R1** | Gemma-4 MoE determinism unproven (seed+temp=0 → byte-identical?) | Sprint 16.2 includes a 5× determinism check; if fails, pin answers in dataset itself (treat as part of golden set) |
| **R2** | LM Studio concurrency: synthesizer + 4-metric judge × `--concurrency 4` = up to 20 in-flight LLM calls | Default `--concurrency 1` for local; document `--concurrency 4+` only when judge endpoint is multi-instance; benchmark in 16.2 |
| **R3** | Schema invariants only enforced at `loadGoldenSet()` (16.3) — 16.1 dataset could ship typo'd | Sprint 16.1 includes standalone `npm run qc:validate-golden` script + pre-commit hook |
| **R4** | `regression_pct_max: 0.05` ambiguous (relative vs absolute pp) | §3.1 explicit: `regression_pct_max` is *relative*; add `regression_pp_max` for absolute pp gates as separate field; clarify in scorecard output |
| R5 | Judge prompts drift across ragas versions | `judge.prompts_hash` recorded per baseline; upgrade procedure documented in Sprint 16.2; cross-version diffs require explicit `--allow-cross-version` |
| R6 | Edge case curation cost — 25 hand-curated rows underestimated | Budget 8 hr (was 4 hr) for Sprint 16.1 edge-case authoring; track actual in SESSION_PATCH |
| R7 | Schema v1.1 forward-compat — diff vs older v1.0 baselines | `diffBaselines.ts` includes explicit version-bridge: v1.0 baseline diffed against v1.1 generates "retrieval-only" comparison, skips gen-metric blocks |
| R8 | `contradictory` category lacks custom metric | Sprint 16.2 stretch: implement `uncertainty_flagged` metric (binary: does answer acknowledge source disagreement?). Falls back to standard metrics if not implemented. |

---

## 11. Acceptance criteria for DESIGN review (Phase 3)

Reviewer (cold-start, file-read only) reads this DESIGN + the CLARIFY spec, finds exactly 3 problems. Examples of what they should look for:
- Schema gap (e.g. missing field that integration needs)
- Sequencing problem (e.g. 16.3 depends on something 16.2 doesn't deliver)
- Contract ambiguity (e.g. ragas API endpoint shape under partial error)
- Threshold logic bug (e.g. regression pct vs absolute trigger ordering)
- Cache key correctness (e.g. forgetting `answerer_model_id`)
- Determinism claim that doesn't hold

REVIEW-DESIGN outputs go to AUDIT_LOG; if any BLOCK, design rev 2 ships before PLAN.

---

## 12. Design hash & revision history

| Rev | Date | Hash | Notes |
|---|---|---|---|
| 1 | 2026-05-24T00:10:00Z | `6ea1b40c...` | Initial DESIGN; 7 risks flagged |
| 2 | 2026-05-24T00:30:00Z | `76c29170836ab873c5f5e49d0fecfa48bad6ff3126e45ae2efe47228a5c241ea` | 3 BLOCKs resolved (cache key, no_answer metric, edge-case dist); minor risks R1-R8 carried to BUILD |

---

## 13. What's NOT in this design (intentionally)

- **Production-fidelity (Path B) generative eval** — Phase 16.5 follow-up after the controlled pipeline proves stable
- **Chat history harvest** — DEFERRED-030, trigger ≥200 user msgs
- **CI integration / PR gating** — D5 says WARN-only for 2 weeks; CI gate is Phase 16+x follow-up
- **Custom metric authoring** — relying on ragas built-in metrics for first pass
- **Multi-judge ensemble** — single judge for now; ensemble (e.g. Gemma + GPT-4o for high-stakes rows) is Phase 17+
- **Embedding-based metric variants** — ragas supports embedding-based answer_relevancy; first pass uses LLM-based for consistency
- **Advanced retrieval techniques** (RRF, HyDE, semantic chunking, query rewrite) — Phase 17, each A/B'd against this baseline

---

## 14. Next: REVIEW-DESIGN

Cold-start adversarial review of THIS document. In default mode that's a focused self-review pass; in AMAW mode it would be a sub-agent.

Per CLAUDE.md "safety-sensitive review policy" — this is **not** a safety-sensitive primitive (no auth, no tenant isolation, no destructive ops), so single-pass self-review is sufficient.

After REVIEW-DESIGN passes, PLAN (Phase 4) decomposes Sprint 16.1 into tasks.
