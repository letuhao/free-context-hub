/**
 * Actor Data Boundary F2e — backfill grants from the legacy api_keys role/scope model (the lockout
 * guard for REPLACE NOW + FULL ENFORCEMENT).
 *
 * Once authorize() is the sole gate (F2f) and auth flips on (F2g, human-gated), every active
 * principal-bound credential needs a covering grant or its holder is denied everywhere. This maps
 * each such credential's (role, project_scope) to the equivalent grant so the flip can't brick
 * existing callers:
 *   admin  + scope NULL  -> admin @ global       writer + scope P -> write @ project:P
 *   admin  + scope P     -> admin @ project:P     reader + scope P -> read  @ project:P
 *   writer/reader + NULL -> write/read @ global   (logged — broad; admin keys are the intended
 *                                                  global writers)
 * granted_by = the root principal (the delegation-tree origin). Idempotent (createGrant collapses on
 * the active-edge unique index). Run out-of-band BEFORE enabling enforcement; assertEnforceReady
 * gates on countCredentialsWithoutGrants()===0.
 *
 * Root-bound credentials are skipped (root short-circuits authorize — needs no grant). Unbound
 * (principal_id NULL) credentials are skipped (they have no principal to grant to and are denied
 * under auth-ON by the F1 hardened posture — operators must rebind them).
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { createModuleLogger } from '../utils/logger.js';
import { getRootPrincipal } from './principals.js';
import { createGrant, type Capability } from './grants.js';

const logger = createModuleLogger('backfill-grants');

const CAP_BY_ROLE: Record<string, Capability> = { admin: 'admin', writer: 'write', reader: 'read' };

export interface BackfillResult {
  scanned: number;
  created: number;
  skipped: number;
}

interface EligibleKey {
  key_id: string;
  role: string;
  project_scope: string | null;
  principal_id: string;
}

/**
 * The active, principal-bound, NON-root credentials whose principal must hold a covering grant.
 * `restrictToPrincipals` (tests) bounds the set to specific principals so a suite mutates only its own
 * rows under concurrency; production runs global (no restrict). $1 = the restrict array (or null).
 */
function eligibleKeysSql(): string {
  return `
    SELECT k.key_id, k.role, k.project_scope, k.principal_id
      FROM api_keys k
      JOIN principals p ON p.principal_id = k.principal_id
     WHERE k.revoked = false
       AND (k.expires_at IS NULL OR k.expires_at > now())
       AND p.status = 'active'
       AND p.is_root = false
       AND ($1::uuid[] IS NULL OR k.principal_id = ANY($1::uuid[]))`;
}

/**
 * Count active non-root principal-bound credentials whose principal holds NO active grant — i.e.
 * would be locked out the instant enforcement turns on. assertEnforceReady gates on this being 0.
 */
export async function countCredentialsWithoutGrants(
  executor?: Pool | PoolClient,
  opts?: { restrictToPrincipals?: readonly string[] },
): Promise<number> {
  const runner = executor ?? getDbPool();
  const restrict = opts?.restrictToPrincipals && opts.restrictToPrincipals.length > 0 ? opts.restrictToPrincipals : null;
  const r = await runner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (${eligibleKeysSql()}) k
      WHERE NOT EXISTS (
        SELECT 1 FROM grants g WHERE g.grantee_principal = k.principal_id AND g.revoked_at IS NULL
      )`,
    [restrict],
  );
  return r.rows[0].n;
}

/**
 * Synthesize a grant per eligible credential from its (role, project_scope). Idempotent. Requires a
 * root principal (the grant origin). Returns counts.
 */
export async function backfillGrantsFromApiKeys(
  executor?: Pool | PoolClient,
  opts?: { restrictToPrincipals?: readonly string[] },
): Promise<BackfillResult> {
  const runner = executor ?? getDbPool();
  const root = await getRootPrincipal();
  if (!root) {
    throw new ContextHubError('CONFLICT', 'cannot backfill grants: no root principal. Run `npm run bootstrap:root` first.');
  }

  const restrict = opts?.restrictToPrincipals && opts.restrictToPrincipals.length > 0 ? opts.restrictToPrincipals : null;
  const keys = (await runner.query<EligibleKey>(eligibleKeysSql(), [restrict])).rows;
  let created = 0;
  let skipped = 0;

  for (const k of keys) {
    const capability = CAP_BY_ROLE[k.role];
    if (!capability) {
      // An unknown role can't be mapped — skip + log rather than guess (fail-safe: no grant = denied,
      // which the enforce-ready gate will then surface rather than silently over-granting).
      logger.warn({ key_id: k.key_id, role: k.role }, 'backfill: unknown role, no grant minted');
      skipped++;
      continue;
    }
    const scope_type = k.project_scope == null ? ('global' as const) : ('project' as const);
    const scope_id = k.project_scope ?? undefined;
    if (scope_type === 'global' && capability !== 'admin') {
      logger.warn({ key_id: k.key_id, role: k.role }, 'backfill: minting a GLOBAL write/read grant from a non-admin null-scope key (broad authority — verify intended)');
    }
    await createGrant({ grantee_principal: k.principal_id, scope_type, scope_id, capability, granted_by: root.principal_id });
    created++;
  }
  logger.info({ scanned: keys.length, created, skipped }, 'backfill: grants synthesized from api_keys');
  return { scanned: keys.length, created, skipped };
}
