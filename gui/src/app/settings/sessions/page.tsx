"use client";

/**
 * /settings/sessions — "Sessions & Security".
 * Ported from docs/gui-drafts/pages/sessions.html. NIST 800-63B §7 session mgmt.
 *
 * Authed page (renders inside the sidebar shell). Lists the principal's active
 * browser sessions with per-session revoke and a "sign out all other sessions"
 * action (DEFERRED-061). Cookie-based via the typed `authApi`.
 *
 * Records its nav line for reconcile (§2.3): Settings group →
 *   { href: "/settings/sessions", label: "Sessions & Security" }
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { PageHeader, Breadcrumb, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { authApi, type SessionInfo } from "@/lib/authApi";

/** Derive a friendly device label from the raw user-agent (the backend stores
 *  the UA verbatim; there is no server-rendered device label). */
function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const u = ua.toLowerCase();
  let os = "";
  if (u.includes("windows")) os = "Windows";
  else if (u.includes("mac os") || u.includes("macintosh")) os = "macOS";
  else if (u.includes("iphone")) os = "iPhone";
  else if (u.includes("android")) os = "Android";
  else if (u.includes("linux")) os = "Linux";
  let browser = "";
  if (u.includes("edg/")) browser = "Edge";
  else if (u.includes("chrome/")) browser = "Chrome";
  else if (u.includes("firefox/")) browser = "Firefox";
  else if (u.includes("safari/") && !u.includes("chrome/")) browser = "Safari";
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || ua.slice(0, 40);
}

function deviceIcon(ua: string | null) {
  const l = (ua ?? "").toLowerCase();
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

export default function SessionsPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await authApi.listSessions();
      setSessions(s.sessions ?? []);
    } catch {
      setError("Couldn't load your active sessions.");
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

  // [DEFERRED-061] Sign out every other device — keep only the current session.
  const handleRevokeOthers = useCallback(async () => {
    try {
      const { revoked } = await authApi.revokeOtherSessions();
      setSessions((prev) => prev.filter((x) => x.current));
      toastRef.current("success", revoked > 0 ? `Signed out ${revoked} other session${revoked === 1 ? "" : "s"}` : "No other sessions");
    } catch {
      toastRef.current("error", "Couldn't sign out the other sessions");
    } finally {
      setRevokeOthersOpen(false);
    }
  }, []);

  const otherCount = sessions.filter((s) => !s.current).length;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full">
      <PageHeader
        title="Sessions & Security"
        subtitle="Active browser sessions for your principal."
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Settings", href: "/settings" }, { label: "Sessions & Security" }]}
          />
        }
      />

      {/* Active sessions */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-200">Active sessions</h2>
        {otherCount > 0 && (
          <button
            onClick={() => setRevokeOthersOpen(true)}
            className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
          >
            Sign out other sessions ({otherCount})
          </button>
        )}
      </div>
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
            const tone = s.current ? "border-emerald-500/20" : "border-zinc-800";
            const label = deviceLabel(s.user_agent);
            return (
              <div key={s.session_id} className={`bg-zinc-900 border ${tone} rounded-lg p-4`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                      {deviceIcon(s.user_agent)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-zinc-200">{label}</span>
                        {s.current && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                            this device
                          </span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                          AAL{s.aal}
                          {s.aal >= 2 ? " · MFA" : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-zinc-600 flex-wrap">
                        {s.ip && <span>{s.ip}</span>}
                        <span>Signed in {relativeTime(s.created_at)}</span>
                        {s.last_seen && <span>Active {relativeTime(s.last_seen)}</span>}
                        {s.expires_at && <span>Expires {relativeTime(s.expires_at)}</span>}
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
        open={revokeOthersOpen}
        title="Sign out all other sessions?"
        description="Every device except this one will be signed out immediately. This can't be undone."
        confirmText="Sign out others"
        destructive
        onConfirm={handleRevokeOthers}
        onClose={() => setRevokeOthersOpen(false)}
      />
    </div>
  );
}
