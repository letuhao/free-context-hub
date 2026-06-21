"use client";

/**
 * First-run bootstrap wizard (pre-auth, shell-less).
 *
 * Route `/bootstrap` is in the integrator's PRE_AUTH_ROUTES list (frozen
 * interface §2.10) — the root layout suppresses <Sidebar/> for it, so this
 * page renders its own centered chrome. It must NOT assume the app shell.
 *
 * Three steps: (1) establish root via ROOT_BOOTSTRAP_TOKEN, (2) create the
 * first human operator, (3) flip enforcement behind a lockout guard. Codes to
 * the documented S1 /api/bootstrap contract (ABSENT at BASE).
 */

import { useState } from "react";
import { governanceApi, type BootstrapStatus } from "@/lib/governanceApi";
import { cn } from "@/lib/cn";
import { Home, Check, AlertTriangle, ShieldCheck } from "lucide-react";

type Step = 1 | 2 | 3 | "done";

export default function BootstrapPage() {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — root. The ROOT_BOOTSTRAP_TOKEN gates EVERY bootstrap call (incl.
  // /status), so it is held in memory and threaded through each request.
  const [token, setToken] = useState("");
  // Step 2 — operator. [DEFERRED-063] The route now ISSUES AN INVITE (root → invite → register), so
  // we collect an email; the returned single-use token is shown for the operator to register with.
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  // Step 3 — enforce
  const [acknowledged, setAcknowledged] = useState(false);

  // Re-read status with the in-memory token, advancing the wizard to the
  // earliest incomplete step. Returns the fetched status (or null on failure).
  const refreshStatus = async (tok: string): Promise<BootstrapStatus | null> => {
    try {
      const s = await governanceApi.bootstrapStatus(tok);
      setStatus(s);
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read bootstrap status");
      return null;
    }
  };

  const establishRoot = async () => {
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    const tok = token.trim();
    try {
      // Validate the token + seed root in one call. The token also unlocks /status.
      await governanceApi.bootstrapRoot(tok);
      const s = await refreshStatus(tok);
      if (s) setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to establish root");
    } finally {
      setBusy(false);
    }
  };

  const createOperator = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await governanceApi.bootstrapOperator(token.trim(), {
        email: email.trim(),
        display_name: displayName.trim() || undefined,
      });
      setInviteToken(res.invite_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue the operator invite");
    } finally {
      setBusy(false);
    }
  };

  const enableEnforcement = async () => {
    if (!acknowledged) return;
    setBusy(true);
    setError(null);
    try {
      // POST /enforce is the lockout guard: 200 = safe to flip MCP_AUTH_ENABLED
      // out-of-band; a non-2xx throws with the blocker message.
      await governanceApi.bootstrapEnforce(token.trim());
      await refreshStatus(token.trim());
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not enforce-ready yet");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-2 text-center">
          <h1 className="text-sm font-semibold tracking-tight text-zinc-100">ContextHub</h1>
          <p className="text-[11px] text-zinc-600">Governance Console · first-run setup</p>
        </div>

        {/* Stepper */}
        <div className="w-full mb-6">
          <div className="flex items-center gap-2 text-[11px]">
            <StepPill n={1} label="Root" active={step === 1} done={step !== 1} />
            <span className="flex-1 h-px bg-zinc-800" />
            <StepPill n={2} label="You" active={step === 2} done={step === 3 || step === "done"} />
            <span className="flex-1 h-px bg-zinc-800" />
            <StepPill n={3} label="Enforce" active={step === 3} done={step === "done"} />
          </div>
        </div>

        {error && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 mb-4 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {/* Step 1 — establish root */}
        {step === 1 && (
          <div className="bg-zinc-900 border border-amber-500/20 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2">
              <Home size={18} className="text-amber-400" />
              <h2 className="text-base font-semibold text-zinc-100">Set up the trust anchor</h2>
            </div>
            <p className="text-xs text-zinc-400 mb-3">
              This deployment has no <span className="text-amber-300">root</span> yet. The root is the
              out-of-band trust anchor — only the holder of <code className="text-zinc-400">DATABASE_URL</code>{" "}
              can establish it.
            </p>
            <div className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-[11px] text-zinc-500 mb-4">
              Paste the value of <code className="text-zinc-400">ROOT_BOOTSTRAP_TOKEN</code> (printed once in
              the server logs at first start). This proves out-of-band possession — it is consumed on use.
            </div>
            <label className="block text-xs text-zinc-400 mb-1.5">Bootstrap token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="rbt_…"
              className="w-full px-3 py-2 mb-4 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
            />
            <button
              onClick={establishRoot}
              disabled={busy || !token.trim()}
              className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium"
            >
              {busy ? "Establishing…" : "Establish root & continue"}
            </button>
            <p className="text-[10px] text-zinc-600 mt-3">
              Prefer the CLI? <code className="text-zinc-500">npm run bootstrap:root</code> does the same,
              headless. Either path seeds exactly one root; running it again once root exists is a no-op.
            </p>
          </div>
        )}

        {/* Step 2 — invite operator [DEFERRED-063] */}
        {step === 2 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            {!inviteToken ? (
              <>
                <h2 className="text-base font-semibold text-zinc-100 mb-1">Invite your operator</h2>
                <p className="text-xs text-zinc-500 mb-4">
                  Root is the anchor, not a daily login. Issue an invite for a human operator; they finish
                  setup (password + MFA) at the <span className="text-blue-300">register</span> page. Root
                  grants them access after their first sign-in.
                </p>
                <label className="block text-xs text-zinc-400 mb-1.5">Operator email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2 mb-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-600"
                />
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Display name <span className="text-zinc-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Jane Operator"
                  className="w-full px-3 py-2 mb-4 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-600"
                />
                <button
                  onClick={createOperator}
                  disabled={busy || !email.trim()}
                  className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium"
                >
                  {busy ? "Issuing…" : "Issue operator invite"}
                </button>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-zinc-100 mb-1">Operator invited</h2>
                <p className="text-xs text-zinc-500 mb-3">
                  Share this single-use token with the operator. They register at{" "}
                  <code className="text-zinc-400">/register</code> to set a password + MFA. Then root grants
                  them access (invites can&apos;t seed global scope).
                </p>
                <div className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 mb-4">
                  <div className="text-[10px] text-zinc-600 mb-1">Invite token (shown once)</div>
                  <code className="text-[11px] text-blue-300 break-all">{inviteToken}</code>
                </div>
                <div className="flex gap-2">
                  <a
                    href={`/register?token=${encodeURIComponent(inviteToken)}`}
                    className="flex-1 px-3 py-2 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white font-medium text-center"
                  >
                    Open register page
                  </a>
                  <button
                    onClick={() => { refreshStatus(token.trim()); setStep(3); }}
                    className="px-3 py-2 text-xs border border-zinc-700 rounded-md text-zinc-300 hover:bg-zinc-800"
                  >
                    Continue to enforcement
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 3 — enforce */}
        {step === 3 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-base font-semibold text-zinc-100 mb-1">Enable enforcement</h2>
            <p className="text-xs text-zinc-500 mb-4">
              Flipping <code className="text-zinc-400">MCP_AUTH_ENABLED=true</code> requires every caller to
              authenticate. We verify you won&apos;t lock yourself out first.
            </p>
            <div className="space-y-2 mb-4">
              <GuardRow ok={status?.has_root ?? false} label="Root established" />
              <GuardRow
                ok={status?.has_usable_credential ?? false}
                label="A usable root credential exists (you won't be locked out)"
              />
              <GuardRow
                ok={status?.enforce_ready ?? false}
                warn={!(status?.enforce_ready ?? false)}
                label={
                  status?.enforce_ready
                    ? "Deployment is enforce-ready"
                    : status?.enforce_blocker ?? "Checking enforce-readiness…"
                }
              />
            </div>
            <label className="flex items-start gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="w-3.5 h-3.5 mt-0.5 rounded border-zinc-700 bg-zinc-800 accent-blue-500"
              />
              <span className="text-[11px] text-zinc-400">
                I understand that after enabling, the console requires login and all MCP/API callers must
                present a credential. Root recovery remains available out-of-band.
              </span>
            </label>
            <button
              onClick={enableEnforcement}
              disabled={busy || !acknowledged}
              className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-medium"
            >
              {busy ? "Enabling…" : "Enable enforcement"}
            </button>
            <p className="text-[11px] text-zinc-600 mt-4">
              If you&apos;d rather stay single-operator: skip this step. Enforcement stays off, the console
              is open as root/dev, and this is valid until you expose the gateway to an untrusted network.
            </p>
          </div>
        )}

        {/* Done */}
        {step === "done" && (
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={18} className="text-emerald-400" />
              <h2 className="text-base font-semibold text-emerald-200">You&apos;re set up</h2>
            </div>
            <p className="text-xs text-zinc-400 mb-3">
              Enforcement is on. Next: register agents and grant them scope.
            </p>
            <div className="flex gap-2">
              <a
                href="/identity"
                className="flex-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white font-medium text-center"
              >
                Go to Identity
              </a>
              <a
                href="/delegation"
                className="px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-300 hover:bg-zinc-800 text-center"
              >
                View delegation
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepPill({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full",
        active ? "bg-blue-600 text-white" : done ? "bg-emerald-600/30 text-emerald-300" : "bg-zinc-800 text-zinc-400",
      )}
    >
      {n} {label}
    </span>
  );
}

function GuardRow({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2">
      {ok ? (
        <Check size={14} className="text-emerald-400 shrink-0" />
      ) : (
        <AlertTriangle size={14} className={cn("shrink-0", warn ? "text-amber-400" : "text-red-400")} />
      )}
      <span className="text-xs text-zinc-300">{label}</span>
    </div>
  );
}
