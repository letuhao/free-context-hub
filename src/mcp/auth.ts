/**
 * MCP auth — workspace_token → CallerScope resolver (DEFERRED-029, PR A foundation).
 *
 * Replaces the legacy single-shared-token model with a per-project scoped model that
 * reuses the api_keys table as the single source of truth for both transports.
 *
 * Mapping:
 *   MCP_AUTH_ENABLED=false                         → undefined (auth-off, unrestricted)
 *   missing/empty token + auth on                  → throw UNAUTHORIZED
 *   token === CONTEXT_HUB_WORKSPACE_TOKEN          → null  (global, DEPRECATED — warns)
 *   api_keys row match (key_hash + not revoked)    → keyEntry.project_scope (string | null)
 *   no match                                       → throw UNAUTHORIZED
 *
 * NOTE (PR A): this resolver is defined but not yet wired into any MCP tool handler.
 * PR B onward switches each handler to call this and pass the result to its service fn.
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
    logger.warn(
      { token_prefix: token.slice(0, 6) },
      'mcp: deprecated single-shared CONTEXT_HUB_WORKSPACE_TOKEN in use; migrate to a scoped api_keys token (DEFERRED-029)',
    );
    return null;
  }

  const keyEntry = await validateApiKey(token);
  if (!keyEntry) {
    throw new ContextHubError('UNAUTHORIZED', 'invalid workspace_token');
  }
  return keyEntry.project_scope;
}
