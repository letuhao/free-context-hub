/**
 * Actor Data Boundary F1d — resolve the ACTING principal (the spoofing defense).
 *
 * The acting principal is derived from the CREDENTIAL, never trusted from a tool's args. This pure
 * function reconciles the credential-derived authenticated principal with any legacy `actor_id` a
 * caller still sends, and is the single chokepoint F1e applies at every previously-asserting tool.
 *
 * Contract (see docs/specs/2026-06-19-actor-data-boundary-mcp-fe-design.md §2.2):
 *   - auth ON + a BOUND credential (authenticatedPrincipalId set):
 *       asserted absent          → authenticated principal
 *       asserted == authenticated → authenticated principal   (compared case-insensitively — UUIDs)
 *       asserted != authenticated → throw ASSERTED_IDENTITY_REJECTED   (un-spoofable)
 *   - auth ON + an UNBOUND credential (legacy token / pre-F1 key, principal null):
 *       allowUnboundAssertion=true  (legacy posture, MCP_LEGACY_TOKEN_DISABLED=false) → honor asserted
 *       allowUnboundAssertion=false (hardened, the default)                          → null (refuse)
 *       Gating this is what stops a legacy/NULL-principal credential holder from impersonating an
 *       arbitrary principal under auth-ON. [F1d adversary HIGH #2]
 *   - auth OFF (dev/root posture):
 *       honor asserted if present, else fall back to the root/dev principal (behavior unchanged)
 *
 * HARD CONTRACT ON THE RETURN VALUE [F1d adversary #3]: when this returns a non-null value that did
 * NOT come from `authenticatedPrincipalId` (i.e. an honored asserted string — the unbound and
 * auth-OFF branches), the value is UNVALIDATED caller input. The consumer (F1e) MUST verify it
 * resolves to an existing, ACTIVE principal within the caller's tenant scope before persisting it to
 * any actor/created_by/event field — otherwise forged provenance and the suspended-principal bypass
 * that validateApiKey closes are reintroduced.
 */

import { ContextHubError } from '../core/errors.js';

function normalize(actor: string | null | undefined): string | null {
  if (typeof actor !== 'string') return null;
  const trimmed = actor.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function resolveActingPrincipal(params: {
  authEnabled: boolean;
  authenticatedPrincipalId: string | null;
  assertedActorId?: string | null;
  rootDevPrincipalId?: string | null;
  /** Whether an UNBOUND credential may honor an asserted actor_id (legacy posture). Default false
   *  (fail-closed): hardened deployments refuse to derive identity from an unbound credential. */
  allowUnboundAssertion?: boolean;
}): string | null {
  const asserted = normalize(params.assertedActorId);

  if (params.authEnabled) {
    if (params.authenticatedPrincipalId) {
      // Bound credential — identity is real. Reject any asserted value that disagrees. UUIDs are
      // case-insensitive (Postgres returns lowercase); compare canonically so an upper/mixed-case
      // assertion of the SAME identity is not a false reject. [F1d adversary #5]
      if (asserted && asserted.toLowerCase() !== params.authenticatedPrincipalId.toLowerCase()) {
        throw new ContextHubError(
          'ASSERTED_IDENTITY_REJECTED',
          'asserted actor_id does not match the authenticated principal; identity is derived from the credential, not the request body.',
        );
      }
      return params.authenticatedPrincipalId;
    }
    // Unbound credential (legacy token / pre-F1 key) — identity cannot be derived from the
    // credential. Only honor an asserted value when the legacy posture explicitly allows it;
    // otherwise refuse (null) so no unbound holder can impersonate a principal under auth-ON.
    return params.allowUnboundAssertion ? asserted : null;
  }

  // auth OFF — dev/root posture, behavior unchanged.
  return asserted ?? params.rootDevPrincipalId ?? null;
}
