import { randomUUID } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { embedTexts } from './embedder.js';

export type GuardrailRulePayload = {
  trigger: string;
  requirement: string;
  verification_method: 'recorded_test_event' | 'user_confirmation' | 'cli_exit_code' | string;
};

export type LessonPayload = {
  project_id: string;
  lesson_type: 'decision' | 'preference' | 'guardrail' | 'workaround' | 'general_note';
  title: string;
  content: string;
  tags?: string[];
  source_refs?: string[];
  captured_by?: string;
  guardrail?: GuardrailRulePayload;
};

export async function addLesson(payload: LessonPayload) {
  const pool = getDbPool();
  const lessonId = payload.lesson_type === 'guardrail' ? randomUUID() : randomUUID();

  const tags = payload.tags ?? [];
  const sourceRefs = payload.source_refs ?? [];

  // Embedding lessons enables later semantic retrieval of preferences/notes (optional in MVP).
  const [embedding] = await embedTexts([payload.content]);
  const embeddingLiteral = `[${embedding.join(',')}]`;

  await pool.query(
    `INSERT INTO projects(project_id, name)
     VALUES ($1, $2)
     ON CONFLICT (project_id) DO NOTHING;`,
    [payload.project_id, payload.project_id],
  );

  await pool.query(
    `INSERT INTO lessons(
      lesson_id, project_id, lesson_type, title, content, tags, source_refs,
      embedding, captured_by, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9, now(), now());`,
    [
      lessonId,
      payload.project_id,
      payload.lesson_type,
      payload.title,
      payload.content,
      tags,
      sourceRefs,
      embeddingLiteral,
      payload.captured_by ?? null,
    ],
  );

  if (payload.lesson_type === 'guardrail' || payload.guardrail) {
    const rule = payload.guardrail;
    if (!rule) {
      // Guardrail without rule payload is a client error, but keep MVP forgiving.
      return { status: 'ok', lesson_id: lessonId, guardrail_inserted: false };
    }

    await pool.query(
      `INSERT INTO guardrails(rule_id, project_id, trigger, requirement, verification_method, created_at)
       VALUES ($1,$2,$3,$4,$5, now());`,
      [lessonId, payload.project_id, rule.trigger, rule.requirement, rule.verification_method],
    );
  }

  return { status: 'ok', lesson_id: lessonId };
}

export async function getPreferences(projectId: string) {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT
      lesson_id,
      lesson_type,
      title,
      content,
      tags,
      source_refs,
      created_at,
      updated_at,
      captured_by
     FROM lessons
     WHERE project_id=$1
       AND EXISTS (SELECT 1 FROM unnest(tags) t WHERE t LIKE 'preference-%')
     ORDER BY created_at DESC;`,
    [projectId],
  );

  return (res.rows ?? []).map((r: any) => ({
    lesson_id: String(r.lesson_id),
    lesson_type: String(r.lesson_type),
    title: String(r.title),
    content: String(r.content),
    tags: (r.tags ?? []) as string[],
    source_refs: (r.source_refs ?? []) as string[],
    created_at: r.created_at,
    updated_at: r.updated_at,
    captured_by: r.captured_by,
  }));
}

