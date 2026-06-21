/**
 * Actor Data Boundary F-AUTH (Stream S3) — human authentication REST surface.
 *
 * MOUNT (recorded for the integrator — §2.1): `app.use('/api/auth', authRouter)` MUST be mounted
 * BEFORE the blanket `app.use('/api', bearerAuth)` at index.ts:101, because login/register/forgot/reset
 * have to be reachable WITHOUT a credential (chicken-and-egg). Everything in THIS router is therefore
 * self-gating: the public endpoints require no auth; the session-scoped endpoints (logout, sessions
 * list/revoke, mfa enroll) use `requireSession` internally.
 *
 * Endpoints:
 *   POST   /api/auth/login            (public)  password → session cookie (or mfa_required step)
 *   POST   /api/auth/mfa/verify       (public)  complete an MFA challenge → upgrade pending login to AAL2 session
 *   POST   /api/auth/logout           (session) revoke current session + clear cookie
 *   GET    /api/auth/sessions         (session) list my live sessions
 *   DELETE /api/auth/sessions/:id     (session) revoke one of my sessions
 *   POST   /api/auth/register         (public)  accept invite → principal + session
 *   POST   /api/auth/password/forgot  (public)  issue a reset token (generic response)
 *   POST   /api/auth/password/reset   (public)  consume token → set password (clears lockout)
 *   POST   /api/auth/mfa/enroll       (session) begin TOTP enrollment
 *   POST   /api/auth/mfa/enroll/verify (session) verify the enrollment code
 */

import { Router } from 'express';
import { ContextHubError } from '../../core/errors.js';
import {
  getCredential,
  verifyPassword,
  dummyVerifyPassword,
  rehashIfNeeded,
  resolvePrincipalByEmail,
  issueAuthToken,
  resetPassword,
} from '../../services/passwordCredentials.js';
import { getLockState, evaluateLock, recordFailure, recordSuccess } from '../../services/lockout.js';
import { createSession } from '../../services/sessions.js';
import { hasVerifiedFactor, verifyMfaChallenge, enrollTotp, verifyTotpEnrollment } from '../../services/mfa.js';
import { acceptInvite } from '../../services/invites.js';
import { setSessionCookie, clearSessionCookie, requireSession, csrfGuard } from '../middleware/sessionAuth.js';
import { callerPrincipalOf } from '../middleware/auth.js';
import { listSessions, revokeSession } from '../../services/sessions.js';
import type { Request } from 'express';

const router = Router();

function clientMeta(req: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
  };
}

/**
 * Establish a session, choosing AAL based on whether the principal has a verified MFA factor. If MFA
 * is enrolled, password-only login returns `mfa_required` (no session yet) and the client must call
 * /mfa/verify. Otherwise an AAL1 session is issued immediately.
 */
async function completeLogin(req: Request, principalId: string): Promise<{ status: 'ok'; aal: 1 | 2; csrfToken: string; signed: string } | { status: 'mfa_required' }> {
  const mfaRequired = await hasVerifiedFactor(principalId);
  if (mfaRequired) return { status: 'mfa_required' };
  await recordSuccess(principalId);
  const meta = clientMeta(req);
  const created = await createSession({ principalId, aal: 1, ip: meta.ip, userAgent: meta.userAgent });
  return { status: 'ok', aal: 1, csrfToken: created.csrfToken, signed: created.signedCookie };
}

