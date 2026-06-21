"use client";

/**
 * /register — invite-only human registration + MFA enrollment.
 * Ported from docs/gui-drafts/pages/register.html.
 *
 * Pre-auth page (shell-less once the integrator adds "/register" to
 * PRE_AUTH_ROUTES). Flow (reconciled against routes/auth.ts):
 *   1. accept invite token + set password (≥12 chars) + display name → the
 *      backend creates the principal AND issues an AAL1 session immediately
 *      (POST /api/auth/register). No separate email-verification round-trip and
 *      no invite-preview GET endpoint exist, so we go straight from accept → MFA.
 *   2. MFA enrollment — TOTP via the otpauth_uri + base32 secret for manual
 *      authenticator entry (the backend returns NO QR data-URL; dep-free).
 *   3. one-time backup codes (returned at enroll time, not at confirm).
 *
 * The invite token arrives in the URL: /register?token=….
 */

import { useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Download } from "lucide-react";
import { authApi, AuthApiError, type MfaEnrollment } from "@/lib/authApi";
import { PreAuthShell, PreAuthCard } from "@/components/pre-auth-shell";

type Step = "accept" | "mfa" | "backup" | "done";

function passwordChecks(pw: string) {
  const longEnough = pw.length >= 12;
  // The breach check is authoritative server-side; the client shows an optimistic
  // hint that flips once the backend confirms on submit.
  return { longEnough };
}

function RegisterInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [step, setStep] = useState<Step>("accept");
  const tokenMissing = !token;

  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const checks = passwordChecks(password);

  const beginMfaEnroll = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const enr = await authApi.enrollMfa();
      setEnrollment(enr);
      // Backup codes are issued at enroll time (services/mfa.ts), shown after confirm.
      setBackupCodes(enr.backup_codes ?? []);
      setStep("mfa");
    } catch (err) {
      setError(
        err instanceof AuthApiError ? "Couldn't start MFA enrollment." : "MFA setup unavailable.",
      );
    } finally {
      setSubmitting(false);
    }
  }, []);

  const handleAccept = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!checks.longEnough) {
        setError("Password must be at least 12 characters.");
        return;
      }
      setSubmitting(true);
      try {
        // Creates the principal + an AAL1 session cookie in one call.
        await authApi.register({ token, display_name: displayName.trim(), password });
      } catch (err) {
        setError(
          err instanceof AuthApiError
            ? err.message || "Couldn't create the account."
            : "Registration is unavailable right now.",
        );
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      // Session is live (cookie set) — proceed straight into MFA enrollment.
      await beginMfaEnroll();
    },
    [token, displayName, password, checks.longEnough, beginMfaEnroll],
  );

  const handleConfirmMfa = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!enrollment) return;
      setSubmitting(true);
      try {
        await authApi.confirmMfa({ factor_id: enrollment.factor_id, code: mfaCode.trim() });
        setStep("backup");
      } catch (err) {
        setError(
          err instanceof AuthApiError ? "That code didn't match. Try again." : "Unavailable.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [enrollment, mfaCode],
  );

  const downloadBackupCodes = useCallback(() => {
    const blob = new Blob([backupCodes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contexthub-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }, [backupCodes]);

  const inputCls =
    "w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600";

  // ── Missing invite token ──
  if (tokenMissing) {
    return (
      <PreAuthShell>
        <PreAuthCard tone="warning">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <h1 className="text-sm font-semibold text-amber-300">Invite required</h1>
          </div>
          <p className="text-xs text-zinc-400">
            This registration link is missing its invite token.
          </p>
          <p className="text-[11px] text-zinc-600 mt-3">
            Registration is invite-only. Ask an admin to issue a fresh invite link.
          </p>
        </PreAuthCard>
      </PreAuthShell>
    );
  }

  // ── Step: MFA enrollment ──
  if (step === "mfa") {
    return (
      <PreAuthShell>
        <PreAuthCard>
          <h1 className="text-lg font-semibold text-zinc-100">Set up two-factor</h1>
          <p className="text-xs text-zinc-500 mt-0.5 mb-4">
            Add this account to an authenticator app, then enter the first code to confirm.
          </p>
          <div className="mb-4">
            <p className="text-[10px] uppercase tracking-wide text-zinc-600 mb-1">
              Authenticator setup key (base32)
            </p>
            <code className="block text-[11px] font-mono text-zinc-300 break-all select-all bg-zinc-950 border border-zinc-800 rounded-md p-2.5 mb-2">
              {enrollment?.secret ?? "…"}
            </code>
            <p className="text-[10px] uppercase tracking-wide text-zinc-600 mb-1">
              Or use this otpauth URI
            </p>
            <code className="block text-[10px] font-mono text-zinc-500 break-all select-all bg-zinc-950 border border-zinc-800 rounded-md p-2.5">
              {enrollment?.otpauth_uri ?? "…"}
            </code>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">TOTP</span>
              Enter the key manually in your authenticator app (Google Authenticator, 1Password, …).
            </div>
          </div>
          <form onSubmit={handleConfirmMfa}>
            <label className="block text-xs text-zinc-400 mb-1.5" htmlFor="mfa-code">
              Confirmation code
            </label>
            <input
              id="mfa-code"
              inputMode="numeric"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="123456"
              className={`${inputCls} mb-4 tracking-widest`}
            />
            {error && <p className="text-[11px] text-red-400 mb-3">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !mfaCode.trim()}
              className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium"
            >
              Confirm &amp; finish
            </button>
          </form>
        </PreAuthCard>
      </PreAuthShell>
    );
  }

  // ── Step 4: backup codes ──
  if (step === "backup") {
    return (
      <PreAuthShell>
        <PreAuthCard>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={16} className="text-amber-400" />
            <h1 className="text-sm font-semibold text-zinc-100">Save these backup codes</h1>
          </div>
          <p className="text-[11px] text-zinc-500 mb-3">
            Each works once if you lose your authenticator. Stored hashed — they won&apos;t be shown
            again.
          </p>
          <div className="grid grid-cols-2 gap-2 mb-4 font-mono text-xs text-zinc-300">
            {backupCodes.map((c) => (
              <code
                key={c}
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-center select-all"
              >
                {c}
              </code>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={downloadBackupCodes}
              className="flex-1 px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-300 hover:bg-zinc-800 flex items-center justify-center gap-1.5"
            >
              <Download size={13} /> Download
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("done");
                window.location.assign("/");
              }}
              className="flex-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white font-medium"
            >
              I&apos;ve saved them →
            </button>
          </div>
        </PreAuthCard>
      </PreAuthShell>
    );
  }

  // ── Step 1: accept invite & set password ──
  return (
    <PreAuthShell>
      <PreAuthCard>
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-md p-2.5 mb-5">
          <p className="text-[11px] text-zinc-400">
            You&apos;re accepting an invite to join as a human principal. Set a display name and a
            password to finish creating your account.
          </p>
        </div>
        <h1 className="text-lg font-semibold text-zinc-100">Create your account</h1>
        <p className="text-xs text-zinc-500 mt-0.5 mb-5">
          Your invite establishes which email this principal is bound to.
        </p>
        <form onSubmit={handleAccept}>
          <label className="block text-xs text-zinc-400 mb-1.5" htmlFor="display-name">
            Display name
          </label>
          <input
            id="display-name"
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={`${inputCls} mb-3`}
          />

          <label className="block text-xs text-zinc-400 mb-1.5" htmlFor="reg-password">
            Password
          </label>
          <input
            id="reg-password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputCls} mb-2`}
          />
          <ul className="text-[11px] text-zinc-600 space-y-0.5 mb-4">
            <li className={checks.longEnough ? "text-emerald-400" : "text-zinc-600"}>
              {checks.longEnough ? "✓" : "○"} At least 12 characters (OWASP V6)
            </li>
            <li className="text-zinc-600">Checked against the breached-password list on submit</li>
            <li className="text-zinc-600">
              No composition rules — length over complexity (NIST 800-63B)
            </li>
          </ul>
          {error && <p className="text-[11px] text-red-400 mb-3">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !displayName.trim() || !checks.longEnough}
            className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium"
          >
            {submitting ? "Creating…" : "Create account & continue to MFA"}
          </button>
        </form>
      </PreAuthCard>
    </PreAuthShell>
  );
}

export default function RegisterPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <PreAuthShell>
          <PreAuthCard>
            <p className="text-xs text-zinc-500">Loading…</p>
          </PreAuthCard>
        </PreAuthShell>
      }
    >
      <RegisterInner />
    </Suspense>
  );
}
