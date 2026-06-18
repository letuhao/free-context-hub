/**
 * Phase 17.3 — TypeScript client for the nli-judge sidecar (services/nli-judge).
 *
 * The sidecar scores answer claims against retrieved contexts with a cross-encoder
 * NLI model (entailment / contradiction / neutral). Unlike the ragas-judge client
 * (judge.ts) it has NO LM Studio dependency — the model is self-contained — so a
 * simple timeout + single retry is enough (no circuit breaker).
 *
 * These metrics are a SEPARATE family from judge.ts's `MetricName` (which is bound
 * to the ragas /score sidecar). They are advisory and measurement-profile only —
 * NOT part of the default baseline. See docs/specs/2026-06-19-phase-17.3-nli-judge.md.
 */

export type NliLabel = 'contradiction' | 'entailment' | 'neutral';

export type NliScores = Record<NliLabel, number>;

/** The NLI-sourced metric family (distinct from judge.ts MetricName). */
export type NliMetricName =
  | 'nli_faithfulness_strict'
  | 'nli_faithfulness_lenient'
  | 'nli_contradiction_rate';

export type EntailResult = { label: NliLabel; scores: NliScores };

export type PerClaim = { claim: string; label: NliLabel; scores: NliScores };

export type NliScoreResult = {
  n_claims: number;
  n_entailment?: number;
  n_contradiction?: number;
  n_neutral?: number;
  /** null when there are no claims to score (empty answer) — N/A, not 0. */
  nli_faithfulness_strict: number | null;
  nli_faithfulness_lenient: number | null;
  nli_contradiction_rate: number | null;
  per_claim: PerClaim[];
  model: string;
};

export type NliClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  retryOnce?: boolean;
  fetchImpl?: typeof fetch;
};

export class NliJudgeError extends Error {
  status?: number;
  constructor(message: string, opts: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'NliJudgeError';
    this.status = opts.status;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

const DEFAULT_BASE_URL = process.env.NLI_JUDGE_URL?.trim() || 'http://localhost:3006';
const DEFAULT_TIMEOUT_MS = 30_000;

function resolveOpts(opts: NliClientOptions = {}) {
  return {
    baseUrl: (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryOnce: opts.retryOnce ?? true,
    fetchImpl: opts.fetchImpl ?? fetch,
  };
}

async function post<T>(route: string, payload: unknown, opts: NliClientOptions): Promise<T> {
  const { baseUrl, timeoutMs, retryOnce, fetchImpl } = resolveOpts(opts);
  const url = `${baseUrl}${route}`;
  const body = JSON.stringify(payload);
  const maxAttempts = retryOnce ? 2 : 1;

  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
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
      if (!res.ok) {
        let detail: unknown = text;
        try { detail = JSON.parse(text); } catch { /* keep text */ }
        throw new NliJudgeError(`nli-judge HTTP ${res.status}`, { status: res.status, cause: detail });
      }
      return JSON.parse(text) as T;
    } catch (err) {
      lastErr = err;
      // Retry only transient failures (network / 5xx), not 4xx client errors.
      const status = err instanceof NliJudgeError ? err.status ?? 0 : 0;
      const transient = status === 0 || status >= 500;
      if (i === maxAttempts - 1 || !transient) break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof NliJudgeError) throw lastErr;
  throw new NliJudgeError('nli-judge unreachable', { status: 0, cause: lastErr });
}

/** Classify a single (premise, hypothesis) pair. */
export async function nliEntail(
  req: { premise: string; hypothesis: string },
  opts: NliClientOptions = {},
): Promise<EntailResult> {
  return post<EntailResult>('/entail', req, opts);
}

/** Score an answer's claims against the retrieved contexts. */
export async function nliScore(
  req: { answer: string; contexts: string[] },
  opts: NliClientOptions = {},
): Promise<NliScoreResult> {
  return post<NliScoreResult>('/score', req, opts);
}
