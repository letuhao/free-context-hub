/**
 * DEFERRED-059 — Hardened human-login E2E (the gap the /warp build left unproven).
 *
 * The slice suite covers F-AUTH at the SERVICE layer (fauth.db.test.ts) and the reconcile WIRING in
 * isolation (api/index.security.test.ts pins mount order + the A1 /info gate + csrfGuard logic). NOTHING
 * drove the *full human chain* over HTTP through the assembled app under MCP_AUTH_ENABLED=true: the
 * cooperative bearerAuth-cookie-defer → sessionAuth → meRouter path, the MFA enroll/verify round-trip,
 * and the AAL2 re-login. A regression in any of those (e.g. the cookie-defer stops firing, sessionAuth
 * stops attaching the principal, /api/me stops resolving it) would keep every other suite green.
 *
 * This test IS that proof. It drives the REAL `createApiApp` over a real loopback socket against the
 * live test DB (migrated through the F-AUTH migrations), under auth-ON, end to end:
 *
 *   issue invite (service, as root) → POST /register → POST /login → GET /me (principal == operator)
 *   → enroll TOTP → verify enrollment → logout → login (now mfa_required) → /mfa/verify (AAL2) → /me
 *
 * Runs under MCP_AUTH_ENABLED=true set at module scope (node's test runner isolates each file in its
 * own process, so this does not leak). Argon2 params are lowered for speed (the KDF strength is config,
 * not logic — the live flip uses production params). DEPLOYMENT_PROFILE is left dev so the session
 * cookie isn't Secure-only over the in-test http loopback (cookie security flags are covered by the
 * live flip, not this wiring test).
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import http from 'node:http';
import type { Express } from 'express';
import { _resetEnvCacheForTest } from '../env.js';
import { getDbPool } from '../db/client.js';
import { issueInvite } from '../services/invites.js';
import { seedRootPrincipal, getRootPrincipal } from '../services/principals.js';
import { totpCode } from '../services/mfa.js';

process.env.MCP_AUTH_ENABLED = 'true';
process.env.CONTEXT_HUB_WORKSPACE_TOKEN = 'test-token-for-env-validation';
process.env.AUTH_SESSION_SIGNING_SECRET = 'deferred-059-test-signing-secret-not-a-real-deployment-key';
// Lower the argon2 cost so register/login/re-login don't each spend 64MiB·t3·p4 (~0.4s) — the KDF
// strength is config, exercised at production values during the live flip; here we test WIRING.
process.env.AUTH_ARGON2_MEMORY_COST = '8192';
process.env.AUTH_ARGON2_TIME_COST = '1';
process.env.AUTH_ARGON2_PARALLELISM = '1';
_resetEnvCacheForTest();

const PREFIX = '__test_hardened_e2e__';

interface Res { status: number; body: any; cookies: string[] }

/** Tiny cookie-aware HTTP client against a one-shot listener. `cookie` → Cookie header; `csrf` →
 *  X-CSRF-Token header (the double-submit token cookie-authed mutations require). */
function call(app: Express, method: string, path: string, opts: { cookie?: string; csrf?: string; body?: unknown } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (opts.cookie) headers.Cookie = opts.cookie;
      if (opts.csrf) headers['X-CSRF-Token'] = opts.csrf;
      const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          server.close();
          let parsed: unknown;
          try { parsed = buf ? JSON.parse(buf) : undefined; } catch { parsed = buf; }
          const setCookie = res.headers['set-cookie'] ?? [];
          resolve({ status: res.statusCode ?? 0, body: parsed, cookies: Array.isArray(setCookie) ? setCookie : [setCookie] });
        });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      if (data) req.write(data);
      req.end();
    });
  });
}

/** Extract the `chub_session=<value>` cookie pair (name=value) from a Set-Cookie list, for resending. */
function sessionCookie(cookies: string[]): string | undefined {
  for (const c of cookies) {
    const pair = c.split(';')[0];
    if (pair.startsWith('chub_session=') && pair.length > 'chub_session='.length) return pair;
  }
  return undefined;
}

