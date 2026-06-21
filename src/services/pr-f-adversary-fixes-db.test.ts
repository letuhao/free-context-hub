/**
 * DEFERRED-029 PR F — REAL-DB regression for SEC-2 (cross-tenant intake triage → no event-log
 * injection). The jobQueue SEC-1/3/5/6 cases that once lived here tested the legacy callerScope
 * auto-bind/short-circuit semantics; F2f replaced jobQueue's guard with authorize() + the global-grant
 * gate (DEFERRED-045), so their actor-native equivalents now live in `jobqueue-authz.test.ts`.
 *
 *   SEC-2: a principal scoped to proj-A cannot triage its intake to a route.topic_id in proj-B. Under
 *   auth-ON authorize() rejects the cross-tenant topic write (FORBIDDEN) BEFORE any UPDATE/appendEvent.
 *   Concrete proof: proj-B's coordination_events count is identical before + after (no injection), and
 *   the intake row is not mutated.
 *
 * Requires DATABASE_URL — run via `npm test` against the dev stack.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

import { submitIntake, triageIntake } from './intake.js';
import { charterTopic, joinTopic } from './topics.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { _resetEnvCacheForTest } from '../env.js';

const isForbidden = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'FORBIDDEN';

/** F2f: mint a principal granted `capability` over `project`, returning its id. */
async function grantedPrincipal(name: string, project: string, capability: 'read' | 'write' | 'admin'): Promise<string> {
  const p = (await createPrincipal({ kind: 'agent', display_name: name })).principal_id;
  await createGrant({ grantee_principal: p, scope_type: 'project', scope_id: project, capability, granted_by: p });
  return p;
}
async function dropPrincipal(id: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(`DELETE FROM grants WHERE grantee_principal=$1 OR granted_by=$1`, [id]);
  await pool.query(`DELETE FROM principals WHERE principal_id=$1`, [id]);
}

const PROJ_A = '__sec_db_A__';
const PROJ_B = '__sec_db_B__';
const ACTOR_A = 'sec-db-actor-A';
const ACTOR_B = 'sec-db-actor-B';

async function purge(projectId: string) {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(`SELECT topic_id FROM topics WHERE project_id=$1`, [projectId]);
  for (const { topic_id } of topicIds.rows) {
    await pool.query(`DELETE FROM intake_items WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM topic_participants WHERE topic_id=$1`, [topic_id]);
  }
  await pool.query(`DELETE FROM intake_items WHERE project_id=$1`, [projectId]);
  await pool.query(`DELETE FROM topics WHERE project_id=$1`, [projectId]);
  await pool.query(`DELETE FROM actors WHERE project_id=$1`, [projectId]);
  await pool.query(`DELETE FROM projects WHERE project_id=$1`, [projectId]);
}

async function makeProject(projectId: string) {
  const pool = getDbPool();
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [projectId, `PR F SEC DB Test ${projectId}`]);
}

async function makeActiveTopic(projectId: string, actorId: string): Promise<string> {
  const result = await charterTopic({ project_id: projectId, name: `topic-${projectId}`, charter: 'sec-db test', created_by: actorId });
  await joinTopic({ topic_id: result.topic_id, actor_id: actorId, level: 'authority', actor_type: 'human', display_name: actorId });
  return result.topic_id;
}

before(async () => {
  _resetEnvCacheForTest();
  await purge(PROJ_A);
  await purge(PROJ_B);
  await makeProject(PROJ_A);
  await makeProject(PROJ_B);
});
after(async () => {
  await purge(PROJ_A);
  await purge(PROJ_B);
});

// ── SEC-2 — triageIntake cross-tenant route.topic_id rejected, NO event written ──

