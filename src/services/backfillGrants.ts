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
  /** edges deliberately revoked by an operator that the backfill refused to resurrect. [F2-adv2 #5] */
  skippedRevoked: number;
}

/**
 * SQL: does the credential `k` already hold an active grant that COVERS its mapped authority? A grant
 * covers iff its capability rank ≥ the role's mapped rank AND its scope covers the key's scope (global
 * covers everything; a project grant covers only that project). Mirrors capabilityCovers + scopeCovers
 * in SQL — checking grant EXISTENCE (the old behaviour) wrongly passed a credential whose only grant
 * was at a different scope/capability, leaving it locked out at the flip. [F2-adv2 #1]
 *
 * `delegate` grants rank 0 here, so they never satisfy a resource credential. Roles are constrained to
 * admin|writer|reader by the api_keys CHECK (migration 0041), so the CASE is total; any other value
 * ranks 0 (never covered) — fail-safe. [F2-adv2 #2]
 */
const COVERING_GRANT_EXISTS = `
  EXISTS (
    SELECT 1 FROM grants g
     WHERE g.grantee_principal = k.principal_id AND g.revoked_at IS NULL
       AND (CASE g.capability WHEN 'admin' THEN 3 WHEN 'write' THEN 2 WHEN 'read' THEN 1 ELSE 0 END)
           >= (CASE k.role WHEN 'admin' THEN 3 WHEN 'writer' THEN 2 WHEN 'reader' THEN 1 ELSE 0 END)
       AND ( g.scope_type = 'global'
             OR (k.project_scope IS NOT NULL AND g.scope_type = 'project' AND g.scope_id = k.project_scope) )
  )`;

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
 * Count active non-root principal-bound credentials whose principal lacks a grant COVERING that
 * credential's (role, scope) — i.e. would be denied the instant enforcement turns on. assertEnforceReady
 * gates on this being 0. (Coverage, not mere existence — see COVERING_GRANT_EXISTS. [F2-adv2 #1])
 */
export async function countCredentialsWithoutGrants(
  executor?: Pool | PoolClient,
  opts?: { restrictToPrincipals?: readonly string[] },
): Promise<number> {
  const runner = executor ?? getDbPool();
  const restrict = opts?.restrictToPrincipals && opts.restrictToPrincipals.length > 0 ? opts.restrictToPrincipals : null;
  const r = await runner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (${eligibleKeysSql()}) k WHERE NOT ${COVERING_GRANT_EXISTS}`,
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
  // Only credentials that LACK a covering grant (coverage, not existence). A credential already
  // covered by a broader grant (e.g. admin@global covering a reader@project key) is left alone.
  const keys = (await runner.query<EligibleKey>(
    `SELECT k.key_id, k.role, k.project_scope, k.principal_id FROM (${eligibleKeysSql()}) k WHERE NOT ${COVERING_GRANT_EXISTS}`,
    [restrict],
  )).rows;
  let created = 0;
  let skipped = 0;
  let skippedRevoked = 0;

  for (const k of keys) {
    const capability = CAP_BY_ROLE[k.role];
    if (!capability) {
      // Unreachable given the api_keys.role CHECK; fail-safe — never guess a capability.
      logger.warn({ key_id: k.key_id, role: k.role }, 'backfill: unmappable role, no grant minted');
      skipped++;
      continue;
    }
    const scope_type = k.project_scope == null ? ('global' as const) : ('project' as const);
    const scope_id = k.project_scope ?? undefined;
    if (scope_type === 'global' && capability !== 'admin') {
      // Faithful, NOT inflation: a NULL project_scope key is an UNRESTRICTED key in the legacy model
      // (DEFERRED-029 callerScope: null ⇒ global/admin), so write/read@global preserves its real reach.
      // Logged because it is broad and worth an operator's eye. [F2-adv2 #3 — assessed, kept]
      logger.warn({ key_id: k.key_id, role: k.role }, 'backfill: GLOBAL write/read grant from a null-scope (unrestricted) key — broad, faithful to the legacy model');
    }
    // [F2-adv2 #5] Do NOT resurrect a deliberately-revoked edge. If the exact mapped grant exists but
    // was revoked, the operator removed it on purpose — skip and surface it, rather than re-minting.
    const revoked = await runner.query(
      `SELECT 1 FROM grants
        WHERE grantee_principal = $1 AND scope_type = $2 AND scope_id IS NOT DISTINCT FROM $3
          AND capability = $4 AND revoked_at IS NOT NULL LIMIT 1`,
      [k.principal_id, scope_type, scope_id ?? null, capability],
    );
    if (revoked.rows[0]) {
      logger.warn({ key_id: k.key_id }, 'backfill: mapped grant was deliberately revoked — not resurrecting; re-grant manually or revoke the credential');
      skippedRevoked++;
      continue;
    }
    await createGrant({ grantee_principal: k.principal_id, scope_type, scope_id, capability, granted_by: root.principal_id });
    created++;
  }
  logger.info({ scanned: keys.length, created, skipped, skippedRevoked }, 'backfill: grants synthesized from api_keys');
  return { scanned: keys.length, created, skipped, skippedRevoked };
}
