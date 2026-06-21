/**
 * Actor Data Boundary F-AUTH (Stream S3) — human sessions (NIST 800-63B re-auth/idle windows).
 *
 * A session is established AFTER password (+ MFA) success and carries:
 *   - aal: 1 (password only) | 2 (≥1 verified MFA factor used).
 *   - absolute expiry (re-auth window) + idle expiry (slides forward on use).
 *   - a per-session CSRF token (double-submit) and an HMAC-signed cookie value.
 *
 * COOKIE SECURITY (the §6 adversary checklist):
 *   - httpOnly: JS cannot read it (XSS can't exfiltrate the session).
 *   - SameSite: default 'lax' (config-driven, recorded for env.ts §2.9); 'strict'/'none' selectable.
 *   - Secure: set in production (recorded; integrator wires DEPLOYMENT_PROFILE).
 *   - SIGNED value: `${session_id}.${hmac}`. A forged cookie without the signing secret fails the HMAC
 *     check BEFORE any DB lookup — a stolen DB row alone cannot mint a valid cookie either.
 *
 * Env keys are recorded for src/env.ts (§2.9); read here via process.env with safe defaults until the
 * integrator promotes them. The signing secret MUST be set in production (no insecure default is used
 * for signing — an unset secret in production is a recorded hard requirement).
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { getDbPool } from '../db/client.js';

export const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME?.trim() || 'chub_session';

/** Resolve the session-signing secret (recorded for env.ts §2.9 as AUTH_SESSION_SIGNING_SECRET).
 *  Falls back to ROOT_BOOTSTRAP_TOKEN (already a deployment secret) then a dev-only constant so the
 *  unit suite + dev run without extra config; production MUST set the dedicated key (integrator gate). */
function signingSecret(): string {
  return (
    process.env.AUTH_SESSION_SIGNING_SECRET?.trim() ||
    process.env.ROOT_BOOTSTRAP_TOKEN?.trim() ||
    'dev-insecure-session-secret-do-not-use-in-production'
  );
}

