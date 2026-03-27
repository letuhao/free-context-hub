import { getEnv } from '../env.js';

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
  const maxChars = Math.max(200, Math.min(params.maxChars ?? 1800, 8000));
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
          { role: 'user', content: `Summarize this content in <= ${maxChars} chars:\n\n${params.text}` },
        ],
        temperature: 0.1,
        max_tokens: Math.min(1200, Math.ceil(maxChars / 3)),
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const out = json?.choices?.[0]?.message?.content;
    if (typeof out !== 'string' || !out.trim()) return null;
    const s = out.trim();
    return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
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
  const maxChars = Math.max(300, Math.min(params.maxChars ?? 2200, 9000));
  const base = qaBaseUrl().endsWith('/') ? qaBaseUrl() : `${qaBaseUrl()}/`;
  const url = new URL('v1/chat/completions', base).toString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), env.QA_AGENT_TIMEOUT_MS);
  try {
    const ctx = params.evidence.map((e, i) => `[#${i + 1}] ${e.path}\n${e.snippet}`).join('\n\n');
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
        max_tokens: Math.min(1200, Math.ceil(maxChars / 3)),
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const out = json?.choices?.[0]?.message?.content;
    if (typeof out !== 'string' || !out.trim()) return null;
    const s = out.trim();
    return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

