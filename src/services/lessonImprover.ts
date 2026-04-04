import { getEnv } from '../env.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('lesson-improver');

export interface ImproveSuggestion {
  original: string;
  improved: string;
  change_summary: string;
}

/**
 * Use LLM to suggest improvements for lesson content.
 * If selected_text is provided, only that portion is improved.
 * Returns suggestions (does not auto-apply).
 */
export async function improveLessonContent(params: {
  title: string;
  content: string;
  instruction: string;
  selectedText?: string;
}): Promise<{ status: 'ok' | 'error'; error?: string; suggestions?: ImproveSuggestion[] }> {
  const env = getEnv();
  const model = env.DISTILLATION_MODEL;
  if (!model) {
    return { status: 'error', error: 'DISTILLATION_MODEL is not configured. AI improve requires a chat model.' };
  }

  const baseUrl = (env.DISTILLATION_BASE_URL?.trim() || env.EMBEDDINGS_BASE_URL).replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = env.DISTILLATION_API_KEY ?? env.EMBEDDINGS_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;

  const targetText = params.selectedText ?? params.content;

  const systemPrompt = `You are a technical writing assistant. You improve lesson content for a knowledge base used by AI coding agents.

Rules:
- Follow the user's instruction precisely
- Preserve the original meaning and intent
- Keep markdown formatting
- Be concise and specific
- Return ONLY a JSON object with this exact structure:
{"suggestions": [{"original": "the original text", "improved": "your improved version", "change_summary": "brief description of what changed"}]}

If improving a selection, return one suggestion. If improving the full content, you may return multiple suggestions for distinct sections.`;

  const userPrompt = params.selectedText
    ? `Lesson title: "${params.title}"

Full content for context:
${params.content}

Selected text to improve:
"${params.selectedText}"

Instruction: ${params.instruction}`
    : `Lesson title: "${params.title}"

Content to improve:
${params.content}

Instruction: ${params.instruction}`;

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
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { status: 'error', error: `LLM returned HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }

    const json = (await res.json()) as any;
    const text = json?.choices?.[0]?.message?.content ?? '';

    // Parse JSON from response (may have markdown fences).
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.warn({ text: text.slice(0, 200) }, 'no JSON in improve response');
      return { status: 'error', error: 'AI response did not contain valid JSON' };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      logger.warn({ text: match[0].slice(0, 200) }, 'malformed JSON in improve response');
      return { status: 'error', error: 'AI response contained malformed JSON' };
    }
    const suggestions: ImproveSuggestion[] = (parsed.suggestions ?? [parsed]).map((s: any) => ({
      original: s.original ?? targetText,
      improved: s.improved ?? '',
      change_summary: s.change_summary ?? 'Improved content',
    }));

    return { status: 'ok', suggestions };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, 'improve lesson failed');
    return { status: 'error', error: msg };
  }
}
