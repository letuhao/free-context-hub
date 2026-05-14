/**
 * Phase 13 Sprint 13.2 — GET /api/me endpoint.
 *
 * Design ref:  docs/specs/2026-05-15-phase-13-sprint-13.2-design.md §10 (v4)
 * Spec hash:   d691fbb5c0b9f92c
 *
 * Returns identity context for the current authenticated user. Used by the GUI
 * to decide whether to render admin-only UI elements (e.g., force-release on
 * the Active Work panel) AND to filter multi-project rows by tenant scope.
 *
 * Three-way resolution mirrors bearerAuth + requireRole semantics:
 *   - MCP_AUTH_ENABLED=false → no_auth (anyone, admin-equivalent in dev)
 *   - MCP_AUTH_ENABLED=true + no role attached → env_token (env-var fast-path)
 *   - MCP_AUTH_ENABLED=true + role attached → db_key (api_keys table entry)
 */

import { Router, type Request, type Response } from 'express';
import { getEnv as defaultGetEnv } from '../../core/index.js';

export interface MeResponse {
  role: 'reader' | 'writer' | 'admin';
  project_scope: string | null;
  auth_enabled: boolean;
  key_source: 'no_auth' | 'env_token' | 'db_key';
}

/**
 * Pure handler logic — exported for direct unit testing without express setup.
 */
export function buildMeResponse(
  req: Pick<Request, never> & { apiKeyRole?: string; apiKeyScope?: string | null },
  getEnvFn: () => { MCP_AUTH_ENABLED?: boolean },
): MeResponse {
  const env = getEnvFn();
  const attachedRole = req.apiKeyRole;
  const attachedScope = req.apiKeyScope;
  const authEnabled = env.MCP_AUTH_ENABLED ?? false;

  if (!authEnabled) {
    return { role: 'admin', project_scope: null, auth_enabled: false, key_source: 'no_auth' };
  }
  // env-var token path: bearerAuth.ts:25-27 returns next() without setting EITHER role or scope.
  // We require BOTH to be undefined to call this an env_token. If scope is attached without role,
  // that's a misconfigured / future-middleware scenario — treat as restrictive (no admin UI).
  // r3 F1 fix: consult both attachedRole AND attachedScope, mirroring requireScope's fallback.
  if (attachedRole === undefined && attachedScope === undefined) {
    return { role: 'admin', project_scope: null, auth_enabled: true, key_source: 'env_token' };
  }
  if (attachedRole === undefined && attachedScope !== undefined) {
    // Unexpected shape — scope without role. Return the most-restrictive identity rather than
    // mis-reporting admin/global. GUI's canForceReleaseRow requires role==='admin', so this
    // hides admin UI as intended.
    return { role: 'reader', project_scope: attachedScope ?? null, auth_enabled: true, key_source: 'db_key' };
  }
  return {
    role: attachedRole as 'reader' | 'writer' | 'admin',
    project_scope: attachedScope ?? null,
    auth_enabled: true,
    key_source: 'db_key',
  };
}

/**
 * Factory that returns the express router. Optional getEnvFn override for
 * tests; production calls with no arg → uses the real getEnv.
 */
export function createMeRouter(getEnvFn: () => { MCP_AUTH_ENABLED?: boolean } = defaultGetEnv): Router {
  const router = Router();
  router.get('/', (req: Request, res: Response) => {
    const body = buildMeResponse(
      req as Request & { apiKeyRole?: string; apiKeyScope?: string | null },
      getEnvFn,
    );
    res.json(body);
  });
  return router;
}

// Default-mounted instance for src/api/index.ts to consume.
export const meRouter = createMeRouter();
