import { getEnv } from '../env.js';

function chatBaseUrl(): string {
  const env = getEnv();
  return (env.DISTILLATION_BASE_URL?.trim() || env.EMBEDDINGS_BASE_URL).replace(/\/$/, '');
}

function chatHeaders(): Record<string, string> {
  const env = getEnv();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = env.DISTILLATION_API_KEY ?? env.EMBEDDINGS_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function extractJsonObject(text: string): any {
  const raw = String(text ?? '').trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return JSON.parse(raw.slice(first, last + 1));
  }
  throw new Error('No JSON object found in model output');
}

async function chatCompletion(params: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  max_tokens?: number;
  temperature?: number;
  timeoutMs: number;
}): Promise<string> {
  const env = getEnv();
  const model = env.DISTILLATION_MODEL;
  if (!model) throw new Error('DISTILLATION_MODEL is not configured');

  const base = chatBaseUrl().endsWith('/') ? chatBaseUrl() : `${chatBaseUrl()}/`;
  const url = new URL('v1/chat/completions', base).toString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), params.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: chatHeaders(),
      signal: ac.signal,
      body: JSON.stringify({
        model,
        messages: params.messages,
        temperature: params.temperature ?? 0.2,
        max_tokens: params.max_tokens ?? 600,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`[chat] HTTP ${res.status}: ${txt}`);
    }
    const json = (await res.json()) as any;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('[chat] Missing choices[0].message.content');
    }
    return content;
  } finally {
    clearTimeout(t);
  }
}

export type DistillLessonResult = {
  summary: string;
  quick_action: string;
};

/** Heuristic: longer lessons need more completion budget so JSON is not truncated. */
function distillMaxTokens(title: string, content: string): number {
  const n = title.length + content.length;
  return Math.min(2500, Math.max(500, Math.ceil(n / 2.5)));
}

export async function distillLesson(input: { title: string; content: string }): Promise<DistillLessonResult> {
  const env = getEnv();
  const system =
    'You are a careful context engineer. Output ONLY valid JSON with keys "summary" and "quick_action". ' +
    'Rules: summary must be <= 150 words. quick_action must be <= 10 short lines, imperative, no markdown fences. ' +
    'The JSON must be parseable.';
  const user =
    `TITLE:\n${input.title}\n\nBODY:\n${input.content}\n\n` +
    `Return JSON like: {"summary":"...","quick_action":"..."}`;

  const out = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: distillMaxTokens(input.title, input.content),
    temperature: 0.2,
    timeoutMs: env.DISTILLATION_TIMEOUT_MS,
  });

  const parsed = extractJsonObject(out) as any;
  const summary = String(parsed?.summary ?? '').trim();
  const quick_action = String(parsed?.quick_action ?? '').trim();
  if (!summary || !quick_action) {
    throw new Error('Distillation JSON missing summary/quick_action');
  }
  return { summary, quick_action };
}

