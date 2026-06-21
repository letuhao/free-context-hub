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
import { getPrincipal, type Principal } from '../../services/principals.js';

/**
 * Actor Data Boundary S1 — the authenticated principal, surfaced for the GUI sidebar account footer
 * ("signed in as {display_name}"). A SUBSET of the principals row (no internal columns beyond what the
 * footer + scope-gating need). Null when no principal is bound (env-token fast-path / auth-off / legacy
 * unbound key) — the footer renders a generic identity in that case.
 */
export interface MePrincipal {
  principal_id: string;
  display_name: string;
  kind: Principal['kind'];
  status: Principal['status'];
  is_root: boolean;
  is_system: boolean;
}

export interface MeResponse {
  role: 'reader' | 'writer' | 'admin';
  project_scope: string | null;
  auth_enabled: boolean;
  key_source: 'no_auth' | 'env_token' | 'db_key';
  /** The authenticated principal (Actor Data Boundary S1), or null when none is bound. */
  principal: MePrincipal | null;
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

  // principal is resolved asynchronously by the router (it needs a DB lookup); the pure builder
  // always sets it to null and the router overlays the resolved principal. This keeps buildMeResponse
  // synchronous + unit-testable, exactly as the existing tests rely on.
  if (!authEnabled) {
    return { role: 'admin', project_scope: null, auth_enabled: false, key_source: 'no_auth', principal: null };
  }
  // env-var token path: bearerAuth.ts:25-27 returns next() without setting EITHER role or scope.
  // We require BOTH to be undefined to call this an env_token. If scope is attached without role,
  // that's a misconfigured / future-middleware scenario — treat as restrictive (no admin UI).
  // r3 F1 fix: consult both attachedRole AND attachedScope, mirroring requireScope's fallback.
  if (attachedRole === undefined && attachedScope === undefined) {
    return { role: 'admin', project_scope: null, auth_enabled: true, key_source: 'env_token', principal: null };
  }
  if (attachedRole === undefined && attachedScope !== undefined) {
    // Unexpected shape — scope without role. Return the most-restrictive identity rather than
    // mis-reporting admin/global. GUI's canForceReleaseRow requires role==='admin', so this
    // hides admin UI as intended.
    return { role: 'reader', project_scope: attachedScope ?? null, auth_enabled: true, key_source: 'db_key', principal: null };
  }
  return {
    role: attachedRole as 'reader' | 'writer' | 'admin',
    project_scope: attachedScope ?? null,
    auth_enabled: true,
    key_source: 'db_key',
    principal: null,
  };
}

/**
 * Resolve the bound principal (Actor Data Boundary S1) for the sidebar footer. Returns the MePrincipal
 * subset, or null when no principal is bound or the lookup misses. Best-effort: a lookup failure must
 * never break /api/me (the footer degrades to a generic identity), so the router catches.
 */
export async function resolveMePrincipal(
  principalId: string | null | undefined,
  getPrincipalFn: (id: string) => Promise<Principal | null> = getPrincipal,
): Promise<MePrincipal | null> {
  if (typeof principalId !== 'string' || principalId.length === 0) return null;
  const p = await getPrincipalFn(principalId);
  if (!p) return null;
  return {
    principal_id: p.principal_id,
    display_name: p.display_name,
    kind: p.kind,
    status: p.status,
    is_root: p.is_root,
    is_system: p.is_system,
  };
}

/**
 * Factory that returns the express router. Optional getEnvFn override for
 * tests; production calls with no arg → uses the real getEnv.
 */
export function createMeRouter(getEnvFn: () => { MCP_AUTH_ENABLED?: boolean } = defaultGetEnv): Router {
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    const body = buildMeResponse(
      req as Request & { apiKeyRole?: string; apiKeyScope?: string | null },
      getEnvFn,
    );
    // Overlay the authenticated principal (S1) for the sidebar footer. Best-effort — a lookup
    // failure leaves principal null rather than failing the whole /api/me response.
    try {
      const principalId = (req as { apiKeyPrincipalId?: string | null }).apiKeyPrincipalId ?? null;
      body.principal = await resolveMePrincipal(principalId);
    } catch {
      body.principal = null;
    }
    res.json(body);
  });
  return router;
}

// Default-mounted instance for src/api/index.ts to consume.
export const meRouter = createMeRouter();
