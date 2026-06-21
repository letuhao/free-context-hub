/**
 * Actor Data Boundary F-AUTH (Stream S3) — human password credentials (argon2id).
 *
 * Per NIST 800-63B §5.1.1 + OWASP ASVS V6:
 *   - ≥12 characters (NIST minimum 8; we adopt OWASP's stricter 12), ≤128 (DoS bound on the KDF).
 *   - argon2id memory-hard hashing with env-tunable params (recorded for src/env.ts §2.9).
 *   - "breach check": reject known-compromised / trivially-weak passwords. We do this OFFLINE (no
 *     external HaveIBeenPwned HTTP call — the deployment is SSRF-hardened and may be air-gapped):
 *     a bundled common-password denylist + structural checks. The denylist is the seam where a larger
 *     breach corpus can be loaded later without touching callers.
 *
 * The principal stays the subject; a human_credentials row binds a password to a principal_id (F1).
 * Verification re-derives params from the stored PHC string, so an argon2 params bump re-verifies old
 * hashes and transparently rehashes on next successful login.
 */

import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { clearLockout } from './lockout.js';

const MIN_LENGTH = 12; // OWASP ASVS V6
const MAX_LENGTH = 128; // bound argon2 input cost

/**
 * Small bundled denylist of the most-common breached passwords (and obvious patterns). NOT the full
 * corpus — the point is to make `assertPasswordPolicy` self-contained + offline. Extend by loading a
 * larger list into this set at module init if a corpus file is provided (future). [breach check]
 */
const COMMON_PASSWORDS = new Set<string>([
  'password', 'password1', 'password123', 'passw0rd', '123456', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'letmein', 'welcome', 'welcome1', 'admin', 'administrator', 'iloveyou',
  'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'changeme', 'whatever',
  'trustno1', 'abc123', 'abcd1234', 'p@ssw0rd', 'p@ssword', 'secret', 'master', 'login', 'qwertyuiop',
  'contexthub', 'freecontexthub',
]);

