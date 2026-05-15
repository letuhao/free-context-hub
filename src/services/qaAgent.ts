import { getEnv } from '../env.js';
import {
  completionTokensForOutputChars,
  excerptForSummarization,
  scaledSummaryCharBudget,
} from '../utils/llmCompletionBudget.js';

function qaBaseUrl(): string {
  const env = getEnv();
  return (env.QA_AGENT_BASE_URL?.trim() || env.DISTILLATION_BASE_URL?.trim() || env.EMBEDDINGS_BASE_URL).replace(/\/$/, '');
}

function qaHeaders(): Record<string, string> {
  const env = getEnv();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = env.QA_AGENT_API_KEY ?? env.DISTILLATION_API_KEY ?? env.EMBEDDINGS_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function qaModel(): string | null {
  const env = getEnv();
  return env.QA_AGENT_MODEL ?? env.DISTILLATION_MODEL ?? null;
}

export async function qaSummarize(params: { text: string; maxChars?: number }): Promise<string | null> {
  const model = qaModel();
  if (!model) return null;
  const env = getEnv();
  const ceiling = { sourceCharCeiling: env.LLM_SUMMARY_SOURCE_CHAR_CEILING };
  const sourceLen = params.text.length;
  const maxChars = Math.max(
    env.QA_SUMMARY_OUTPUT_MIN_CHARS,
    Math.min(
      params.maxChars ??
        scaledSummaryCharBudget(sourceLen, env.QA_SUMMARY_SCALED_MIN_CHARS, env.QA_SUMMARY_SCALED_MAX_CHARS, ceiling),
      env.QA_SUMMARY_HARD_MAX_CHARS,
    ),
  );
  const excerpt = excerptForSummarization(params.text, env.QA_SUMMARIZE_MAX_INPUT_CHARS);
  const userContent = excerpt.truncated
    ? `The source was truncated to fit context (head + tail; ${excerpt.omittedChars.toLocaleString()} characters omitted from the middle). Summarize what is visible in <= ${maxChars} characters. Preserve symbols, paths, and APIs.\n\n${excerpt.text}`
    : `Summarize this content in <= ${maxChars} characters:\n\n${excerpt.text}`;

  const maxTokens = completionTokensForOutputChars(maxChars, {
    maxTokens: env.LLM_COMPLETION_MAX_TOKENS_CAP,
  });
  const base = qaBaseUrl().endsWith('/') ? qaBaseUrl() : `${qaBaseUrl()}/`;
  const url = new URL('v1/chat/completions', base).toString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), env.QA_AGENT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: qaHeaders(),
      signal: ac.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You summarize technical content for retrieval. Keep concrete symbols, filenames, APIs, and constraints. No markdown fences.',
          },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const msg = json?.choices?.[0]?.message ?? {};
    // Phase 14: fall back to reasoning_content for reasoning models (nemotron etc.)
    const out = String(msg.content ?? '').trim() || String(msg.reasoning_content ?? '').trim();
    if (!out) return null;
    return out.length > maxChars ? `${out.slice(0, maxChars)}…` : out;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function qaAnswerFromEvidence(params: {
  question: string;
  evidence: Array<{ path: string; snippet: string }>;
  maxChars?: number;
}): Promise<string | null> {
  const model = qaModel();
  if (!model) return null;
  const env = getEnv();
  const ctx = params.evidence.map((e, i) => `[#${i + 1}] ${e.path}\n${e.snippet}`).join('\n\n');
  const ctxLen = ctx.length;
  const ceiling = { sourceCharCeiling: env.LLM_SUMMARY_SOURCE_CHAR_CEILING };
  const maxChars = Math.max(
    env.QA_EVIDENCE_OUTPUT_MIN_CHARS,
    Math.min(
      params.maxChars ??
        scaledSummaryCharBudget(ctxLen, env.QA_EVIDENCE_SCALED_MIN_CHARS, env.QA_EVIDENCE_SCALED_MAX_CHARS, ceiling),
      env.QA_EVIDENCE_ANSWER_HARD_MAX_CHARS,
    ),
  );
  const maxTokens = completionTokensForOutputChars(maxChars, {
    maxTokens: env.LLM_COMPLETION_MAX_TOKENS_CAP,
  });
  const base = qaBaseUrl().endsWith('/') ? qaBaseUrl() : `${qaBaseUrl()}/`;
  const url = new URL('v1/chat/completions', base).toString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), env.QA_AGENT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: qaHeaders(),
      signal: ac.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Answer only from provided evidence. Cite file paths inline using backticks. If evidence is insufficient, say so explicitly.',
          },
          { role: 'user', content: `Question: ${params.question}\n\nEvidence:\n${ctx}\n\nReturn concise answer.` },
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const msg = json?.choices?.[0]?.message ?? {};
    // Phase 14: fall back to reasoning_content for reasoning models (nemotron etc.)
    const out = String(msg.content ?? '').trim() || String(msg.reasoning_content ?? '').trim();
    if (!out) return null;
    return out.length > maxChars ? `${out.slice(0, maxChars)}…` : out;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