/** POST /api/auth/login — password authentication. Generic failures (no user enumeration). */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }
    const principalId = await resolvePrincipalByEmail(email);
    // No such account: spend equivalent argon2 KDF time before the generic 401 so the latency cannot
    // be used as an account-existence oracle (adversary A3) — the prior version returned immediately.
    if (!principalId) {
      await dummyVerifyPassword(password);
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    // Lockout check BEFORE verifying (a locked account never reveals password validity).
    // [DEFERRED-060 C2] A locked account must look IDENTICAL to a wrong password / unknown email.
    // The previous 429 "Account locked" was an account-existence oracle: only a REAL account that had
    // accumulated failures could ever reach a lock, so a 429 confirmed the email exists (a non-existent
    // email always 401s). We return the SAME generic 401 instead. The lock is still ENFORCED — we return
    // BEFORE verifying, so a locked account cannot authenticate even with the correct password; recovery
    // is via the password-reset flow (which clears the lock, OWASP 2.2.3).
    const lockState = await getLockState(principalId);
    if (lockState && evaluateLock(lockState).locked) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    const cred = await getCredential(principalId);
    const ok = cred ? await verifyPassword(cred.password_hash, password) : false;
    if (!ok) {
      await recordFailure(principalId);
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    if (cred) await rehashIfNeeded(principalId, password, cred.password_hash);
    const result = await completeLogin(req, principalId);
    if (result.status === 'mfa_required') {
      // Hand the client a short-lived MFA continuation hint. The /mfa/verify step re-checks the
      // password is not required — but it DOES require the email so the principal is re-resolved.
      res.json({ status: 'mfa_required', email });
      return;
    }
    setSessionCookie(res, result.signed, result.aal);
    res.json({ status: 'ok', aal: result.aal, csrf_token: result.csrfToken });
  } catch (e) { next(e); }
});

/**
 * POST /api/auth/mfa/verify — second factor. Requires the password to ALSO be presented (so a stolen
 * MFA code alone can't log in) plus the OTP/backup code. On success issues an AAL2 session.
 */
router.post('/mfa/verify', async (req, res, next) => {
  try {
    const { email, password, code } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || typeof code !== 'string') {
      res.status(400).json({ error: 'email, password and code are required' });
      return;
    }
    const principalId = await resolvePrincipalByEmail(email);
    if (!principalId) { res.status(401).json({ error: 'Invalid credentials' }); return; }
    // [DEFERRED-060 C2] generic 401 on lock (no 429 oracle), consistent with the login path above.
    const lockState = await getLockState(principalId);
    if (lockState && evaluateLock(lockState).locked) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const cred = await getCredential(principalId);
    const pwOk = cred ? await verifyPassword(cred.password_hash, password) : false;
    if (!pwOk) { await recordFailure(principalId); res.status(401).json({ error: 'Invalid credentials' }); return; }
    const mfaOk = await verifyMfaChallenge(principalId, code);
    if (!mfaOk) { await recordFailure(principalId); res.status(401).json({ error: 'Invalid credentials' }); return; }
    await recordSuccess(principalId);
    const meta = clientMeta(req);
    const created = await createSession({ principalId, aal: 2, ip: meta.ip, userAgent: meta.userAgent });
    setSessionCookie(res, created.signedCookie, 2);
    res.json({ status: 'ok', aal: 2, csrf_token: created.csrfToken });
  } catch (e) { next(e); }
});

/** POST /api/auth/register — accept an invite, set password, issue an AAL1 session. */
router.post('/register', async (req, res, next) => {
  try {
    const { token, password, display_name } = req.body ?? {};
    if (typeof token !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'token and password are required' });
      return;
    }
    const accepted = await acceptInvite({ token, password, display_name: typeof display_name === 'string' ? display_name : undefined });
    const meta = clientMeta(req);
    const created = await createSession({ principalId: accepted.principal_id, aal: 1, ip: meta.ip, userAgent: meta.userAgent });
    setSessionCookie(res, created.signedCookie, 1);
    res.status(201).json({ status: 'created', principal_id: accepted.principal_id, display_name: accepted.display_name, csrf_token: created.csrfToken });
  } catch (e) { next(e); }
});

/** POST /api/auth/password/forgot — always returns generic success (no enumeration). Issues a reset
 *  token only if the account exists; delivery is out-of-band (the token is returned for dev/test). */
