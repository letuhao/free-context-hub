/**
 * Actor Data Boundary S1 — the authz_decisions READ layer (net-new).
 *
 * authorize() (services/authorize.ts:255) APPENDS one row per decision to `authz_decisions`
 * (allow + deny, root short-circuit, every origin). Until now the ONLY reader was the test suite —
 * nothing in the product surfaced the decision log. This module is that reader: a paginated,
 * filtered, time-windowed query plus an aggregate stats roll-up, for the governance GUI's
 * Authorization page (decision log + stats cards) via GET /api/authz/decisions.
 *
 * Security posture (this is a safety-sensitive read — it exposes who-tried-what):
 *   - The ROUTE is admin@global gated (routes/authorization.ts); this service is the pure query.
 *   - No PII is stored in the table beyond principal_id (a UUID) + caller-supplied resource_id
 *     (already length-capped to 256 at write time, authorize.ts:276). We never widen the row.
 *   - Filters are parameterized (no SQL injection); enum-shaped filters are whitelist-validated so a
 *     malformed value is a clean BAD_REQUEST, never a 22P02 or an unindexed scan.
 *   - Pagination is bounded (limit ≤ MAX_LIMIT) so a single call cannot exfiltrate the whole log or
 *     pin the DB. Cursor is the immutable (ts, decision_id) tuple — stable under concurrent appends.
 *
 * Mirrors the row schema in migrations/0067_authz_decisions.sql + 0068_authz_decision_origin.sql.
 */

import { validate as isUuid } from 'uuid';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';

export type AuthzAction = 'read' | 'write' | 'admin' | 'delegate';
export type AuthzOrigin = 'access' | 'delegation_check' | 'tool_auth';

const ACTIONS: readonly AuthzAction[] = ['read', 'write', 'admin', 'delegate'];
const ORIGINS: readonly AuthzOrigin[] = ['access', 'delegation_check', 'tool_auth'];

/** One row of the decision log, exactly as the table stores it. */
export interface AuthzDecisionRow {
  decision_id: string;
  ts: string;
  principal_id: string | null;
  action: string;
  resource_kind: string;
  resource_id: string | null;
  allow: boolean;
  reason: string;
  matched_grant_id: string | null;
  origin: string;
}

export interface ListAuthzDecisionsFilter {
  /** Filter to a single principal. Non-UUID input is a clean BAD_REQUEST (the column is TEXT, but the
   *  product only ever writes UUIDs / NULL; a non-UUID filter can match nothing useful and is almost
   *  always a client bug — reject loudly rather than silently returning []). */
  principal_id?: string | null;
  action?: AuthzAction;
  /** true → only allows; false → only denies; undefined → both. */
  allow?: boolean;
  origin?: AuthzOrigin;
  /** Inclusive lower bound on ts (ISO-8601). */
  since?: string;
  /** Exclusive upper bound on ts (ISO-8601). */
  until?: string;
}

export interface ListAuthzDecisionsParams extends ListAuthzDecisionsFilter {
  /** Page size; clamped to [1, MAX_LIMIT]. Defaults to DEFAULT_LIMIT. */
  limit?: number;
  /** Keyset cursor from a prior page's `next_cursor` (opaque (ts, decision_id) tuple). */
  cursor?: string | null;
}

export interface ListAuthzDecisionsResult {
  decisions: AuthzDecisionRow[];
  /** Opaque cursor to fetch the next (older) page, or null when the page is the last. */
  next_cursor: string | null;
}