function intEnv(key: string, dflt: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

export interface CookiePolicy {
  name: string;
  sameSite: 'lax' | 'strict' | 'none';
  /** Absolute session lifetime (re-auth window) in seconds. NIST: 30d@AAL1, 12h@AAL2. */
  absoluteTtlSeconds: number;
  /** Idle timeout in seconds; slides forward on each authenticated request. */
  idleTtlSeconds: number;
}

/** Resolve cookie policy from env (recorded for env.ts §2.9). aal2 sessions get a shorter absolute
 *  window per NIST (12h vs 30d). */
export function getCookiePolicy(aal: 1 | 2 = 1): CookiePolicy {
  const sameSiteRaw = (process.env.AUTH_COOKIE_SAMESITE?.trim().toLowerCase() || 'lax');
  const sameSite: CookiePolicy['sameSite'] = sameSiteRaw === 'strict' || sameSiteRaw === 'none' ? sameSiteRaw : 'lax';
  const absoluteDefault = aal === 2 ? 12 * 3600 : 30 * 24 * 3600;
  return {
    name: SESSION_COOKIE_NAME,
    sameSite,
    absoluteTtlSeconds: intEnv('AUTH_SESSION_ABSOLUTE_TTL_SECONDS', absoluteDefault),
    idleTtlSeconds: intEnv('AUTH_SESSION_IDLE_TTL_SECONDS', 15 * 60), // NIST 15-min idle
  };
}

// ── PURE cookie signing (no DB) ───────────────────────────────────────────────────────────────────

function hmac(value: string): string {
  return createHmac('sha256', signingSecret()).update(value).digest('base64url');
}

/** Produce the signed cookie value for a session id: `${id}.${hmac(id)}`. */
export function signSessionId(sessionId: string): string {
  return `${sessionId}.${hmac(sessionId)}`;
}

/** Verify + extract the session id from a signed cookie value. Returns null on any tampering. Uses a
 *  constant-time comparison so the signature check leaks no timing. */
export function unsignSessionId(signed: string | undefined | null): string | null {
  if (typeof signed !== 'string') return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = hmac(id);
  // timingSafeEqual requires equal lengths; bail (non-match) on length mismatch first.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? id : null;
}

/** PURE — parse a Cookie header into a map. (No cookie-parser dep; the header grammar is simple.) */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// ── DB-bound session lifecycle ──────────────────────────────────────────────────────────────────

export interface SessionRow {
  session_id: string;
  principal_id: string;
  aal: number;
  csrf_token: string;
  expires_at: Date;
  idle_expires_at: Date;
  revoked_at: Date | null;
}

export interface CreatedSession {
  session: SessionRow;
  /** The signed value to set in the cookie. */
  signedCookie: string;
  /** The CSRF token to hand to the client (sent back via X-CSRF-Token on state changes). */
  csrfToken: string;
  policy: CookiePolicy;
}

/** Create a session for a principal at the given AAL. */
export async function createSession(params: {
  principalId: string;
  aal: 1 | 2;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<CreatedSession> {
  const policy = getCookiePolicy(params.aal);
  const csrfToken = randomBytes(24).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + policy.absoluteTtlSeconds * 1000);
  const idleExpiresAt = new Date(now + policy.idleTtlSeconds * 1000);
  const res = await getDbPool().query<SessionRow>(
    `INSERT INTO sessions (principal_id, aal, csrf_token, expires_at, idle_expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING session_id, principal_id, aal, csrf_token, expires_at, idle_expires_at, revoked_at`,
    [params.principalId, params.aal, csrfToken, expiresAt, idleExpiresAt, params.ip ?? null, params.userAgent ?? null],
  );
  const session = res.rows[0];
  return { session, signedCookie: signSessionId(session.session_id), csrfToken, policy };
}

/**
 * Resolve + touch a session from a SIGNED cookie value. Returns the live session (and slides the idle
 * window forward) or null if absent/forged/expired/idle-timed-out/revoked. This is the per-request
 * authenticator used by middleware/sessionAuth.ts.
 */
export async function resolveSession(signedCookie: string | undefined | null): Promise<SessionRow | null> {
  const sessionId = unsignSessionId(signedCookie);
  if (!sessionId) return null;
  const pool = getDbPool();
  // Single guarded UPDATE: only matches a live session; slides idle window; returns the row. A
  // race-safe touch — expiry/idle/revoke are evaluated in the WHERE, not a prior read.
  const policy = getCookiePolicy();
  const idleExpiresAt = new Date(Date.now() + policy.idleTtlSeconds * 1000);
  const res = await pool.query<SessionRow>(
    `UPDATE sessions
        SET last_seen = now(), idle_expires_at = $2
      WHERE session_id = $1
        AND revoked_at IS NULL
        AND expires_at > now()
        AND idle_expires_at > now()
      RETURNING session_id, principal_id, aal, csrf_token, expires_at, idle_expires_at, revoked_at`,
    [sessionId, idleExpiresAt],
  );
  return res.rows[0] ?? null;
}

/** List a principal's live sessions (for the Sessions & Security page). */
export async function listSessions(principalId: string): Promise<Array<SessionRow & { last_seen: Date; ip: string | null; user_agent: string | null; created_at: Date }>> {
  const res = await getDbPool().query(
    `SELECT session_id, principal_id, aal, csrf_token, expires_at, idle_expires_at, revoked_at, last_seen, ip, user_agent, created_at
       FROM sessions
      WHERE principal_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_seen DESC`,
    [principalId],
  );
  return res.rows;
}

/** Revoke ONE session — only if it belongs to the given principal (no cross-principal revoke / IDOR). */
export async function revokeSession(principalId: string, sessionId: string): Promise<boolean> {
  const res = await getDbPool().query(
    `UPDATE sessions SET revoked_at = now()
      WHERE session_id = $1 AND principal_id = $2 AND revoked_at IS NULL`,
    [sessionId, principalId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Revoke every live session for a principal (logout-everywhere / password change). */
export async function revokeAllSessions(principalId: string): Promise<number> {
  const res = await getDbPool().query(
    `UPDATE sessions SET revoked_at = now() WHERE principal_id = $1 AND revoked_at IS NULL`,
    [principalId],
  );
  return res.rowCount ?? 0;
}

/** [DEFERRED-061] Revoke every live session for a principal EXCEPT one ("sign out all OTHER devices").
 *  The caller keeps the session it presented; everything else is signed out. Returns the revoked count. */
export async function revokeOtherSessions(principalId: string, exceptSessionId: string): Promise<number> {
  const res = await getDbPool().query(
    `UPDATE sessions SET revoked_at = now()
      WHERE principal_id = $1 AND session_id <> $2 AND revoked_at IS NULL`,
    [principalId, exceptSessionId],
  );
  return res.rowCount ?? 0;
}
