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
import { validateApiKey } from '../services/apiKeys.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('mcp-auth');

export async function resolveMcpCallerScope(token: string | undefined): Promise<CallerScope> {
  const env = getEnv();
  if (!env.MCP_AUTH_ENABLED) return undefined;

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
    return null;
  }

  const keyEntry = await validateApiKey(token);
  if (!keyEntry) {
    throw new ContextHubError('UNAUTHORIZED', 'invalid workspace_token');
  }
  return keyEntry.project_scope;
}
