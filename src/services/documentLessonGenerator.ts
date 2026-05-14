import { getEnv } from '../env.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('doc-lesson-gen');

export interface SuggestedLesson {
  title: string;
  content: string;
  lesson_type: 'decision' | 'preference' | 'guardrail' | 'workaround' | 'general_note';
  tags: string[];
}

/**
 * Use LLM to extract lesson suggestions from document content.
 * Returns suggestions only — does not auto-create.
 */
export async function generateLessonsFromDocument(params: {
  docName: string;
  docContent: string;
  maxLessons?: number;
}): Promise<{ status: 'ok' | 'error'; error?: string; suggestions?: SuggestedLesson[] }> {
  const env = getEnv();
  const model = env.DISTILLATION_MODEL;
  if (!model) {
    return { status: 'error', error: 'DISTILLATION_MODEL is not configured.' };
  }

  const maxLessons = Math.min(params.maxLessons ?? 5, 10);
  const baseUrl = (env.DISTILLATION_BASE_URL?.trim() || env.EMBEDDINGS_BASE_URL).replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = env.DISTILLATION_API_KEY ?? env.EMBEDDINGS_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;

  // Truncate very long docs to stay within token limits.
  const content = params.docContent.slice(0, 8000);

  const systemPrompt = `You are a knowledge extraction assistant. Analyze the given document and extract key lessons for a team knowledge base.

Each lesson should capture one specific decision, convention, rule, or workaround mentioned in the document.

Rules:
- Extract up to ${maxLessons} distinct lessons
- Each lesson must have a clear, actionable title
- Content should be self-contained (understandable without the source doc)
- Assign the most appropriate lesson_type:
  - "decision" — an architectural or design choice
  - "preference" — a team convention or style preference
  - "guardrail" — a rule that must be enforced before risky actions
  - "workaround" — a known issue with a specific solution
  - "general_note" — useful information that doesn't fit other types
- Suggest relevant tags (2-4 per lesson)
- Return ONLY a JSON object: {"suggestions": [{"title": "...", "content": "...", "lesson_type": "...", "tags": ["..."]}]}`;

  const userPrompt = `Document: "${params.docName}"

Content:
${content}`;

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { status: 'error', error: `LLM returned HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }

    const json = (await res.json()) as any;
    const msg = json?.choices?.[0]?.message ?? {};
    // Phase 14: fall back to reasoning_content for reasoning models (nemotron etc.)
    const text = String(msg.content ?? '').trim() || String(msg.reasoning_content ?? '').trim();

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.warn({ text: text.slice(0, 200) }, 'no JSON in generate-lessons response');
      return { status: 'error', error: 'AI response did not contain valid JSON' };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      logger.warn({ text: match[0].slice(0, 200) }, 'malformed JSON in generate-lessons response');
      return { status: 'error', error: 'AI response contained malformed JSON' };
    }
    const validTypes = ['decision', 'preference', 'guardrail', 'workaround', 'general_note'];
    const suggestions: SuggestedLesson[] = (parsed.suggestions ?? [])
      .slice(0, maxLessons)
      .map((s: any) => ({
        title: String(s.title ?? '').slice(0, 200),
        content: String(s.content ?? ''),
        lesson_type: validTypes.includes(s.lesson_type) ? s.lesson_type : 'general_note',
        tags: Array.isArray(s.tags) ? s.tags.filter((t: unknown) => typeof t === 'string').slice(0, 5) : [],
      }))
      .filter((s: SuggestedLesson) => s.title && s.content);

    logger.info({ docName: params.docName, count: suggestions.length }, 'generated lessons from document');
    return { status: 'ok', suggestions };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, 'generate lessons from doc failed');
    return { status: 'error', error: msg };
  }
}
