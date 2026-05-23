/**
 * Service-layer tenant-scope guard (DEFERRED-029, PR A foundation).
 *
 * Three-valued CallerScope semantics, mirroring src/api/middleware/requireScope.ts:
 *   undefined → auth-off / env-token / no middleware attached → UNRESTRICTED
 *   null      → admin/global key (api_keys.project_scope IS NULL) → UNRESTRICTED
 *   string    → project-scoped key → must equal resourceProjectId
 *
 * Cross-tenant throws ContextHubError('NOT_FOUND') to preserve the
 * no-existence-oracle property the REST middleware already enforces.
 */

import { ContextHubError } from '../errors.js';

export type CallerScope = string | null | undefined;

export function assertCallerScope(callerScope: CallerScope, resourceProjectId: string): void {
  if (callerScope === undefined || callerScope === null) return;
  if (callerScope !== resourceProjectId) {
    throw new ContextHubError('NOT_FOUND', 'not found');
  }
}

/**
 * Multi-project variant. Strict-reject: a scoped key may reach at most its own project,
 * and only when the request asks for exactly that one project. Silent filtering would let
 * a scoped caller probe other projects' existence via result-count changes.
 */
export function assertCallerScopeMulti(callerScope: CallerScope, resourceProjectIds: string[]): void {
  if (callerScope === undefined || callerScope === null) return;
  if (resourceProjectIds.length !== 1 || resourceProjectIds[0] !== callerScope) {
    throw new ContextHubError('NOT_FOUND', 'not found');
  }
}
