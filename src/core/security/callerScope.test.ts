/**
 * DEFERRED-029 PR A — tenant-scope helper unit tests.
 *
 * Four-case matrix per helper. No DB.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCallerScope, assertCallerScopeMulti } from './callerScope.js';
import { ContextHubError } from '../errors.js';

// ── assertCallerScope ─────────────────────────────────────────────────────

test('assertCallerScope: undefined → unrestricted (does not throw on any project)', () => {
  assert.doesNotThrow(() => assertCallerScope(undefined, 'proj-A'));
});

test('assertCallerScope: null → unrestricted (global key)', () => {
  assert.doesNotThrow(() => assertCallerScope(null, 'proj-A'));
});

test('assertCallerScope: matching scope → OK', () => {
  assert.doesNotThrow(() => assertCallerScope('proj-A', 'proj-A'));
});

test('assertCallerScope: cross-tenant → throws NOT_FOUND (no existence oracle)', () => {
  assert.throws(
    () => assertCallerScope('proj-A', 'proj-B'),
    (err: unknown) => {
      assert.ok(err instanceof ContextHubError, 'must be a ContextHubError');
      assert.equal((err as ContextHubError).code, 'NOT_FOUND');
      assert.equal((err as ContextHubError).message, 'not found',
        'message is the generic "not found" — same bytes as an unknown-id 404 (no oracle)');
      return true;
    },
  );
});

// ── assertCallerScopeMulti ────────────────────────────────────────────────

test('assertCallerScopeMulti: undefined / null → unrestricted (any project list)', () => {
  assert.doesNotThrow(() => assertCallerScopeMulti(undefined, ['A', 'B']));
  assert.doesNotThrow(() => assertCallerScopeMulti(null, ['A', 'B']));
  assert.doesNotThrow(() => assertCallerScopeMulti(undefined, []));
});

test('assertCallerScopeMulti: scope + single matching → OK', () => {
  assert.doesNotThrow(() => assertCallerScopeMulti('proj-A', ['proj-A']));
});

test('assertCallerScopeMulti: scope + single mismatching → NOT_FOUND', () => {
  assert.throws(
    () => assertCallerScopeMulti('proj-A', ['proj-B']),
    (err: unknown) => err instanceof ContextHubError && (err as ContextHubError).code === 'NOT_FOUND',
  );
});

test('assertCallerScopeMulti: scope + multi (any size > 1) → NOT_FOUND (strict-reject; no result-count oracle)', () => {
  assert.throws(
    () => assertCallerScopeMulti('proj-A', ['proj-A', 'proj-B']),
    (err: unknown) => err instanceof ContextHubError && (err as ContextHubError).code === 'NOT_FOUND',
  );
  // Even an all-matching multi list is rejected — silent filtering would itself become the oracle.
  assert.throws(
    () => assertCallerScopeMulti('proj-A', ['proj-A', 'proj-A']),
    (err: unknown) => err instanceof ContextHubError && (err as ContextHubError).code === 'NOT_FOUND',
  );
});

test('assertCallerScopeMulti: scope + empty list → NOT_FOUND (a scoped caller asking for zero projects is meaningless)', () => {
  assert.throws(
    () => assertCallerScopeMulti('proj-A', []),
    (err: unknown) => err instanceof ContextHubError && (err as ContextHubError).code === 'NOT_FOUND',
  );
});
