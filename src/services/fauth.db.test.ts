/**
 * Actor Data Boundary F-AUTH (Stream S3) — DB-integration acceptance tests (live test DB).
 *
 * Requires DATABASE_URL pointed at a DB migrated through 0071_human_auth.sql. Harness mirrors
 * principals.test.ts: PREFIX-scoped fixtures + total cleanup. NOT in the no-DB unit path — the
 * integrator adds it to package.json's DB-test list (recorded in the slice report).
 *
 * Covers the §4 Acceptance:
 *   - register (accept invite) → human_credentials row → login verifies → session establishes
 *   - lockout: repeated failures trip soft then hard; a hard-locked account is blocked
 *   - RESET BYPASSES LOCK (the OWASP 2.2.3 invariant): resetPassword clears hard_locked
 *   - resolveSession round-trips a created session; revoke invalidates it
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { getDbPool } from '../db/client.js';
import { issueInvite, acceptInvite, previewInvite } from './invites.js';
import { getCredential, verifyPassword, resolvePrincipalByEmail, issueAuthToken, resetPassword } from './passwordCredentials.js';
import { getLockState, evaluateLock, recordFailure, recordSuccess } from './lockout.js';
import { createSession, resolveSession, revokeSession, revokeOtherSessions } from './sessions.js';
import { seedRootPrincipal, getRootPrincipal } from './principals.js';

const PREFIX = '__test_fauth__';

async function cleanup() {
  const pool = getDbPool();
  // Children (FK CASCADE handles most, but be explicit + scope by display_name/email prefix).
  await pool.query(`DELETE FROM auth_tokens WHERE principal_id IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM sessions WHERE principal_id IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM human_credentials WHERE principal_id IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM mfa_factors WHERE principal_id IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM invites WHERE email LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

// Ensure a root exists (invites attribute their starter grant to an issuer; here we just need a valid
// issuer principal id). We reuse an existing root if present, else seed one with the PREFIX.
let issuerId: string;

before(async () => {
  await cleanup();
  const existing = await getRootPrincipal();
  if (existing) {
    issuerId = existing.principal_id;
  } else {
    const root = await seedRootPrincipal({ display_name: `${PREFIX}root` });
    issuerId = root.principal_id;
  }
});

beforeEach(cleanup);
after(cleanup);

const STRONG_PW = 'a-Strong-Passphrase-2026!';
const email = () => `${PREFIX}${Math.random().toString(36).slice(2)}@example.com`;

test('register via invite creates a human credential and login verifies', async () => {
  const e = email();
  const { token } = await issueInvite({ email: e, createdBy: issuerId, display_name: `${PREFIX}alice` });
  const accepted = await acceptInvite({ token, password: STRONG_PW });
  assert.equal(accepted.email, e);

  // resolve-by-email → credential → verify
  const pid = await resolvePrincipalByEmail(e);
  assert.equal(pid, accepted.principal_id, 'email resolves to the new principal');
  const cred = await getCredential(pid!);
  assert.ok(cred);
  assert.equal(await verifyPassword(cred!.password_hash, STRONG_PW), true);
  assert.equal(await verifyPassword(cred!.password_hash, 'wrong-password-xyz!'), false);
});

test('invite is single-use: a second accept fails', async () => {
  const e = email();
  const { token } = await issueInvite({ email: e, createdBy: issuerId });
  await acceptInvite({ token, password: STRONG_PW });
  await assert.rejects(() => acceptInvite({ token, password: STRONG_PW }), /invalid, already used, or expired/);
});

test('login establishes a session cookie that authenticates, then revoke invalidates it', async () => {
  const e = email();
  const { token } = await issueInvite({ email: e, createdBy: issuerId });
  const { principal_id } = await acceptInvite({ token, password: STRONG_PW });

  const created = await createSession({ principalId: principal_id, aal: 1 });
  // The signed cookie resolves back to a live session for the SAME principal.
  const resolved = await resolveSession(created.signedCookie);
  assert.ok(resolved, 'a freshly created session resolves');
  assert.equal(resolved!.principal_id, principal_id);
  assert.equal(resolved!.aal, 1);

  // A forged cookie does not resolve.
  assert.equal(await resolveSession(created.signedCookie + 'x'), null);

  // Revoke → no longer resolves.
  assert.equal(await revokeSession(principal_id, created.session.session_id), true);
  assert.equal(await resolveSession(created.signedCookie), null);
});

test('lockout: repeated failures trip soft then hard; hard-locked account is blocked', async () => {
  const e = email();
  const { token } = await issueInvite({ email: e, createdBy: issuerId });
  const { principal_id } = await acceptInvite({ token, password: STRONG_PW });

  // Drive enough failures to cross the hard threshold (default 10).
  let lastReason: string | null = null;
  for (let i = 0; i < 12; i++) {
    const r = await recordFailure(principal_id);
    lastReason = r.reason;
  }
  const state = await getLockState(principal_id);
  assert.ok(state);
  const ev = evaluateLock(state!);
  assert.equal(ev.locked, true, 'account is locked after crossing the hard threshold');
  assert.equal(ev.reason, 'hard');
  assert.equal(state!.hardLocked, true);
});

test('RESET BYPASSES LOCK (OWASP 2.2.3): a password reset clears a hard lock', async () => {
  const e = email();
  const { token } = await issueInvite({ email: e, createdBy: issuerId });
  const { principal_id } = await acceptInvite({ token, password: STRONG_PW });

  // Hard-lock the account.
  for (let i = 0; i < 12; i++) await recordFailure(principal_id);
  assert.equal((await getLockState(principal_id))!.hardLocked, true);

  // Issue + consume a reset token with a NEW strong password.
  const resetToken = await issueAuthToken(principal_id, 'password_reset');
  const NEW_PW = 'another-Strong-Passphrase-99!';
  const out = await resetPassword(resetToken, NEW_PW);
  assert.equal(out.principalId, principal_id);

  // The lock is GONE and the new password verifies.
  const state = await getLockState(principal_id);
  assert.equal(state!.hardLocked, false, 'reset cleared the hard lock');
  assert.equal(state!.failedCount, 0);
  assert.equal(evaluateLock(state!).locked, false);
  const cred = await getCredential(principal_id);
  assert.equal(await verifyPassword(cred!.password_hash, NEW_PW), true);
});

test('reset token is single-use', async () => {
  const e = email();
  const { token } = await issueInvite({ email: e, createdBy: issuerId });
  const { principal_id } = await acceptInvite({ token, password: STRONG_PW });
  const resetToken = await issueAuthToken(principal_id, 'password_reset');
  await resetPassword(resetToken, 'first-Reset-Passphrase-1!');
  await assert.rejects(() => resetPassword(resetToken, 'second-Reset-Passphrase-2!'), /invalid, already used, or expired/);
});

test('recordFailure [A4 review-impl #1]: re-arms a LAPSED hard lock with a fresh window', async () => {
  const e = email();
  const { token } = await issueInvite({ email: e, createdBy: issuerId });
  const { principal_id } = await acceptInvite({ token, password: STRONG_PW });

  // Hard-lock, then simulate BOTH windows LAPSING (back-date hard + soft into the past). Both must
  // lapse for the state to read unlocked — the soft window from the last failure is otherwise still live.
  for (let i = 0; i < 12; i++) await recordFailure(principal_id);
  assert.ok((await getLockState(principal_id))!.hardLockedUntil, 'hard lock has an auto-expiry window');
  await getDbPool().query(
    `UPDATE human_credentials SET hard_locked_until = now() - interval '1 hour', soft_locked_until = now() - interval '1 hour' WHERE principal_id = $1`,
    [principal_id],
  );
  assert.equal(evaluateLock((await getLockState(principal_id))!).locked, false, 'a lapsed hard+soft lock reads unlocked');

  // A further failure must RE-ARM a fresh FUTURE window (not stay lapsed → soft-only forever).
  await recordFailure(principal_id);
  const st = await getLockState(principal_id);
  assert.ok(st!.hardLockedUntil && st!.hardLockedUntil.getTime() > Date.now(), 'a fresh future hard window');
  assert.equal(evaluateLock(st!).locked, true, 're-armed hard lock blocks again');
  assert.equal(evaluateLock(st!).reason, 'hard');
});

test('previewInvite [DEFERRED-061]: live invite → email+display_name; bad/consumed → null', async () => {
  const e = email();
  const { token } = await issueInvite({ email: e, createdBy: issuerId, display_name: `${PREFIX}preview` });
  const p = await previewInvite(token);
  assert.ok(p, 'a live invite previews');
  assert.equal(p!.email, e);
  assert.equal(p!.display_name, `${PREFIX}preview`);
  assert.equal(p!.intended_kind, 'human');
  assert.equal(await previewInvite('not-a-real-token'), null, 'an unknown token does not preview');
  await acceptInvite({ token, password: STRONG_PW });
  assert.equal(await previewInvite(token), null, 'an accepted invite is no longer previewable');
});

test('revokeOtherSessions [DEFERRED-061]: revokes all but the kept session', async () => {
  const e = email();
  const { token } = await issueInvite({ email: e, createdBy: issuerId });
  const { principal_id } = await acceptInvite({ token, password: STRONG_PW });
  const a = await createSession({ principalId: principal_id, aal: 1 });
  const b = await createSession({ principalId: principal_id, aal: 1 });
  const c = await createSession({ principalId: principal_id, aal: 1 });
  const revoked = await revokeOtherSessions(principal_id, a.session.session_id);
  assert.equal(revoked, 2, 'the two non-kept sessions are revoked');
  assert.ok(await resolveSession(a.signedCookie), 'the kept (current) session still resolves');
  assert.equal(await resolveSession(b.signedCookie), null, 'another session is revoked');
  assert.equal(await resolveSession(c.signedCookie), null, 'another session is revoked');
});

test('recordSuccess clears soft state but a clean login after lock requires reset (hard stays)', async () => {
  const e = email();
  const { token } = await issueInvite({ email: e, createdBy: issuerId });
  const { principal_id } = await acceptInvite({ token, password: STRONG_PW });
  // A few soft failures then a success → soft window cleared, failed_count reset.
  await recordFailure(principal_id);
  await recordFailure(principal_id);
  await recordSuccess(principal_id);
  const state = await getLockState(principal_id);
  assert.equal(state!.failedCount, 0);
  assert.equal(state!.softLockedUntil, null);
});