export interface AuthzDecisionStats {
  total: number;
  allowed: number;
  denied: number;
  /** Counts keyed by reason token (ROOT / GRANT / NO_COVERING_GRANT / …). */
  by_reason: Record<string, number>;
  /** Counts keyed by action verb. */
  by_action: Record<string, number>;
  /** Counts keyed by origin (access / delegation_check / tool_auth). */
  by_origin: Record<string, number>;
  /** Distinct principals that appear in the window (NULL principal excluded). */
  distinct_principals: number;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

// `ts` is rendered as an explicit ISO-8601 UTC string (NOT the default node-pg Date) so it is a
// stable, parseable cursor token — a JS Date stringifies to a locale form Postgres can't re-parse as
// a timestamptz literal (e.g. "...GMT+0700"), which would break keyset pagination. [self-review]
const TS_ISO = `to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const COLS =
  `decision_id, ${TS_ISO} AS ts, principal_id, action, resource_kind, resource_id, allow, reason, matched_grant_id, origin`;

/** Clamp the requested page size into [1, MAX_LIMIT]; non-finite / ≤0 → DEFAULT_LIMIT. */
export function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/**
 * Encode/decode the keyset cursor as `${ts}|${decision_id}`. The tuple is immutable and unique
 * (decision_id is the PK), so it is a stable cursor even as new rows append at the head.
 */
export function encodeCursor(row: Pick<AuthzDecisionRow, 'ts' | 'decision_id'>): string {
  return `${row.ts}|${row.decision_id}`;
}

function decodeCursor(cursor: string): { ts: string; decision_id: string } {
  const sep = cursor.indexOf('|');
  if (sep <= 0) {
    throw new ContextHubError('BAD_REQUEST', 'invalid cursor.');
  }
  const ts = cursor.slice(0, sep);
  const decision_id = cursor.slice(sep + 1);
  if (!decision_id || !isUuid(decision_id) || Number.isNaN(Date.parse(ts))) {
    throw new ContextHubError('BAD_REQUEST', 'invalid cursor.');
  }
  return { ts, decision_id };
}

/**
 * Build the shared WHERE fragment + args from the filter. Returns the fragment WITHOUT the leading
 * `WHERE` and the positional args array. Used by both the list query and the stats roll-up so they
 * always describe the SAME window.
 */
function buildFilterClause(filter: ListAuthzDecisionsFilter): { where: string[]; args: unknown[] } {
  const where: string[] = [];
  const args: unknown[] = [];

  if (filter.principal_id != null) {
    if (!isUuid(filter.principal_id)) {
      throw new ContextHubError('BAD_REQUEST', `Invalid principal_id "${filter.principal_id}" (must be a UUID).`);
    }
    args.push(filter.principal_id);
    where.push(`principal_id = $${args.length}`);
  }
  if (filter.action !== undefined) {
    if (!ACTIONS.includes(filter.action)) {
      throw new ContextHubError('BAD_REQUEST', `Invalid action "${filter.action}". Allowed: ${ACTIONS.join(', ')}.`);
    }
    args.push(filter.action);
    where.push(`action = $${args.length}`);
  }
  if (filter.allow !== undefined) {
    args.push(filter.allow);
    where.push(`allow = $${args.length}`);
  }
  if (filter.origin !== undefined) {
    if (!ORIGINS.includes(filter.origin)) {
      throw new ContextHubError('BAD_REQUEST', `Invalid origin "${filter.origin}". Allowed: ${ORIGINS.join(', ')}.`);
    }
    args.push(filter.origin);
    where.push(`origin = $${args.length}`);
  }
  if (filter.since !== undefined) {
    if (Number.isNaN(Date.parse(filter.since))) {
      throw new ContextHubError('BAD_REQUEST', 'invalid `since` (must be an ISO-8601 timestamp).');
    }
    args.push(filter.since);
    where.push(`ts >= $${args.length}`);
  }
  if (filter.until !== undefined) {
    if (Number.isNaN(Date.parse(filter.until))) {
      throw new ContextHubError('BAD_REQUEST', 'invalid `until` (must be an ISO-8601 timestamp).');
    }
    args.push(filter.until);
    where.push(`ts < $${args.length}`);
  }
  return { where, args };
}

/**
 * Paginated, filtered, time-windowed read of the decision log, newest-first. Keyset pagination on
 * (ts DESC, decision_id DESC) — stable under concurrent appends, and uses the
 * authz_decisions_ts_idx index. Returns up to `limit` rows + a `next_cursor` when more remain.
 */
export async function listAuthzDecisions(
  params: ListAuthzDecisionsParams = {},
): Promise<ListAuthzDecisionsResult> {
  const limit = clampLimit(params.limit);
  const { where, args } = buildFilterClause(params);

  if (params.cursor != null && params.cursor !== '') {
    const { ts, decision_id } = decodeCursor(params.cursor);
    // Strict keyset predicate: rows OLDER than the cursor tuple (ts DESC, decision_id DESC).
    args.push(ts);
    const tsIdx = args.length;
    args.push(decision_id);
    const idIdx = args.length;
    where.push(`(ts, decision_id) < ($${tsIdx}::timestamptz, $${idIdx}::uuid)`);
  }

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  // Fetch limit+1 to know whether another page exists without a second COUNT.
  const sql = `SELECT ${COLS} FROM authz_decisions${whereSql}
               ORDER BY ts DESC, decision_id DESC
               LIMIT ${limit + 1}`;
  const res = await getDbPool().query<AuthzDecisionRow>(sql, args);
  const rows = res.rows ?? [];

  let next_cursor: string | null = null;
  if (rows.length > limit) {
    rows.pop(); // drop the sentinel overflow row
    const last = rows[rows.length - 1];
    next_cursor = encodeCursor(last);
  }
  return { decisions: rows, next_cursor };
}

/**
 * Aggregate roll-up over the SAME filter window (no pagination) — for the Authorization page stat
 * cards. One pass: totals + allow/deny split + per-reason / per-action / per-origin histograms +
 * distinct-principal count. All computed in SQL so the window can be arbitrarily large without
 * streaming every row to the app.
 */
export async function getAuthzDecisionStats(
  filter: ListAuthzDecisionsFilter = {},
): Promise<AuthzDecisionStats> {
  const { where, args } = buildFilterClause(filter);
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const totalsSql = `
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE allow)::int AS allowed,
      count(*) FILTER (WHERE NOT allow)::int AS denied,
      count(DISTINCT principal_id)::int AS distinct_principals
    FROM authz_decisions${whereSql}`;
  const totalsRes = await getDbPool().query<{
    total: number;
    allowed: number;
    denied: number;
    distinct_principals: number;
  }>(totalsSql, args);
  const totals = totalsRes.rows[0] ?? { total: 0, allowed: 0, denied: 0, distinct_principals: 0 };

  const histogram = async (column: 'reason' | 'action' | 'origin'): Promise<Record<string, number>> => {
    const sql = `SELECT ${column} AS k, count(*)::int AS n
                 FROM authz_decisions${whereSql}
                 GROUP BY ${column}`;
    const res = await getDbPool().query<{ k: string; n: number }>(sql, args);
    const out: Record<string, number> = {};
    for (const r of res.rows ?? []) out[r.k] = r.n;
    return out;
  };

  const [by_reason, by_action, by_origin] = await Promise.all([
    histogram('reason'),
    histogram('action'),
    histogram('origin'),
  ]);

  return {
    total: totals.total,
    allowed: totals.allowed,
    denied: totals.denied,
    by_reason,
    by_action,
    by_origin,
    distinct_principals: totals.distinct_principals,
  };
}
