/**
 * Actor Data Boundary F1c — out-of-band root bootstrap + enforce-ready (lockout) guard.
 *
 * The root of trust is axiomatic and established OUT OF BAND (FOUNDATION line 1): whoever holds the
 * deployment secret (ROOT_BOOTSTRAP_TOKEN, alongside DATABASE_URL) establishes the single root
 * principal. This module is the only place that mints the root credential, and the lockout guard
 * (assertEnforceReady) refuses to declare a deployment "enforce-ready" unless a usable root
 * credential exists — so turning enforcement on can never lock the operator out.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { getEnv } from '../env.js';
import { getRootPrincipal, seedRootPrincipal, type Principal } from './principals.js';
import { createBootstrapRootKey } from './apiKeys.js';

/** Constant-time, length-independent secret comparison (hash both to a fixed 32 bytes first). */
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * True iff a USABLE root credential exists: an active, non-revoked, non-expired, is_bootstrap key
 * bound to the active root principal. This is exactly what validateApiKey would accept for root.
 */
export async function hasUsableRootCredential(): Promise<boolean> {
  const res = await getDbPool().query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM api_keys k
       JOIN principals p ON p.principal_id = k.principal_id
      WHERE p.is_root = true AND p.status = 'active'
        AND k.is_bootstrap = true AND k.revoked = false
        AND (k.expires_at IS NULL OR k.expires_at > now())`,
  );
  return res.rows[0].n > 0;
}

export type BootstrapResult =
  | { status: 'created'; principal: Principal; key: string }
  | { status: 'reissued'; principal: Principal; key: string }
  | { status: 'noop'; principal: Principal };

/**
 * Establish the root of trust. Requires the caller to present the deployment's ROOT_BOOTSTRAP_TOKEN
 * (proves out-of-band possession). Behaviour:
 *   - no root yet                          → seed root (kind=system) + mint root credential → 'created'
 *   - root exists, NO usable credential    → mint a fresh root credential (recovery)        → 'reissued'
 *   - root exists, usable credential ready → no-op (never reveals a new secret)              → 'noop'
 *
 * The 'reissued' branch is the lockout-recovery path: a lost/revoked root key must be recoverable
 * by the deployment-secret holder, otherwise the system becomes permanently un-rootable.
 */
export async function bootstrapRoot(params: {
  presentedToken: string;
  display_name?: string;
}): Promise<BootstrapResult> {
  const configured = getEnv().ROOT_BOOTSTRAP_TOKEN;
  if (!configured) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'ROOT_BOOTSTRAP_TOKEN is not configured; set it in the environment before establishing root.',
    );
  }
  if (typeof params.presentedToken !== 'string' || params.presentedToken.length === 0) {
    throw new ContextHubError('UNAUTHORIZED', 'bootstrap token required.');
  }
  if (!secretsMatch(params.presentedToken, configured)) {
    throw new ContextHubError('UNAUTHORIZED', 'invalid bootstrap token.');
  }

  const displayName = params.display_name?.trim() || 'root';
  const existing = await getRootPrincipal();

  if (!existing) {
    const principal = await seedRootPrincipal({ display_name: displayName });
    const { key } = await createBootstrapRootKey(principal.principal_id);
    return { status: 'created', principal, key };
  }

  if (await hasUsableRootCredential()) {
    return { status: 'noop', principal: existing };
  }

  // Root exists but has no usable credential (lost/revoked/expired) — recover it.
  const { key } = await createBootstrapRootKey(existing.principal_id);
  return { status: 'reissued', principal: existing, key };
}

/**
 * Lockout guard. Throws unless the deployment is safe to switch into enforcement (auth-on):
 * a usable root credential must exist, or enabling MCP_AUTH_ENABLED would lock everyone out.
 * Returns the root principal on success for the caller to log.
 */
export async function assertEnforceReady(): Promise<Principal> {
  // The legacy single-shared CONTEXT_HUB_WORKSPACE_TOKEN short-circuits to global admin WITHOUT a
  // principal or the is_bootstrap gate — so while it is live, the data boundary is not actually
  // enforced (the marker design is bypassable). A deployment is not enforce-ready until that
  // bypass is off. [F1c adversary #1] (Hard boot-gating of MCP_AUTH_ENABLED on this check is F4.)
  const env = getEnv();
  if (env.CONTEXT_HUB_WORKSPACE_TOKEN && !env.MCP_LEGACY_TOKEN_DISABLED) {
    throw new ContextHubError(
      'CONFLICT',
      'not enforce-ready: the legacy CONTEXT_HUB_WORKSPACE_TOKEN grants global admin and bypasses the boundary. Set MCP_LEGACY_TOKEN_DISABLED=true (or unset the token) first.',
    );
  }

  const root = await getRootPrincipal();
  if (!root) {
    throw new ContextHubError(
      'CONFLICT',
      'not enforce-ready: no root principal. Run `npm run bootstrap:root` first.',
    );
  }
  if (!(await hasUsableRootCredential())) {
    throw new ContextHubError(
      'CONFLICT',
      'not enforce-ready: root exists but has no usable credential. Re-run `npm run bootstrap:root` to reissue before enabling enforcement.',
    );
  }
  return root;
}
