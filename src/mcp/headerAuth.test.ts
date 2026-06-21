/**
 * [DEFERRED-060] Unit tests for the MCP Authorization-header → workspace_token bridge.
 * Pins: header parse, inject-when-absent, NEVER-overwrite an explicit token, only tools/call,
 * batch arrays, and the no-bearer no-op. (Auth-sensitive: no silent change without a test.)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bearerFromAuthHeader, injectBearerWorkspaceToken } from './headerAuth.js';

test('bearerFromAuthHeader: parses Bearer, tolerates Authorization casing + array, rejects junk', () => {
  assert.equal(bearerFromAuthHeader({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(bearerFromAuthHeader({ headers: { Authorization: 'Bearer xyz' } }), 'xyz');
  assert.equal(bearerFromAuthHeader({ headers: { authorization: ['Bearer arr'] } }), 'arr');
  assert.equal(bearerFromAuthHeader({ headers: { authorization: 'Basic abc' } }), undefined);
  assert.equal(bearerFromAuthHeader({ headers: { authorization: 'Bearer   ' } }), undefined);
  assert.equal(bearerFromAuthHeader({ headers: {} }), undefined);
  assert.equal(bearerFromAuthHeader({}), undefined);
});

test('injects workspace_token on a tools/call that omits it', () => {
  const req = { headers: { authorization: 'Bearer K' }, body: { method: 'tools/call', params: { name: 'whoami', arguments: {} } } };
  injectBearerWorkspaceToken(req);
  assert.equal((req.body.params.arguments as Record<string, unknown>).workspace_token, 'K');
});

test('creates the arguments object when the tools/call has none', () => {
  const req: any = { headers: { authorization: 'Bearer K' }, body: { method: 'tools/call', params: { name: 'whoami' } } };
  injectBearerWorkspaceToken(req);
  assert.equal(req.body.params.arguments.workspace_token, 'K');
});

test('NEVER overwrites a caller-supplied workspace_token (explicit arg wins)', () => {
  const req = { headers: { authorization: 'Bearer HEADER' }, body: { method: 'tools/call', params: { name: 'whoami', arguments: { workspace_token: 'EXPLICIT' } } } };
  injectBearerWorkspaceToken(req);
  assert.equal((req.body.params.arguments as Record<string, unknown>).workspace_token, 'EXPLICIT');
});

test('no-op without a bearer header', () => {
  const req: any = { headers: {}, body: { method: 'tools/call', params: { name: 'whoami', arguments: {} } } };
  injectBearerWorkspaceToken(req);
  assert.equal(req.body.params.arguments.workspace_token, undefined);
});

test('no-op for non-tools/call methods (initialize, tools/list)', () => {
  for (const method of ['initialize', 'tools/list', 'notifications/initialized']) {
    const req: any = { headers: { authorization: 'Bearer K' }, body: { method, params: { arguments: {} } } };
    injectBearerWorkspaceToken(req);
    assert.equal(req.body.params.arguments.workspace_token, undefined, `${method} must not get a token`);
  }
});

test('handles a JSON-RPC batch array — injects into each tools/call', () => {
  const req: any = {
    headers: { authorization: 'Bearer K' },
    body: [
      { method: 'tools/call', params: { name: 'a', arguments: {} } },
      { method: 'tools/list', params: {} },
      { method: 'tools/call', params: { name: 'b', arguments: { workspace_token: 'KEEP' } } },
    ],
  };
  injectBearerWorkspaceToken(req);
  assert.equal(req.body[0].params.arguments.workspace_token, 'K');
  assert.equal(req.body[1].params.arguments, undefined);
  assert.equal(req.body[2].params.arguments.workspace_token, 'KEEP');
});
