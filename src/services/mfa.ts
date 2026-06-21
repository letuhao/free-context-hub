/**
 * Actor Data Boundary F-AUTH (Stream S3) — MFA factors (AAL2).
 *
 * TOTP (RFC 6238) is implemented dependency-free (HMAC-SHA1 over a 30s counter) so there is no client
 * QR library requirement on the backend: enrollment returns the base32 secret + an `otpauth://` URI
 * the GUI renders as a QR (server-issued data-URL is S4's concern). WebAuthn credentials are stored as
 * opaque blobs (the browser-side ceremony is S4/M1); this layer records the verified factor so a
 * principal with ≥1 verified factor authenticates at AAL2.
 *
 * Backup codes are single-use, stored sha256-hashed (never plaintext); the service strikes a code on
 * use. The plaintext codes are returned ONCE at enrollment.
 */

import { createHmac, createHash, randomBytes, randomInt } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_ISSUER = process.env.AUTH_TOTP_ISSUER?.trim() || 'ContextHub';

// ── PURE TOTP core (RFC 6238 / RFC 4226) — no DB ──────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode bytes to RFC 4648 base32 (no padding) — the format authenticator apps expect. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode an RFC 4648 base32 string (case-insensitive, padding/space tolerant) to bytes. */
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/,'').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new ContextHubError('BAD_REQUEST', 'Invalid base32 in TOTP secret.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate a fresh random TOTP secret (base32, 20 bytes = 160 bits per RFC 4226). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** PURE — compute the TOTP code for a base32 secret at a given unix-time (seconds). */
export function totpCode(secretBase32: string, unixSeconds: number = Math.floor(Date.now() / 1000)): string {
  const key = base32Decode(secretBase32);
  let counter = Math.floor(unixSeconds / TOTP_STEP_SECONDS);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const digest = createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

/** PURE — verify a TOTP code with a ±1 step window (clock skew tolerance, RFC 6238 §5.2). */
export function verifyTotp(secretBase32: string, code: string, unixSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return false;
  const candidate = code.trim();
  for (const drift of [-1, 0, 1]) {
    if (totpCode(secretBase32, unixSeconds + drift * TOTP_STEP_SECONDS) === candidate) return true;
  }
  return false;
}

/** Build the `otpauth://totp/...` provisioning URI the GUI renders as a QR. */
export function totpProvisioningUri(secretBase32: string, accountLabel: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${accountLabel}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer: TOTP_ISSUER, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Backup codes (single-use, hashed) ─────────────────────────────────────────────────────────────

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Generate N human-friendly backup codes (plaintext returned once; hashes stored). */
export function generateBackupCodes(n = 10): { plaintext: string[]; hashed: Array<{ hash: string; used_at: null }> } {
  const plaintext: string[] = [];
  for (let i = 0; i < n; i++) {
    // 10 digits, grouped as XXXXX-XXXXX.
    const a = randomInt(0, 100000).toString().padStart(5, '0');
    const b = randomInt(0, 100000).toString().padStart(5, '0');
    plaintext.push(`${a}-${b}`);
  }
  return { plaintext, hashed: plaintext.map((c) => ({ hash: hashCode(c), used_at: null })) };
}

// ── DB-bound MFA lifecycle ────────────────────────────────────────────────────────────────────────

export interface MfaFactorRow {
  factor_id: string;
  principal_id: string;
  type: 'totp' | 'webauthn';
  verified_at: Date | null;
}

/**
 * Begin TOTP enrollment: store an UNVERIFIED totp factor + generate backup codes. Returns the secret,
 * provisioning URI, and plaintext backup codes (shown once). The factor is unusable until verified.
 * Re-enrolling replaces any prior UNVERIFIED totp; a verified one must be removed explicitly.
 */
export async function enrollTotp(principalId: string, accountLabel: string): Promise<{ factorId: string; secret: string; otpauthUri: string; backupCodes: string[] }> {
  const secret = generateTotpSecret();
  const { plaintext, hashed } = generateBackupCodes();
  // Drop a prior unverified totp so re-enroll is clean (verified totp is protected by the partial index).
  await getDbPool().query(
    `DELETE FROM mfa_factors WHERE principal_id = $1 AND type = 'totp' AND verified_at IS NULL`,
    [principalId],
  );
  const res = await getDbPool().query<{ factor_id: string }>(
    `INSERT INTO mfa_factors (principal_id, type, secret, backup_codes, label)
     VALUES ($1, 'totp', $2, $3::jsonb, $4) RETURNING factor_id`,
    [principalId, secret, JSON.stringify(hashed), accountLabel],
  );
  return { factorId: res.rows[0].factor_id, secret, otpauthUri: totpProvisioningUri(secret, accountLabel), backupCodes: plaintext };
}

/** Complete TOTP enrollment by verifying a code, marking the factor verified (→ AAL2 capable). */
export async function verifyTotpEnrollment(principalId: string, factorId: string, code: string): Promise<void> {
  const res = await getDbPool().query<{ secret: string }>(
    `SELECT secret FROM mfa_factors WHERE factor_id = $1 AND principal_id = $2 AND type = 'totp'`,
    [factorId, principalId],
  );
  const row = res.rows[0];
  if (!row) throw new ContextHubError('NOT_FOUND', 'TOTP factor not found.');
  if (!verifyTotp(row.secret, code)) throw new ContextHubError('BAD_REQUEST', 'Invalid TOTP code.');
  await getDbPool().query(
    `UPDATE mfa_factors SET verified_at = now() WHERE factor_id = $1 AND principal_id = $2`,
    [factorId, principalId],
  );
}

/** True iff the principal holds ≥1 VERIFIED factor (the AAL2 gate). */
export async function hasVerifiedFactor(principalId: string): Promise<boolean> {
  const res = await getDbPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM mfa_factors WHERE principal_id = $1 AND verified_at IS NOT NULL`,
    [principalId],
  );
  return res.rows[0].n > 0;
}

/**
 * Verify an MFA challenge at login: accept a TOTP code from any verified totp factor, OR a single-use
 * backup code (which is then struck). Returns true on success. Generic on failure (no enumeration).
 */
export async function verifyMfaChallenge(principalId: string, code: string): Promise<boolean> {
  const pool = getDbPool();
  const factors = await pool.query<{ factor_id: string; secret: string; backup_codes: Array<{ hash: string; used_at: string | null }> | null }>(
    `SELECT factor_id, secret, backup_codes FROM mfa_factors WHERE principal_id = $1 AND type = 'totp' AND verified_at IS NOT NULL`,
    [principalId],
  );
  for (const f of factors.rows) {
    if (verifyTotp(f.secret, code)) return true;
  }
  // Backup-code path: strike a matching unused code atomically.
  const wanted = hashCode(code.trim());
  for (const f of factors.rows) {
    const codes = f.backup_codes ?? [];
    const idx = codes.findIndex((c) => c.hash === wanted && c.used_at === null);
    if (idx >= 0) {
      codes[idx] = { hash: codes[idx].hash, used_at: new Date().toISOString() };
      const upd = await pool.query(
        // Guard on the code still being unused at write time (jsonb path) to avoid double-spend races.
        `UPDATE mfa_factors SET backup_codes = $2::jsonb WHERE factor_id = $1
           AND (backup_codes -> $3 ->> 'used_at') IS NULL`,
        [f.factor_id, JSON.stringify(codes), idx],
      );
      if ((upd.rowCount ?? 0) > 0) return true;
    }
  }
  return false;
}

/** Register a WebAuthn credential blob (verified — the browser ceremony happened client-side, S4). */
export async function registerWebauthn(principalId: string, credentialBlob: string, label?: string): Promise<string> {
  const res = await getDbPool().query<{ factor_id: string }>(
    `INSERT INTO mfa_factors (principal_id, type, secret, label, verified_at)
     VALUES ($1, 'webauthn', $2, $3, now()) RETURNING factor_id`,
    [principalId, credentialBlob, label ?? null],
  );
  return res.rows[0].factor_id;
}
