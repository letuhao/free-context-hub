import { getEnv } from '../env.js';
import * as z from 'zod/v4';
import { completionTokensForOutputChars, excerptForSummarization } from '../utils/llmCompletionBudget.js';
import { chatComplete, extractJsonObject } from './llm/index.js';

async function chatCompletion(params: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  max_tokens?: number;
  temperature?: number;
  timeoutMs: number;
  /** DEFERRED-035: injectable fetch for caller-wiring tests. */
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const env = getEnv();
  const model = env.DISTILLATION_MODEL;
  if (!model) throw new Error('DISTILLATION_MODEL is not configured');

  // Phase 17.2: shared transport — standardized reasoning-suppression + answer
  // extraction (was an inline fetch with no suppression; reasoning models like
  // gemma-4 leaked chain-of-thought into the distilled output).
  const { content } = await chatComplete({
    baseUrl: env.DISTILLATION_BASE_URL?.trim() || env.EMBEDDINGS_BASE_URL,
    apiKey: env.DISTILLATION_API_KEY ?? env.EMBEDDINGS_API_KEY,
    model,
    messages: params.messages,
    temperature: params.temperature ?? 0.2,
    maxTokens: params.max_tokens ?? 600,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
  });
  if (!content) {
    throw new Error('[chat] Missing choices[0].message.content (and reasoning_content also empty)');
  }
  return content;
}

export type DistillLessonResult = {
  summary: string;
  quick_action: string;
};

/** Heuristic: longer lessons need more completion budget so JSON is not truncated.
 *  Phase 14: significantly bumped floor and cap to accommodate reasoning models
 *  (nemotron-3-nano etc.) that consume substantial tokens on chain-of-thought
 *  before writing the final JSON answer.
 */
function distillMaxTokens(title: string, content: string): number {
  const n = title.length + content.length;
  return Math.min(8000, Math.max(2000, Math.ceil(n / 2.5)));
}

export async function distillLesson(
  input: { title: string; content: string },
  opts?: { fetchImpl?: typeof fetch },
): Promise<DistillLessonResult> {
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
    fetchImpl: opts?.fetchImpl,
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
  const maxOut = Math.min(
    Math.max(input.maxOutputChars ?? 4000, env.DISTILLATION_COMPRESS_MIN_OUTPUT_CHARS),
    env.DISTILLATION_COMPRESS_MAX_OUTPUT_CHARS,
  );

  if (!env.DISTILLATION_ENABLED) {
    const t = String(input.text ?? '');
    return {
      compressed: t.length > maxOut ? `${t.slice(0, maxOut)}…` : t,
      warning: 'DISTILLATION_ENABLED=false; returned truncated original text instead of LLM compression',
    };
  }

  const system =
    'Compress the user text while preserving decisions, constraints, and actionable steps. Remove redundancy.';
  const excerpt = excerptForSummarization(String(input.text ?? ''), env.QA_SUMMARIZE_MAX_INPUT_CHARS);
  const user =
    `MAX_OUTPUT_CHARS: ${maxOut}${excerpt.truncated ? ` (input truncated; ${excerpt.omittedChars} chars omitted from middle)` : ''}\n\nTEXT:\n${excerpt.text}`;

  try {
    const out = await chatCompletion({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: completionTokensForOutputChars(maxOut, {
        maxTokens: env.LLM_COMPLETION_MAX_TOKENS_CAP,
      }),
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
  lesson_type: string;
  title: string;
  content: string;
  tags: string[];
  source_refs: string[];
  rationale: string;
};

const CommitLessonSuggestionSchema = z.object({
  lesson_type: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string().min(1)),
  source_refs: z.array(z.string().min(1)).transform(refs => refs.filter(s => !/^\[object\b/i.test(s.trim()))),
  rationale: z.string().min(1).optional().default('LLM synthesized from commit message and changed files.'),
});

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
    'lesson_type must be one of decision|preference|guardrail|workaround|general_note. ' +
    'tags MUST be an array of strings. source_refs MUST be an array of strings (file paths and git:<sha>), never objects.';
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
    // Phase 14 round-2 fix: bumped 900 → 3000 for reasoning models that consume
    // budget on chain-of-thought before emitting the final JSON suggestion.
    max_tokens: 3000,
    temperature: 0.2,
    timeoutMs: env.DISTILLATION_TIMEOUT_MS,
  });

  const parsed = extractJsonObject(out) as unknown;
  const validated = CommitLessonSuggestionSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid commit suggestion schema: ${issues}`);
  }

  const source_refs = Array.from(new Set([`git:${input.sha}`, ...validated.data.source_refs]));

  return {
    lesson_type: validated.data.lesson_type,
    title: validated.data.title.trim(),
    content: validated.data.content.trim(),
    tags: validated.data.tags.map(t => t.trim()).filter(Boolean),
    source_refs,
    rationale: String(validated.data.rationale ?? '').trim() || 'LLM synthesized from commit message and changed files.',
  };
}
