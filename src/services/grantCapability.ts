/**
 * Actor Data Boundary F2c — the delegation invariant (policy layer over the F2a grants writer).
 *
 * grant_capability: you may grant capability C at scope S only if you hold BOTH `delegate` AND C
 * (or higher) at a scope that COVERS S. This composes as two authorize() checks — root short-circuits
 * both (grants anything), auth-off passes both (dev posture). Because scope coverage is downward-only,
 * the same check forbids granting upward (e.g. global from a project grant) or sideways (a sibling
 * project). You can never grant more authority, or wider scope, than you hold.
 *
 * revoke_grant: the granter, or a principal with admin/delegate over the grant's scope, or root.
 *
 * Separate module (not grants.ts) to avoid an import cycle — authorize.ts already depends on grants.ts
 * for its types. See docs/specs/2026-06-19-actor-data-boundary-F2-design.md §5.
 */

import { ContextHubError } from '../core/errors.js';
import { authorize, type Action } from './authorize.js';
import { createGrant, getGrant, revokeGrant, type Capability, type ScopeType, type Grant } from './grants.js';

export async function grantCapability(params: {
  callerPrincipalId: string | null;
  grantee_principal: string;
  scope_type: ScopeType;
  scope_id?: string | null;
  capability: Capability;
}): Promise<Grant> {
  const scopeRef = { kind: params.scope_type, id: params.scope_id ?? null };
  // Two gates: (1) the re-grant flag (`delegate`) covering the target scope, and (2) the capability
  // itself covering the target scope (can't grant beyond your own authority). Both via authorize(),
  // so root + auth-off + scope-coverage (downward-only) are handled uniformly.
  const canDelegate = await authorize(params.callerPrincipalId, 'delegate', scopeRef);
  const canGrantCap = await authorize(params.callerPrincipalId, params.capability as Action, scopeRef);
  if (!canDelegate.allow || !canGrantCap.allow) {
    throw new ContextHubError(
      'FORBIDDEN',
      'not authorized to grant this capability at this scope: you need both `delegate` and the capability itself, held at a scope that covers the target (no upward/sideways grants, no granting more than you hold).',
    );
  }
  // granted_by = the acting caller. createGrant validates it is a real principal; under auth-off a
  // caller without a real principal id will be rejected there (you cannot grant anonymously).
  return createGrant({
    grantee_principal: params.grantee_principal,
    scope_type: params.scope_type,
    scope_id: params.scope_id,
    capability: params.capability,
    granted_by: params.callerPrincipalId as string,
  });
}

export async function revokeGrantAuthorized(params: {
  callerPrincipalId: string | null;
  grant_id: string;
}): Promise<{ status: 'revoked' | 'noop' }> {
  const grant = await getGrant(params.grant_id);
  // Idempotent + no oracle: an unknown grant id is simply a no-op (nothing to authorize against).
  if (!grant) return { status: 'noop' };

  const scopeRef = { kind: grant.scope_type, id: grant.scope_id };
  const isGranter = !!params.callerPrincipalId && grant.granted_by === params.callerPrincipalId;
  if (!isGranter) {
    const canAdmin = (await authorize(params.callerPrincipalId, 'admin', scopeRef)).allow;
    const canDelegate = (await authorize(params.callerPrincipalId, 'delegate', scopeRef)).allow;
    if (!canAdmin && !canDelegate) {
      throw new ContextHubError(
        'FORBIDDEN',
        'not authorized to revoke this grant: be its granter, or hold admin/delegate over its scope.',
      );
    }
  }
  const wasActive = grant.revoked_at == null;
  await revokeGrant(params.grant_id); // idempotent on revoked_at IS NULL
  return { status: wasActive ? 'revoked' : 'noop' };
}
