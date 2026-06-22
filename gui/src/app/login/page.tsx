"use client";

/**
 * /login — human authentication (NIST 800-63B AAL2, OWASP ASVS V6).
 * Ported from docs/gui-drafts/pages/login.html.
 *
 * Pre-auth page: it renders shell-less ONCE the integrator's §2.10 layout gate
 * adds "/login" to PRE_AUTH_ROUTES. This file only owns its own chrome via
 * <PreAuthShell> (§2.10) — it does not touch layout.tsx.
 *
 * Auth is COOKIE-BASED: on success the backend sets an httpOnly session cookie;
 * this page never sees a token. It drives the S3 `/api/auth/*` contract through
 * the typed `authApi` client. The S3 endpoints are absent at this slice's BASE,
 * so all flows degrade gracefully (errors are surfaced, never thrown to a crash).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Lock, AlertTriangle } from "lucide-react";
import { authApi, AuthApiError } from "@/lib/authApi";
import { PreAuthShell, PreAuthCard } from "@/components/pre-auth-shell";

type Stage = "login" | "mfa" | "forgot";

/**
 * Where to land after a successful sign-in. Honors `?next=` (set by the AuthGate when it
 * bounces an unauthenticated visitor here) but ONLY for same-origin relative paths — a
 * leading-single-`/` guard rejects `//evil.com` and absolute URLs (open-redirect defense).
 */