export async function reflectOnTopic(input: { topic: string; bullets: string[] }): Promise<{ answer: string; warning?: string }> {
  const env = getEnv();
  if (!env.DISTILLATION_ENABLED) {
    return { answer: '', warning: 'DISTILLATION_ENABLED=false (enable distillation to use reflect)' };
  }

  const ctx = input.bullets.length ? input.bullets.join('\n') : '(no retrieved lessons)';
  const system =
    'You are a senior engineer. Answer concisely using ONLY the provided lesson bullets as evidence. ' +
    'If evidence is insufficient, say what is missing.';
  const user = `TOPIC:\n${input.topic}\n\nLESSON BULLETS:\n${ctx}\n\nAnswer in <= 20 sentences.`;

  const reflectBudget = Math.min(2000, Math.max(700, Math.ceil((input.topic.length + ctx.length) / 3)));

  try {
    const out = await chatCompletion({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: reflectBudget,
      temperature: 0.3,
      timeoutMs: env.REFLECT_TIMEOUT_MS,
    });
    return { answer: out.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { answer: '', warning: msg };
  }
}

export async function compressText(input: { text: string; maxOutputChars?: number }): Promise<{ compressed: string; warning?: string }> {
  const env = getEnv();
  const maxOut = Math.min(Math.max(input.maxOutputChars ?? 4000, 200), 32_000);

  if (!env.DISTILLATION_ENABLED) {
    const t = String(input.text ?? '');
    return {
      compressed: t.length > maxOut ? `${t.slice(0, maxOut)}…` : t,
      warning: 'DISTILLATION_ENABLED=false; returned truncated original text instead of LLM compression',
    };
  }

  const system =
    'Compress the user text while preserving decisions, constraints, and actionable steps. Remove redundancy.';
  const user = `MAX_OUTPUT_CHARS: ${maxOut}\n\nTEXT:\n${input.text}`;

  try {
    const out = await chatCompletion({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: Math.min(1200, Math.ceil(maxOut / 3)),
      temperature: 0.1,
      timeoutMs: env.DISTILLATION_TIMEOUT_MS,
    });
    let compressed = out.trim();
    if (compressed.length > maxOut) compressed = compressed.slice(0, maxOut) + '…';
    return { compressed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const t = String(input.text ?? '');
    return {
      compressed: t.length > maxOut ? `${t.slice(0, maxOut)}…` : t,
      warning: msg,
    };
  }
}

export type CommitLessonSuggestion = {
  lesson_type: 'decision' | 'preference' | 'guardrail' | 'workaround' | 'general_note';
  title: string;
  content: string;
  tags: string[];
  source_refs: string[];
  rationale: string;
};

export async function suggestLessonFromCommit(input: {
  sha: string;
  message: string;
  files: string[];
}): Promise<CommitLessonSuggestion> {
  const env = getEnv();
  if (!env.DISTILLATION_ENABLED) {
    throw new Error('DISTILLATION_ENABLED=false');
  }

  const system =
    'You are an engineering memory assistant. Convert commit context into a reusable lesson draft. ' +
    'Output ONLY valid JSON with keys: lesson_type,title,content,tags,source_refs,rationale. ' +
    'lesson_type must be one of decision|preference|guardrail|workaround|general_note.';
  const user =
    `COMMIT_SHA: ${input.sha}\n` +
    `COMMIT_MESSAGE:\n${input.message}\n\n` +
    `CHANGED_FILES:\n${input.files.map(f => `- ${f}`).join('\n') || '(none)'}\n\n` +
    'Return concise but specific JSON. source_refs must include git:<sha> and relevant file paths.';

  const out = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 900,
    temperature: 0.2,
    timeoutMs: env.DISTILLATION_TIMEOUT_MS,
  });

  const parsed = extractJsonObject(out) as any;
  const lesson_type = String(parsed?.lesson_type ?? '').trim();
  const allowed = new Set(['decision', 'preference', 'guardrail', 'workaround', 'general_note']);
  if (!allowed.has(lesson_type)) {
    throw new Error('invalid lesson_type in commit suggestion');
  }
  const title = String(parsed?.title ?? '').trim();
  const content = String(parsed?.content ?? '').trim();
  const rationale = String(parsed?.rationale ?? '').trim();
  if (!title || !content) {
    throw new Error('missing title/content in commit suggestion');
  }

  const rawTags = Array.isArray(parsed?.tags) ? parsed.tags : [];
  const tags = rawTags.map((t: any) => String(t).trim()).filter(Boolean);
  const refs = Array.isArray(parsed?.source_refs) ? parsed.source_refs.map((x: any) => String(x).trim()).filter(Boolean) : [];
  const source_refs = Array.from(new Set([`git:${input.sha}`, ...refs]));

  return {
    lesson_type: lesson_type as CommitLessonSuggestion['lesson_type'],
    title,
    content,
    tags,
    source_refs,
    rationale: rationale || 'LLM synthesized from commit message and changed files.',
  };
}