async function realApp(): Promise<Express> {
  const { createApiApp } = await import('./index.js');
  return createApiApp();
}

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM auth_tokens WHERE principal_id IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM sessions WHERE principal_id IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM human_credentials WHERE principal_id IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM mfa_factors WHERE principal_id IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM invites WHERE email LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1 AND is_root = false`, [`${PREFIX}%`]);
}

let issuerId: string;

before(async () => {
  await cleanup();
  const existing = await getRootPrincipal();
  issuerId = existing ? existing.principal_id : (await seedRootPrincipal({ display_name: `${PREFIX}root` })).principal_id;
});
after(cleanup);

const STRONG_PW = 'a-Strong-Operator-Passphrase-2026!';

test('hardened (auth-ON) human login E2E: register → login → /api/me → MFA → AAL2 re-login', async () => {
  const app = await realApp();
  const email = `${PREFIX}${Math.random().toString(36).slice(2)}@example.com`;

  // ── Pre-auth gate sanity: an un-credentialed data route is blocked under auth-ON ──
  const blocked = await call(app, 'GET', '/api/me');
  assert.equal(blocked.status, 401, 'auth-ON: /api/me must reject a request with no cookie and no bearer');

  // ── Invite (service layer, attributed to root) → register over HTTP ──
  const { token } = await issueInvite({ email, createdBy: issuerId, display_name: `${PREFIX}operator` });
  const reg = await call(app, 'POST', '/api/auth/register', { body: { token, password: STRONG_PW } });
  assert.equal(reg.status, 201, `register should 201 (got ${reg.status}: ${JSON.stringify(reg.body)})`);
  const operatorId: string = reg.body.principal_id;
  assert.ok(operatorId, 'register returns the new principal id');

  // ── Login (the load-bearing claim: password → session cookie under auth-ON) ──
  const login = await call(app, 'POST', '/api/auth/login', { body: { email, password: STRONG_PW } });
  assert.equal(login.status, 200, `login should 200 (got ${login.status}: ${JSON.stringify(login.body)})`);
  assert.equal(login.body.status, 'ok');
  assert.equal(login.body.aal, 1, 'no MFA yet → AAL1');
  const cookie1 = sessionCookie(login.cookies);
  const csrf1: string = login.body.csrf_token;
  assert.ok(cookie1, 'login sets a chub_session cookie');
  assert.ok(csrf1, 'login returns a csrf_token in the body');

  // ── /api/me resolves the operator from the cookie (proves cookie-defer → sessionAuth → meRouter) ──
  const me1 = await call(app, 'GET', '/api/me', { cookie: cookie1 });
  assert.equal(me1.status, 200, 'cookie authenticates /api/me under auth-ON');
  assert.equal(me1.body.auth_enabled, true);
  assert.ok(me1.body.principal, '/api/me returns the bound principal for a cookie session');
  assert.equal(me1.body.principal.principal_id, operatorId, '/api/me principal is the logged-in operator');
  // [DEFERRED-060] a cookie session is labeled 'session' (not the env-token default).
  assert.equal(me1.body.key_source, 'session', '/api/me labels a cookie session key_source=session');

  // ── [DEFERRED-060] /api/me must NOT hand an env-token admin identity to a junk/expired cookie ──
  const junk = await call(app, 'GET', '/api/me', { cookie: 'chub_session=not-a-real-session-value' });
  assert.equal(junk.status, 401, 'a junk session cookie is unauthenticated → 401 (no env-token admin leak)');

  // ── Wrong password is rejected (generic 401) ──
  const bad = await call(app, 'POST', '/api/auth/login', { body: { email, password: 'definitely-not-it-9!' } });
  assert.equal(bad.status, 401, 'wrong password → 401');

  // ── [DEFERRED-060 C1] a cookie-authed mutation on /api/auth WITHOUT the CSRF token is rejected ──
  const noCsrf = await call(app, 'POST', '/api/auth/mfa/enroll', { cookie: cookie1, body: { label: email } });
  assert.equal(noCsrf.status, 403, 'mfa/enroll without X-CSRF-Token → 403 (csrfGuard now covers /api/auth mutations)');

  // ── MFA enrollment (session-scoped /api/auth route; cookie + X-CSRF-Token) ──
  const enroll = await call(app, 'POST', '/api/auth/mfa/enroll', { cookie: cookie1, csrf: csrf1, body: { label: email } });
  assert.equal(enroll.status, 201, `mfa/enroll should 201 (got ${enroll.status}: ${JSON.stringify(enroll.body)})`);
  const secret: string = enroll.body.secret;
  assert.ok(secret && enroll.body.otpauth_uri, 'enroll returns a TOTP secret + otpauth_uri');

  const verifyEnroll = await call(app, 'POST', '/api/auth/mfa/enroll/verify', { cookie: cookie1, csrf: csrf1, body: { factor_id: enroll.body.factor_id, code: totpCode(secret) } });
  assert.equal(verifyEnroll.status, 200, `enroll/verify should 200 (got ${verifyEnroll.status}: ${JSON.stringify(verifyEnroll.body)})`);
  assert.equal(verifyEnroll.body.status, 'verified');

  // ── Logout (cookie + CSRF), then a fresh login now demands the second factor ──
  const logout = await call(app, 'POST', '/api/auth/logout', { cookie: cookie1, csrf: csrf1 });
  assert.equal(logout.status, 200, 'logout 200');

  const login2 = await call(app, 'POST', '/api/auth/login', { body: { email, password: STRONG_PW } });
  assert.equal(login2.status, 200);
  assert.equal(login2.body.status, 'mfa_required', 'a verified factor forces the MFA step on password login');
  assert.equal(sessionCookie(login2.cookies), undefined, 'no session is issued at the mfa_required step');

  // ── Complete the second factor → AAL2 session ──
  const mfa = await call(app, 'POST', '/api/auth/mfa/verify', { body: { email, password: STRONG_PW, code: totpCode(secret) } });
  assert.equal(mfa.status, 200, `mfa/verify should 200 (got ${mfa.status}: ${JSON.stringify(mfa.body)})`);
  assert.equal(mfa.body.aal, 2, 'second factor upgrades to AAL2');
  const cookie2 = sessionCookie(mfa.cookies);
  assert.ok(cookie2, 'mfa/verify sets an AAL2 session cookie');

  const me2 = await call(app, 'GET', '/api/me', { cookie: cookie2 });
  assert.equal(me2.status, 200);
  assert.equal(me2.body.principal?.principal_id, operatorId, 'the AAL2 session is still the operator');
});
