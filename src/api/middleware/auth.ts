import type { Request, Response, NextFunction } from 'express';
import { getEnv } from '../../core/index.js';
import { validateApiKey } from '../../services/apiKeys.js';
import { createModuleLogger } from '../../utils/logger.js';

const logger = createModuleLogger('rest-auth');

/**
 * Actor Data Boundary F2f — the acting principal id attached by bearerAuth (the bound principal of
 * the api key, F1b). This is what authorize()/assertAuthorized take, replacing the project-scope
 * `callerScopeOf`. Returns null when no principal is bound (legacy unbound key, env-token fast path,
 * or auth-off) — under auth-off assertAuthorized no-ops regardless, so this is dev-safe.
 */
export function callerPrincipalOf(req: Request): string | null {
  return (req as { apiKeyPrincipalId?: string | null }).apiKeyPrincipalId ?? null;
}

/**
 * Bearer token middleware for the REST API.
 * Checks in order:
 *   1. Env var CONTEXT_HUB_WORKSPACE_TOKEN (fast path, backwards compat → admin role)
 *      - DEPRECATED (DEFERRED-029 PR E). Rejected entirely when
 *        MCP_LEGACY_TOKEN_DISABLED=true to mirror the MCP transport.
 *   2. api_keys table (SHA-256 hash lookup → role from DB)
 * Skipped when MCP_AUTH_ENABLED is false.
 */
export function bearerAuth(req: Request, res: Response, next: NextFunction) {
  const env = getEnv();
  if (!env.MCP_AUTH_ENABLED) return next();

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: missing Bearer token' });
    return;
  }

  const token = header.slice(7);

  // Fast path: env var token (admin)
  if (env.CONTEXT_HUB_WORKSPACE_TOKEN && token === env.CONTEXT_HUB_WORKSPACE_TOKEN) {
    // PR F SEC-7 (third-pass live verification): mirror src/mcp/auth.ts —
    // when MCP_LEGACY_TOKEN_DISABLED=true the legacy single-shared token
    // must be rejected on REST too. Without this, hardened-mode deployments
    // think they've disabled the legacy token but REST routes still accept
    // it — a documentation/implementation mismatch with real security cost.
    if (env.MCP_LEGACY_TOKEN_DISABLED) {
      logger.warn(
        { token_prefix: token.slice(0, 6), path: req.path },
        'rest: legacy CONTEXT_HUB_WORKSPACE_TOKEN rejected (MCP_LEGACY_TOKEN_DISABLED=true); use a scoped api_keys token',
      );
      res.status(401).json({
        error: 'Unauthorized: legacy single-shared token disabled — use a scoped api_keys token',
      });
      return;
    }
    return next();
  }

  // DB lookup: api_keys table
  validateApiKey(token)
    .then((keyEntry) => {
      if (!keyEntry) {
        res.status(401).json({ error: 'Unauthorized: invalid token' });
        return;
      }
      // Attach role + scope + key name to request for permission enforcement
      // and audit identity (Phase 13 SS3 — review approve/return derives
      // resolved_by from apiKeyName).
      (req as any).apiKeyRole = keyEntry.role;
      (req as any).apiKeyScope = keyEntry.project_scope;
      (req as any).apiKeyName = keyEntry.name;
      // Actor Data Boundary F2f — the bound acting principal (F1b). authorize()/assertAuthorized
      // need the principal id, not the project scope. Null for a legacy unbound key; that path
      // loses access only once MCP_AUTH_ENABLED flips (F2g posture-flip prerequisite).
      (req as any).apiKeyPrincipalId = keyEntry.principal_id;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'Unauthorized: authentication error' });
    });
}
