"use client";

/**
 * /register — invite-only human registration + MFA enrollment.
 * Ported from docs/gui-drafts/pages/register.html.
 *
 * Pre-auth page (shell-less once the integrator adds "/register" to
 * PRE_AUTH_ROUTES, §2.10). Flow:
 *   1. accept invite + set password (≥12 chars, NIST 800-63B length-over-complexity)
 *   2. email verification notice (single-use link)
 *   3. MFA enrollment — TOTP via a SERVER-RENDERED QR data-URL (dep-free, §2.7/M1)
 *   4. one-time backup codes
 *
 * The invite token arrives in the URL: /register?token=…. Drives the S3
 * `/api/auth/*` contract via the typed `authApi` client; degrades gracefully
 * when S3 is absent (BASE) or the token is invalid.
 */

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, AlertTriangle, Download } from "lucide-react";
import { authApi, AuthApiError, type InvitePreview, type MfaEnrollment } from "@/lib/authApi";
import { PreAuthShell, PreAuthCard } from "@/components/pre-auth-shell";

type Step = "accept" | "verify" | "mfa" | "backup" | "done";

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
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  // Resolve the invite on mount.
  useEffect(() => {
    if (!token) {
      setInviteError("This registration link is missing its invite token.");
      return;
    }
    let active = true;
    authApi
      .getInvite(token)
      .then((inv) => {
        if (!active) return;
        if (!inv.valid) {
          setInviteError("This invite has expired or was already used.");
        } else {
          setInvite(inv);
        }
      })
      .catch((err) => {
        if (!active) return;
        setInviteError(
          err instanceof AuthApiError && err.status === 404
            ? "This invite link is invalid."
            : "Couldn't load this invite. The link may be expired.",
        );
      });
    return () => {
      active = false;
    };
  }, [token]);

  const checks = passwordChecks(password);

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
        await authApi.register({ token, display_name: displayName.trim(), password });
        // Backend sends the verification email; show the notice, then proceed.
        setStep("verify");
      } catch (err) {
        setError(
          err instanceof AuthApiError
            ? err.message || "Couldn't create the account."
            : "Registration is unavailable right now.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [token, displayName, password, checks.longEnough],
  );

  const beginMfaEnroll = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const enr = await authApi.enrollMfa();
      setEnrollment(enr);
      setStep("mfa");
    } catch (err) {
      setError(
        err instanceof AuthApiError ? "Couldn't start MFA enrollment." : "MFA setup unavailable.",
      );
    } finally {
      setSubmitting(false);
    }
  }, []);

  const handleConfirmMfa = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const res = await authApi.confirmMfa({ code: mfaCode.trim() });
        setBackupCodes(res.backup_codes ?? []);
        setStep("backup");
      } catch (err) {
        setError(
          err instanceof AuthApiError ? "That code didn't match. Try again." : "Unavailable.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [mfaCode],
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

  // ── Invite invalid / missing ──
  if (inviteError) {
    return (
      <PreAuthShell>
        <PreAuthCard tone="warning">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <h1 className="text-sm font-semibold text-amber-300">Invite unavailable</h1>
          </div>
          <p className="text-xs text-zinc-400">{inviteError}</p>
          <p className="text-[11px] text-zinc-600 mt-3">
            Registration is invite-only. Ask an admin to issue a fresh invite.
          </p>
        </PreAuthCard>
      </PreAuthShell>
    );
  }

  // ── Step 2: verify email ──
  if (step === "verify") {
    return (
      <PreAuthShell>
        <PreAuthCard className="text-center">
          <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <Mail size={20} className="text-blue-400" />
          </div>
          <h1 className="text-base font-semibold text-zinc-100">Check your inbox</h1>
          <p className="text-xs text-zinc-500 mt-1 mb-4">
            We sent a single-use verification link to{" "}
            <span className="text-zinc-300">{invite?.email}</span>. The link is short-lived and
            one-time.
          </p>
          <button
            type="button"
            disabled={submitting}
            onClick={beginMfaEnroll}
            className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium"
          >
            Continue to two-factor setup
          </button>
          {error && <p className="text-[11px] text-red-400 mt-3">{error}</p>}
        </PreAuthCard>
      </PreAuthShell>
    );
  }

  // ── Step 3: MFA enrollment ──
  if (step === "mfa") {
    return (
      <PreAuthShell>
        <PreAuthCard>
          <h1 className="text-lg font-semibold text-zinc-100">Set up two-factor</h1>
          <p className="text-xs text-zinc-500 mt-0.5 mb-4">
            Scan with an authenticator app, then enter the first code to confirm.
          </p>
          <div className="flex gap-4 mb-4">
            {enrollment?.qr_data_url ? (
              // Server-rendered QR data-URL — no browser QR dependency (§2.7/M1).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={enrollment.qr_data_url}
                alt="TOTP enrollment QR code"
                className="w-28 h-28 bg-white rounded-md p-1.5 shrink-0"
              />
            ) : (
              <div className="w-28 h-28 bg-zinc-800 rounded-md shrink-0 animate-pulse" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-zinc-600 mb-1">
                Or enter the key
              </p>
              <code className="text-[11px] font-mono text-zinc-400 break-all select-all">
                {enrollment?.secret ?? "…"}
              </code>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  TOTP
                </span>
              </div>
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
            {invite ? (
              <>
                You were invited
                {invite.inviter_display_name ? (
                  <>
                    {" "}
                    by <span className="text-blue-300">{invite.inviter_display_name}</span>
                  </>
                ) : null}{" "}
                to join as a <span className="text-sky-300">{invite.kind}</span> principal.
              </>
            ) : (
              "Validating your invite…"
            )}
          </p>
        </div>
        <h1 className="text-lg font-semibold text-zinc-100">Create your account</h1>
        <p className="text-xs text-zinc-500 mt-0.5 mb-5">
          A principal will be registered for{" "}
          <code className="text-zinc-400">{invite?.email ?? "…"}</code>.
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
            disabled={submitting || !invite}
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
