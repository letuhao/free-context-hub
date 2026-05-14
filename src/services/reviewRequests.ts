/**
 * Phase 13 Sprint 13.3 — Review-request service module.
 *
 * Design ref:  docs/specs/2026-05-15-phase-13-sprint-13.3-design.md (v2)
 * Spec hash:   8ac8a0c2e57910f7
 *
 * Closes F2 core. Provides submit/list/get/approve/return APIs over a new
 * `review_requests` table with one-pending-per-lesson partial unique index.
 *
 * Atomic transactions with race-condition catches at three points:
 *   1. submitForReview: UPDATE lessons WHERE status='draft' RETURNING title — handles concurrent status mutations.
 *   2. submitForReview: INSERT review_requests catches 23505 unique violation — handles concurrent submits.
 *   3. resolveRequest: UPDATE review_requests WHERE status='pending' RETURNING — handles double-resolve.
 */

import { randomUUID } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { logActivity } from './activity.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('review-requests');
const PG_UNIQUE_VIOLATION = '23505';

export type SubmitResult =
  | { status: 'submitted'; request_id: string; lesson_id: string; lesson_title: string; created_at: string }
  | { status: 'lesson_not_found' }
  | { status: 'wrong_lesson_status'; current_status: string }
  | { status: 'already_pending'; existing_request_id: string };

