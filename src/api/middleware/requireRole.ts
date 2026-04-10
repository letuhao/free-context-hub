import type { Request, Response, NextFunction } from 'express';

/**
 * Role hierarchy:  reader < writer < admin
 *
 * requireRole('writer') allows writer + admin.
 * requireRole('admin')  allows admin only.
 *
 * When auth is disabled (MCP_AUTH_ENABLED=false), bearerAuth calls next()
 * without setting apiKeyRole — in that case we allow everything (no role = unrestricted).
 * The env-var fast path in bearerAuth also skips role assignment — that token is admin.
 */

type Role = 'reader' | 'writer' | 'admin';

const ROLE_LEVEL: Record<Role, number> = {
  reader: 0,
  writer: 1,
  admin: 2,
};

export function requireRole(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = (req as any).apiKeyRole as string | undefined;

    // No role set = auth disabled or env-var token (admin) → allow
    if (!role) return next();

    const userLevel = ROLE_LEVEL[role as Role];
    const requiredLevel = ROLE_LEVEL[minRole];

    if (userLevel === undefined || userLevel < requiredLevel) {
      res.status(403).json({
        error: `Forbidden: requires '${minRole}' role, you have '${role}'.`,
      });
      return;
    }

    next();
  };
}
