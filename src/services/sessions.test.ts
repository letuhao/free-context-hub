/**
 * Actor Data Boundary F-AUTH (Stream S3) — session cookie signing + parsing PURE tests (no DB).
 *
 * Covers the cookie-security primitives the §6 adversary probes:
 *   - HMAC signing: a valid signature round-trips to the session id
 *   - tampering (id or signature) is rejected → a forged cookie can't authenticate
 *   - cookie-header parsing handles multiple cookies + url-encoding
 *   - cookie policy honors SameSite + idle/absolute windows (AAL-dependent)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  signSessionId,
  unsignSessionId,
  parseCookies,
  getCookiePolicy,
  SESSION_COOKIE_NAME,
} from './sessions.js';

test('signSessionId/unsignSessionId: round-trips a session id', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const signed = signSessionId(id);
  assert.notEqual(signed, id, 'signed value carries an HMAC suffix');
  assert.equal(unsignSessionId(signed), id);
});

test('unsignSessionId: rejects a tampered id (signature no longer matches)', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const signed = signSessionId(id);
  const tampered = signed.replace(id, 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(unsignSessionId(tampered), null);
});

test('unsignSessionId: rejects a tampered/forged signature', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(unsignSessionId(`${id}.not-a-real-hmac`), null);
  assert.equal(unsignSessionId(`${id}.`), null);
  assert.equal(unsignSessionId(id), null, 'unsigned id (no dot) is rejected');
  assert.equal(unsignSessionId(undefined), null);
  assert.equal(unsignSessionId(''), null);
});

test('parseCookies: parses multiple cookies and decodes values', () => {
  const out = parseCookies(`${SESSION_COOKIE_NAME}=abc.def; other=1; enc=a%20b`);
  assert.equal(out[SESSION_COOKIE_NAME], 'abc.def');
  assert.equal(out.other, '1');
  assert.equal(out.enc, 'a b');
});

test('parseCookies: empty / missing header yields empty map', () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
});

test('getCookiePolicy: defaults to SameSite=lax and a sane idle window', () => {
  const p = getCookiePolicy(1);
  assert.equal(p.sameSite, 'lax');
  assert.equal(p.name, SESSION_COOKIE_NAME);
  assert.ok(p.idleTtlSeconds > 0 && p.idleTtlSeconds <= 30 * 60, 'idle window <= 30min (NIST 15min default)');
  assert.ok(p.absoluteTtlSeconds > 0);
});

test('getCookiePolicy: AAL2 sessions get a shorter absolute window than AAL1 (NIST re-auth)', () => {
  const aal1 = getCookiePolicy(1);
  const aal2 = getCookiePolicy(2);
  assert.ok(aal2.absoluteTtlSeconds < aal1.absoluteTtlSeconds, 'AAL2 (12h) < AAL1 (30d)');
});
