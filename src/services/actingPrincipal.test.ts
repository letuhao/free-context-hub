/**
 * Actor Data Boundary F1d — resolveActingPrincipal (the spoofing defense).
 *
 * Pure logic (no DB): given the credential-derived authenticated principal and the legacy asserted
 * actor_id from a tool's args, decide who is acting — or reject a mismatch.
 *
 *   auth ON, bound credential:
 *     - no asserted              -> authenticated principal
 *     - asserted == authenticated -> authenticated principal
 *     - asserted != authenticated -> ASSERTED_IDENTITY_REJECTED
 *   auth ON, UNBOUND credential (legacy token / legacy key, principal null):
 *     - cannot derive identity -> honor asserted (workspace-trusted, migration posture)
 *   auth OFF:
 *     - honor asserted if present, else fall back to the root/dev principal
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveActingPrincipal } from './actingPrincipal.js';
import { ContextHubError } from '../core/errors.js';

const AUTHED = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ROOTDEV = '99999999-9999-9999-9999-999999999999';

test('auth ON + bound + no asserted -> authenticated principal', () => {
  assert.equal(
    resolveActingPrincipal({ authEnabled: true, authenticatedPrincipalId: AUTHED }),
    AUTHED,
  );
});

test('auth ON + bound + asserted matches -> authenticated principal', () => {
  assert.equal(
    resolveActingPrincipal({ authEnabled: true, authenticatedPrincipalId: AUTHED, assertedActorId: AUTHED }),
    AUTHED,
  );
});

test('auth ON + bound + asserted MISMATCH -> ASSERTED_IDENTITY_REJECTED', () => {
  assert.throws(
    () => resolveActingPrincipal({ authEnabled: true, authenticatedPrincipalId: AUTHED, assertedActorId: OTHER }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'ASSERTED_IDENTITY_REJECTED',
  );
});

test('auth ON + bound + asserted is empty string -> treated as absent, uses authenticated', () => {
  assert.equal(
    resolveActingPrincipal({ authEnabled: true, authenticatedPrincipalId: AUTHED, assertedActorId: '  ' }),
    AUTHED,
  );
});

test('auth ON + bound + asserted is UPPERCASE form of authenticated -> accepted (canonical compare) [adversary #5]', () => {
  assert.equal(
    resolveActingPrincipal({ authEnabled: true, authenticatedPrincipalId: AUTHED, assertedActorId: AUTHED.toUpperCase() }),
    AUTHED,
  );
});

test('auth ON + UNBOUND + asserted, allowUnboundAssertion=true -> honors asserted (legacy posture)', () => {
  assert.equal(
    resolveActingPrincipal({ authEnabled: true, authenticatedPrincipalId: null, assertedActorId: 'agent-bob', allowUnboundAssertion: true }),
    'agent-bob',
  );
});

test('auth ON + UNBOUND + asserted, allowUnboundAssertion=false (default) -> null (no impersonation) [adversary #2]', () => {
  assert.equal(
    resolveActingPrincipal({ authEnabled: true, authenticatedPrincipalId: null, assertedActorId: 'victim-principal-uuid' }),
    null,
  );
  // explicit false too
  assert.equal(
    resolveActingPrincipal({ authEnabled: true, authenticatedPrincipalId: null, assertedActorId: 'victim', allowUnboundAssertion: false }),
    null,
  );
});

test('auth ON + UNBOUND + no asserted -> null (no identity derivable)', () => {
  assert.equal(
    resolveActingPrincipal({ authEnabled: true, authenticatedPrincipalId: null, allowUnboundAssertion: true }),
    null,
  );
});

test('auth OFF + asserted -> honors asserted (dev behavior unchanged)', () => {
  assert.equal(
    resolveActingPrincipal({ authEnabled: false, authenticatedPrincipalId: null, assertedActorId: 'dev-agent' }),
    'dev-agent',
  );
});

test('auth OFF + no asserted -> falls back to root/dev principal', () => {
  assert.equal(
    resolveActingPrincipal({ authEnabled: false, authenticatedPrincipalId: null, rootDevPrincipalId: ROOTDEV }),
    ROOTDEV,
  );
});

test('auth OFF + no asserted + no rootDev -> null', () => {
  assert.equal(
    resolveActingPrincipal({ authEnabled: false, authenticatedPrincipalId: null }),
    null,
  );
});

test('auth ON + bound + asserted mismatch even when rootDev present -> still rejected (no escape hatch)', () => {
  assert.throws(
    () =>
      resolveActingPrincipal({
        authEnabled: true,
        authenticatedPrincipalId: AUTHED,
        assertedActorId: OTHER,
        rootDevPrincipalId: ROOTDEV,
      }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'ASSERTED_IDENTITY_REJECTED',
  );
});
