/**
 * Actor Data Boundary F2g / DEFERRED-050 — the notification "user" is the authenticated principal, and a
 * notification carrying a project the caller can't read is dropped (defense-in-depth).
 *
 * Two layers:
 *  - `notificationUserOf(req)` derives the user from the principal and NEVER honors a request-supplied
 *    `user_id` (the cross-user isolation hole). Pure, no DB.
 *  - `listNotifications` filters the activity_log JOIN to projects the principal can read (D2). DB-backed.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { notificationUserOf, LOCAL_NOTIFICATION_USER } from '../api/routes/activity.js';
import { listNotifications } from './activity.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { getDbPool } from '../db/client.js';

// ── layer 1: the pure derivation (no DB, no auth toggle) ──────────────────────
test('notificationUserOf: returns the bound principal id when present', () => {
  assert.equal(notificationUserOf({ apiKeyPrincipalId: 'principal-123' } as any), 'principal-123');
});
test('notificationUserOf: falls back to the dev user when no principal is bound', () => {
  assert.equal(notificationUserOf({} as any), LOCAL_NOTIFICATION_USER);
});
test('notificationUserOf: IGNORES a request-supplied user_id (the isolation hole)', () => {
  // an attacker passing user_id in query/body must NOT be able to address another user's notifications.
  assert.equal(
    notificationUserOf({ query: { user_id: 'victim' }, body: { user_id: 'victim' } } as any),
    LOCAL_NOTIFICATION_USER,
  );
});

// ── layer 2: listNotifications drops rows for projects the principal can't read ─
const PREFIX = '__test_notif050__';
const PA = `${PREFIX}readable`;   // principal A can read
const PB = `${PREFIX}foreign`;    // principal A canNOT read
let userA: string;
let grantor: string;
const saved = { auth: process.env.MCP_AUTH_ENABLED };

async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM notifications WHERE user_id IN (SELECT principal_id::text FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM activity_log WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM projects WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

before(async () => {
  await cleanup();
  const pool = getDbPool();
  userA = (await createPrincipal({ kind: 'human', display_name: `${PREFIX}userA` })).principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,$1),($2,$2)`, [PA, PB]);
  await createGrant({ grantee_principal: userA, scope_type: 'project', scope_id: PA, capability: 'read', granted_by: grantor });
  // two activity events (one per project) → a notification for userA on EACH.
  const mkEvent = async (project: string, title: string) => {
    const r = await pool.query<{ activity_id: string }>(
      `INSERT INTO activity_log (project_id, event_type, title) VALUES ($1,'lesson.created',$2) RETURNING activity_id`,
      [project, title],
    );
    await pool.query(`INSERT INTO notifications (user_id, activity_id) VALUES ($1,$2)`, [userA, r.rows[0].activity_id]);
  };
  await mkEvent(PA, 'readable event');
  await mkEvent(PB, 'foreign event');
  await setAuth(true);
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED; else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

test('listNotifications: drops a notification whose project the principal cannot read; unread_count reflects the visible set', async () => {
  const res = await listNotifications({ userId: userA, actingPrincipalId: userA });
  assert.equal(res.items.length, 1, 'only the readable-project notification is returned');
  assert.equal(res.items[0].project_id, PA);
  assert.equal(res.unread_count, 1, 'unread_count counts only visible notifications');
});

// NB: the auth-OFF short-circuit (authorize → AUTH_DISABLED → every row kept) is NOT re-tested here on
// purpose. Flipping MCP_AUTH_ENABLED OFF mid-file opens a process-global auth-OFF window that races other
// auth-ON test files in the shared suite run; the AUTH_DISABLED path is already covered in authorize.test.ts.
// This file keeps auth ON for its whole run (before→ON, after→restore), matching the other authz suites.
