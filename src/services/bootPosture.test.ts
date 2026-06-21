import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBootPosture } from './bootPosture.js';

// F2g boot-posture guard — the profile × auth matrix. Pure decision; no DB, no
// process.exit, no env cache. (assertEnforceReady's own logic is covered by
// system-identity-authz.test.ts; this only pins which branch the boot path takes.)

test('dev + auth OFF → warn-unauthenticated (today’s default dev behavior)', () => {
  assert.deepEqual(
    evaluateBootPosture({ DEPLOYMENT_PROFILE: 'dev', MCP_AUTH_ENABLED: false }),
    { kind: 'warn-unauthenticated' },
  );
});

test('production + auth OFF → refuse (no unauthenticated production)', () => {
  const v = evaluateBootPosture({ DEPLOYMENT_PROFILE: 'production', MCP_AUTH_ENABLED: false });
  assert.equal(v.kind, 'refuse');
  assert.match((v as { reason: string }).reason, /production/);
  assert.match((v as { reason: string }).reason, /MCP_AUTH_ENABLED=false/);
});

test('production + auth ON → enforce-ready-required (hard boot gate)', () => {
  assert.deepEqual(
    evaluateBootPosture({ DEPLOYMENT_PROFILE: 'production', MCP_AUTH_ENABLED: true }),
    { kind: 'enforce-ready-required' },
  );
});

test('dev + auth ON → ok (test rigs / trusted auth-ON are NOT enforce-ready-gated)', () => {
  // This is the branch docker-compose.auth-test.yml lands on (auth ON, legacy token
  // still present) — assertEnforceReady would reject that, so auth-test.yml MUST pin
  // DEPLOYMENT_PROFILE=dev explicitly (the base ships profile=production).
  assert.deepEqual(
    evaluateBootPosture({ DEPLOYMENT_PROFILE: 'dev', MCP_AUTH_ENABLED: true }),
    { kind: 'ok' },
  );
});
