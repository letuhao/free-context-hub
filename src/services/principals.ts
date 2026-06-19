/**
 * Actor Data Boundary F1 — principals service (identity substrate).
 *
 * A principal is the single subject of every action — it replaces the *asserted* actor_id
 * string callers currently send. A credential (api_keys row) authenticates TO a principal;
 * the principal is what gets authorized (F2). See
 * docs/specs/2026-06-19-actor-data-boundary-FOUNDATION.md and -mcp-fe-design.md §1.
 *
 * Invariants this module guards:
 *   - kind ∈ {human, agent, system}; status ∈ {active, suspended, retired}.
 *   - is_root is set ONLY by seedRootPrincipal (the out-of-band bootstrap path); createPrincipal
 *     can never produce a root. At most one root exists (DB partial unique index).
 */

import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';

export type PrincipalKind = 'human' | 'agent' | 'system';
export type PrincipalStatus = 'active' | 'suspended' | 'retired';

export interface Principal {
  principal_id: string;
  kind: PrincipalKind;
  status: PrincipalStatus;
  display_name: string;
  is_root: boolean;
  created_at: string;
}

const KINDS: readonly PrincipalKind[] = ['human', 'agent', 'system'];
const STATUSES: readonly PrincipalStatus[] = ['active', 'suspended', 'retired'];

const COLS =
  'principal_id, kind, status, display_name, is_root, created_at';

function validateDisplayName(name: string): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ContextHubError('BAD_REQUEST', 'display_name is required.');
  }
  // Length is checked on the TRIMMED value — that is what gets stored, so trailing
  // whitespace must not push a valid name over the limit. [review-impl F1a #2]
  const trimmed = name.trim();
  if (trimmed.length > 256) {
    throw new ContextHubError('BAD_REQUEST', 'display_name must be 256 characters or fewer.');
  }
  return trimmed;
}

/**
 * Create a non-root principal. is_root is ALWAYS false here — the only root path is
 * seedRootPrincipal (out-of-band bootstrap).
 */
export async function createPrincipal(params: {
  kind: PrincipalKind;
  display_name: string;
  status?: PrincipalStatus;
}): Promise<Principal> {
  if (!KINDS.includes(params.kind)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid kind "${params.kind}". Allowed: ${KINDS.join(', ')}.`);
  }
  const status = params.status ?? 'active';
  if (!STATUSES.includes(status)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid status "${status}". Allowed: ${STATUSES.join(', ')}.`);
  }
  const displayName = validateDisplayName(params.display_name);

  const pool = getDbPool();
  const res = await pool.query<Principal>(
    `INSERT INTO principals (kind, status, display_name, is_root)
     VALUES ($1, $2, $3, false) RETURNING ${COLS}`,
    [params.kind, status, displayName],
  );
  return res.rows[0];
}

export async function getPrincipal(principalId: string): Promise<Principal | null> {
  const pool = getDbPool();
  const res = await pool.query<Principal>(
    `SELECT ${COLS} FROM principals WHERE principal_id = $1`,
    [principalId],
  );
  return res.rows[0] ?? null;
}

export async function getRootPrincipal(): Promise<Principal | null> {
  const pool = getDbPool();
  const res = await pool.query<Principal>(
    `SELECT ${COLS} FROM principals WHERE is_root = true LIMIT 1`,
  );
  return res.rows[0] ?? null;
}

export async function listPrincipals(): Promise<Principal[]> {
  const pool = getDbPool();
  const res = await pool.query<Principal>(
    `SELECT ${COLS} FROM principals ORDER BY created_at DESC, principal_id`,
  );
  return res.rows ?? [];
}

/**
 * Transition a principal's status. Two invariants are guarded in the WHERE clause (race-safe —
 * the guard is the write, not a prior read):
 *   - The ROOT principal's status is axiomatically `active` and cannot be changed. Suspending or
 *     retiring root would brick the trust anchor with no recovery (seedRootPrincipal would still
 *     CONFLICT on the reserved is_root slot). [adversary F1a #1]
 *   - `retired` is TERMINAL — no transition out of it. A deliberately decommissioned identity must
 *     not be silently resurrected. (suspended ⇄ active stays reversible — that is suspension's
 *     purpose vs retirement.) [adversary F1a #2]
 */
export async function setPrincipalStatus(
  principalId: string,
  status: PrincipalStatus,
): Promise<Principal> {
  if (!STATUSES.includes(status)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid status "${status}". Allowed: ${STATUSES.join(', ')}.`);
  }
  const pool = getDbPool();
  const res = await pool.query<Principal>(
    `UPDATE principals SET status = $2
       WHERE principal_id = $1 AND is_root = false AND status <> 'retired'
       RETURNING ${COLS}`,
    [principalId, status],
  );
  if (res.rowCount === 0) {
    // Disambiguate why the guarded UPDATE matched no row.
    const cur = await getPrincipal(principalId);
    if (!cur) {
      throw new ContextHubError('NOT_FOUND', 'Principal not found.');
    }
    if (cur.is_root) {
      throw new ContextHubError('CONFLICT', 'The root principal status is axiomatic and cannot be changed.');
    }
    // cur.status === 'retired' (terminal) is the only remaining reason.
    throw new ContextHubError('CONFLICT', 'retired is a terminal status; the principal cannot be reactivated.');
  }
  return res.rows[0];
}

/**
 * Seed THE root principal — the out-of-band trust anchor (FOUNDATION line 1). The only path
 * that sets is_root=true. Idempotency is the caller's job (bootstrap checks getRootPrincipal
 * first); this enforces single-root at the DB and translates the partial-unique-index
 * violation into a typed CONFLICT so a race can't create two roots.
 */
export async function seedRootPrincipal(params: { display_name: string }): Promise<Principal> {
  const displayName = validateDisplayName(params.display_name);
  const pool = getDbPool();

  const existing = await getRootPrincipal();
  if (existing) {
    throw new ContextHubError('CONFLICT', 'A root principal already exists; bootstrap is a no-op.');
  }

  try {
    const res = await pool.query<Principal>(
      `INSERT INTO principals (kind, status, display_name, is_root)
       VALUES ('human', 'active', $1, true) RETURNING ${COLS}`,
      [displayName],
    );
    return res.rows[0];
  } catch (err) {
    // 23505 = unique_violation on principals_single_root_uniq (lost a race to another seeder).
    if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
      throw new ContextHubError('CONFLICT', 'A root principal already exists; bootstrap is a no-op.');
    }
    throw err;
  }
}