export async function submitForReview(params: {
  project_id: string;
  agent_id: string;
  lesson_id: string;
  reviewer_note?: string;
  intended_reviewer?: string;
}): Promise<SubmitResult> {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Pre-check: lesson exists, belongs to project, status is 'draft'.
    const lr = await client.query<{ lesson_id: string; title: string; status: string }>(
      `SELECT lesson_id, title, status FROM lessons
       WHERE lesson_id = $1 AND project_id = $2`,
      [params.lesson_id, params.project_id],
    );
    if (lr.rows.length === 0) { await client.query('ROLLBACK'); return { status: 'lesson_not_found' }; }
    if (lr.rows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      return { status: 'wrong_lesson_status', current_status: lr.rows[0].status };
    }

    // Pre-check: no existing pending request (race window covered by unique index)
    const existing = await client.query<{ request_id: string }>(
      `SELECT request_id FROM review_requests
       WHERE lesson_id = $1 AND status = 'pending' LIMIT 1`,
      [params.lesson_id],
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { status: 'already_pending', existing_request_id: existing.rows[0].request_id };
    }

    // Atomic transition — v2 r1-F2 fix: WHERE status='draft' guards against
    // concurrent status mutations between pre-check and UPDATE.
    const upd = await client.query<{ title: string }>(
      `UPDATE lessons SET status = 'pending-review'
       WHERE lesson_id = $1 AND status = 'draft'
       RETURNING title`,
      [params.lesson_id],
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      // Re-fetch to disambiguate
      const recheck = await pool.query<{ status: string }>(
        `SELECT status FROM lessons WHERE lesson_id = $1 AND project_id = $2`,
        [params.lesson_id, params.project_id],
      );
      if (recheck.rows.length === 0) return { status: 'lesson_not_found' };
      return { status: 'wrong_lesson_status', current_status: recheck.rows[0].status };
    }
    const lessonTitle = upd.rows[0].title;

    const requestId = randomUUID();
    try {
      await client.query(
        `INSERT INTO review_requests
           (request_id, project_id, lesson_id, submitter_agent_id, reviewer_note, intended_reviewer)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [requestId, params.project_id, params.lesson_id, params.agent_id,
         params.reviewer_note ?? null, params.intended_reviewer ?? null],
      );
    } catch (err: unknown) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        await client.query('ROLLBACK');
        // Race: another concurrent submit won. Re-fetch the winner.
        const r = await pool.query<{ request_id: string }>(
          `SELECT request_id FROM review_requests
           WHERE lesson_id = $1 AND status = 'pending' LIMIT 1`,
          [params.lesson_id],
        );
        return { status: 'already_pending', existing_request_id: r.rows[0]?.request_id ?? '' };
      }
      throw err;
    }
    await client.query('COMMIT');

    // Fire-and-forget audit
    logActivity({
      projectId: params.project_id,
      eventType: 'review.submitted',
      actor: params.agent_id,
      title: `Submitted lesson for review: ${lessonTitle}`,
      detail: params.reviewer_note,
      metadata: { lesson_id: params.lesson_id, request_id: requestId, intended_reviewer: params.intended_reviewer ?? null },
    }).catch((e) => logger.warn({ err: String(e) }, 'activity emit failed (swallowed)'));

    return {
      status: 'submitted',
      request_id: requestId,
      lesson_id: params.lesson_id,
      lesson_title: lessonTitle,
      created_at: new Date().toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type ReviewRequestRow = {
  request_id: string;
  project_id: string;
  lesson_id: string;
  lesson_title: string;
  lesson_type: string;
  submitter_agent_id: string;
  reviewer_note: string | null;
  intended_reviewer: string | null;
  status: 'pending' | 'approved' | 'returned';
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
};

export async function listReviewRequests(params: {
  project_id: string;
  status?: 'pending' | 'approved' | 'returned';
  submitted_by?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ReviewRequestRow[]; total_count: number }> {
  const pool = getDbPool();
  const status = params.status ?? 'pending';
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  const where: string[] = [`rr.project_id = $1`, `rr.status = $2`];
  const args: unknown[] = [params.project_id, status];
  if (params.submitted_by) {
    where.push(`rr.submitter_agent_id = $${args.length + 1}`);
    args.push(params.submitted_by);
  }
  const whereClause = where.join(' AND ');

  const itemsSql = `
    SELECT rr.request_id, rr.project_id, rr.lesson_id,
           l.title AS lesson_title, l.lesson_type AS lesson_type,
           rr.submitter_agent_id, rr.reviewer_note, rr.intended_reviewer,
           rr.status, rr.resolved_at, rr.resolved_by, rr.resolution_note, rr.created_at
    FROM review_requests rr
    JOIN lessons l ON l.lesson_id = rr.lesson_id
    WHERE ${whereClause}
    ORDER BY rr.created_at DESC
    LIMIT $${args.length + 1} OFFSET $${args.length + 2}
  `;
  const countSql = `SELECT COUNT(*)::int AS n FROM review_requests rr WHERE ${whereClause}`;

  const [itemsR, countR] = await Promise.all([
    pool.query(itemsSql, [...args, limit, offset]),
    pool.query(countSql, args),
  ]);
  return {
    items: itemsR.rows.map((r: Record<string, unknown>) => ({
      request_id: String(r.request_id),
      project_id: String(r.project_id),
      lesson_id: String(r.lesson_id),
      lesson_title: String(r.lesson_title),
      lesson_type: String(r.lesson_type),
      submitter_agent_id: String(r.submitter_agent_id),
      reviewer_note: r.reviewer_note as string | null,
      intended_reviewer: r.intended_reviewer as string | null,
      status: r.status as 'pending' | 'approved' | 'returned',
      resolved_at: r.resolved_at ? (r.resolved_at as Date).toISOString() : null,
      resolved_by: r.resolved_by as string | null,
      resolution_note: r.resolution_note as string | null,
      created_at: (r.created_at as Date).toISOString(),
    })),
    total_count: countR.rows[0]?.n ?? 0,
  };
}

export async function getReviewRequest(params: { project_id: string; request_id: string }): Promise<ReviewRequestRow | null> {
  const pool = getDbPool();
  const r = await pool.query<Record<string, unknown>>(
    `SELECT rr.request_id, rr.project_id, rr.lesson_id,
            l.title AS lesson_title, l.lesson_type AS lesson_type,
            rr.submitter_agent_id, rr.reviewer_note, rr.intended_reviewer,
            rr.status, rr.resolved_at, rr.resolved_by, rr.resolution_note, rr.created_at
     FROM review_requests rr
     JOIN lessons l ON l.lesson_id = rr.lesson_id
     WHERE rr.request_id = $1 AND rr.project_id = $2`,
    [params.request_id, params.project_id],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    request_id: String(row.request_id),
    project_id: String(row.project_id),
    lesson_id: String(row.lesson_id),
    lesson_title: String(row.lesson_title),
    lesson_type: String(row.lesson_type),
    submitter_agent_id: String(row.submitter_agent_id),
    reviewer_note: row.reviewer_note as string | null,
    intended_reviewer: row.intended_reviewer as string | null,
    status: row.status as 'pending' | 'approved' | 'returned',
    resolved_at: row.resolved_at ? (row.resolved_at as Date).toISOString() : null,
    resolved_by: row.resolved_by as string | null,
    resolution_note: row.resolution_note as string | null,
    created_at: (row.created_at as Date).toISOString(),
  };
}

export type ResolveResult =
  | { status: 'resolved'; new_lesson_status: 'active' | 'draft'; request_id: string }
  | { status: 'not_found' }
  | { status: 'already_resolved'; current_status: 'approved' | 'returned' };

async function resolveRequest(
  params: { project_id: string; request_id: string; resolved_by: string; resolution_note: string | null },
  decision: 'approve' | 'return',
): Promise<ResolveResult> {
  const newReviewStatus = decision === 'approve' ? 'approved' : 'returned';
  const newLessonStatus: 'active' | 'draft' = decision === 'approve' ? 'active' : 'draft';
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Atomic guard: UPDATE only if still pending
    const ur = await client.query<{ lesson_id: string }>(
      `UPDATE review_requests
       SET status = $1, resolved_at = now(), resolved_by = $2, resolution_note = $3
       WHERE request_id = $4 AND project_id = $5 AND status = 'pending'
       RETURNING lesson_id`,
      [newReviewStatus, params.resolved_by, params.resolution_note, params.request_id, params.project_id],
    );
    if (ur.rows.length === 0) {
      await client.query('ROLLBACK');
      const existing = await pool.query<{ status: 'pending' | 'approved' | 'returned' }>(
        `SELECT status FROM review_requests WHERE request_id = $1 AND project_id = $2`,
        [params.request_id, params.project_id],
      );
      if (existing.rows.length === 0) return { status: 'not_found' };
      return { status: 'already_resolved', current_status: existing.rows[0].status as 'approved' | 'returned' };
    }
    const lessonId = ur.rows[0].lesson_id;
    // v2 r1-F3 + code-r1 F1+F3 fix: WHERE clause guards against
    //   (a) cross-tenant: project_id must match the resolved review_request's project
    //   (b) state race: lesson must still be in 'pending-review' (no late-flip stomp)
    const lu = await client.query<{ title: string }>(
      `UPDATE lessons SET status = $1
       WHERE lesson_id = $2 AND project_id = $3 AND status = 'pending-review'
       RETURNING title`,
      [newLessonStatus, lessonId, params.project_id],
    );
    if (lu.rows.length === 0) {
      // Lesson is no longer in pending-review (concurrent mutation), OR its
      // project_id has somehow drifted from the review_request's project_id.
      // Roll back the review_request status change to keep audit consistent.
      await client.query('ROLLBACK');
      logger.warn(
        { lesson_id: lessonId, project_id: params.project_id, request_id: params.request_id },
        'resolveRequest lesson UPDATE found no row (concurrent mutation or cross-tenant drift); review_request not resolved',
      );
      return { status: 'not_found' };
    }
    const lessonTitle = lu.rows[0].title;
    await client.query('COMMIT');

    logActivity({
      projectId: params.project_id,
      eventType: decision === 'approve' ? 'review.approved' : 'review.returned',
      actor: params.resolved_by,
      title: `Review ${newReviewStatus}: ${lessonTitle}`,
      detail: params.resolution_note ?? undefined,
      metadata: { request_id: params.request_id, lesson_id: lessonId, new_lesson_status: newLessonStatus },
    }).catch((e) => logger.warn({ err: String(e) }, 'activity emit failed (swallowed)'));

    return { status: 'resolved', new_lesson_status: newLessonStatus, request_id: params.request_id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function approveReviewRequest(params: {
  project_id: string; request_id: string; resolved_by: string; resolution_note?: string;
}): Promise<ResolveResult> {
  return resolveRequest(
    { project_id: params.project_id, request_id: params.request_id, resolved_by: params.resolved_by, resolution_note: params.resolution_note ?? null },
    'approve',
  );
}

export async function returnReviewRequest(params: {
  project_id: string; request_id: string; resolved_by: string; resolution_note: string;
}): Promise<ResolveResult> {
  return resolveRequest(
    { project_id: params.project_id, request_id: params.request_id, resolved_by: params.resolved_by, resolution_note: params.resolution_note },
    'return',
  );
}
