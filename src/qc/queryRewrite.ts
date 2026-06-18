/**
 * Phase 17 — query-rewrite lever (retrieval-side A/B).
 *
 * A retrieval-side transformation applied to the golden query BEFORE it reaches
 * the retriever. Parallel to CoVe (synth-side), this is the 4th Phase-17 A/B
 * lever, selected via `--rewrite-mode none|expand|hyde` on runBaseline.
 *
 *   expand → LLM rewrites the question into a keyword/synonym-rich retrieval
 *            query. The rewritten STRING is embedded/searched.
 *   hyde   → LLM writes a short hypothetical answer passage; we retrieve on the
 *            PASSAGE instead of the raw question (Gao et al. 2022, "Precise
 *            Zero-Shot Dense Retrieval without Relevance Labels").
 *
 * The PRIMARY signal is the answer-independent retrieval metrics (recall@k, MRR,
 * nDCG) — they read `dispatch(rewrittenQuery)` directly, so the lever has zero
 * exposure to the reasoning-leak class that invalidated the first CoVe A/B.
 *
 * Reasoning suppression + answer extraction come for free via the shared
 * `chatComplete` transport — a leaked chain-of-thought must never become the
 * retrieval query.
 *
 * Graceful degradation: any LLM error or empty parse falls back to the original
 * query (`fallback:true`). A rewrite call never blocks a row.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chatComplete } from '../services/llm/index.js';
import { promptHash } from './genEvalTypes.js';
import type { AnswererConfig } from './genPipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, 'templates');

/** hyde passages longer than this are truncated before they become the
 *  retrieval query — a runaway generation should not dominate the embedding.
 *  NOTE (review LOW-4): the `global` surface dispatches the query in a GET
 *  querystring, so a 2000-char hyde passage → ~2.5KB URL. Safe on the local
 *  Node/Express API (16KB header default); treat hyde+global as local-only
 *  behind a stricter proxy. lessons/code/chunks use POST bodies (unaffected). */
export const HYDE_MAX_CHARS = 2000;

export type RewriteMode = 'none' | 'expand' | 'hyde';

/** A non-`none` rewrite mode — the only kind that produces a trace. */
export type ActiveRewriteMode = Exclude<RewriteMode, 'none'>;

/** Per-query trace, attached to the baseline row when a rewrite ran. */
export type QueryRewriteTrace = {
  mode: ActiveRewriteMode;
  original_query: string;
  /** What was actually dispatched to the retriever (== original on fallback). */
  rewritten_query: string;
  rewrite_ms: number;
  /** True when the LLM failed or produced an empty parse → original was used. */
  fallback: boolean;
  error?: string;
};

/** Top-level provenance pinned in the baseline archive when the lever ran. */
export type RewriteManifest = {
  mode: ActiveRewriteMode;
  template_hashes: { expand: string; hyde: string };
  answerer_model_id: string;
  answerer_endpoint: string;
  answerer_temperature: number;
  answerer_seed: number;
};

export function parseRewriteMode(raw: string | undefined): RewriteMode {
  const v = (raw ?? 'none').trim().toLowerCase();
  if (v === 'expand' || v === 'hyde') return v;
  return 'none';
}

// ─── template loading (one-shot cache, same shape as loadCoVeTemplate) ───

const _templateCache = new Map<ActiveRewriteMode, string>();

export async function loadRewriteTemplate(mode: ActiveRewriteMode): Promise<string> {
  const cached = _templateCache.get(mode);
  if (cached !== undefined) return cached;
  const file = path.join(TEMPLATE_DIR, `query-rewrite.${mode}.txt`);
  const content = await fs.readFile(file, 'utf-8');
  _templateCache.set(mode, content);
  return content;
}

export async function allRewriteTemplateHashes(): Promise<{ expand: string; hyde: string }> {
  const expand = await loadRewriteTemplate('expand');
  const hyde = await loadRewriteTemplate('hyde');
  return { expand: promptHash(expand), hyde: promptHash(hyde) };
}

// ─── pure post-processor ───

const LABEL_RE = /^\s*(?:rewritten\s+query|search\s+query|hypothetical\s+answer|query|answer)\s*:\s*/i;

/** Strip wrapping quotes/backticks. Handles a balanced pair (single layer) AND
 *  a dangling leading/trailing quote the LLM left unmatched — an unbalanced
 *  `"retry strategy` should not embed a stray quote into the retrieval query. */
function unwrapQuotes(s: string): string {
  const t = s.trim();
  const balanced = /^(["'`])([\s\S]*)\1$/.exec(t);
  if (balanced) return balanced[2]!.trim();
  // Unbalanced: drop a single leading and/or trailing quote char if present.
  return t.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
}

/**
 * Turn a raw LLM completion into the string that hits the retriever.
 *
 *  - Reasoning blocks are assumed already stripped by `chatComplete`.
 *  - A leading label (`Rewritten query:` etc.) is removed.
 *  - expand → first non-empty line, quote-unwrapped.
 *  - hyde   → all non-empty lines joined with a space, capped to HYDE_MAX_CHARS.
 *
 * Returns `null` when the result is empty — the caller falls back to the
 * original query.
 */
export function parseRewrittenQuery(raw: string, mode: ActiveRewriteMode): string | null {
  const stripped = raw.replace(LABEL_RE, '');
  const lines = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  if (mode === 'expand') {
    const q = unwrapQuotes(lines[0]!);
    return q.length > 0 ? q : null;
  }

  // hyde: the whole passage is the query.
  const passage = unwrapQuotes(lines.join(' ')).slice(0, HYDE_MAX_CHARS).trim();
  return passage.length > 0 ? passage : null;
}

// ─── LLM-backed rewrite ───

/**
 * Rewrite one query via the answerer LLM. Always resolves to a trace — never
 * throws — so the caller can dispatch `trace.rewritten_query` unconditionally.
 */
export async function rewriteQuery(
  question: string,
  mode: ActiveRewriteMode,
  answerer: AnswererConfig,
  opts?: { fetchImpl?: typeof fetch },
): Promise<QueryRewriteTrace> {
  const t0 = Date.now();
  const fallback = (error?: string): QueryRewriteTrace => ({
    mode,
    original_query: question,
    rewritten_query: question,
    rewrite_ms: Date.now() - t0,
    fallback: true,
    ...(error ? { error } : {}),
  });

  let template: string;
  try {
    template = await loadRewriteTemplate(mode);
  } catch (err) {
    return fallback(`rewrite_template_load_failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const prompt = template.replace('{question}', question);

  try {
    const { content } = await chatComplete({
      baseUrl: answerer.baseUrl,
      apiKey: answerer.apiKey,
      model: answerer.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: answerer.temperature,
      seed: answerer.seed,
      maxTokens: answerer.maxTokens,
      timeoutMs: answerer.timeoutMs,
      fetchImpl: opts?.fetchImpl,
      retry: { maxAttempts: 3, baseDelayMs: 500 },
    });
    const rewritten = parseRewrittenQuery(content, mode);
    if (rewritten === null) return fallback(); // empty parse → fallback, no error
    return {
      mode,
      original_query: question,
      rewritten_query: rewritten,
      rewrite_ms: Date.now() - t0,
      fallback: false,
    };
  } catch (err) {
    return fallback(`rewrite_failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
