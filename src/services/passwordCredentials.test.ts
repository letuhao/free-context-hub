/**
 * Actor Data Boundary F-AUTH (Stream S3) — password policy + argon2id PURE tests (no DB).
 *
 * Covers NIST 800-63B / OWASP ASVS V6 password requirements that don't need a database:
 *   - ≥12-char minimum, ≤128 max
 *   - breach/common-password rejection (offline denylist)
 *   - repeated-character rejection
 *   - argon2id hash round-trips and rejects wrong passwords
 *   - hash format is argon2id (the standards-mandated KDF)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
  getArgon2Params,
} from './passwordCredentials.js';
import { ContextHubError } from '../core/errors.js';

function policyError(pw: unknown): string | null {
  try {
    assertPasswordPolicy(pw);
    return null;
  } catch (e) {
    assert.ok(e instanceof ContextHubError);
    assert.equal((e as ContextHubError).code, 'BAD_REQUEST');
    return (e as ContextHubError).message;
  }
}

test('assertPasswordPolicy: rejects under 12 chars', () => {
  assert.match(policyError('Short1!') ?? '', /at least 12/);
});

test('assertPasswordPolicy: rejects over 128 chars', () => {
  assert.match(policyError('a1B!'.repeat(40)) ?? '', /at most 128/);
});

test('assertPasswordPolicy: rejects common breached passwords (case-insensitive)', () => {
  assert.match(policyError('Password123') ?? '', /commonly breached/);
  assert.match(policyError('PASSWORD123') ?? '', /commonly breached/);
  assert.match(policyError('contexthub') ?? '', /commonly breached/);
});

test('assertPasswordPolicy: rejects a single repeated character', () => {
  assert.match(policyError('aaaaaaaaaaaa') ?? '', /repeated character/);
});

test('assertPasswordPolicy: accepts a strong 12+ char password', () => {
  assert.equal(policyError('correct horse battery staple 42'), null);
  assert.equal(policyError('Tr0ub4dour&3xtra'), null);
});

test('assertPasswordPolicy: non-string is rejected', () => {
  assert.match(policyError(undefined) ?? '', /required/);
  assert.match(policyError(12345678901234) ?? '', /required/);
});

test('getArgon2Params: defaults to argon2id with OWASP-aligned cost', () => {
  const p = getArgon2Params();
  assert.equal(p.type, 2, 'argon2id == 2');
  assert.ok(p.memoryCost >= 19456, 'memory cost at least OWASP minimum (~19MiB)');
  assert.ok(p.timeCost >= 2);
  assert.ok(p.parallelism >= 1);
});

test('hashPassword/verifyPassword: round-trips and produces an argon2id PHC string', async () => {
  const pw = 'a-Strong-Passphrase-2026';
  const hash = await hashPassword(pw);
  assert.match(hash, /^\$argon2id\$/, 'hash is argon2id format');
  assert.equal(await verifyPassword(hash, pw), true);
  assert.equal(await verifyPassword(hash, pw + 'x'), false);
});

test('verifyPassword: a malformed stored hash fails closed (false, not throw)', async () => {
  assert.equal(await verifyPassword('not-a-hash', 'a-Strong-Passphrase-2026'), false);
});

test('hashPassword: enforces policy (weak password never gets hashed)', async () => {
  await assert.rejects(() => hashPassword('password'), (e: unknown) => e instanceof ContextHubError);
});
