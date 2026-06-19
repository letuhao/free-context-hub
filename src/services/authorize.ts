/**
 * Actor Data Boundary F2b — authorize(), the single authorization chokepoint.
 *
 * authorize(principal, action, resource) = principal is active ∧ ∃ active grant whose capability
 * covers the action ∧ whose scope covers the resource. Root short-circuits ALLOW. Every decision
 * (allow + deny) is logged to coordination_events (authz.decision). The pure core (capabilityCovers,
 * scopeCovers, decide) carries the logic and is exhaustively unit-tested with no DB; the async
 * wrapper loads principal + grants, resolves the resource's scope chain, decides, and logs.
 *
 * See docs/specs/2026-06-19-actor-data-boundary-F2-design.md.
 */

import type { PoolClient } from 'pg';
import { validate as isUuid } from 'uuid';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { createModuleLogger } from '../utils/logger.js';
import type { Capability, ScopeType } from './grants.js';

const logger = createModuleLogger('authorize');

// ── Types ─────────────────────────────────────────────────────────────────────

/** What a handler is trying to do. read⊂write⊂admin are resource verbs; delegate = re-grant. */
export type Action = 'read' | 'write' | 'admin' | 'delegate';

/** A resource expressed as its FULLY-RESOLVED scope chain (project→topic→task ancestry filled in). */
export type ResourceScope =
  | { kind: 'global' }
  | { kind: 'project'; project_id: string }
  | { kind: 'topic'; project_id: string; topic_id: string }
  | { kind: 'task'; project_id: string; topic_id: string; task_id: string };

/** The fields of a grant the decision needs (a subset of services/grants.ts Grant). */
export interface GrantLike {
  grant_id: string;
  scope_type: ScopeType;
  scope_id: string | null;
  capability: Capability;
}

export interface PrincipalLike {
  is_root: boolean;
  status: 'active' | 'suspended' | 'retired';
}

export type AllowReason = 'ROOT' | 'GRANT' | 'AUTH_DISABLED';
export type DenyReason =
  | 'NO_PRINCIPAL'
  | 'PRINCIPAL_INACTIVE'
  | 'NO_COVERING_GRANT'
  | 'OUT_OF_SCOPE'
  | 'GRANT_REVOKED';

export type Decision =
  | { allow: true; reason: AllowReason; matched_grant_id?: string }
  | { allow: false; reason: DenyReason };

// ── Pure core ───────────────────────────────────────────────────────────────────

const RESOURCE_RANK: Record<'read' | 'write' | 'admin', number> = { read: 1, write: 2, admin: 3 };

/**
 * read ⊂ write ⊂ admin for resource actions; `delegate` is ORTHOGONAL — it covers only the
 * `delegate` action and no resource action, and no resource capability confers `delegate`.
 */
export function capabilityCovers(granted: Capability, action: Action): boolean {
  if (action === 'delegate') return granted === 'delegate';
  if (granted === 'delegate') return false;
  return RESOURCE_RANK[granted] >= RESOURCE_RANK[action];
}

/**
 * A grant's scope covers a resource iff the resource sits at-or-below it on the SAME branch.
 * global ⊃ project ⊃ topic ⊃ task. Pure — operates on the already-resolved resource chain.
 */
export function scopeCovers(grant: GrantLike, resource: ResourceScope): boolean {
  switch (grant.scope_type) {
    case 'global':
      return true;
    case 'project':
      return resource.kind !== 'global' && grant.scope_id === resource.project_id;
    case 'topic':
      return (resource.kind === 'topic' || resource.kind === 'task') && grant.scope_id === resource.topic_id;
    case 'task':
      return resource.kind === 'task' && grant.scope_id === resource.task_id;
    default:
      return false;
  }
}

/**
 * The decision truth table (pure). Order matters: NO_PRINCIPAL → ROOT short-circuit → status gate →
 * covering-grant search. The status gate runs only for non-root (root is axiomatically active).
 */
export function decide(
  principal: PrincipalLike | null,
  action: Action,
  resource: ResourceScope,
  activeGrants: readonly GrantLike[],
): Decision {
  if (!principal) return { allow: false, reason: 'NO_PRINCIPAL' };
  if (principal.is_root) return { allow: true, reason: 'ROOT' };
  if (principal.status !== 'active') return { allow: false, reason: 'PRINCIPAL_INACTIVE' };
  const g = activeGrants.find((gr) => capabilityCovers(gr.capability, action) && scopeCovers(gr, resource));
  return g
    ? { allow: true, reason: 'GRANT', matched_grant_id: g.grant_id }
    : { allow: false, reason: 'NO_COVERING_GRANT' };
}

// ── Async wrapper + resolver + logging ────────────────────────────────────────

/** A handler's reference to the resource it acts on: a kind + (for non-global) its id. */
export interface ResourceRef {
  kind: ResourceScope['kind'];
  id?: string | null;
}

/**
 * Resolve a resource reference to its FULL scope chain by walking task→topic→project. Returns
 * (never throws) so authorize() stays total. `unresolvable: NOT_FOUND` covers both a missing id and
 * a non-existent ancestry — the handler maps it to NOT_FOUND, no existence oracle. global is a no-op.
 */
