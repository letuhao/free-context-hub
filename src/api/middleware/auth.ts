import type { Request, Response, NextFunction } from 'express';
import { getEnv } from '../../core/index.js';

/**
 * Bearer token middleware for the REST API.
 * Validates `Authorization: Bearer <token>` against CONTEXT_HUB_WORKSPACE_TOKEN.
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
  if (token !== env.CONTEXT_HUB_WORKSPACE_TOKEN) {
    res.status(401).json({ error: 'Unauthorized: invalid token' });
    return;
  }

  next();
}