function resolveNext(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

export default function LoginPage() {
  const [stage, setStage] = useState<Stage>("login");

  // Auth-OFF notice (State 5): when enforcement is disabled, no login is needed.
  const [authOff, setAuthOff] = useState(false);

  // Login form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // [DEFERRED-060 C2] No soft-lock countdown: login no longer returns a 429 "locked" (that response
  // was an account-existence oracle). A locked account now returns the SAME generic 401 as a wrong
  // password, so there is nothing lock-specific to surface here.

  // MFA challenge (State 2). The verify step re-submits email+password+code, so
  // we carry the credentials forward from the login attempt (kept only in memory).
  const [code, setCode] = useState("");
  const [mfaMethod, setMfaMethod] = useState<"totp" | "backup_code">("totp");

  // Forgot (State 4)
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  // Detect enforcement posture on mount (auth-OFF → State 5).
  useEffect(() => {
    let active = true;
    authApi
      .me()
      .then((me) => {
        if (!active) return;
        if (me && me.auth_enabled === false) setAuthOff(true);
        // If already authenticated, bounce to the intended destination (or root).
        if (me?.authenticated) window.location.assign(resolveNext());
      })
      .catch(() => {
        /* /api/auth/me absent (S3 not merged) or 401 — stay on the login form */
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const res = await authApi.login({ email: email.trim(), password });
        if (res.status === "mfa_required") {
          setStage("mfa");
        } else {
          // Session cookie is set; go to the intended destination (or console root).
          window.location.assign(resolveNext());
        }
      } catch (err) {
        if (err instanceof AuthApiError) {
          // Neutral message — never reveal whether the email exists or is locked (DEFERRED-060 C2).
          setError("Incorrect email or password.");
        } else {
          setError("Sign-in is unavailable right now. Try again shortly.");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [email, password],
  );

  const handleVerifyMfa = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        await authApi.verifyMfa({
          email: email.trim(),
          password,
          code: code.trim(),
        });
        window.location.assign(resolveNext());
      } catch (err) {
        setError(
          err instanceof AuthApiError
            ? "That code didn't match. Try again."
            : "Verification is unavailable right now.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, code],
  );

  const handleForgot = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      try {
        await authApi.forgotPassword({ email: forgotEmail.trim() });
      } catch {
        /* swallow — response is always neutral to avoid enumeration */
      } finally {
        // Always show the neutral confirmation regardless of outcome.
        setForgotSent(true);
        setSubmitting(false);
      }
    },
    [forgotEmail],
  );

  const inputCls =
    "w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600";

  // ── State 5: enforcement OFF ──
  if (authOff) {
    return (
      <PreAuthShell>
        <PreAuthCard tone="warning">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <h1 className="text-sm font-semibold text-amber-300">Single-operator mode</h1>
          </div>
          <p className="text-xs text-zinc-400 mb-2">
            <code className="text-zinc-500">MCP_AUTH_ENABLED=false</code> — the console is open
            as the root/dev operator; no login is required.
          </p>
          <p className="text-[11px] text-zinc-600 mb-4">
            Enable enforcement and configure a root credential before exposing this deployment to
            any untrusted network.
          </p>
          <Link
            href="/"
            className="block w-full text-center px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-colors"
          >
            Continue to console
          </Link>
        </PreAuthCard>
      </PreAuthShell>
    );
  }

  // ── State 4: forgot password ──
  if (stage === "forgot") {
    return (
      <PreAuthShell>
        <PreAuthCard>
          <h1 className="text-lg font-semibold text-zinc-100">Reset password</h1>
          <p className="text-xs text-zinc-500 mt-0.5 mb-5">
            We&apos;ll email a single-use, short-lived link. For security, the response is the same
            whether or not the address has an account.
          </p>
          {forgotSent ? (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-2.5">
              <p className="text-[11px] text-emerald-300">
                If an account exists for that address, a reset link is on its way.
              </p>
            </div>
          ) : (
            <form onSubmit={handleForgot}>
              <label className="block text-xs text-zinc-400 mb-1.5" htmlFor="forgot-email">
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="you@example.com"
                className={`${inputCls} mb-4`}
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium"
              >
                Send reset link
              </button>
            </form>
          )}
          <button
            type="button"
            onClick={() => {
              setStage("login");
              setForgotSent(false);
            }}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 mt-4 block mx-auto"
          >
            ← Back to sign in
          </button>
        </PreAuthCard>
      </PreAuthShell>
    );
  }

  // ── State 2: MFA challenge ──
  if (stage === "mfa") {
    return (
      <PreAuthShell>
        <PreAuthCard>
          <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
            <Lock size={18} className="text-blue-400" />
          </div>
          <h1 className="text-lg font-semibold text-zinc-100">Two-factor</h1>
          <p className="text-xs text-zinc-500 mt-0.5 mb-5">
            {mfaMethod === "backup_code"
              ? "Enter one of your saved backup codes."
              : "Enter the 6-digit code from your authenticator app."}
          </p>
          <form onSubmit={handleVerifyMfa}>
            <input
              autoFocus
              inputMode={mfaMethod === "backup_code" ? "text" : "numeric"}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={mfaMethod === "backup_code" ? "xxxx-xxxx" : "123456"}
              className={`${inputCls} mb-4 tracking-widest text-center`}
            />
            {error && <p className="text-[11px] text-red-400 mb-3">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !code.trim()}
              className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium"
            >
              Verify
            </button>
          </form>
          <div className="flex items-center justify-end mt-4">
            <button
              type="button"
              onClick={() =>
                setMfaMethod((m) => (m === "backup_code" ? "totp" : "backup_code"))
              }
              className="text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              {mfaMethod === "backup_code" ? "Use authenticator app" : "Use a backup code"}
            </button>
          </div>
        </PreAuthCard>
      </PreAuthShell>
    );
  }

  // ── State 1: login form ──
  return (
    <PreAuthShell>
      <PreAuthCard>
        <h1 className="text-lg font-semibold text-zinc-100">Sign in</h1>
        <p className="text-xs text-zinc-500 mt-0.5 mb-5">
          Operator access to the governance console.
        </p>
        <form onSubmit={handleLogin}>
          <label className="block text-xs text-zinc-400 mb-1.5" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={`${inputCls} mb-3`}
          />
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-zinc-400" htmlFor="password">
              Password
            </label>
            <button
              type="button"
              onClick={() => setStage("forgot")}
              className="text-[11px] text-blue-400 hover:text-blue-300"
            >
              Forgot?
            </button>
          </div>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputCls} mb-4`}
          />
          {error && <p className="text-[11px] text-red-400 mb-3">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium transition-colors"
          >
            {submitting ? "Signing in…" : "Continue"}
          </button>
        </form>
        <p className="text-[11px] text-zinc-600 mt-4 text-center">
          No account? Registration is by <span className="text-zinc-400">invite only</span>.
        </p>
      </PreAuthCard>
    </PreAuthShell>
  );
}
