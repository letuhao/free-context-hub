/**
 * Phase 15 Sprint 15.11 — proxy voting grants (DEFERRED-017 Q3).
 *
 * A `proxies` row records that `principal` authorized `proxy` to cast their ballot
 * in `body_id`. `castVote(proxy_for)` verifies a grant exists (auth-on) before
 * recording the principal's weighted vote as cast-by-proxy.
 *
 * Authorization: only the PRINCIPAL may delegate their own vote — `granted_by`
 * must equal `principal`. Auth-on: `granted_by` is bound to the caller's apiKeyName
 * (15.3.1 F1), so the caller must BE the principal. `proxies` is body-scoped config
 * (no event log — mirrors body_members / decision_bodies).
 *
 * §0.1 — grant/revoke are single-statement (atomic without an explicit transaction);
 * list is a plain read.
 */

import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';

const MAX_FIELD_LEN = 256;

export type GrantProxyResult =
  | { status: 'ok'; body_id: string; principal: string; proxy: string }
  | { status: 'body_not_found' }
  | { status: 'principal_not_member' }
  | { status: 'not_authorized' };

export type RevokeProxyResult = { status: 'ok' | 'not_found' };

export type ProxyRecord = {
  principal: string;
  proxy: string;
  granted_by: string;
  granted_at: string;
};

/**
 * Grant a proxy: principal authorizes proxy to cast on their behalf in body_id.
 * Only the principal may grant (granted_by === principal). Principal must be a
 * body member. Idempotent (ON CONFLICT DO NOTHING).
 */
export async function grantProxy(params: {
  body_id: string;
  principal: string;
  proxy: string;
  granted_by: string;
}): Promise<GrantProxyResult> {
  const bodyId = (params.body_id ?? '').trim();
  const principal = (params.principal ?? '').trim();
  const proxy = (params.proxy ?? '').trim();
  const grantedBy = (params.granted_by ?? '').trim();

  if (!bodyId || !principal || !proxy || !grantedBy) {
    throw new ContextHubError('BAD_REQUEST', 'body_id, principal, proxy, granted_by are all required');
  }
  if (principal.length > MAX_FIELD_LEN || proxy.length > MAX_FIELD_LEN) {
    throw new ContextHubError('BAD_REQUEST', `principal and proxy must be at most ${MAX_FIELD_LEN} characters`);
  }
  if (principal === proxy) {
    throw new ContextHubError('BAD_REQUEST', 'principal and proxy must differ (a self-proxy is a direct vote)');
  }
  // Only the principal may delegate their own vote.
  if (grantedBy !== principal) {
    return { status: 'not_authorized' };
  }

  const pool = getDbPool();

  // body must exist + principal must be a member
  const bodyRes = await pool.query(`SELECT 1 FROM decision_bodies WHERE body_id=$1`, [bodyId]);
  if (bodyRes.rowCount === 0) {
    return { status: 'body_not_found' };
  }
  const memberRes = await pool.query(
    `SELECT 1 FROM body_members WHERE body_id=$1 AND actor_id=$2`,
    [bodyId, principal],
  );
  if (memberRes.rowCount === 0) {
    return { status: 'principal_not_member' };
  }

  await pool.query(
    `INSERT INTO proxies (body_id, principal, proxy, granted_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (body_id, principal, proxy) DO NOTHING`,
    [bodyId, principal, proxy, grantedBy],
  );
  return { status: 'ok', body_id: bodyId, principal, proxy };
}

/** Revoke a proxy grant. */
export async function revokeProxy(params: {
  body_id: string;
  principal: string;
  proxy: string;
}): Promise<RevokeProxyResult> {
  const bodyId = (params.body_id ?? '').trim();
  const principal = (params.principal ?? '').trim();
  const proxy = (params.proxy ?? '').trim();
  if (!bodyId || !principal || !proxy) {
    throw new ContextHubError('BAD_REQUEST', 'body_id, principal, proxy are all required');
  }
  const pool = getDbPool();
  const res = await pool.query(
    `DELETE FROM proxies WHERE body_id=$1 AND principal=$2 AND proxy=$3`,
    [bodyId, principal, proxy],
  );
  return { status: (res.rowCount ?? 0) > 0 ? 'ok' : 'not_found' };
}

/** List all proxy grants for a body. */
export async function listProxies(params: { body_id: string }): Promise<{ proxies: ProxyRecord[] }> {
  const bodyId = (params.body_id ?? '').trim();
  if (!bodyId) throw new ContextHubError('BAD_REQUEST', 'body_id is required');
  const pool = getDbPool();
  const res = await pool.query<{ principal: string; proxy: string; granted_by: string; granted_at: Date }>(
    `SELECT principal, proxy, granted_by, granted_at FROM proxies WHERE body_id=$1 ORDER BY granted_at`,
    [bodyId],
  );
  return {
    proxies: res.rows.map((r) => ({
      principal: r.principal,
      proxy: r.proxy,
      granted_by: r.granted_by,
      granted_at: r.granted_at.toISOString(),
    })),
  };
}
