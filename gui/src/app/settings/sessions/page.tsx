"use client";

/**
 * /settings/sessions — "Sessions & Security".
 * Ported from docs/gui-drafts/pages/sessions.html. NIST 800-63B §7 session mgmt.
 *
 * Authed page (renders inside the sidebar shell). Lists the principal's active
 * browser sessions with revoke, plus the deployment-wide auth policy (read for
 * everyone, editable by admin/root). Cookie-based via the typed `authApi`.
 *
 * Records its nav line for reconcile (§2.3): Settings group →
 *   { href: "/settings/sessions", label: "Sessions & Security" }
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Monitor, Smartphone, AlertCircle, ShieldCheck } from "lucide-react";
import { PageHeader, Breadcrumb, Button, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { authApi, AuthApiError, type SessionInfo, type AuthPolicy } from "@/lib/authApi";

function deviceIcon(label: string | null) {
  const l = (label ?? "").toLowerCase();
  if (l.includes("iphone") || l.includes("android") || l.includes("mobile")) {
    return <Smartphone size={16} className="text-zinc-500" />;
  }
  return <Monitor size={16} className="text-emerald-400" />;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const REAUTH_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: "12 hours", seconds: 12 * 3600 },
  { label: "7 days", seconds: 7 * 86400 },
  { label: "30 days", seconds: 30 * 86400 },
];
const IDLE_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: "15 minutes", seconds: 15 * 60 },
  { label: "1 hour", seconds: 3600 },
  { label: "7 days", seconds: 7 * 86400 },
];

export default function SessionsPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.allSettled([authApi.listSessions(), authApi.getPolicy()]);
      if (s.status === "fulfilled") setSessions(s.value.sessions ?? []);
      else setError("Couldn't load your active sessions.");
      if (p.status === "fulfilled") setPolicy(p.value);
    } catch {
      setError("Couldn't load session data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRevoke = useCallback(
    async (sessionId: string) => {
      try {
        await authApi.revokeSession(sessionId);
        setSessions((prev) => prev.filter((x) => x.session_id !== sessionId));
        toastRef.current("success", "Session revoked");
      } catch {
        toastRef.current("error", "Couldn't revoke that session");
      } finally {
        setRevokeTarget(null);
      }
    },
    [],
  );

  const handleRevokeAll = useCallback(async () => {
    try {
      await authApi.revokeOtherSessions();
      setSessions((prev) => prev.filter((x) => x.current));
      toastRef.current("success", "All other sessions revoked");
    } catch {
      toastRef.current("error", "Couldn't revoke other sessions");
    } finally {
      setRevokeAllOpen(false);
    }
  }, []);

  const updatePolicy = useCallback(async (patch: Partial<AuthPolicy>) => {
    try {
      const next = await authApi.updatePolicy(patch);
      setPolicy(next);
      toastRef.current("success", "Policy updated");
    } catch (err) {
      const msg =
        err instanceof AuthApiError && err.status === 403
          ? "Only admins can change the auth policy"
          : "Couldn't update the policy";
      toastRef.current("error", msg);
    }
  }, []);

  const hasOthers = sessions.some((s) => !s.current);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full">
      <PageHeader
        title="Sessions & Security"
        subtitle="Active browser sessions for your principal, and the deployment's authentication policy."
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Settings", href: "/settings" }, { label: "Sessions & Security" }]}
          />
        }
        actions={
          <Button variant="danger" disabled={!hasOthers} onClick={() => setRevokeAllOpen(true)}>
            Revoke all other sessions
          </Button>
        }
      />

      {/* Active sessions */}
      <h2 className="text-sm font-semibold text-zinc-200 mb-3">Active sessions</h2>
      {loading ? (
        <div className="text-xs text-zinc-600 mb-10">Loading sessions…</div>
      ) : error ? (
        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 mb-10 text-xs text-red-400">
          {error}
        </div>
      ) : sessions.length === 0 ? (
        <div className="mb-10">
          <EmptyState
            icon="🔐"
            title="No active sessions"
            description="When you sign in, your browser sessions appear here."
          />
        </div>
      ) : (
        <div className="space-y-2.5 mb-10">
          {sessions.map((s) => {
            const tone = s.current
              ? "border-emerald-500/20"
              : s.flagged
                ? "border-amber-500/20"
                : "border-zinc-800";
            return (
              <div key={s.session_id} className={`bg-zinc-900 border ${tone} rounded-lg p-4`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                      {deviceIcon(s.device_label)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-zinc-200">
                          {s.device_label ?? s.user_agent ?? "Unknown device"}
                        </span>
                        {s.current && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                            this device
                          </span>
                        )}
                        {s.mfa && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                            AAL{s.aal} · MFA
                          </span>
                        )}
                        {s.flagged && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                            new location
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-zinc-600 flex-wrap">
                        {(s.ip || s.location) && (
                          <span>
                            {[s.ip, s.location].filter(Boolean).join(" · ")}
                          </span>
                        )}
                        <span>Signed in {relativeTime(s.created_at)}</span>
                        {s.last_active_at && <span>Active {relativeTime(s.last_active_at)}</span>}
                      </div>
                    </div>
                  </div>
                  {s.current ? (
                    <span className="text-[10px] text-zinc-600 italic shrink-0">current</span>
                  ) : (
                    <button
                      onClick={() => setRevokeTarget(s.session_id)}
                      className="text-xs text-zinc-500 hover:text-red-400 transition-colors shrink-0"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Auth policy */}
      <h2 className="text-sm font-semibold text-zinc-200 mb-1">Authentication policy</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Deployment-wide — applies to all human principals. Editable by admin/root.
      </p>

      {policy ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg divide-y divide-zinc-800">
          {/* require MFA */}
          <div className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm text-zinc-200">Require MFA (AAL2)</div>
              <div className="text-[11px] text-zinc-600">
                NIST 800-63B AAL2 — every human session must complete a second factor.
              </div>
            </div>
            <button
              type="button"
              aria-pressed={policy.require_mfa}
              onClick={() => updatePolicy({ require_mfa: !policy.require_mfa })}
              className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${
                policy.require_mfa ? "bg-blue-600" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-[2px] w-[16px] h-[16px] bg-white rounded-full shadow-sm transition-all ${
                  policy.require_mfa ? "left-[18px]" : "left-[2px]"
                }`}
              />
            </button>
          </div>

          {/* re-auth window */}
          <div className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm text-zinc-200">Re-authentication window</div>
              <div className="text-[11px] text-zinc-600">
                Force re-auth during an extended session regardless of activity.
              </div>
            </div>
            <select
              value={policy.reauth_window_seconds}
              onChange={(e) => updatePolicy({ reauth_window_seconds: Number(e.target.value) })}
              className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none cursor-pointer shrink-0"
            >
              {REAUTH_OPTIONS.map((o) => (
                <option key={o.seconds} value={o.seconds}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* idle timeout */}
          <div className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm text-zinc-200">Idle timeout</div>
              <div className="text-[11px] text-zinc-600">
                End a session after inactivity (AAL3 requires ≤15 minutes).
              </div>
            </div>
            <select
              value={policy.idle_timeout_seconds}
              onChange={(e) => updatePolicy({ idle_timeout_seconds: Number(e.target.value) })}
              className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none cursor-pointer shrink-0"
            >
              {IDLE_OPTIONS.map((o) => (
                <option key={o.seconds} value={o.seconds}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* lockout (read-only) */}
          <div className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm text-zinc-200">Brute-force protection</div>
              <div className="text-[11px] text-zinc-600">
                Soft lock with increasing delay; ≤100 failed attempts/hour/account (OWASP V6).
                Reset never locks an account.
              </div>
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded shrink-0 flex items-center gap-1 ${
                policy.lockout_enforced
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-zinc-700 text-zinc-400"
              }`}
            >
              {policy.lockout_enforced ? <ShieldCheck size={11} /> : <AlertCircle size={11} />}
              {policy.lockout_enforced ? "enforced" : "off"}
            </span>
          </div>
        </div>
      ) : (
        !loading && (
          <div className="text-xs text-zinc-600">Authentication policy is unavailable.</div>
        )
      )}

      <p className="text-[11px] text-zinc-600 mt-3">
        Agents don&apos;t have sessions — they authenticate per request with an API key. Manage
        those under Access Control and NHI Access Review.
      </p>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke this session?"
        description="The device using this session will be signed out immediately."
        confirmText="Revoke"
        destructive
        onConfirm={() => revokeTarget && handleRevoke(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
      />
      <ConfirmDialog
        open={revokeAllOpen}
        title="Revoke all other sessions?"
        description="Every session except this one will be signed out immediately."
        confirmText="Revoke all others"
        destructive
        onConfirm={handleRevokeAll}
        onClose={() => setRevokeAllOpen(false)}
      />
    </div>
  );
}
