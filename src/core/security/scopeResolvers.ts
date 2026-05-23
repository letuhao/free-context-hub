/**
 * DEFERRED-029 PR C — service-layer scope resolvers for entity-id-based fns.
 *
 * Many coordination services accept an entity id (topic_id / task_id / motion_id /
 * dispute_id / intake_id / request_id / body_id / artifact_id) rather than a
 * project_id. To enforce tenant scope service-side (so REST + MCP both inherit), we
 * DB-derive the entity's project_id and compare to the caller's scope.
 *
 * Queries mirror `src/api/middleware/requireResourceScope.ts` (single source of truth
 * for entity → project mapping). Cross-tenant + unknown both yield ContextHubError
 * NOT_FOUND — the same no-existence-oracle posture as the REST middleware.
 */

import type { Pool, PoolClient } from 'pg';
import { ContextHubError } from '../errors.js';
import type { CallerScope } from './callerScope.js';

type Conn = Pool | PoolClient;

async function deriveAndAssert(c: Conn, callerScope: CallerScope, sql: string, id: string): Promise<void> {
  if (callerScope === undefined || callerScope === null) return;
  const r = await c.query<{ project_id: string }>(sql, [id]);
  if (!r.rowCount || r.rows[0].project_id !== callerScope) {
    throw new ContextHubError('NOT_FOUND', 'not found');
  }
}

export const assertTopicScope    = (c: Conn, s: CallerScope, id: string) =>
  deriveAndAssert(c, s, `SELECT project_id FROM topics WHERE topic_id = $1`, id);
export const assertTaskScope     = (c: Conn, s: CallerScope, id: string) =>
  deriveAndAssert(c, s, `SELECT t.project_id FROM tasks tk JOIN topics t ON t.topic_id = tk.topic_id WHERE tk.task_id = $1`, id);
export const assertMotionScope   = (c: Conn, s: CallerScope, id: string) =>
  deriveAndAssert(c, s, `SELECT t.project_id FROM motions m JOIN topics t ON t.topic_id = m.topic_id WHERE m.motion_id = $1`, id);
export const assertDisputeScope  = (c: Conn, s: CallerScope, id: string) =>
  deriveAndAssert(c, s, `SELECT t.project_id FROM disputes d JOIN topics t ON t.topic_id = d.topic_id WHERE d.dispute_id = $1`, id);
export const assertRequestScope  = (c: Conn, s: CallerScope, id: string) =>
  deriveAndAssert(c, s, `SELECT t.project_id FROM requests r JOIN topics t ON t.topic_id = r.topic_id WHERE r.request_id = $1`, id);
export const assertIntakeScope   = (c: Conn, s: CallerScope, id: string) =>
  deriveAndAssert(c, s, `SELECT project_id FROM intake_items WHERE intake_id = $1`, id);
export const assertBodyScope     = (c: Conn, s: CallerScope, id: string) =>
  deriveAndAssert(c, s, `SELECT project_id FROM decision_bodies WHERE body_id = $1`, id);
export const assertArtifactScope = (c: Conn, s: CallerScope, id: string) =>
  deriveAndAssert(c, s, `SELECT t.project_id FROM artifacts a JOIN tasks tk ON tk.task_id = a.task_id JOIN topics t ON t.topic_id = tk.topic_id WHERE a.artifact_id = $1`, id);
