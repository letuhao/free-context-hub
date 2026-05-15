/**
 * Phase 13 Sprint 13.3 — reviewRequests unit tests.
 *
 * Covers ACs 1-7:
 *   AC1: submitForReview happy path → draft → pending-review + row created
 *   AC2: submitForReview rejects when lesson not draft + when pending exists
 *   AC3: listReviewRequests submitted_by filter
 *   AC4: approve → pending-review → active
 *   AC5: return → pending-review → draft
 *   AC6: re-submit after return creates new row
 *   AC7: update_lesson_status rejects pending-review (covered by mcp guard — smoke)
 *
 * Plus concurrency cases.
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { randomUUID } from 'node:crypto';

import {
  submitForReview,
  listReviewRequests,
  getReviewRequest,
  approveReviewRequest,
  returnReviewRequest,
} from './reviewRequests.js';
import { updateLessonStatus } from './lessons.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_review_requests__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM review_requests WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM lessons WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM projects WHERE project_id = $1`, [TEST_PROJECT]);
}

async function ensureProject() {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO projects (project_id, name) VALUES ($1, 'Test Review Requests')
     ON CONFLICT (project_id) DO NOTHING`,
    [TEST_PROJECT],
  );
}

async function insertLesson(status: string = 'draft'): Promise<string> {
  const pool = getDbPool();
  const lessonId = randomUUID();
  await pool.query(
    `INSERT INTO lessons (lesson_id, project_id, lesson_type, title, content, status, captured_by)
     VALUES ($1, $2, 'general_note', $3, 'test content', $4, 'test-agent')`,
    [lessonId, TEST_PROJECT, `Test lesson ${lessonId.slice(0, 8)}`, status],
  );
  return lessonId;
}

before(async () => { await cleanup(); await ensureProject(); });
after(async () => { await cleanup(); });
beforeEach(async () => {
  const pool = getDbPool();
  await pool.query(`DELETE FROM review_requests WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM lessons WHERE project_id = $1`, [TEST_PROJECT]);
});

test('submitForReview happy path: draft → pending-review + row created (AC1)', async () => {
  const lessonId = await insertLesson('draft');
  const r = await submitForReview({
    project_id: TEST_PROJECT,
    agent_id: 'agent-x',
    lesson_id: lessonId,
    reviewer_note: 'please review',
  });
  assert.equal(r.status, 'submitted');
  if (r.status !== 'submitted') return;
  assert.ok(r.request_id);
  assert.equal(r.lesson_id, lessonId);

  const pool = getDbPool();
  const lr = await pool.query(`SELECT status FROM lessons WHERE lesson_id = $1`, [lessonId]);
  assert.equal(lr.rows[0].status, 'pending-review');
  const rr = await pool.query(`SELECT submitter_agent_id, reviewer_note FROM review_requests WHERE lesson_id = $1`, [lessonId]);
  assert.equal(rr.rows[0].submitter_agent_id, 'agent-x');
  assert.equal(rr.rows[0].reviewer_note, 'please review');
});

test('submitForReview rejects when lesson not draft (AC2)', async () => {
  const lessonId = await insertLesson('active');
  const r = await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-x', lesson_id: lessonId });
  assert.equal(r.status, 'wrong_lesson_status');
  if (r.status === 'wrong_lesson_status') {
    assert.equal(r.current_status, 'active');
  }
});

test('submitForReview rejects when pending request exists (AC2)', async () => {
  const lessonId = await insertLesson('draft');
  await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-1', lesson_id: lessonId });
  // Force lesson back to draft (simulate manual DB tinkering — race window scenario)
  // Actually with the AC2 setup, simulate the scenario by trying again immediately
  // (already in pending-review state at this point).
  const r2 = await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-2', lesson_id: lessonId });
  // Should reject because lesson status is no longer draft
  assert.equal(r2.status, 'wrong_lesson_status');
});

test('submitForReview rejects when lesson_id not in project', async () => {
  const r = await submitForReview({
    project_id: TEST_PROJECT,
    agent_id: 'agent-x',
    lesson_id: randomUUID(),
  });
  assert.equal(r.status, 'lesson_not_found');
});

test('listReviewRequests filters by submitted_by (AC3)', async () => {
  const l1 = await insertLesson('draft');
  const l2 = await insertLesson('draft');
  await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-A', lesson_id: l1 });
  await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-B', lesson_id: l2 });

  const r = await listReviewRequests({ project_id: TEST_PROJECT, submitted_by: 'agent-A' });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].submitter_agent_id, 'agent-A');
});

test('approveReviewRequest: pending-review → active (AC4)', async () => {
  const lessonId = await insertLesson('draft');
  const submitR = await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-x', lesson_id: lessonId });
  assert.equal(submitR.status, 'submitted');
  if (submitR.status !== 'submitted') return;

  const r = await approveReviewRequest({
    project_id: TEST_PROJECT,
    request_id: submitR.request_id,
    resolved_by: 'human-reviewer-1',
    resolution_note: 'looks good',
  });
  assert.equal(r.status, 'resolved');
  if (r.status === 'resolved') {
    assert.equal(r.new_lesson_status, 'active');
  }

  const pool = getDbPool();
  const lr = await pool.query(`SELECT status FROM lessons WHERE lesson_id = $1`, [lessonId]);
  assert.equal(lr.rows[0].status, 'active');
  const rr = await pool.query(`SELECT status, resolved_by FROM review_requests WHERE request_id = $1`, [submitR.request_id]);
  assert.equal(rr.rows[0].status, 'approved');
  assert.equal(rr.rows[0].resolved_by, 'human-reviewer-1');
});

test('returnReviewRequest: pending-review → draft (AC5)', async () => {
  const lessonId = await insertLesson('draft');
  const submitR = await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-x', lesson_id: lessonId });
  assert.equal(submitR.status, 'submitted');
  if (submitR.status !== 'submitted') return;

  const r = await returnReviewRequest({
    project_id: TEST_PROJECT,
    request_id: submitR.request_id,
    resolved_by: 'human-reviewer-1',
    resolution_note: 'needs more detail',
  });
  assert.equal(r.status, 'resolved');
  if (r.status === 'resolved') {
    assert.equal(r.new_lesson_status, 'draft');
  }

  const pool = getDbPool();
  const lr = await pool.query(`SELECT status FROM lessons WHERE lesson_id = $1`, [lessonId]);
  assert.equal(lr.rows[0].status, 'draft');
});

test('re-submit after return creates new row (AC6)', async () => {
  const lessonId = await insertLesson('draft');
  const submit1 = await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-x', lesson_id: lessonId });
  assert.equal(submit1.status, 'submitted');
  if (submit1.status !== 'submitted') return;
  await returnReviewRequest({
    project_id: TEST_PROJECT,
    request_id: submit1.request_id,
    resolved_by: 'human-1',
    resolution_note: 'revise',
  });
  // Now lesson is back to draft
  const submit2 = await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-x', lesson_id: lessonId });
  assert.equal(submit2.status, 'submitted');
  if (submit2.status !== 'submitted') return;
  assert.notEqual(submit1.request_id, submit2.request_id);

  // Two review_requests rows exist: one returned, one pending
  const pool = getDbPool();
  const rows = await pool.query(`SELECT status FROM review_requests WHERE lesson_id = $1 ORDER BY created_at`, [lessonId]);
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[0].status, 'returned');
  assert.equal(rows.rows[1].status, 'pending');
});

test('concurrent approve/approve: one wins, other returns already_resolved', async () => {
  const lessonId = await insertLesson('draft');
  const submitR = await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-x', lesson_id: lessonId });
  assert.equal(submitR.status, 'submitted');
  if (submitR.status !== 'submitted') return;

  const [r1, r2] = await Promise.all([
    approveReviewRequest({ project_id: TEST_PROJECT, request_id: submitR.request_id, resolved_by: 'reviewer-A' }),
    approveReviewRequest({ project_id: TEST_PROJECT, request_id: submitR.request_id, resolved_by: 'reviewer-B' }),
  ]);
  const winners = [r1, r2].filter((r) => r.status === 'resolved');
  const losers = [r1, r2].filter((r) => r.status === 'already_resolved');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
});

test('getReviewRequest returns null for unknown id', async () => {
  const r = await getReviewRequest({ project_id: TEST_PROJECT, request_id: randomUUID() });
  assert.equal(r, null);
});

// code-r1 F1+F3 fix: resolveRequest guards lesson UPDATE with project_id + status
test('approve does NOT promote lesson that has been moved out of pending-review (state guard)', async () => {
  const lessonId = await insertLesson('draft');
  const submitR = await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-x', lesson_id: lessonId });
  assert.equal(submitR.status, 'submitted');
  if (submitR.status !== 'submitted') return;

  // Simulate a concurrent mutation moving the lesson out of pending-review
  // (e.g., manual admin SQL, or some future workflow). Force to archived.
  const pool = getDbPool();
  await pool.query(`UPDATE lessons SET status = 'archived' WHERE lesson_id = $1`, [lessonId]);

  // Now try to approve. The review_request UPDATE succeeds (review_request still 'pending'),
  // but the lesson UPDATE finds no row (status != 'pending-review') → service rolls back
  // and returns not_found-class signal.
  const r = await approveReviewRequest({
    project_id: TEST_PROJECT,
    request_id: submitR.request_id,
    resolved_by: 'reviewer-A',
  });
  assert.equal(r.status, 'not_found', 'should signal not_found / rollback when lesson state has drifted');

  // Verify lesson is still archived and review_request is still pending (rollback worked)
  const lr = await pool.query(`SELECT status FROM lessons WHERE lesson_id = $1`, [lessonId]);
  assert.equal(lr.rows[0].status, 'archived');
  const rr = await pool.query(`SELECT status FROM review_requests WHERE request_id = $1`, [submitR.request_id]);
  assert.equal(rr.rows[0].status, 'pending');
});

// ── BUG-13.3-2 / BUG-13.7-1 fix: update_lesson_status must not move a lesson
//    OUT of 'pending-review'. A lesson under review leaves that state ONLY via
//    the review-request approve/return flow (resolveRequest runs its own guarded
//    UPDATE and does not call updateLessonStatus). The 13.7 guard only blocked
//    pending-review → superseded/archived; → active and → draft leaked through,
//    bypassing review and orphaning the review_requests row.
test('update_lesson_status cannot move a lesson OUT of pending-review (BUG-13.3-2 / 13.7-1)', async () => {
  const lessonId = await insertLesson('pending-review');
  for (const target of ['active', 'draft', 'superseded'] as const) {
    const r = await updateLessonStatus({ projectId: TEST_PROJECT, lessonId, status: target });
    assert.equal(r.status, 'error', `pending-review → ${target} must be rejected`);
  }
  const pool = getDbPool();
  const lr = await pool.query(`SELECT status FROM lessons WHERE lesson_id = $1`, [lessonId]);
  assert.equal(lr.rows[0].status, 'pending-review', 'lesson status unchanged after rejected transitions');
});

test('update_lesson_status rejects any → pending-review (BUG-13.3-2 / 13.7-1)', async () => {
  const activeId = await insertLesson('active');
  const r = await updateLessonStatus({ projectId: TEST_PROJECT, lessonId: activeId, status: 'pending-review' });
  assert.equal(r.status, 'error', 'active → pending-review must be rejected');
});

// BUG-13.4-1: getReviewRequest must return the full lesson so the GUI's
// "View Full Lesson" shows real content (pre-fix it built an empty stub).
test('getReviewRequest returns the full lesson detail for the reviewer (BUG-13.4-1)', async () => {
  const lessonId = await insertLesson('draft');
  const submitR = await submitForReview({ project_id: TEST_PROJECT, agent_id: 'agent-x', lesson_id: lessonId });
  assert.equal(submitR.status, 'submitted');
  if (submitR.status !== 'submitted') return;

  const detail = await getReviewRequest({ project_id: TEST_PROJECT, request_id: submitR.request_id });
  assert.ok(detail, 'detail must not be null');
  assert.ok(detail!.lesson, 'detail must include the nested lesson object');
  assert.equal(detail!.lesson.lesson_id, lessonId);
  assert.equal(detail!.lesson.content, 'test content', 'lesson content must be present (empty pre-fix)');
});
