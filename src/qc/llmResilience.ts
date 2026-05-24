/**
 * Phase 17.x — Resilience layer for LM-Studio-backed LLM calls.
 *
 * LM Studio has documented reliability issues (see GH issue
 * lmstudio-ai/lmstudio-bug-tracker#945):
 *   - ECONNRESET / "socket hang up" mid-request (~6% baseline rate)
 *   - Streaming SIGKILL at 120s (~11% rate)
 *   - "Processing prompt 0.00%" stuck state after ~hundreds of requests
 *
 * This module provides:
 *   1. retryOnTransient — wrap an async fetch-based call with exponential
 *      backoff on socket errors and 5xx responses
 *   2. CircuitBreaker — track consecutive failures across the process; trip
 *      after threshold so we don't burn through a baseline against a wedged
 *      server (prints clear "server appears wedged" warning instead)
 *
 * Used by:
 *   - src/qc/genPipeline.ts callAnswerer (synthesizer + CoVe steps)
 *   - src/qc/judge.ts scoreOnce (ragas-judge sidecar HTTP)
 */

import { setTimeout as delay } from 'node:timers/promises';

// ─── transient-error classifier ───

/** True if the error/response is the kind LM Studio's bug causes — worth retrying. */
export function isTransientLLMError(err: unknown, httpStatus?: number): boolean {
  // HTTP 5xx → retry (sidecar transient or upstream)
  if (httpStatus !== undefined && httpStatus >= 500) return true;
  // HTTP 408 / 429 / 502 / 503 / 504 already covered above; explicit 0 = network
  if (httpStatus === 0) return true;

  if (!err) return false;
  const msg = String((err as { message?: string }).message ?? err).toLowerCase();
  const code = String((err as { code?: string }).code ?? '').toUpperCase();

  // Node / undici transient codes
  const codeMatches =
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE' ||
    code === 'ENOTFOUND' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT';

  // Phrase matches from the LM Studio bug report
  const msgMatches =
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed') || // Node fetch wraps lower-level errors here
    msg.includes('connect timeout') ||
    msg.includes('headers timeout') ||
    msg.includes('other side closed') ||
    msg.includes('terminated') ||
    msg.includes('the operation was aborted');

  return codeMatches || msgMatches;
}

// ─── retry policy ───

export type RetryOptions = {
  /** Max attempts including the first. Default 3 (= 1 try + 2 retries). */
  maxAttempts?: number;
  /** Base backoff in ms; doubled each retry. Default 500. */
  baseDelayMs?: number;
  /** Cap on the per-attempt backoff. Default 8_000. */
  maxDelayMs?: number;
  /** Called before each retry (good for logging). */
  onRetry?: (attempt: number, err: unknown, nextDelayMs: number) => void;
};

/** Retry an async operation when it throws a transient error. Re-throws
 *  the final error if all attempts fail (non-transient errors throw
 *  immediately, no retries). */
export async function retryOnTransient<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 8_000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (err) {
      lastErr = err;
      // Determine HTTP status if the error carries one (judge.ts JudgeError does)
      const status = (err as { status?: number }).status;
      if (!isTransientLLMError(err, status)) {
        // Non-transient — propagate immediately
        breaker.recordSuccess(); // not the breaker's problem; reset is fine on caller error
        throw err;
      }
      breaker.recordFailure();
      if (attempt >= maxAttempts) break;
      const ms = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      opts.onRetry?.(attempt, err, ms);
      await delay(ms);
    }
  }
  throw lastErr;
}

// ─── circuit breaker (process-global) ───

/** Tracks consecutive transient failures across all callers. When the
 *  threshold trips, callers see a clear "server appears wedged" warning
 *  on the next attempt. Doesn't actually open the circuit (we still call
 *  through) — it just makes the problem visible. */
class CircuitBreaker {
  private consecutive_failures = 0;
  private last_warn_at = 0;
  private threshold = 5;

  recordFailure() {
    this.consecutive_failures++;
    const now = Date.now();
    // Throttle warn to once per 30s to avoid log spam
    if (this.consecutive_failures >= this.threshold && now - this.last_warn_at > 30_000) {
      const _ts = new Date().toISOString().slice(11, 23);
      console.warn(
        `\n[${_ts}] [llm-resilience] WARNING: ${this.consecutive_failures} consecutive transient LLM failures.`,
      );
      console.warn(
        '[llm-resilience] LM Studio may be wedged. Try: (1) restart LM Studio app,',
      );
      console.warn(
        '[llm-resilience]   (2) re-load the model, (3) check Docker container <-> host network.',
      );
      console.warn(
        '[llm-resilience] See: https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/945',
      );
      this.last_warn_at = now;
    }
  }

  recordSuccess() {
    this.consecutive_failures = 0;
  }

  get failures() {
    return this.consecutive_failures;
  }
}

export const breaker = new CircuitBreaker();
