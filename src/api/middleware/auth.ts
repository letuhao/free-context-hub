import type { Request, Response, NextFunction } from 'express';
import { getEnv } from '../../core/index.js';
import { validateApiKey } from '../../services/apiKeys.js';

/**
 * Bearer token middleware for the REST API.
 * Checks in order:
 *   1. Env var CONTEXT_HUB_WORKSPACE_TOKEN (fast path, backwards compat → admin role)
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
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'Unauthorized: authentication error' });
    });
}
