/**
 * Actor Data Boundary F2a — grants substrate (the delegation edges).
 *
 * A grant is one edge of the delegation tree: `grantee_principal` holds `capability` over everything
 * at-or-below `scope` (= scope_type + scope_id). authorize() (F2b) reads these. This module is the
 * low-level CRUD with shape/existence guards + idempotency ONLY:
 *   - the delegation invariant (granted_by must hold `delegate` covering the scope) is enforced one
 *     layer up at grant time (F2c/F2d grant_capability), exactly as F1's createApiKey did shape
 *     validation while the bootstrap path owned policy.
 * Inert until F2f wires authorize() into handlers — creating/revoking rows changes no enforcement yet.
 *
 * See docs/specs/2026-06-19-actor-data-boundary-mcp-fe-design.md §1 and -F2-clarify.md.
 */

import { validate as isUuid } from 'uuid';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { getPrincipal } from './principals.js';

export type ScopeType = 'global' | 'project' | 'topic' | 'task';
export type Capability = 'read' | 'write' | 'admin' | 'delegate';

export const SCOPE_TYPES: readonly ScopeType[] = ['global', 'project', 'topic', 'task'];
export const CAPABILITIES: readonly Capability[] = ['read', 'write', 'admin', 'delegate'];

export interface Grant {
  grant_id: string;
  grantee_principal: string;
  scope_type: ScopeType;
  scope_id: string | null;
  capability: Capability;
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
}

const COLS =
  'grant_id, grantee_principal, scope_type, scope_id, capability, granted_by, granted_at, revoked_at';

/**
 * Normalize + validate the (scope_type, scope_id) pair. Returns the scope_id to store: `null` for
 * global, a non-empty trimmed string otherwise. Mirrors the DB CHECK grants_scope_shape so callers
 * get a clean BAD_REQUEST instead of a 23514.
 */
export function normalizeScope(scopeType: ScopeType, scopeId?: string | null): string | null {
  if (!SCOPE_TYPES.includes(scopeType)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid scope_type "${scopeType}". Allowed: ${SCOPE_TYPES.join(', ')}.`);
  }
  const trimmed = typeof scopeId === 'string' ? scopeId.trim() : '';
  if (scopeType === 'global') {
    if (trimmed.length > 0) {
      throw new ContextHubError('BAD_REQUEST', 'global scope must not carry a scope_id.');
    }
    return null;
  }
  if (trimmed.length === 0) {
    throw new ContextHubError('BAD_REQUEST', `${scopeType} scope requires a scope_id.`);
  }
  return trimmed;
}

export async function createGrant(params: {
  grantee_principal: string;
  scope_type: ScopeType;
  scope_id?: string | null;
  capability: Capability;
  granted_by: string;
}): Promise<Grant> {
  if (!CAPABILITIES.includes(params.capability)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid capability "${params.capability}". Allowed: ${CAPABILITIES.join(', ')}.`);
  }
  const scopeId = normalizeScope(params.scope_type, params.scope_id);

  // UUID-guard both principal refs so a malformed id is a clean BAD_REQUEST, never a raw pg 22P02.
  if (!isUuid(params.grantee_principal)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid grantee_principal "${params.grantee_principal}" (must be a UUID).`);
  }
  if (!isUuid(params.granted_by)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid granted_by "${params.granted_by}" (must be a UUID).`);
  }
  // Existence: give NOT_FOUND rather than letting the FK raise 23503. (Status is intentionally NOT
  // gated here — a grant to a suspended principal is harmless; authorize() denies on status anyway.)
  if (!(await getPrincipal(params.grantee_principal))) {
    throw new ContextHubError('NOT_FOUND', `Grantee principal ${params.grantee_principal} not found.`);
  }
  if (!(await getPrincipal(params.granted_by))) {
    throw new ContextHubError('NOT_FOUND', `Granter principal ${params.granted_by} not found.`);
  }

  const pool = getDbPool();
  // Idempotent on the active-edge unique index (grantee, scope_type, scope_id, capability) WHERE
  // revoked_at IS NULL, NULLS NOT DISTINCT (so global edges collide too). On conflict, return the
  // existing ACTIVE row rather than minting a duplicate.
  const ins = await pool.query<Grant>(
    `INSERT INTO grants (grantee_principal, scope_type, scope_id, capability, granted_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (grantee_principal, scope_type, scope_id, capability) WHERE revoked_at IS NULL
     DO NOTHING
     RETURNING ${COLS}`,
    [params.grantee_principal, params.scope_type, scopeId, params.capability, params.granted_by],
  );
  if (ins.rows[0]) return ins.rows[0];

  // Conflict: an active edge already exists — return it (idempotent grant).
  const existing = await pool.query<Grant>(
    `SELECT ${COLS} FROM grants
      WHERE grantee_principal = $1 AND scope_type = $2 AND scope_id IS NOT DISTINCT FROM $3
        AND capability = $4 AND revoked_at IS NULL`,
    [params.grantee_principal, params.scope_type, scopeId, params.capability],
  );
  if (existing.rows[0]) return existing.rows[0];
  // Extremely unlikely race (the active row was revoked between INSERT and SELECT) — retry once.
  return createGrant(params);
}

export async function getGrant(grantId: string): Promise<Grant | null> {
  if (!isUuid(grantId)) return null;
  const res = await getDbPool().query<Grant>(`SELECT ${COLS} FROM grants WHERE grant_id = $1`, [grantId]);
  return res.rows[0] ?? null;
}

/** Revoke a grant (sets revoked_at). Idempotent: revoking an unknown/already-revoked grant is a no-op. */
export async function revokeGrant(grantId: string): Promise<void> {
  if (!isUuid(grantId)) return;
  await getDbPool().query(
    `UPDATE grants SET revoked_at = now() WHERE grant_id = $1 AND revoked_at IS NULL`,
    [grantId],
  );
}

export async function listGrants(filter?: {
  grantee_principal?: string;
  scope_type?: ScopeType;
  scope_id?: string | null;
  granted_by?: string;
  include_revoked?: boolean;
}): Promise<Grant[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter?.grantee_principal) {
    args.push(filter.grantee_principal);
    where.push(`grantee_principal = $${args.length}`);
  }
  if (filter?.granted_by) {
    args.push(filter.granted_by);
    where.push(`granted_by = $${args.length}`);
  }
  if (filter?.scope_type) {
    args.push(filter.scope_type);
    where.push(`scope_type = $${args.length}`);
    // scope_id only meaningful alongside a scope_type; IS NOT DISTINCT FROM handles the global NULL.
    if (filter.scope_type !== 'global' || filter.scope_id != null) {
      args.push(filter.scope_id ?? null);
      where.push(`scope_id IS NOT DISTINCT FROM $${args.length}`);
    }
  }
  if (!filter?.include_revoked) where.push(`revoked_at IS NULL`);

  const sql = `SELECT ${COLS} FROM grants${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY granted_at DESC, grant_id`;
  const res = await getDbPool().query<Grant>(sql, args);
  return res.rows ?? [];
}
