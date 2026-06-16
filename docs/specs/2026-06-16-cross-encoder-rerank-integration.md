# Spec — Cross-encoder rerank integration (Cohere `/v1/rerank` boundary)

- **Date:** 2026-06-16
- **Phase:** CLARIFY → DESIGN
- **Type:** [BE]
- **Size:** M–L (retriever + lessons + env + MCP filter + startup prewarm + benchmark + docs; side-effect: new external service dependency, default behavior change)
- **Trigger:** Switch the online reranker from an LLM ranker (mistral-nemo / qwen3-4b-instruct, ~1.8s/query) to a dedicated cross-encoder (`bge-reranker-v2-m3`) served by `local-rerank-service`, then re-measure on the golden set.

## 1. Context — current state (verified in code)

There are **two independent rerank paths**:

| Surface | File | How it picks a reranker | Modes today |
|---|---|---|---|
| Code search | `src/services/retriever.ts` | per-call `rerankMode` param | `off` \| `llm` only |
| Lesson search | `src/services/lessons.ts` (`rerankLessons`) | env `RERANK_TYPE` | `generative` \| `cross-encoder` \| `api` |

- `retriever.ts` **ignores** `RERANK_TYPE`; its only non-off mode is `llm` (`llmRerank` → `/v1/chat/completions`, 1800ms timeout, JSON `{"order":[...]}`, Redis+in-mem cache).
- `lessons.ts` already has three implementations: `rerankGenerative` (LLM), `rerankCrossEncoder` (embedding cosine — *not* a true cross-encoder), and `rerankExternalApi` (true cross-encoder via external server).
- **Protocol mismatch (the crux):** `rerankExternalApi` speaks the **TEI** wire format — `POST {base}/rerank {query, texts}` → `[{index, score}]`. `local-rerank-service` (and Cohere / Jina / Voyage / Bedrock cloud rerankers) speak the **Cohere** format — `POST {base}/v1/rerank {model, query, documents, top_n}` → `{results:[{index, relevance_score}], meta}`. Pointing `RERANK_BASE_URL` at `local-rerank-service` with today's code **will not work**.

## 2. Decisions (locked with user)

- **A — Boundary:** we own only the *client* side. The boundary is the **Cohere `/v1/rerank` protocol**, because every cloud rerank provider speaks it; `local-rerank-service` is just one configured endpoint. Swapping to a cloud provider later = **config change only** (`RERANK_BASE_URL` / `RERANK_API_KEY` / `RERANK_MODEL`), zero code change. We do not depend on any service internal.
- **B — Add, don't replace:** keep `off` and `llm`; add the cross-encoder path. **Default reranker provider becomes the cross-encoder.**
- **C — v1 = reorder-only:** use server scores only to sort. `min_rerank_score` floor (reject off-topic) deferred to v2.

## 3. Design

### 3.1 Shared Cohere rerank client (the boundary)

New module `src/services/rerankClient.ts`:

```ts
export interface RerankItem { index: number; relevanceScore: number }
export async function cohereRerank(params: {
  query: string;
  documents: string[];
  baseUrl: string;          // RERANK_BASE_URL  (http://127.0.0.1:28417 now; cloud later)
  apiKey?: string;          // RERANK_API_KEY   (RERANK_SERVICE_TOKEN now; cloud key later)
  model: string;            // RERANK_MODEL     (bge-reranker-v2-m3 now)
  topN?: number;
  timeoutMs: number;
}): Promise<RerankItem[]>;   // sorted DESC; THROWS on error (caller decides fallback)
```

- `POST {baseUrl}/v1/rerank` body `{model, query, documents, top_n, return_documents:false}`; Bearer `apiKey`.
- Parse `{results:[{index, relevance_score}]}`; map back to caller indices.
- Pure transport; no caching, no fallback (callers own those — keeps the boundary thin).

Both `retriever.ts` and `lessons.ts` consume this single client → DRY, one place to evolve toward cloud.

### 3.2 Wire-protocol selector

`RERANK_TYPE='api'` stays "external rerank server"; add **`RERANK_API_PROTOCOL: 'cohere' | 'tei'` (default `cohere`)**:
- `cohere` → `cohereRerank` (local-rerank-service, cloud).
- `tei` → existing `rerankExternalApi` (legacy HF TEI), unchanged.

Rationale: models "api = external server, protocol = wire format". Keeps TEI working; makes Cohere the default.

### 3.3 Code search (`retriever.ts`)

