/**
 * Actor Data Boundary F-AUTH (Stream S3) — TOTP / base32 / backup-code PURE tests (no DB).
 *
 * Covers RFC 6238 / RFC 4226 TOTP correctness + the AAL2 second-factor primitives:
 *   - base32 round-trip
 *   - a generated code verifies at the same instant; a wrong code fails
 *   - ±1 step skew tolerance; a code from 2 steps away fails
 *   - provisioning URI is well-formed otpauth://
 *   - backup codes are unique + stored hashed (never plaintext)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpCode,
  verifyTotp,
  totpProvisioningUri,
  generateBackupCodes,
} from './mfa.js';

test('base32: round-trips arbitrary bytes', () => {
  const buf = Buffer.from('hello-totp-secret');
  const enc = base32Encode(buf);
  assert.match(enc, /^[A-Z2-7]+$/);
  assert.deepEqual(base32Decode(enc), buf);
});

test('generateTotpSecret: produces a decodable base32 secret', () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.equal(base32Decode(secret).length, 20, '160-bit secret per RFC 4226');
});

test('totpCode/verifyTotp: a code verifies at the same instant', () => {
  const secret = generateTotpSecret();
  const t = 1_700_000_000;
  const code = totpCode(secret, t);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code, t), true);
});

test('verifyTotp: wrong code fails', () => {
  const secret = generateTotpSecret();
  const t = 1_700_000_000;
  const code = totpCode(secret, t);
  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal(verifyTotp(secret, wrong, t), false);
  assert.equal(verifyTotp(secret, 'abc', t), false);
  assert.equal(verifyTotp(secret, '', t), false);
});

test('verifyTotp: ±1 step skew tolerated, ±2 rejected', () => {
  const secret = generateTotpSecret();
  const t = 1_700_000_000;
  const prevStep = totpCode(secret, t - 30);
  const nextStep = totpCode(secret, t + 30);
  assert.equal(verifyTotp(secret, prevStep, t), true, 'previous step within skew window');
  assert.equal(verifyTotp(secret, nextStep, t), true, 'next step within skew window');
  const twoBack = totpCode(secret, t - 60);
  // It is *possible* (1-in-1e6) for adjacent windows to collide; assert on the structural property
  // by checking the code differs before asserting rejection.
  if (twoBack !== totpCode(secret, t) && twoBack !== prevStep) {
    assert.equal(verifyTotp(secret, twoBack, t), false, '2 steps away is outside the ±1 window');
  }
});

test('totpProvisioningUri: well-formed otpauth URI with issuer + secret', () => {
  const secret = generateTotpSecret();
  const uri = totpProvisioningUri(secret, 'alice@example.com');
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.ok(uri.includes(`secret=${secret}`));
  assert.ok(uri.includes('issuer='));
});

test('generateBackupCodes: unique plaintext, stored hashed (no plaintext in storage form)', () => {
  const { plaintext, hashed } = generateBackupCodes(8);
  assert.equal(plaintext.length, 8);
  assert.equal(hashed.length, 8);
  assert.equal(new Set(plaintext).size, 8, 'codes are unique');
  for (let i = 0; i < plaintext.length; i++) {
    assert.match(plaintext[i], /^\d{5}-\d{5}$/);
    assert.match(hashed[i].hash, /^[a-f0-9]{64}$/, 'sha256 hex');
    assert.notEqual(hashed[i].hash, plaintext[i], 'stored form is not the plaintext');
    assert.equal(hashed[i].used_at, null);
  }
});
