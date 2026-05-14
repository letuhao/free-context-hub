import type { Request, Response, NextFunction } from 'express';

/**
 * Phase 13 Sprint 13.2 — tenant-scope enforcement middleware.
 *
 * Verifies that the caller's API-key project_scope (set by bearerAuth via
 * apiKeyScope) either:
 *   (a) is null  → caller has global scope, allowed for any project
 *   (b) matches the project_id passed in the URL parameter (default `id`)
 *
 * Calling convention:
 *   router.delete('/:leaseId/force', requireRole('admin'), requireScope(), handler)
 *   router.delete('/:leaseId/force', requireRole('admin'), requireScope('id'), handler)
 *   router.delete('/:leaseId/force', requireRole('admin'), requireScope('projectId'), handler)
 *
 * Resolution mirrors requireRole.ts:25-27:
 *   - When no role attached (auth disabled or env-var token), apiKeyScope is
 *     also undefined → treat as global → allow. This is the same "unrestricted
 *     fallback" semantics requireRole uses; the two middlewares stay aligned.
 *
 * Closes Adversary code-review r1 F1 BLOCK + DEFERRED-004 for this route.
 */

export function requireScope(paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction) => {
    const attachedScope = (req as { apiKeyScope?: string | null }).apiKeyScope;

    // No scope attached (auth disabled, env-var token, or any future middleware
    // that omits scope) → unrestricted. The fallback keys off `apiKeyScope ===
    // undefined` rather than `apiKeyRole` because scope is what this middleware
    // enforces; coupling to a sibling's role state was fragile (r2 F1 fix).
    if (attachedScope === undefined) return next();

    // Global scope (apiKeyScope === null) → allowed for any project
    if (attachedScope === null) return next();

    const targetProjectId = (req.params as Record<string, string>)[paramName];
    if (!targetProjectId) {
      res.status(400).json({
        error: `requireScope: route is missing :${paramName} URL param`,
      });
      return;
    }

    if (attachedScope !== targetProjectId) {
      res.status(403).json({
        error: `Forbidden: API key is scoped to '${attachedScope}', cannot access '${targetProjectId}'`,
      });
      return;
    }

    next();
  };
}
