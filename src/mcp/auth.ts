/**
 * MCP auth — workspace_token → CallerScope resolver (DEFERRED-029).
 *
 * Replaces the legacy single-shared-token model with a per-project scoped model that
 * reuses the api_keys table as the single source of truth for both transports.
 *
 * Mapping:
 *   MCP_AUTH_ENABLED=false                         → undefined (auth-off, unrestricted)
 *   missing/empty token + auth on                  → throw UNAUTHORIZED
 *   token === CONTEXT_HUB_WORKSPACE_TOKEN          →
 *     - MCP_LEGACY_TOKEN_DISABLED=false (default)  → null (global, DEPRECATED — warns)
 *     - MCP_LEGACY_TOKEN_DISABLED=true             → throw UNAUTHORIZED (api_keys-only mode)
 *   api_keys row match (key_hash + not revoked)    → keyEntry.project_scope (string | null)
 *   no match                                       → throw UNAUTHORIZED
 *
 * PR E (DEFERRED-029): the legacy single-shared token path is now disable-able via
 * MCP_LEGACY_TOKEN_DISABLED=true. The default remains back-compat (accept + warn).
 * A deployment that has fully migrated to scoped api_keys should set
 * MCP_LEGACY_TOKEN_DISABLED=true to harden against accidental reuse of the legacy
 * env var.
 */

import { ContextHubError, getEnv } from '../core/index.js';
import type { CallerScope } from '../core/index.js';
import { validateApiKey, classifyCredentialFailure } from '../services/apiKeys.js';
import { resolveActingPrincipal } from '../services/actingPrincipal.js';
import { isActivePrincipal } from '../services/principals.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('mcp-auth');

/**
 * Actor Data Boundary F1d — the authenticated MCP caller: tenant scope (DEFERRED-029) PLUS the
 * credential-bound principal (F1) and the credential's expiry. `principalId` is null for the
 * legacy single-shared token, for pre-F1 unbound keys, and for auth-off — in all of which the
 * acting identity cannot be derived from the credential (resolveActingPrincipal handles the rest).
 */
export interface McpCaller {
  scope: CallerScope;
  principalId: string | null;
  expiresAt: string | null;
}

export async function resolveMcpCaller(token: string | undefined): Promise<McpCaller> {
  const env = getEnv();
  if (!env.MCP_AUTH_ENABLED) return { scope: undefined, principalId: null, expiresAt: null };

  if (!token) {
    throw new ContextHubError('UNAUTHORIZED', 'workspace_token required when MCP_AUTH_ENABLED=true');
  }

  if (env.CONTEXT_HUB_WORKSPACE_TOKEN && token === env.CONTEXT_HUB_WORKSPACE_TOKEN) {
    if (env.MCP_LEGACY_TOKEN_DISABLED) {
      // Hardened deployment: reject the legacy token explicitly. We still log
      // so the operator can see migration attempts that need to be redirected
      // to api_keys.
      logger.warn(
        { token_prefix: token.slice(0, 6) },
        'mcp: legacy CONTEXT_HUB_WORKSPACE_TOKEN rejected (MCP_LEGACY_TOKEN_DISABLED=true); use a scoped api_keys token',
      );
      throw new ContextHubError(
        'UNAUTHORIZED',
        'legacy single-shared workspace_token disabled — use a scoped api_keys token',
      );
    }
    logger.warn(
      { token_prefix: token.slice(0, 6) },
      'mcp: deprecated single-shared CONTEXT_HUB_WORKSPACE_TOKEN in use; migrate to a scoped api_keys token (DEFERRED-029). Set MCP_LEGACY_TOKEN_DISABLED=true to reject it.',
    );
    return { scope: null, principalId: null, expiresAt: null };
  }

  const keyEntry = await validateApiKey(token);
  if (!keyEntry) {
    // Distinguish a credential that WAS valid but is now expired/revoked (the agent must re-auth
    // out-of-band, not retry) from a token that never matched. [F1d / G3 contract]
    //
    // INFO-LEAK GUARD [F1d adversary #1]: the caller is unauthenticated by definition here, so we
    // surface ONLY the credential's own lifecycle (expired | revoked). principal_inactive is folded
    // into the generic UNAUTHORIZED — it must never reveal to an unauthenticated party that a named
    // principal was suspended/retired. (Residual: expired/revoked vs invalid is a low-value
    // existence oracle given 24-byte token entropy; accepted per the G3 re-auth contract.)
    const reason = await classifyCredentialFailure(token);
    if (reason === 'expired' || reason === 'revoked') {
      throw new ContextHubError('CREDENTIAL_EXPIRED', `credential ${reason}; re-authenticate out-of-band`);
    }
    throw new ContextHubError('UNAUTHORIZED', 'invalid workspace_token');
  }
  return { scope: keyEntry.project_scope, principalId: keyEntry.principal_id, expiresAt: keyEntry.expires_at };
}

