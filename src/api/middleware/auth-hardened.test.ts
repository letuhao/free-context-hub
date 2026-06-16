/**
 * DEFERRED-029 PR F SEC-7 — bearerAuth + MCP_LEGACY_TOKEN_DISABLED.
 *
 * Found during third-pass live verification of hardened mode:
 *   - src/mcp/auth.ts respects MCP_LEGACY_TOKEN_DISABLED (PR E added it)
 *   - src/api/middleware/auth.ts (REST) did NOT — silent inconsistency
 *
 * In hardened mode (MCP_AUTH_ENABLED=true + MCP_LEGACY_TOKEN_DISABLED=true)
 * an attacker who knew CONTEXT_HUB_WORKSPACE_TOKEN could still authenticate
 * to REST endpoints. Documentation claimed "Legacy token rejected" but the
 * REST middleware accepted it unconditionally.
 *
 * Fix: bearerAuth now mirrors the MCP resolver — reject the legacy token
 * with 401 when the disable flag is set.
 *
 * These tests run DB-free by stubbing req/res and toggling process.env.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { bearerAuth } from './auth.js';
import { _resetEnvCacheForTest } from '../../env.js';

function mockReqRes(authHeader: string | undefined) {
  const ctx = {
    req: { headers: authHeader ? { authorization: authHeader } : {}, path: '/test' } as any,
    res: {
      statusValue: 0,
      jsonValue: null as unknown,
      status(n: number) { this.statusValue = n; return this; },
      json(v: unknown) { this.jsonValue = v; return this; },
    },
    nextCalled: false,
  };
  return ctx;
}

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const keys = ['MCP_AUTH_ENABLED', 'MCP_LEGACY_TOKEN_DISABLED', 'CONTEXT_HUB_WORKSPACE_TOKEN'];
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  return (async () => {
    try {
      for (const [k, v] of Object.entries(overrides)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      _resetEnvCacheForTest();
      await fn();
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
      _resetEnvCacheForTest();
    }
  })();
}

// ── Default (legacy enabled) — back-compat ───────────────────────────────────

test('SEC-7: legacy CONTEXT_HUB_WORKSPACE_TOKEN accepted by default (back-compat)', async () => {
  await withEnv({
    MCP_AUTH_ENABLED: 'true',
    MCP_LEGACY_TOKEN_DISABLED: undefined,
    CONTEXT_HUB_WORKSPACE_TOKEN: 'legacy-sec7-test',
  }, () => {
    const ctx = mockReqRes('Bearer legacy-sec7-test');
    bearerAuth(ctx.req, ctx.res as any, () => { ctx.nextCalled = true; });
    assert.equal(ctx.nextCalled, true, 'legacy token must pass through to next() when flag unset');
    assert.equal(ctx.res.statusValue, 0, 'no error status should be set');
  });
});

// ── Hardened (legacy disabled) — SEC-7 fix ───────────────────────────────────

test('SEC-7: legacy token rejected with 401 when MCP_LEGACY_TOKEN_DISABLED=true', async () => {
  await withEnv({
    MCP_AUTH_ENABLED: 'true',
    MCP_LEGACY_TOKEN_DISABLED: 'true',
    CONTEXT_HUB_WORKSPACE_TOKEN: 'legacy-sec7-test',
  }, () => {
    const ctx = mockReqRes('Bearer legacy-sec7-test');
    bearerAuth(ctx.req, ctx.res as any, () => { ctx.nextCalled = true; });
    assert.equal(ctx.nextCalled, false, 'legacy token must NOT pass through in hardened mode');
    assert.equal(ctx.res.statusValue, 401, 'must respond 401 Unauthorized');
    const body = ctx.res.jsonValue as { error: string };
    assert.match(body.error, /legacy.*disabled|use.*api_keys/i,
      'error message should indicate legacy is disabled');
  });
});

// ── Auth-off — short-circuit unchanged ───────────────────────────────────────

test('SEC-7: MCP_AUTH_ENABLED=false short-circuit wins regardless of flag', async () => {
  await withEnv({
    MCP_AUTH_ENABLED: 'false',
    MCP_LEGACY_TOKEN_DISABLED: 'true',
    CONTEXT_HUB_WORKSPACE_TOKEN: 'legacy-sec7-test',
  }, () => {
    const ctx = mockReqRes(undefined); // no Authorization header
    bearerAuth(ctx.req, ctx.res as any, () => { ctx.nextCalled = true; });
    assert.equal(ctx.nextCalled, true, 'auth-off should bypass everything');
  });
});

// ── Missing token still rejected in hardened mode (positive control) ─────────

test('SEC-7: missing Bearer header still 401 in hardened mode', async () => {
  await withEnv({
    MCP_AUTH_ENABLED: 'true',
    MCP_LEGACY_TOKEN_DISABLED: 'true',
    CONTEXT_HUB_WORKSPACE_TOKEN: 'legacy-sec7-test',
  }, () => {
    const ctx = mockReqRes(undefined);
    bearerAuth(ctx.req, ctx.res as any, () => { ctx.nextCalled = true; });
    assert.equal(ctx.nextCalled, false);
    assert.equal(ctx.res.statusValue, 401);
  });
});