- Widen `rerankMode` union → `'off' | 'llm' | 'api'`.
- MCP `search_code` filter `rerank_mode` enum → `['off','llm','api']`.
- Dispatch in the rerank block: `api` → build `documents = candidates.map(path + snippet)` (parity with `llmRerank`'s PATH+SNIPPET; A/B path-vs-snippet during eval), call `cohereRerank`, reorder. Keep the existing Redis + in-mem order cache and the best-effort fallback (error/timeout → base order).
- Lower `RERANK_TIMEOUT_MS` effective budget for the api path (warm cross-encoder ≈ tens of ms; use ~300ms).

### 3.4 Default switch (B) — Q1 RESOLVED = (b) rerank ON by default

- `RERANK_TYPE` default `generative` → **`api`** (lesson search defaults to cross-encoder).
- Code search rerank is **ON by default** with `api`. **Critical: flip the default only at the public entry layer** — MCP `search_code` handler + REST code-search route — via `rerankMode: filters?.rerank_mode ?? defaultInteractiveRerankMode()`, where `defaultInteractiveRerankMode()` maps `RERANK_TYPE` (`api`→`api`, `generative`→`llm`, else `off`).
- **Retriever keeps internal default `rerankMode ?? 'off'` UNCHANGED.** Internal callers (`qcEval` passes explicit `'off'`; `ragQcRunner` omits the filter for no-rerank groups → undefined → `'off'`) MUST stay un-reranked so the 3-way benchmark's baseline group is valid. Only the interactive entry layer flips on.
- `.env.baseline` keeps `generative` for reproducible *baseline* measurement; the new runtime default does not touch baseline integrity because the QC path never inherits the entry-layer default.
- Latency: adds a warm cross-encoder hop (~tens of ms) to every interactive code query. Mitigated by prewarm (§3.5) + graceful fallback; quantified by the eval (§4).

### 3.5 Cold-start prewarm

`local-rerank-service` lazy-loads (~30–60s first request) → first online query would timeout→fallback. Add a best-effort prewarm in `src/core/startup.ts`: when `RERANK_TYPE='api'` and protocol `cohere`, `POST {base}/v1/models/{model}/load` (ignore failure). Optionally set `keep_warm`. Non-fatal if the service is down.

## 4. Eval / re-measure plan (the deliverable)

Reuse `src/qc/rerankBenchmark.ts` + `ragQcRunner.ts` + the 40-query golden set. Run **3-way** on identical inputs:

| Config | Status |
|---|---|
| no-rerank baseline | Phase 12: 76% @ 99ms — re-confirm |
| LLM rerank | Phase 12: 85% @ 1.8s — re-confirm on current model |
| **cross-encoder `bge-reranker-v2-m3` (api/cohere)** | **NEW** |

Metrics: recall@k, MRR, p50/p95 latency. Output a reproducible report under `docs/benchmarks/`. Honest framing — the architect value is the *measured decision*, regardless of which wins. Known risk: a multilingual cross-encoder may underperform an instruction-following LLM on **code** retrieval; this is exactly what the measurement resolves.

## 5. Risks / non-goals

- Non-goal v1: `min_rerank_score` floor, score-based off-topic rejection (v2).
- Non-goal: changing the lesson `cross-encoder` (embedding-cosine) path.
- Risk: cross-encoder quality on code < LLM → mitigated by keeping `llm` selectable and measuring before flipping any hot-path default.
- Risk: `local-rerank-service` is Windows-only scripts today; docker/Linux deploy is separate. Online default depends on it being reachable — fallback covers absence, but a down service silently degrades to base order (logged).

## 6. Self-review (CLARIFY gate)

- No placeholders. ✅
- Boundary is config-swappable to cloud (Decision A satisfied). ✅
- Adds, does not replace; default→cross-encoder (Decision B), with Q1 flagged as the one real ambiguity. ✅
- v1 reorder-only (Decision C). ✅
- One open question (Q1) requires user input before BUILD.

## 7. Task decomposition (PLAN — pending CLARIFY sign-off)

1. `rerankClient.ts` — `cohereRerank` + unit test (mock fetch: happy path, HTTP error throws, empty results throws).
2. `env.ts` — add `RERANK_API_PROTOCOL`; change `RERANK_TYPE` default → `api`.
3. `lessons.ts` — route `api` path through protocol selector (`cohere` → `cohereRerank`).
4. `retriever.ts` — `rerankMode` union += `api`; dispatch + cache + fallback; document text = path+snippet.
5. `mcp/index.ts` — `rerank_mode` enum += `api`.
6. `startup.ts` — prewarm.
7. Benchmark run (3-way) + `docs/benchmarks/` report.
8. Update CV free-context-hub entry with measured numbers.
