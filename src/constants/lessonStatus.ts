/**
 * Phase 13 Sprint 13.3 — lesson status constants.
 *
 * LESSON_STATUS_WRITABLE — values acceptable as the TARGET of `update_lesson_status`.
 * LESSON_STATUS_ALL      — values acceptable as a READ filter (includes 'pending-review').
 *
 * 'pending-review' is reachable only via `submit_for_review` → review_requests pending.
 * Direct transition to/from 'pending-review' via `update_lesson_status` is rejected.
 */

export const LESSON_STATUS_WRITABLE = ['draft', 'active', 'superseded', 'archived'] as const;
export const LESSON_STATUS_ALL = ['draft', 'pending-review', 'active', 'superseded', 'archived'] as const;

export type LessonStatusWritable = typeof LESSON_STATUS_WRITABLE[number];
export type LessonStatusAll = typeof LESSON_STATUS_ALL[number];

export function isWritableStatus(s: string): s is LessonStatusWritable {
  return (LESSON_STATUS_WRITABLE as readonly string[]).includes(s);
}