export async function resolveResourceScope(
  ref: ResourceRef,
  executor?: PoolClient,
): Promise<{ ok: ResourceScope } | { unresolvable: 'NOT_FOUND' }> {
  if (ref.kind === 'global') return { ok: { kind: 'global' } };
  const runner = executor ?? getDbPool();
  const id = typeof ref.id === 'string' ? ref.id.trim() : '';
  if (!id) return { unresolvable: 'NOT_FOUND' };

  if (ref.kind === 'project') return { ok: { kind: 'project', project_id: id } };

  if (ref.kind === 'topic') {
    const r = await runner.query<{ project_id: string }>(
      `SELECT project_id FROM topics WHERE topic_id = $1`,
      [id],
    );
    if (!r.rows[0]) return { unresolvable: 'NOT_FOUND' };
    return { ok: { kind: 'topic', project_id: r.rows[0].project_id, topic_id: id } };
  }

  // task — task_id is UUID; guard against 22P02 on a malformed id (treat as not found).
  if (!isUuid(id)) return { unresolvable: 'NOT_FOUND' };
  const r = await runner.query<{ topic_id: string; project_id: string }>(
    `SELECT t.topic_id, tp.project_id
       FROM tasks t JOIN topics tp ON tp.topic_id = t.topic_id
      WHERE t.task_id = $1`,
    [id],
  );
  if (!r.rows[0]) return { unresolvable: 'NOT_FOUND' };
  return { ok: { kind: 'task', project_id: r.rows[0].project_id, topic_id: r.rows[0].topic_id, task_id: id } };
}

async function loadPrincipalLite(principalId: string | null, executor?: PoolClient): Promise<PrincipalLike | null> {
  if (typeof principalId !== 'string' || !isUuid(principalId)) return null;
  const runner = executor ?? getDbPool();
  const r = await runner.query<PrincipalLike>(
    `SELECT is_root, status FROM principals WHERE principal_id = $1`,
    [principalId],
  );
  return r.rows[0] ?? null;
}

async function loadActiveGrants(principalId: string, executor?: PoolClient): Promise<GrantLike[]> {
  const runner = executor ?? getDbPool();
  const r = await runner.query<GrantLike>(
    `SELECT grant_id, scope_type, scope_id, capability
       FROM grants WHERE grantee_principal = $1 AND revoked_at IS NULL`,
    [principalId],
  );
  return r.rows ?? [];
}

/** Append the decision to authz_decisions. BEST-EFFORT: a logging failure never alters the decision. */
async function logDecision(
  principalId: string | null,
  action: Action,
  ref: ResourceRef,
  d: Decision,
  executor?: PoolClient,
): Promise<void> {
  try {
    const runner = executor ?? getDbPool();
    await runner.query(
      `INSERT INTO authz_decisions
         (principal_id, action, resource_kind, resource_id, allow, reason, matched_grant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        principalId,
        action,
        ref.kind,
        ref.id ?? null,
        d.allow,
        d.reason,
        d.allow ? (d.matched_grant_id ?? null) : null,
      ],
    );
  } catch (err) {
    logger.warn({ err }, 'authz: decision log write failed (decision unaffected)');
  }
}

/**
 * The single authorization chokepoint. Loads the principal + its active grants, resolves the
 * resource's scope chain, applies the pure `decide`, logs, and returns. Total — never throws for an
 * authz reason. Ordering is oracle-safe: a null/inactive principal is denied BEFORE the resource is
 * resolved, so an unauthorized caller never learns whether a resource exists.
 *
 * AUTH-OFF fast path: when MCP_AUTH_ENABLED=false this returns ALLOW/AUTH_DISABLED immediately (no
 * DB, no log) — the dev/root posture is unchanged and the whole F2 enforcement layer is inert until
 * the posture flip (F2g, human-gated).
 */
export async function authorize(
  principalId: string | null,
  action: Action,
  resource: ResourceRef,
  executor?: PoolClient,
): Promise<Decision> {
  if (!getEnv().MCP_AUTH_ENABLED) return { allow: true, reason: 'AUTH_DISABLED' };

  const principal = await loadPrincipalLite(principalId, executor);
  if (!principal) {
    const d: Decision = { allow: false, reason: 'NO_PRINCIPAL' };
    await logDecision(principalId, action, resource, d, executor);
    return d;
  }
  if (principal.is_root) {
    const d: Decision = { allow: true, reason: 'ROOT' };
    await logDecision(principalId, action, resource, d, executor);
    return d;
  }
  if (principal.status !== 'active') {
    const d: Decision = { allow: false, reason: 'PRINCIPAL_INACTIVE' };
    await logDecision(principalId, action, resource, d, executor);
    return d;
  }

  const resolved = await resolveResourceScope(resource, executor);
  if ('unresolvable' in resolved) {
    const d: Decision = { allow: false, reason: 'OUT_OF_SCOPE' };
    await logDecision(principalId, action, resource, d, executor);
    return d;
  }

  const grants = await loadActiveGrants(principalId as string, executor);
  const d = decide(principal, action, resolved.ok, grants);
  await logDecision(principalId, action, resource, d, executor);
  return d;
}
