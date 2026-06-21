/**
 * Actor Data Boundary S1 — authzDecisions read-layer tests (real DB).
 *
 * Covers the NET-NEW reader over authz_decisions:
 *   - clampLimit / encodeCursor (pure)
 *   - filter validation → BAD_REQUEST (principal_id, action, origin, since, until, cursor)
 *   - listAuthzDecisions: newest-first ordering, filters, keyset pagination + next_cursor
 *   - getAuthzDecisionStats: totals, allow/deny split, per-reason/action/origin histograms,
 *     distinct-principal count — over the SAME window as the list
 *
 * Rows are inserted DIRECTLY (the table is what authorize() appends to) so the read layer is exercised
 * deterministically and independently of the auth-on toggle.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import {
  listAuthzDecisions,
  getAuthzDecisionStats,
  clampLimit,
  encodeCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './authzDecisions.js';

// A dedicated principal id so the window is hermetic — every filter pins principal_id to it.
const PRINCIPAL = randomUUID();
const OTHER_PRINCIPAL = randomUUID();

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM authz_decisions WHERE principal_id IN ($1, $2)`, [PRINCIPAL, OTHER_PRINCIPAL]);
}

/** Insert one decision row with an explicit ts so ordering is deterministic. */
async function insertRow(opts: {
  principal_id?: string | null;
  action?: string;
  resource_kind?: string;
  resource_id?: string | null;
  allow?: boolean;
  reason?: string;
  matched_grant_id?: string | null;
  origin?: string;
  ts: string;
}): Promise<string> {
  const pool = getDbPool();
  const r = await pool.query<{ decision_id: string }>(
    `INSERT INTO authz_decisions
       (ts, principal_id, action, resource_kind, resource_id, allow, reason, matched_grant_id, origin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING decision_id`,
    [
      opts.ts,
      opts.principal_id ?? PRINCIPAL,
      opts.action ?? 'read',
      opts.resource_kind ?? 'project',
      opts.resource_id ?? 'projX',
      opts.allow ?? true,
      opts.reason ?? 'GRANT',
      opts.matched_grant_id ?? null,
      opts.origin ?? 'access',
    ],
  );
  return r.rows[0].decision_id;
}

before(async () => {
  await cleanup();
  // Five rows for PRINCIPAL spanning a deterministic time window, plus one for OTHER_PRINCIPAL.
  await insertRow({ ts: '2026-06-21T10:00:00Z', allow: true, reason: 'GRANT', action: 'read', origin: 'access' });
  await insertRow({ ts: '2026-06-21T10:01:00Z', allow: false, reason: 'NO_COVERING_GRANT', action: 'write', origin: 'access' });
  await insertRow({ ts: '2026-06-21T10:02:00Z', allow: true, reason: 'ROOT', action: 'admin', origin: 'tool_auth' });
  await insertRow({ ts: '2026-06-21T10:03:00Z', allow: false, reason: 'PRINCIPAL_INACTIVE', action: 'read', origin: 'delegation_check' });
  await insertRow({ ts: '2026-06-21T10:04:00Z', allow: true, reason: 'GRANT', action: 'delegate', origin: 'access' });
  await insertRow({ ts: '2026-06-21T10:05:00Z', principal_id: OTHER_PRINCIPAL, allow: true, reason: 'GRANT' });
});

after(cleanup);

// ── pure helpers ────────────────────────────────────────────────────────────

test('clampLimit clamps and defaults', () => {
  assert.equal(clampLimit(undefined), DEFAULT_LIMIT);
  assert.equal(clampLimit(0), DEFAULT_LIMIT);
  assert.equal(clampLimit(-5), DEFAULT_LIMIT);
  assert.equal(clampLimit(10), 10);
  assert.equal(clampLimit(99999), MAX_LIMIT);
  assert.equal(clampLimit(10.9), 10);
});

test('encodeCursor renders the (ts, decision_id) tuple', () => {
  const id = randomUUID();
  assert.equal(encodeCursor({ ts: '2026-06-21T10:00:00Z', decision_id: id }), `2026-06-21T10:00:00Z|${id}`);
});

// ── filter validation ───────────────────────────────────────────────────────