/** Back-compat scope-only resolver — delegates to resolveMcpCaller (single auth path). */
export async function resolveMcpCallerScope(token: string | undefined): Promise<CallerScope> {
  return (await resolveMcpCaller(token)).scope;
}

/**
 * Actor Data Boundary F1e — the single chokepoint every previously-asserting tool uses to learn WHO
 * is acting. Composes resolveMcpCaller (credential → principal) with resolveActingPrincipal (the
 * spoofing defense), applying the two F1d contracts:
 *   (a) allowUnboundAssertion = !MCP_LEGACY_TOKEN_DISABLED — a hardened deployment refuses to honor
 *       an asserted actor_id from an UNBOUND credential (no impersonation).
 *   (b) under auth-ON, a null acting principal (unbound + refused) is rejected — the caller must use
 *       a principal-bound credential rather than assert an identity.
 * Returns the caller's tenant scope alongside, so a handler resolves auth once.
 *
 * Note on F1d contract #3 (validate asserted == active principal): under auth-ON the only non-null
 * results are (i) the authenticated bound principal — already gated active by validateApiKey — or
 * (ii) nothing (unbound refused by (a)/(b)). So no forged/suspended principal can be persisted in
 * the hardened posture. Under auth-OFF / legacy-allowed the actor is workspace-trusted free text by
 * design (dev/CI lane unchanged); validating it against principals would break existing flows.
 */
/**
 * The `system:` and `motion:` prefixes are RESERVED for synthetic/system identities written by
 * background services (sweep/tally/chaining) and collective routing. The actor migration + the
 * enforce-ready gate exclude them (they're not principals); to make that exclusion sound, a
 * user-supplied actor identity may NEVER bear these prefixes — otherwise a real actor named
 * `system:*` would be excluded-and-stranded while the gate still reported safe. [F1-adv pass 3]
 * Enforced at the MCP user-input boundary (these resolvers); system services bypass them.
 */
const RESERVED_ACTOR_PREFIXES = ['system:', 'motion:'] as const;
export function isReservedActorId(v: string | null | undefined): boolean {
  return typeof v === 'string' && RESERVED_ACTOR_PREFIXES.some((p) => v.startsWith(p));
}
function rejectReservedActorId(v: string | null | undefined): void {
  if (isReservedActorId(v)) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'actor_id may not use the reserved "system:"/"motion:" prefix (reserved for system identities).',
    );
  }
}

export async function resolveActingActor(
  token: string | undefined,
  assertedActorId?: string | null,
): Promise<{ scope: CallerScope; actingPrincipalId: string | null }> {
  rejectReservedActorId(assertedActorId);
  const caller = await resolveMcpCaller(token);
  const env = getEnv();
  const acting = resolveActingPrincipal({
    authEnabled: Boolean(env.MCP_AUTH_ENABLED),
    authenticatedPrincipalId: caller.principalId,
    assertedActorId,
    allowUnboundAssertion: !env.MCP_LEGACY_TOKEN_DISABLED,
  });
  if (env.MCP_AUTH_ENABLED && acting === null) {
    throw new ContextHubError(
      'ASSERTED_IDENTITY_REJECTED',
      'no derivable acting identity: use a principal-bound credential (an asserted actor_id is not honored for unbound credentials when MCP_LEGACY_TOKEN_DISABLED=true).',
    );
  }
  return { scope: caller.scope, actingPrincipalId: acting };
}

/**
 * Actor Data Boundary F1f — validate a TARGET/reference actor field (a member being added, a vote
 * owner, a proxy delegate, a veto holder) — identity the caller NAMES rather than claims as their
 * own. Under auth-ON the target MUST be an existing active principal (so the coordination substrate
 * is uniformly principal-keyed and ownership/membership comparisons hold); under auth-OFF it is a
 * free string, unchanged. Returns the value to persist.
 */
export async function resolveTargetActor(actorId: string): Promise<string> {
  rejectReservedActorId(actorId); // reserved prefixes are never valid user-named targets (all postures)
  if (!getEnv().MCP_AUTH_ENABLED) return actorId;
  if (!(await isActivePrincipal(actorId))) {
    throw new ContextHubError(
      'BAD_REQUEST',
      `target actor "${actorId}" is not an active principal; pass a principal_id (see list_principals / whoami).`,
    );
  }
  return actorId;
}

export async function resolveTargetActors(actorIds: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const a of actorIds) out.push(await resolveTargetActor(a));
  return out;
}