test('SEC-2 DB: scoped intake triaged to cross-tenant topic → FORBIDDEN + no coordination_events injected', async () => {
  const topicA = await makeActiveTopic(PROJ_A, ACTOR_A);
  const topicB = await makeActiveTopic(PROJ_B, ACTOR_B);

  // Submit an intake owned by proj-A (setup runs auth-OFF; the gate is inert here).
  const intake = await submitIntake({ project_id: PROJ_A, kind: 'suggestion', body: 'SEC-2 DB regression intake', submitted_by: ACTOR_A });
  assert.equal(intake.status, 'received');

  const pool = getDbPool();
  const beforeRes = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM coordination_events WHERE topic_id=$1`, [topicB]);
  const beforeCount = parseInt(beforeRes.rows[0]?.n ?? '0', 10);

  // F2f: scopedA is granted write@PROJ_A only. Under auth-ON the cross-tenant triage (route.topic_id in
  // PROJ_B) is rejected by authorize() on the topic — a write-deny on a resolvable cross-tenant topic →
  // FORBIDDEN — BEFORE any UPDATE/appendEvent. (Pre-F2f assertTopicScope gave NOT_FOUND; no-injection identical.)
  const originalAuth = process.env.MCP_AUTH_ENABLED;
  const scopedA = await grantedPrincipal('__sec_db_scopedA__', PROJ_A, 'write');
  process.env.MCP_AUTH_ENABLED = 'true';
  _resetEnvCacheForTest();
  try {
    await assert.rejects(
      triageIntake(
        intake.intake_id,
        { route_kind: 'task' as const, actor_id: ACTOR_A, topic_id: topicB, routed_to: 'arbitrary-task-id' },
        { actingPrincipalId: scopedA },
      ),
      isForbidden,
    );
  } finally {
    if (originalAuth === undefined) delete process.env.MCP_AUTH_ENABLED;
    else process.env.MCP_AUTH_ENABLED = originalAuth;
    _resetEnvCacheForTest();
    await dropPrincipal(scopedA);
  }

  const afterRes = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM coordination_events WHERE topic_id=$1`, [topicB]);
  const afterCount = parseInt(afterRes.rows[0]?.n ?? '0', 10);
  assert.equal(afterCount, beforeCount, `SEC-2 regressed: ${afterCount - beforeCount} cross-tenant coordination_events injected into proj-B`);

  const intakeRow = await pool.query<{ topic_id: string | null; status: string }>(`SELECT topic_id, status FROM intake_items WHERE intake_id=$1`, [intake.intake_id]);
  assert.equal(intakeRow.rows[0]?.topic_id, null, 'SEC-2 regressed: intake.topic_id flipped to cross-tenant');
  assert.equal(intakeRow.rows[0]?.status, 'received', 'SEC-2 regressed: intake.status flipped to triaged despite rejection');

  await pool.query(`DELETE FROM coordination_events WHERE topic_id IN ($1, $2)`, [topicA, topicB]);
  await pool.query(`DELETE FROM topic_participants WHERE topic_id IN ($1, $2)`, [topicA, topicB]);
  await pool.query(`DELETE FROM topics WHERE topic_id IN ($1, $2)`, [topicA, topicB]);
});

test('SEC-2 DB: scoped intake triaged to OWN-tenant topic still works (positive control, auth-off)', async () => {
  const topicA = await makeActiveTopic(PROJ_A, ACTOR_A);
  const intake = await submitIntake({ project_id: PROJ_A, kind: 'suggestion', body: 'SEC-2 positive-control intake', submitted_by: ACTOR_A });

  const result = await triageIntake(
    intake.intake_id,
    { route_kind: 'task' as const, actor_id: ACTOR_A, topic_id: topicA, routed_to: 'same-tenant-task' },
  );
  assert.equal(result.status, 'triaged');
  assert.equal(result.routed_to, 'same-tenant-task');

  const pool = getDbPool();
  await pool.query(`DELETE FROM coordination_events WHERE topic_id=$1`, [topicA]);
  await pool.query(`DELETE FROM topic_participants WHERE topic_id=$1`, [topicA]);
  await pool.query(`DELETE FROM topics WHERE topic_id=$1`, [topicA]);
});