test('listAuthzDecisions rejects a non-UUID principal_id', async () => {
  await assert.rejects(
    () => listAuthzDecisions({ principal_id: 'not-a-uuid' }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('listAuthzDecisions rejects an invalid action', async () => {
  await assert.rejects(
    () => listAuthzDecisions({ action: 'destroy' as never }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('listAuthzDecisions rejects an invalid origin', async () => {
  await assert.rejects(
    () => listAuthzDecisions({ origin: 'bogus' as never }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('listAuthzDecisions rejects a malformed since', async () => {
  await assert.rejects(
    () => listAuthzDecisions({ since: 'yesterday' }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('listAuthzDecisions rejects a malformed cursor', async () => {
  await assert.rejects(
    () => listAuthzDecisions({ principal_id: PRINCIPAL, cursor: 'garbage-no-pipe' }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

// ── list ──────────────────────────────────────────────────────────────────

test('listAuthzDecisions returns the principal window newest-first', async () => {
  const { decisions, next_cursor } = await listAuthzDecisions({ principal_id: PRINCIPAL });
  assert.equal(decisions.length, 5);
  assert.equal(next_cursor, null, 'all 5 fit in one default page');
  // newest first
  assert.equal(decisions[0].action, 'delegate');
  assert.equal(decisions[0].ts.startsWith('2026-06-21'), true);
  // strictly descending ts
  for (let i = 1; i < decisions.length; i++) {
    assert.ok(decisions[i - 1].ts >= decisions[i].ts, 'ts must be non-increasing');
  }
});

test('listAuthzDecisions allow=false returns only denies', async () => {
  const { decisions } = await listAuthzDecisions({ principal_id: PRINCIPAL, allow: false });
  assert.equal(decisions.length, 2);
  assert.equal(decisions.every((d) => d.allow === false), true);
});

test('listAuthzDecisions action filter narrows', async () => {
  const { decisions } = await listAuthzDecisions({ principal_id: PRINCIPAL, action: 'read' });
  assert.equal(decisions.length, 2);
  assert.equal(decisions.every((d) => d.action === 'read'), true);
});

test('listAuthzDecisions origin filter narrows', async () => {
  const { decisions } = await listAuthzDecisions({ principal_id: PRINCIPAL, origin: 'access' });
  assert.equal(decisions.length, 3);
  assert.equal(decisions.every((d) => d.origin === 'access'), true);
});

test('listAuthzDecisions time window (since/until) is inclusive/exclusive', async () => {
  const { decisions } = await listAuthzDecisions({
    principal_id: PRINCIPAL,
    since: '2026-06-21T10:01:00Z',
    until: '2026-06-21T10:03:00Z',
  });
  // since inclusive (10:01), until exclusive (10:03) → 10:01 + 10:02
  assert.equal(decisions.length, 2);
});

test('listAuthzDecisions keyset-paginates with next_cursor', async () => {
  const page1 = await listAuthzDecisions({ principal_id: PRINCIPAL, limit: 2 });
  assert.equal(page1.decisions.length, 2);
  assert.ok(page1.next_cursor, 'first page has a cursor');

  const page2 = await listAuthzDecisions({ principal_id: PRINCIPAL, limit: 2, cursor: page1.next_cursor });
  assert.equal(page2.decisions.length, 2);
  assert.ok(page2.next_cursor, 'second page still has more');

  const page3 = await listAuthzDecisions({ principal_id: PRINCIPAL, limit: 2, cursor: page2.next_cursor });
  assert.equal(page3.decisions.length, 1);
  assert.equal(page3.next_cursor, null, 'last page has no cursor');

  // No row is repeated across pages, and all 5 are seen.
  const seen = [...page1.decisions, ...page2.decisions, ...page3.decisions].map((d) => d.decision_id);
  assert.equal(new Set(seen).size, 5);
});

// ── stats ─────────────────────────────────────────────────────────────────

test('getAuthzDecisionStats rolls up the same window', async () => {
  const stats = await getAuthzDecisionStats({ principal_id: PRINCIPAL });
  assert.equal(stats.total, 5);
  assert.equal(stats.allowed, 3);
  assert.equal(stats.denied, 2);
  assert.equal(stats.distinct_principals, 1);
  assert.equal(stats.by_reason['GRANT'], 2);
  assert.equal(stats.by_reason['ROOT'], 1);
  assert.equal(stats.by_action['read'], 2);
  assert.equal(stats.by_origin['access'], 3);
});

test('getAuthzDecisionStats honors the allow filter', async () => {
  const stats = await getAuthzDecisionStats({ principal_id: PRINCIPAL, allow: false });
  assert.equal(stats.total, 2);
  assert.equal(stats.allowed, 0);
  assert.equal(stats.denied, 2);
});
