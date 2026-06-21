/**
 * Actor Data Boundary F2g — boot-posture guard (deployment-profile aware).
 *
 * The flip ships as a DEPLOYMENT POSTURE, not a code default: env.ts keeps
 * MCP_AUTH_ENABLED defaulting to `false` so local dev and the unit suite are
 * unaffected. A real deployment sets DEPLOYMENT_PROFILE=production (the hardened
 * docker-compose.yml does), which turns on these two boot guards:
 *
 *   1. production + auth OFF  → REFUSE to boot (no unauthenticated production —
 *      closes the "MCP_AUTH_ENABLED accidentally left false in prod" risk).
 *   2. production + auth ON    → require assertEnforceReady() to pass (the hard
 *      boot gate the assertEnforceReady comment anticipated as "F4"): the legacy
 *      token must be off, a usable root + system identity must exist, coordination
 *      actors migrated, and every principal-bound credential covered by a grant —
 *      else enabling enforcement would lock callers / the worker out.
 *
 * This module is the PURE decision so it is unit-testable without booting the
 * server, hitting the DB, or calling process.exit. src/index.ts acts on the
 * verdict (logging + assertEnforceReady + process.exit live there).
 */

export type BootPosture =
  /** production + auth OFF — hard refuse. */
  | { kind: 'refuse'; reason: string }
  /** production + auth ON — caller must run assertEnforceReady() and exit on throw. */
  | { kind: 'enforce-ready-required' }
  /** auth OFF (non-production) — boot, but warn that the surface is unauthenticated. */
  | { kind: 'warn-unauthenticated' }
  /** auth ON, non-production — boot normally (test rigs / trusted auth-ON). */
  | { kind: 'ok' };

export function evaluateBootPosture(env: {
  DEPLOYMENT_PROFILE: 'dev' | 'production';
  MCP_AUTH_ENABLED: boolean;
}): BootPosture {
  const isProd = env.DEPLOYMENT_PROFILE === 'production';
  if (isProd && !env.MCP_AUTH_ENABLED) {
    return {
      kind: 'refuse',
      reason:
        'DEPLOYMENT_PROFILE=production but MCP_AUTH_ENABLED=false — refusing to boot an ' +
        'unauthenticated production deployment. Set MCP_AUTH_ENABLED=true (hardened: also ' +
        'MCP_LEGACY_TOKEN_DISABLED=true, no CONTEXT_HUB_WORKSPACE_TOKEN), or use ' +
        'DEPLOYMENT_PROFILE=dev for a local/trusted stack.',
    };
  }
  if (isProd && env.MCP_AUTH_ENABLED) {
    return { kind: 'enforce-ready-required' };
  }
  if (!env.MCP_AUTH_ENABLED) {
    return { kind: 'warn-unauthenticated' };
  }
  return { kind: 'ok' };
}
