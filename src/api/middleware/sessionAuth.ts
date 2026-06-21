/**
 * Actor Data Boundary F-AUTH (Stream S3) — session (cookie) authentication, wired ALONGSIDE bearerAuth.
 *
 * INTEGRATION CONTRACT (recorded for the integrator — this slice does NOT edit src/api/index.ts):
 *   Mount `sessionAuth` on `/api` IMMEDIATELY AFTER `bearerAuth` (index.ts:101), i.e.
 *       app.use('/api', bearerAuth);
 *       app.use('/api', sessionAuth);   // ← new line, right after
 *   ORDER MATTERS and is deliberately permissive-then-cooperative:
 *     - bearerAuth runs first. If a valid Bearer token is present it attaches apiKeyPrincipalId and
 *       calls next(). For an AGENT/Bearer request, sessionAuth is then a no-op (no cookie) — agents
 *       are unaffected.
 *     - For a BROWSER request there is no Bearer header. Under MCP_AUTH_ENABLED, bearerAuth currently
 *       401s a missing Bearer token BEFORE sessionAuth can run. So the integrator MUST make bearerAuth
 *       fall through (call next()) when no Authorization header is present AND a session cookie IS
 *       present, deferring the decision to sessionAuth. The minimal change recorded for the integrator
 *       is a one-line guard at the top of bearerAuth:
 *           if (!header && req.headers.cookie?.includes(SESSION_COOKIE_NAME)) return next();
 *       (sessionAuth then authenticates the cookie, or leaves the request unauthenticated so the
 *       downstream authorize() gate denies it.) See RECORD-FOR-RECONCILE in the slice report.
 *
 *   `requireSession` and `csrfGuard` are exported for routes that are cookie-ONLY (sessions mgmt,
 *   logout) and for the global CSRF gate on cookie-authenticated state changes.
 *
 * CSRF: cookie auth is vulnerable to CSRF; Bearer auth is not (no ambient credential). The csrfGuard
 * enforces a double-submit token (X-CSRF-Token header == the session's csrf_token) on state-changing
 * methods, but ONLY for cookie-authenticated requests — Bearer/agent requests skip it.
 */

import type { Request, Response, NextFunction } from 'express';
import { getEnv } from '../../core/index.js';
import {
  SESSION_COOKIE_NAME,
  parseCookies,
  resolveSession,
  getCookiePolicy,
  type SessionRow,
} from '../../services/sessions.js';

/** The acting principal attached by sessionAuth — the SAME request field bearerAuth uses, so
 *  authorize()/assertAuthorized work identically for human-session and agent-key callers. */
const PRINCIPAL_FIELD = 'apiKeyPrincipalId';

function attachSession(req: Request, session: SessionRow): void {
  (req as any)[PRINCIPAL_FIELD] = session.principal_id;
  (req as any).session = session;
  (req as any).authMethod = 'session';
}

/**
 * Cooperative session authenticator. If a valid session cookie is present, attach the principal and
 * session. NEVER rejects on its own (so Bearer/agent and pre-auth flows pass through) — authorization
 * is the downstream authorize() gate's job. A forged/expired cookie simply attaches nothing.
 */
export function sessionAuth(req: Request, res: Response, next: NextFunction): void {
  // If a previous middleware (bearerAuth) already established a principal, don't override it.
  if ((req as any)[PRINCIPAL_FIELD]) return next();
  const cookies = parseCookies(req.headers.cookie);
  const signed = cookies[SESSION_COOKIE_NAME];
  if (!signed) return next();
  resolveSession(signed)
    .then((session) => {
      if (session) attachSession(req, session);
      next();
    })
    .catch(() => next()); // fail-open to "unauthenticated"; the authorize() gate denies downstream
}

/** Hard gate: 401 unless the request carries a valid session. For cookie-ONLY routes (sessions list,
 *  logout) that must not be reachable by an unauthenticated browser. */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const signed = cookies[SESSION_COOKIE_NAME];
  if (!signed) {
    res.status(401).json({ error: 'Unauthorized: no session' });
    return;
  }
  resolveSession(signed)
    .then((session) => {
      if (!session) {
        res.status(401).json({ error: 'Unauthorized: invalid or expired session' });
        return;
      }
      attachSession(req, session);
      next();
    })
    .catch(() => res.status(401).json({ error: 'Unauthorized: session error' }));
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF guard for cookie-authenticated state changes. Skips safe methods and skips
 * Bearer/agent requests (no ambient cookie credential = no CSRF risk). For a cookie-authed mutation,
 * requires `X-CSRF-Token` to equal the session's csrf_token.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const session: SessionRow | undefined = (req as any).session;
  // Not cookie-authenticated (Bearer/agent, or unauthenticated) → no CSRF surface here.
  if (!session || (req as any).authMethod !== 'session') return next();
  const presented = req.headers['x-csrf-token'];
  const token = Array.isArray(presented) ? presented[0] : presented;
  if (!token || token !== session.csrf_token) {
    res.status(403).json({ error: 'Forbidden: CSRF token missing or invalid' });
    return;
  }
  next();
}

/**
 * Set the session cookie on a response. httpOnly + SameSite + (Secure in production). Centralized so
 * the flags are consistent. Secure is gated on DEPLOYMENT_PROFILE=production (recorded; integrator
 * confirms env wiring).
 */
export function setSessionCookie(res: Response, signedValue: string, aal: 1 | 2 = 1): void {
  const policy = getCookiePolicy(aal);
  let secure = false;
  try {
    secure = getEnv().DEPLOYMENT_PROFILE === 'production';
  } catch {
    secure = false;
  }
  // SameSite=None REQUIRES Secure per the cookie spec; force it on if so configured.
  if (policy.sameSite === 'none') secure = true;
  res.cookie(policy.name, signedValue, {
    httpOnly: true,
    sameSite: policy.sameSite,
    secure,
    maxAge: policy.absoluteTtlSeconds * 1000,
    path: '/',
  });
}

/** Clear the session cookie (logout). */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}
