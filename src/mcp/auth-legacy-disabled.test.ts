/**
 * DEFERRED-029 PR E — MCP_LEGACY_TOKEN_DISABLED opt-out path.
 *
 * Verifies the resolver respects MCP_LEGACY_TOKEN_DISABLED=true: the legacy
 * single-shared CONTEXT_HUB_WORKSPACE_TOKEN must be rejected with UNAUTHORIZED
 * even when set in env. The default path (flag unset/false) keeps back-compat.
 *
 * Pure env + resolver test — no DB calls needed because the resolver short-
 * circuits BEFORE the api_keys lookup for the legacy token match path.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMcpCallerScope } from './auth.js';
import { ContextHubError } from '../core/errors.js';

const isUnauthorized = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'UNAUTHORIZED';

// ── Default (legacy enabled) — back-compat ────────────────────────────────────

test('legacy token accepted by default (MCP_LEGACY_TOKEN_DISABLED unset)', async () => {
  const prevAuth = process.env.MCP_AUTH_ENABLED;
  const prevToken = process.env.CONTEXT_HUB_WORKSPACE_TOKEN;
  const prevDisable = process.env.MCP_LEGACY_TOKEN_DISABLED;
  process.env.MCP_AUTH_ENABLED = 'true';
  process.env.CONTEXT_HUB_WORKSPACE_TOKEN = 'legacy-token-pr-e-test';
  delete process.env.MCP_LEGACY_TOKEN_DISABLED;

  // Refresh the cached env.
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();

  try {
    const scope = await resolveMcpCallerScope('legacy-token-pr-e-test');
    assert.equal(scope, null, 'legacy token → null (global), deprecated but accepted');
  } finally {
    process.env.MCP_AUTH_ENABLED = prevAuth;
    process.env.CONTEXT_HUB_WORKSPACE_TOKEN = prevToken;
    if (prevDisable === undefined) delete process.env.MCP_LEGACY_TOKEN_DISABLED;
    else process.env.MCP_LEGACY_TOKEN_DISABLED = prevDisable;
    _resetEnvCacheForTest();
  }
});

// ── Hardened (legacy disabled) — opt-out ──────────────────────────────────────

test('legacy token rejected when MCP_LEGACY_TOKEN_DISABLED=true → UNAUTHORIZED', async () => {
  const prevAuth = process.env.MCP_AUTH_ENABLED;
  const prevToken = process.env.CONTEXT_HUB_WORKSPACE_TOKEN;
  const prevDisable = process.env.MCP_LEGACY_TOKEN_DISABLED;
  process.env.MCP_AUTH_ENABLED = 'true';
  process.env.CONTEXT_HUB_WORKSPACE_TOKEN = 'legacy-token-pr-e-test';
  process.env.MCP_LEGACY_TOKEN_DISABLED = 'true';

  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();

  try {
    await assert.rejects(
      resolveMcpCallerScope('legacy-token-pr-e-test'),
      isUnauthorized,
    );
  } finally {
    process.env.MCP_AUTH_ENABLED = prevAuth;
    process.env.CONTEXT_HUB_WORKSPACE_TOKEN = prevToken;
    if (prevDisable === undefined) delete process.env.MCP_LEGACY_TOKEN_DISABLED;
    else process.env.MCP_LEGACY_TOKEN_DISABLED = prevDisable;
    _resetEnvCacheForTest();
  }
});

// ── Auth-off short-circuit unchanged ──────────────────────────────────────────

test('MCP_AUTH_ENABLED=false → undefined regardless of MCP_LEGACY_TOKEN_DISABLED', async () => {
  const prevAuth = process.env.MCP_AUTH_ENABLED;
  const prevDisable = process.env.MCP_LEGACY_TOKEN_DISABLED;
  process.env.MCP_AUTH_ENABLED = 'false';
  process.env.MCP_LEGACY_TOKEN_DISABLED = 'true';

  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();

  try {
    const scope = await resolveMcpCallerScope('anything');
    assert.equal(scope, undefined, 'auth-off short-circuit still wins');
  } finally {
    process.env.MCP_AUTH_ENABLED = prevAuth;
    if (prevDisable === undefined) delete process.env.MCP_LEGACY_TOKEN_DISABLED;
    else process.env.MCP_LEGACY_TOKEN_DISABLED = prevDisable;
    _resetEnvCacheForTest();
  }
});
