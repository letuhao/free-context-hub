/**
 * Cohere-compatible rerank client — the cross-encoder boundary.
 *
 * Speaks the de-facto-standard Cohere `/v1/rerank` wire protocol, which is
 * shared by:
 *   - `local-rerank-service` (self-hosted bge-reranker-v2-m3) — current default
 *   - Cohere, Jina, Voyage, AWS Bedrock rerank (cloud) — future, config-only swap
 *
 * Thin transport only: no caching, no fallback, no env reads. Callers own the
 * cache key, the timeout budget, and the degrade-to-base-order policy. This keeps
 * the boundary swappable — pointing at a cloud provider is purely a change of
 * `baseUrl` / `apiKey` / `model`, never a code change here.
 *
 * Request:  POST {baseUrl}/v1/rerank
 *           {model, query, documents:[string], top_n?, return_documents:false}
 * Response: {model, results:[{index, relevance_score}], meta}   (sorted DESC)
 *
 * Throws on network error, non-2xx, or malformed/empty response. The caller
 * decides what to do (every current caller falls back to base order).
 */

export interface RerankItem {
  /** Index into the caller-supplied `documents` array. */
  index: number;
  relevanceScore: number;
}

export interface CohereRerankParams {
  query: string;
  documents: string[];
  baseUrl: string;
  apiKey?: string;
  model: string;
  topN?: number;
  timeoutMs: number;
}

interface CohereRerankResponse {
  results?: Array<{ index: number; relevance_score: number }>;
}

/**
 * Score and rank `documents` against `query` via a Cohere-compatible endpoint.
 * Returns results sorted by relevance DESC. Throws on any failure.
 */
export async function cohereRerank(params: CohereRerankParams): Promise<RerankItem[]> {
  const { query, documents, baseUrl, apiKey, model, topN, timeoutMs } = params;

  if (documents.length === 0) return [];

  const base = baseUrl.replace(/\/$/, '');
  const url = `${base}/v1/rerank`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body: Record<string, unknown> = {
    model,
    query,
    documents,
    return_documents: false,
  };
  if (topN !== undefined) body.top_n = topN;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: ac.signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`[rerank] HTTP ${res.status} from ${url}: ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as CohereRerankResponse;
    const results = json?.results;
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(`[rerank] empty or malformed response from ${url}`);
    }

    const n = documents.length;
    const items: RerankItem[] = [];
    for (const r of results) {
      // Guard against an endpoint returning out-of-range indices.
      if (typeof r?.index !== 'number' || r.index < 0 || r.index >= n) continue;
      items.push({ index: r.index, relevanceScore: Number(r.relevance_score) });
    }
    if (items.length === 0) {
      throw new Error(`[rerank] response had no valid indices from ${url}`);
    }
    // The server sorts DESC; re-sort defensively so callers can rely on order.
    items.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return items;
  } finally {
    clearTimeout(timer);
  }
}