router.post('/password/forgot', async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    if (typeof email !== 'string') { res.status(400).json({ error: 'email is required' }); return; }
    const principalId = await resolvePrincipalByEmail(email);
    let devToken: string | undefined;
    if (principalId) {
      const token = await issueAuthToken(principalId, 'password_reset');
      // In a real deployment this token is emailed. Exposing it in the HTTP response is gated behind an
      // EXPLICIT opt-in flag (default off) — NOT the deployment profile — because returning it whenever
      // the account exists is an account-enumeration + takeover oracle on any non-prod gateway
      // (adversary A5). E2E harnesses set AUTH_EXPOSE_DEV_RESET_TOKEN=true; otherwise the token is only
      // retrievable server-side (auth_tokens row), and the response is identical whether or not the
      // account exists.
      if (process.env.AUTH_EXPOSE_DEV_RESET_TOKEN === 'true') devToken = token;
    }
    res.json({ status: 'ok', message: 'If an account exists, a reset link has been sent.', ...(devToken ? { dev_reset_token: devToken } : {}) });
  } catch (e) { next(e); }
});

/** POST /api/auth/password/reset — consume token, set new password. CLEARS lockout (never sets it). */
router.post('/password/reset', async (req, res, next) => {
  try {
    const { token, password } = req.body ?? {};
    if (typeof token !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'token and password are required' });
      return;
    }
    const { principalId } = await resetPassword(token, password);
    res.json({ status: 'ok', principal_id: principalId });
  } catch (e) { next(e); }
});

// ── Session-scoped (requireSession) ──────────────────────────────────────────────────────────────

// [DEFERRED-060 C1] This router mounts BEFORE the global csrfGuard (index.ts), so the session-scoped
// cookie mutations below would otherwise bypass CSRF. Apply csrfGuard explicitly (after requireSession,
// which attaches req.session + authMethod='session' that csrfGuard reads). Safe GETs are exempt by the
// guard; the GUI authApi already sends X-CSRF-Token on these mutations.

/** POST /api/auth/logout — revoke the current session + clear cookie. */
router.post('/logout', requireSession, csrfGuard, async (req, res, next) => {
  try {
    const session = (req as any).session;
    await revokeSession(session.principal_id, session.session_id);
    clearSessionCookie(res);
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

/** GET /api/auth/sessions — list my live sessions. */
router.get('/sessions', requireSession, async (req, res, next) => {
  try {
    const principalId = callerPrincipalOf(req)!;
    const sessions = await listSessions(principalId);
    const current = (req as any).session?.session_id;
    res.json({ sessions: sessions.map((s) => ({ session_id: s.session_id, aal: s.aal, created_at: s.created_at, last_seen: s.last_seen, ip: s.ip, user_agent: s.user_agent, expires_at: s.expires_at, current: s.session_id === current })) });
  } catch (e) { next(e); }
});

/** DELETE /api/auth/sessions/:id — revoke one of MY sessions (no cross-principal revoke). */
router.delete('/sessions/:id', requireSession, csrfGuard, async (req, res, next) => {
  try {
    const principalId = callerPrincipalOf(req)!;
    const sessionId = String(req.params.id);
    const ok = await revokeSession(principalId, sessionId);
    if (!ok) { throw new ContextHubError('NOT_FOUND', 'Session not found.'); }
    res.json({ status: 'revoked', session_id: sessionId });
  } catch (e) { next(e); }
});

/** POST /api/auth/mfa/enroll — begin TOTP enrollment for the current principal. */
router.post('/mfa/enroll', requireSession, csrfGuard, async (req, res, next) => {
  try {
    const principalId = callerPrincipalOf(req)!;
    const label = typeof req.body?.label === 'string' ? req.body.label : principalId;
    const result = await enrollTotp(principalId, label);
    res.status(201).json({ factor_id: result.factorId, secret: result.secret, otpauth_uri: result.otpauthUri, backup_codes: result.backupCodes });
  } catch (e) { next(e); }
});

/** POST /api/auth/mfa/enroll/verify — confirm enrollment by verifying a code. */
router.post('/mfa/enroll/verify', requireSession, csrfGuard, async (req, res, next) => {
  try {
    const principalId = callerPrincipalOf(req)!;
    const { factor_id, code } = req.body ?? {};
    if (typeof factor_id !== 'string' || typeof code !== 'string') {
      res.status(400).json({ error: 'factor_id and code are required' });
      return;
    }
    await verifyTotpEnrollment(principalId, factor_id, code);
    res.json({ status: 'verified' });
  } catch (e) { next(e); }
});

export { router as authRouter };
