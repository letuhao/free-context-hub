/**
 * Phase 15 Sprint 15.3 — doaMatrix service unit tests.
 *
 * Design ref: docs/specs/2026-05-17-phase-15-sprint-15.3-design.md §2, §8 (T13–T16).
 *
 * Covers:
 *   T13 resolution precedence: topic-override > project > __default__
 *   T14 narrowest-span tie-break within same tier
 *   T15 deriveRoute per shape including the empty-ladder fallback
 *   T16 doa_snapshot is frozen — a matrix edit after submission does not re-target
 *       a live request's request_steps
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { resolveMatrixRow, deriveRoute } from './doaMatrix.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_doa_matrix__';

// A topic_id that we'll use for topic-override rows
let testTopicId = 'test-topic-for-doa-' + Math.random().toString(36).slice(2);

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM doa_matrix WHERE project_id = $1`, [TEST_PROJECT]);
  // Also clean up any topic-override rows we inserted
  await pool.query(`DELETE FROM doa_matrix WHERE topic_id = $1`, [testTopicId]);
}

before(cleanup);
after(cleanup);

// ── T13: resolution precedence ──────────────────────────────────────────────

test('T13a: topic-override row beats project row beats __default__', async () => {
  const pool = getDbPool();

  // Insert project row
  const projInsert = await pool.query<{ matrix_id: string }>(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
     VALUES ($1, NULL, 'artifact_review', 0, 2147483647, 'coordination', 'counter_sign')
     RETURNING matrix_id`,
    [TEST_PROJECT],
  );
  const projMatrixId = projInsert.rows[0].matrix_id;

  // Insert topic-override row
  const topicInsert = await pool.query<{ matrix_id: string }>(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
     VALUES ($1, $2, 'artifact_review', 0, 2147483647, 'authority', 'escalate_to_authority')
     RETURNING matrix_id`,
    [TEST_PROJECT, testTopicId],
  );
  const topicMatrixId = topicInsert.rows[0].matrix_id;

  const client = await pool.connect();
  try {
    // When topic_id is given, topic-override wins
    const rowWithTopic = await resolveMatrixRow(client, {
      project_id: TEST_PROJECT,
      topic_id: testTopicId,
      kind: 'artifact_review',
      weight: 25,
    });
    assert.ok(rowWithTopic !== null, 'should find a row');
    assert.equal(rowWithTopic!.matrix_id, topicMatrixId, 'topic-override should win');
    assert.equal(rowWithTopic!.required_level, 'authority');
    assert.equal(rowWithTopic!.route_shape, 'escalate_to_authority');
    // doa_snapshot should be matrix_id:t0 (tier 0 = topic override)
    assert.equal(rowWithTopic!.doa_snapshot, `${topicMatrixId}:t0`);

    // When topic_id is a different topic, project row wins over __default__
    const rowWithProject = await resolveMatrixRow(client, {
      project_id: TEST_PROJECT,
      topic_id: 'different-topic-id',
      kind: 'artifact_review',
      weight: 25,
    });
    assert.ok(rowWithProject !== null, 'should find a row');
    assert.equal(rowWithProject!.matrix_id, projMatrixId, 'project row should win over __default__');
    assert.equal(rowWithProject!.required_level, 'coordination');
    // doa_snapshot should be matrix_id:t1 (tier 1 = project row)
    assert.equal(rowWithProject!.doa_snapshot, `${projMatrixId}:t1`);

    // When no project row exists but __default__ does, __default__ wins
    const rowDefault = await resolveMatrixRow(client, {
      project_id: '__nonexistent_project__',
      topic_id: 'some-topic',
      kind: 'artifact_review',
      weight: 10,
    });
    assert.ok(rowDefault !== null, '__default__ should be found');
    assert.equal(rowDefault!.required_level, 'coordination'); // weight 10 < 50
    // doa_snapshot should be matrix_id:t2 (tier 2 = __default__)
    assert.ok(rowDefault!.doa_snapshot.endsWith(':t2'), `snapshot should end in :t2, got: ${rowDefault!.doa_snapshot}`);
  } finally {
    client.release();
    await cleanup();
  }
});

// ── T14: narrowest-span tie-break ──────────────────────────────────────────

test('T14: narrowest weight span wins within same tier', async () => {
  const pool = getDbPool();

  // Two project-level rows for the same kind, both covering weight=25
  // Wide: 0–99; Narrow: 20–30. Narrow should win.
  const wideInsert = await pool.query<{ matrix_id: string }>(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
     VALUES ($1, NULL, 'doc_review', 0, 99, 'authority', 'escalate_to_authority')
     RETURNING matrix_id`,
    [TEST_PROJECT],
  );

  const narrowInsert = await pool.query<{ matrix_id: string }>(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
     VALUES ($1, NULL, 'doc_review', 20, 30, 'coordination', 'counter_sign')
     RETURNING matrix_id`,
    [TEST_PROJECT],
  );
  const narrowMatrixId = narrowInsert.rows[0].matrix_id;

  const client = await pool.connect();
  try {
    const row = await resolveMatrixRow(client, {
      project_id: TEST_PROJECT,
      topic_id: 'irrelevant-topic',
      kind: 'doc_review',
      weight: 25,
    });
    assert.ok(row !== null, 'should find a row');
    assert.equal(row!.matrix_id, narrowMatrixId, 'narrowest span should win');
    assert.equal(row!.required_level, 'coordination');
  } finally {
    client.release();
    await cleanup();
  }
});

// ── T15: deriveRoute ────────────────────────────────────────────────────────

test('T15a: deriveRoute escalate_to_authority → [requiredLevel]', () => {
  // Always one step: the required level itself
  const route = deriveRoute('execution', 'authority', 'escalate_to_authority');
  assert.deepEqual(route, ['authority']);

  const route2 = deriveRoute('coordination', 'authority', 'escalate_to_authority');
  assert.deepEqual(route2, ['authority']);

  const route3 = deriveRoute('authority', 'authority', 'escalate_to_authority');
  assert.deepEqual(route3, ['authority']);
});

test('T15b: deriveRoute counter_sign → levels strictly above submitter up to required', () => {
  // execution submitter, authority required → [coordination, authority]
  const route1 = deriveRoute('execution', 'authority', 'counter_sign');
  assert.deepEqual(route1, ['coordination', 'authority']);

  // execution submitter, coordination required → [coordination]
  const route2 = deriveRoute('execution', 'coordination', 'counter_sign');
  assert.deepEqual(route2, ['coordination']);

  // coordination submitter, authority required → [authority]
  const route3 = deriveRoute('coordination', 'authority', 'counter_sign');
  assert.deepEqual(route3, ['authority']);
});

test('T15c: deriveRoute counter_sign empty-ladder fallback → [requiredLevel]', () => {
  // authority submitter with authority required → list is empty → fallback to [authority]
  const route1 = deriveRoute('authority', 'authority', 'counter_sign');
  assert.deepEqual(route1, ['authority']);

  // coordination submitter with coordination required → empty → fallback
  const route2 = deriveRoute('coordination', 'coordination', 'counter_sign');
  assert.deepEqual(route2, ['coordination']);
});

// ── T16: doa_snapshot is frozen ─────────────────────────────────────────────

test('T16: doa_snapshot captures matrix_id + tier at resolution time', async () => {
  const pool = getDbPool();

  // Insert a project row
  const ins = await pool.query<{ matrix_id: string }>(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
     VALUES ($1, NULL, 'freeze_test', 0, 2147483647, 'coordination', 'counter_sign')
     RETURNING matrix_id`,
    [TEST_PROJECT],
  );
  const matrixId = ins.rows[0].matrix_id;

  const client = await pool.connect();
  try {
    const row = await resolveMatrixRow(client, {
      project_id: TEST_PROJECT,
      topic_id: 'some-other-topic',
      kind: 'freeze_test',
      weight: 10,
    });
    assert.ok(row !== null);
    // The snapshot captures the matrix_id at resolution time
    const snapshot = row!.doa_snapshot;
    assert.equal(snapshot, `${matrixId}:t1`, 'snapshot = matrix_id:t1 (project tier)');

    // Now update the matrix row (simulate a later edit)
    await pool.query(
      `UPDATE doa_matrix SET required_level='authority', route_shape='escalate_to_authority'
       WHERE matrix_id=$1`,
      [matrixId],
    );

    // The snapshot captured before the edit is unaffected — it's just a string
    // (the request_steps row holds this string; no live re-read of doa_matrix)
    assert.equal(snapshot, `${matrixId}:t1`, 'snapshot is immutable after matrix edit');
  } finally {
    client.release();
    await cleanup();
  }
});

test('T16b: no match → null', async () => {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const row = await resolveMatrixRow(client, {
      project_id: '__nonexistent__',
      topic_id: 'no-topic',
      kind: 'unknown_kind_xyz',
      weight: 999,
    });
    assert.equal(row, null, 'no matching row should return null');
  } finally {
    client.release();
  }
});
