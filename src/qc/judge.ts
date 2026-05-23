/**
 * Phase 16 Sprint 16.2 — TypeScript client for the ragas-judge sidecar.
 *
 * The sidecar (services/ragas-judge/main.py) exposes:
 *   GET  /health
 *   POST /score
 *
 * This client wraps the POST /score call with timeout, single retry on 5xx,
 * and typed request/response shapes. It is consumed by Sprint 16.3 from
 * src/qc/runBaseline.ts.
 *
 * See docs/specs/2026-05-23-phase-16-rag-production-design.md §4 for the
 * full API contract.
 */

import { setTimeout as delay } from 'node:timers/promises';

export type AnswerCategory =
  | 'standard'
  | 'multi_hop'
  | 'no_answer'
  | 'contradictory'
  | 'paraphrase'
  | 'distractor';

export type StandardMetricName =
  | 'faithfulness'
  | 'answer_relevancy'
  | 'context_precision'
  | 'context_recall';

export type MetricName = StandardMetricName | 'refusal_correctness';

export type JudgeContext = {
  /** Optional stable id (lesson_id / chunk_id / file path / etc.) for traceability. */
  id?: string;
  /** The actual context text the synthesizer would have seen. */
  text: string;
};

export type JudgeRequest = {
  /** Caller-supplied id; echoed back for log correlation. */
  request_id?: string;
  question: string;
  answer: string;
  contexts: JudgeContext[];
  /** Required for context_precision, context_recall, refusal_correctness. */
  ground_truth?: string;
  /** Defaults to 'standard' on the sidecar; pass explicitly to enable §4.6 routing. */
  answer_category?: AnswerCategory;
  /** Metrics to evaluate. Defaults to the 4 standard metrics on the sidecar. */
  metrics?: MetricName[];
  options?: {
    include_reasons?: boolean;
    temperature?: number;
    cache_key?: string;
  };
};

export type JudgeMetricError = {
  metric: string;
  error: string;
  detail?: string;
};

export type JudgeResponse = {
  request_id?: string;
  /** Map of metric name → numeric score in [0, 1], or null if the metric failed. */
  scores: Record<string, number | null>;
  /** Optional per-metric LLM-generated reasoning strings (only when include_reasons). */
  reasons: Record<string, string>;
  /** Metrics that were skipped by per-category routing (e.g. faithfulness on no_answer). */
  skipped: string[];
  skip_reason?: string | null;
  errors: JudgeMetricError[];
  judge_call_count: number;
  judge_latency_ms: number;
  cache_hit: boolean;
};

export type JudgeClientOptions = {
  /** Base URL of the ragas-judge sidecar. Default `http://localhost:3005`. */
  baseUrl?: string;
  /** Per-call timeout. Default 120s (gen-eval LLM calls are slow). */
  timeoutMs?: number;
  /** Retry once on 5xx / network failure. Default true. */
  retryOnce?: boolean;
  /** Custom fetch override (used in tests). Default `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
};

export class JudgeError extends Error {
  readonly status?: number;
  readonly cause_?: unknown;
  constructor(message: string, opts: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'JudgeError';
    this.status = opts.status;
    this.cause_ = opts.cause;
  }
}

const DEFAULT_BASE_URL = 'http://localhost:3005';
const DEFAULT_TIMEOUT_MS = 120_000;

function _resolveOpts(opts: JudgeClientOptions = {}) {
  return {
    baseUrl: (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryOnce: opts.retryOnce ?? true,
    fetchImpl: opts.fetchImpl ?? fetch,
  };
}

/**
 * Score a single (question, answer, contexts, ground_truth) tuple.
 *
 * Throws JudgeError on:
 *   - non-2xx HTTP response that doesn't parse as JSON
 *   - 422 (empty_contexts when metrics need them) — caller likely has a data bug
 *   - sidecar unreachable after retries
 *
 * Per-metric errors (LLM timeout on one metric, etc.) are returned in the
 * `errors` array of JudgeResponse — they do NOT throw. Caller decides whether
 * to skip the row, retry, or accept a partial result.
 */
export async function scoreOnce(
  req: JudgeRequest,
  opts: JudgeClientOptions = {},
): Promise<JudgeResponse> {
  const { baseUrl, timeoutMs, retryOnce, fetchImpl } = _resolveOpts(opts);
  const url = `${baseUrl}/score`;

  const body = JSON.stringify(req);

  const attempt = async (): Promise<{ ok: boolean; status: number; text: string }> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ctl.signal,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } finally {
      clearTimeout(timer);
    }
  };

  let last: { ok: boolean; status: number; text: string };
  try {
    last = await attempt();
  } catch (err) {
    // Network error / abort / DNS — retry once if enabled
    if (retryOnce) {
      await delay(500);
      try {
        last = await attempt();
      } catch (err2) {
        throw new JudgeError('judge sidecar unreachable after retry', { cause: err2 });
      }
    } else {
      throw new JudgeError('judge sidecar unreachable', { cause: err });
    }
  }

  if (!last.ok) {
    // Retry once on 5xx (transient sidecar / dependency failures)
    if (retryOnce && last.status >= 500) {
      await delay(500);
      try {
        last = await attempt();
      } catch (err) {
        throw new JudgeError(`judge sidecar 5xx then unreachable on retry`, {
          status: last.status,
          cause: err,
        });
      }
    }
  }

  if (!last.ok) {
    let detail: unknown = undefined;
    try {
      detail = JSON.parse(last.text);
    } catch {
      detail = last.text;
    }
    throw new JudgeError(`judge sidecar HTTP ${last.status}`, {
      status: last.status,
      cause: detail,
    });
  }

  let parsed: JudgeResponse;
  try {
    parsed = JSON.parse(last.text) as JudgeResponse;
  } catch (err) {
    throw new JudgeError('judge sidecar returned malformed JSON', { cause: err });
  }

  return parsed;
}

/**
 * Health probe. Returns true iff sidecar responds 200 with status='ok'.
 * Does NOT validate that LM Studio is reachable — that's only known on a
 * real /score call.
 */
export async function judgeHealthy(opts: JudgeClientOptions = {}): Promise<boolean> {
  const { baseUrl, timeoutMs, fetchImpl } = _resolveOpts(opts);
  const url = `${baseUrl}/health`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.min(timeoutMs, 5_000));
  try {
    const res = await fetchImpl(url, { signal: ctl.signal });
    if (!res.ok) return false;
    const d = (await res.json()) as { status?: string };
    return d?.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