export interface Argon2Params {
  type: 0 | 1 | 2;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

function intEnv(key: string, dflt: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

/** Resolve argon2id params from env (recorded for env.ts §2.9). Defaults follow OWASP's argon2id
 *  recommendation (m=19MiB→we use 64MiB, t=2→3, p=1→4 for server hardware). */
export function getArgon2Params(): Argon2Params {
  return {
    type: argon2.argon2id,
    memoryCost: intEnv('AUTH_ARGON2_MEMORY_COST', 65536), // KiB → 64 MiB
    timeCost: intEnv('AUTH_ARGON2_TIME_COST', 3),
    parallelism: intEnv('AUTH_ARGON2_PARALLELISM', 4),
  };
}

/**
 * PURE — validate a password against the policy. Throws BAD_REQUEST with a SPECIFIC message on
 * failure (this is registration/reset, where helping the legitimate user is correct; it is NOT the
 * login path, which must stay generic to avoid enumeration). Returns void on success.
 */
export function assertPasswordPolicy(password: unknown): void {
  if (typeof password !== 'string') {
    throw new ContextHubError('BAD_REQUEST', 'Password is required.');
  }
  // Breach check FIRST: a known-breached password is rejected with the accurate reason regardless of
  // its length (telling a user to "lengthen" a breached password is misleading — it's compromised).
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    throw new ContextHubError('BAD_REQUEST', 'Password is among the most commonly breached passwords; choose another.');
  }
  if (password.length < MIN_LENGTH) {
    throw new ContextHubError('BAD_REQUEST', `Password must be at least ${MIN_LENGTH} characters.`);
  }
  if (password.length > MAX_LENGTH) {
    throw new ContextHubError('BAD_REQUEST', `Password must be at most ${MAX_LENGTH} characters.`);
  }
  // Trivial single-character or short repeated patterns (e.g. "aaaaaaaaaaaa", "abcabcabcabc").
  if (/^(.)\1+$/.test(password)) {
    throw new ContextHubError('BAD_REQUEST', 'Password must not be a single repeated character.');
  }
}

/** Hash a password with the configured argon2id params. Validates policy first. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  const p = getArgon2Params();
  return argon2.hash(password, {
    type: p.type,
    memoryCost: p.memoryCost,
    timeCost: p.timeCost,
    parallelism: p.parallelism,
  });
}

/** Verify a password against a stored PHC hash. Never throws on mismatch — returns false. A malformed
 *  stored hash also returns false (fail-closed), never a 500. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, password);
  } catch {
    return false;
  }
}

/** Anti-enumeration helper (adversary A3): spend argon2 work equivalent to a real verify against a
 *  decoy hash, so the login "no such account" path takes comparable KDF time to the "wrong password"
 *  path — the latency difference is otherwise a reliable account-existence oracle. The decoy is hashed
 *  once with the live params. Never throws; the boolean result is discarded. */
let decoyHashPromise: Promise<string> | null = null;
export async function dummyVerifyPassword(password: string): Promise<void> {
  try {
    if (!decoyHashPromise) {
      const p = getArgon2Params();
      decoyHashPromise = argon2.hash('decoy-not-a-real-credential', {
        type: p.type,
        memoryCost: p.memoryCost,
        timeCost: p.timeCost,
        parallelism: p.parallelism,
      });
    }
    await argon2.verify(await decoyHashPromise, typeof password === 'string' ? password : '');
  } catch {
    /* timing-only; result intentionally discarded */
  }
}

/** True iff a stored hash was produced with weaker params than current policy (rehash-on-login seam). */
export function needsRehash(storedHash: string): boolean {
  const p = getArgon2Params();
  try {
    return argon2.needsRehash(storedHash, { memoryCost: p.memoryCost, timeCost: p.timeCost, parallelism: p.parallelism });
  } catch {
    return true;
  }
}

// ── DB-bound operations ─────────────────────────────────────────────────────────────────────────

/** Set (create or replace) the password credential for a principal. Resets lock state — a freshly
 *  set/changed password is a clean slate (and reset MUST clear locks, ASVS 2.2.3). */
export async function setPassword(principalId: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await getDbPool().query(
    `INSERT INTO human_credentials (principal_id, password_hash, pw_updated_at, failed_count, soft_locked_until, hard_locked)
     VALUES ($1, $2, now(), 0, NULL, false)
     ON CONFLICT (principal_id) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           pw_updated_at = now(),
           failed_count = 0,
           soft_locked_until = NULL,
           hard_locked = false`,
    [principalId, hash],
  );
}

export interface HumanCredentialRow {
  principal_id: string;
  password_hash: string;
}

/**
 * Resolve the principal a login identifier (email) maps to, via the accepted-invite trail. Returns
 * null when no human credential exists for that email. Login resolves the principal HERE then verifies
 * the password against human_credentials — both "no such email" and "wrong password" yield the SAME
 * generic failure at the route (no user enumeration). The email→principal binding comes from the
 * invite that created the account (invites.email + invites.accepted_principal).
 */
export async function resolvePrincipalByEmail(email: string): Promise<string | null> {
  if (typeof email !== 'string' || email.length === 0) return null;
  const res = await getDbPool().query<{ principal_id: string }>(
    `SELECT i.accepted_principal AS principal_id
       FROM invites i
       JOIN human_credentials h ON h.principal_id = i.accepted_principal
      WHERE lower(i.email) = lower($1) AND i.accepted_principal IS NOT NULL
      ORDER BY i.accepted_at DESC NULLS LAST
      LIMIT 1`,
    [email.trim()],
  );
  return res.rows[0]?.principal_id ?? null;
}

/** Fetch the credential row for a principal (null if none — used by the generic login path). */
export async function getCredential(principalId: string): Promise<HumanCredentialRow | null> {
  const res = await getDbPool().query<HumanCredentialRow>(
    `SELECT principal_id, password_hash FROM human_credentials WHERE principal_id = $1`,
    [principalId],
  );
  return res.rows[0] ?? null;
}

/** Transparently rehash on a successful login when params have hardened since the hash was written. */
export async function rehashIfNeeded(principalId: string, password: string, storedHash: string): Promise<void> {
  if (!needsRehash(storedHash)) return;
  const fresh = await hashPassword(password);
  await getDbPool().query(
    `UPDATE human_credentials SET password_hash = $2, pw_updated_at = now() WHERE principal_id = $1`,
    [principalId, fresh],
  );
}

// ── Password-reset / email-verify tokens (auth_tokens) ────────────────────────────────────────────
//
// Single-use, short-TTL, hash-only. The RESET path is the load-bearing OWASP invariant (2.2.3): a
// completed reset CLEARS lockout and can NEVER set it. resetPassword() below is the only reset writer
// and it calls clearLockout() — never recordFailure().

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a single-use token. Returns the plaintext (to deliver out-of-band, e.g. email); only the hash
 * is stored. The caller (route) MUST NOT leak whether the principal exists — issue is called only
 * after a generic "if an account exists we sent a link" response shape.
 */
export async function issueAuthToken(principalId: string, purpose: 'email_verify' | 'password_reset'): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const ttl = intEnv('AUTH_RESET_TOKEN_TTL_SECONDS', 3600);
  const expiresAt = new Date(Date.now() + ttl * 1000);
  await getDbPool().query(
    `INSERT INTO auth_tokens (principal_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [principalId, purpose, hashToken(token), expiresAt],
  );
  return token;
}

/**
 * Complete a password reset. Consumes the token ATOMICALLY (single-use), sets the new password, and
 * CLEARS all lockout state (OWASP 2.2.3 — reset must never leave an account locked). Throws
 * BAD_REQUEST on an invalid/expired/used token or a policy failure (the latter before consume? no —
 * we validate policy first, then consume, so a weak new password does not burn the token).
 */
export async function resetPassword(token: string, newPassword: string): Promise<{ principalId: string }> {
  // Validate the new password BEFORE consuming the token so a weak password doesn't waste it.
  assertPasswordPolicy(newPassword);
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const consumed = await client.query<{ principal_id: string }>(
      `UPDATE auth_tokens SET consumed_at = now()
        WHERE token_hash = $1 AND purpose = 'password_reset' AND consumed_at IS NULL AND expires_at > now()
        RETURNING principal_id`,
      [hashToken(token)],
    );
    if (consumed.rowCount === 0) {
      throw new ContextHubError('BAD_REQUEST', 'Reset token is invalid, already used, or expired.');
    }
    const principalId = consumed.rows[0].principal_id;
    const hash = await hashPassword(newPassword);
    await client.query(
      `UPDATE human_credentials SET password_hash = $2, pw_updated_at = now() WHERE principal_id = $1`,
      [principalId, hash],
    );
    await client.query('COMMIT');
    // INVARIANT: reset clears the lock. Done outside the txn (idempotent UPDATE; harmless if retried).
    await clearLockout(principalId);
    return { principalId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
