/**
 * Phase 13 Sprint 13.5 — lesson type constants.
 *
 * BUILTIN_LESSON_TYPES — the 5 built-in types always accepted.
 * GUARDRAIL_LESSON_TYPES — types treated as guardrail rules by:
 *   (1) lessons.ts INSERT path → also writes a row to guardrails table
 *   (2) kg/linker.ts edge mapping → CONSTRAINS edge
 *   (3) check_guardrails engine (transitively via #1's guardrails table rows)
 *
 * Active profile types extend BUILTIN_LESSON_TYPES additively. See
 * taxonomyService.getValidLessonTypes(project_id) for the runtime check.
 */

export const BUILTIN_LESSON_TYPES = [
  'decision', 'preference', 'guardrail', 'workaround', 'general_note',
] as const;

export const GUARDRAIL_LESSON_TYPES = ['guardrail', 'codex-guardrail'] as const;

export type BuiltinLessonType = typeof BUILTIN_LESSON_TYPES[number];

export function isBuiltinLessonType(t: string): t is BuiltinLessonType {
  return (BUILTIN_LESSON_TYPES as readonly string[]).includes(t);
}

export function isGuardrailLessonType(t: string): boolean {
  return (GUARDRAIL_LESSON_TYPES as readonly string[]).includes(t);
}
