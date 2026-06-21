"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  governanceApi,
  type PrincipalSummary,
  type PrincipalDetail,
  type PrincipalKind,
  type PrincipalStatus,
} from "@/lib/governanceApi";
import { Breadcrumb, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { relTime } from "@/lib/rel-time";
import {
  Plus,
  X,
  ShieldCheck,
  ShieldAlert,
  Home,
  Bot,
  User,
} from "lucide-react";

const KIND_TABS = [
  { key: "all", label: "All" },
  { key: "human", label: "Humans" },
  { key: "agent", label: "Agents" },
  { key: "system", label: "System" },
] as const;

const kindBadge: Record<PrincipalKind, string> = {
  human: "bg-sky-500/10 text-sky-400",
  agent: "bg-violet-500/10 text-violet-400",
  system: "bg-zinc-700 text-zinc-300",
};

const statusBadge: Record<PrincipalStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-400",
  suspended: "bg-amber-500/10 text-amber-400",
  retired: "bg-zinc-700 text-zinc-400",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function KindIcon({ kind }: { kind: PrincipalKind }) {
  if (kind === "human") return <User size={16} className="text-sky-300" />;
  if (kind === "agent") return <Bot size={16} className="text-violet-300" />;
  return <Home size={16} className="text-zinc-400" />;
}

export default function IdentityPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [principals, setPrincipals] = useState<PrincipalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null);
  const [tab, setTab] = useState<(typeof KIND_TABS)[number]["key"]>("all");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PrincipalDetail | null>(null);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [regName, setRegName] = useState("");
  const [regKind, setRegKind] = useState<PrincipalKind>("agent");
  const [registering, setRegistering] = useState(false);

  const fetchPrincipals = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [pRes, meRes] = await Promise.all([
        governanceApi.listPrincipals(),
        governanceApi.me().catch(() => null),
      ]);
      setPrincipals(pRes.principals ?? []);
      setAuthEnabled(meRes?.auth_enabled ?? null);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrincipals();
  }, [fetchPrincipals]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    governanceApi
      .getPrincipal(selectedId)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selectedId]);

  const handleRegister = async () => {
    if (!regName.trim()) return;
    setRegistering(true);
    try {
      await governanceApi.createPrincipal({ kind: regKind, display_name: regName.trim() });
      toastRef.current("success", "Principal registered");
      setRegisterOpen(false);
      setRegName("");
      setRegKind("agent");
      fetchPrincipals();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Failed to register principal");
    } finally {
      setRegistering(false);
    }
  };

  const handleStatusChange = async (id: string, status: PrincipalStatus) => {
    try {
      await governanceApi.setPrincipalStatus(id, status);
      toastRef.current("success", `Principal set to ${status}`);
      fetchPrincipals();
      if (selectedId === id) {
        const d = await governanceApi.getPrincipal(id).catch(() => null);
        setDetail(d);
      }
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Status change failed");
    }
  };

  const root = principals.find((p) => p.is_root);
  const nonRoot = principals.filter((p) => !p.is_root);
  const filtered = tab === "all" ? nonRoot : nonRoot.filter((p) => p.kind === tab);

  const humans = principals.filter((p) => p.kind === "human").length;
  const agents = principals.filter((p) => p.kind === "agent").length;
  const inactive = principals.filter((p) => p.status !== "active").length;

  const controlsDisabled = authEnabled === false;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Governance" }, { label: "Identity" }]} />

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Identity</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Every actor that can touch the system — humans, agents, and system principals. Identity is
            authenticated, never asserted.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setRegisterOpen(true)}
          disabled={controlsDisabled}
          title={controlsDisabled ? "Enable enforcement to register principals" : undefined}
        >
          <Plus size={14} className="mr-1" /> Register Principal
        </Button>
      </div>

      {/* Posture banner */}
      {authEnabled === true && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 mb-5 flex items-center gap-3">
          <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-emerald-300 font-medium">Enforcement: ON</span>
            <span className="text-[11px] text-zinc-500 ml-2">
              Every request resolves a credential to a principal. Asserted{" "}
              <code className="text-zinc-400">actor_id</code> in payloads is rejected.
            </span>
          </div>
          <code className="text-[10px] font-mono text-zinc-600">MCP_AUTH_ENABLED=true</code>
        </div>
      )}
      {authEnabled === false && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 mb-5 flex items-center gap-3">
          <ShieldAlert size={16} className="text-amber-400 shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-amber-300 font-medium">Enforcement: OFF</span>
            <span className="text-[11px] text-zinc-500 ml-2">
              All callers resolve to the <span className="text-amber-300">root/dev</span> principal.
              Asserted <code className="text-zinc-400">actor_id</code> is honored (dev convenience).
              The directory still renders for setup, but status/grant controls are disabled. Do not
              expose this deployment to an untrusted network (DEFERRED-041).
            </span>
          </div>
          <code className="text-[10px] font-mono text-zinc-600">MCP_AUTH_ENABLED=false</code>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatBox value={principals.length} label="Principals" />
        <StatBox value={humans} label="Humans" tone="text-sky-400" />
        <StatBox value={agents} label="Agents" tone="text-violet-400" />
        <StatBox value={inactive} label="Suspended / Retired" tone="text-amber-400" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-zinc-800 pb-px">
        {KIND_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-xs font-medium transition-colors",
              tab === t.key
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {t.label}
          </button>
        ))}
        <span
          className="px-4 py-2 text-xs text-zinc-700 cursor-not-allowed flex items-center gap-1.5"
          title="DLF-growth track — not in the foundation"
        >
          Codices
          <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-600">later</span>
        </span>
      </div>

      {/* Root card */}
      {root && (
        <div className="bg-gradient-to-r from-amber-500/[0.07] to-zinc-900 border border-amber-500/30 rounded-lg p-4 mb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                <Home size={16} className="text-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-semibold text-amber-100">{root.display_name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">
                    root · axiomatic
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                    system
                  </span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded", statusBadge[root.status])}>
                    {root.status}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mb-1.5">
                  Trust anchor for this deployment. Set <span className="text-zinc-300">out-of-band</span>{" "}
                  at install by the <code className="text-[11px] text-zinc-400">DATABASE_URL</code> holder.
                  The root cannot be granted, suspended, or re-authorized from inside the system.
                </p>
                <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                  <code className="font-mono text-zinc-600 bg-zinc-950 px-1.5 py-0.5 rounded">
                    {root.principal_id}
                  </code>
                  <span>Configured at install</span>
                </div>
              </div>
            </div>
            <span className="text-[10px] text-zinc-600 italic shrink-0">not editable</span>
          </div>
        </div>
      )}

      {/* Directory */}
      {loadError ? (
        <div className="py-12 text-center text-xs text-zinc-600">
          Could not load principals. The governance API may not be available yet.
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-xs text-zinc-600">Loading principals…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-zinc-400 mb-1">No principals yet</p>
          <p className="text-xs text-zinc-600 mb-4">
            Register the first human or agent principal to begin delegating authority from root.
          </p>
          {!controlsDisabled && (
            <Button size="sm" onClick={() => setRegisterOpen(true)}>
              <Plus size={14} className="mr-1" /> Register Principal
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((p) => {
            const isRetired = p.status === "retired";
            const isSuspended = p.status === "suspended";
            return (
              <div
                key={p.principal_id}
                onClick={() => !isRetired && setSelectedId(p.principal_id)}
                className={cn(
                  "bg-zinc-900 border rounded-lg p-4 transition-colors",
                  isSuspended ? "border-amber-500/20" : "border-zinc-800",
                  isRetired ? "opacity-60" : "hover:border-zinc-700 cursor-pointer",
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-full border flex items-center justify-center shrink-0 text-xs font-bold",
                        p.kind === "human"
                          ? "bg-sky-500/10 border-sky-500/20 text-sky-300"
                          : p.kind === "agent"
                            ? "bg-violet-500/10 border-violet-500/20"
                            : "bg-zinc-800 border-zinc-700",
                      )}
                    >
                      {p.kind === "human" ? initials(p.display_name) : <KindIcon kind={p.kind} />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span
                          className={cn(
                            "text-sm font-medium",
                            isRetired ? "text-zinc-400 line-through" : "text-zinc-200",
                          )}
                        >
                          {p.display_name}
                        </span>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded", kindBadge[p.kind])}>
                          {p.kind}
                        </span>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded", statusBadge[p.status])}>
                          {p.status}
                        </span>
                      </div>
                      {isSuspended && (
                        <p className="text-[11px] text-amber-300/80 mt-1">
                          All authorize() checks deny while suspended — reason{" "}
                          <code className="text-amber-300">PRINCIPAL_INACTIVE</code>. Grants are retained.
                        </p>
                      )}
                      <div className="flex items-center gap-3 text-[10px] text-zinc-600 mt-1.5">
                        <code className="font-mono text-zinc-600 bg-zinc-950 px-1.5 py-0.5 rounded">
                          {p.principal_id}
                        </code>
                        {p.key_count !== undefined && <span>{p.key_count} keys</span>}
                        {p.grant_count !== undefined && <span>{p.grant_count} grants</span>}
                        {p.last_seen_at && <span>Last seen {relTime(p.last_seen_at)}</span>}
                      </div>
                    </div>
                  </div>
                  {!isRetired && (
                    <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {isSuspended ? (
                        <button
                          disabled={controlsDisabled}
                          onClick={() => handleStatusChange(p.principal_id, "active")}
                          className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors disabled:opacity-40"
                        >
                          Reinstate
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail slide-over */}
      {selectedId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setSelectedId(null)}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-[26rem] bg-zinc-900 border-l border-zinc-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-100">Principal Detail</h3>
              <button
                onClick={() => setSelectedId(null)}
                aria-label="Close"
                className="text-zinc-500 hover:text-zinc-300 p-1"
              >
                <X size={16} />
              </button>
            </div>
            {detail ? (
              <div className="flex-1 overflow-y-auto p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full border flex items-center justify-center",
                      detail.kind === "human"
                        ? "bg-sky-500/10 border-sky-500/20"
                        : detail.kind === "agent"
                          ? "bg-violet-500/10 border-violet-500/20"
                          : "bg-zinc-800 border-zinc-700",
                    )}
                  >
                    <KindIcon kind={detail.kind} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-zinc-100">{detail.display_name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded", kindBadge[detail.kind])}>
                        {detail.kind}
                      </span>
                      <span
                        className={cn("text-[10px] px-1.5 py-0.5 rounded", statusBadge[detail.status])}
                      >
                        {detail.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 mb-4">
                  <p className="text-[10px] text-zinc-600 mb-0.5">Principal ID (opaque, un-spoofable)</p>
                  <code className="text-xs font-mono text-zinc-300 select-all break-all">
                    {detail.principal_id}
                  </code>
                </div>

                {/* Bound credentials (G7: mixed session + api_key) */}
                <p className="text-[10px] uppercase tracking-wide text-zinc-600 mb-2">
                  Bound credentials ({detail.credentials?.length ?? 0})
                </p>
                <div className="space-y-2 mb-4">
                  {(detail.credentials ?? []).length === 0 ? (
                    <p className="text-[11px] text-zinc-600">No credentials bound.</p>
                  ) : (
                    detail.credentials.map((c) => (
                      <div
                        key={c.credential_id}
                        className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-zinc-300 truncate">
                              {c.name ?? (c.credential_type === "session" ? "Browser session" : "API key")}
                            </span>
                            <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500">
                              {c.credential_type}
                            </span>
                          </div>
                          {c.key_prefix && (
                            <code className="text-[10px] font-mono text-zinc-600">{c.key_prefix}</code>
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded shrink-0",
                            c.status === "active"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-red-500/10 text-red-400",
                          )}
                        >
                          {c.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Grants summary */}
                <p className="text-[10px] uppercase tracking-wide text-zinc-600 mb-2">
                  Grants ({detail.grants?.length ?? 0})
                </p>
                <div className="space-y-2 mb-4">
                  {(detail.grants ?? []).length === 0 ? (
                    <p className="text-[11px] text-zinc-600">No grants.</p>
                  ) : (
                    detail.grants.map((g) => (
                      <div
                        key={g.grant_id}
                        className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2"
                      >
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                          {g.capability}
                        </span>
                        <span className="text-xs text-zinc-400">@</span>
                        <span className="text-xs text-zinc-300 truncate">
                          {g.scope_type}
                          {g.scope_id ? `:${g.scope_id}` : ""}
                        </span>
                        <span className="text-[10px] text-zinc-600 ml-auto shrink-0">
                          by {g.granted_by_display_name ?? "—"}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Status control */}
                {!detail.is_root && (
                  <div className="space-y-2 border-t border-zinc-800 pt-3">
                    <div className="flex items-center justify-between py-1.5">
                      <div>
                        <div className="text-xs text-zinc-300">Status</div>
                        <div className="text-[10px] text-zinc-600">suspended ⇒ every check denies</div>
                      </div>
                      <select
                        value={detail.status}
                        disabled={controlsDisabled}
                        onChange={(e) =>
                          handleStatusChange(detail.principal_id, e.target.value as PrincipalStatus)
                        }
                        className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none appearance-none cursor-pointer disabled:opacity-40"
                      >
                        <option value="active">active</option>
                        <option value="suspended">suspended</option>
                        <option value="retired">retired</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-zinc-600">Loading principal…</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Register modal */}
      {registerOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setRegisterOpen(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="reg-title"
              className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-center justify-between">
                <h2 id="reg-title" className="text-base font-semibold text-zinc-100">
                  Register Principal
                </h2>
                <button
                  onClick={() => setRegisterOpen(false)}
                  aria-label="Close"
                  className="text-zinc-500 hover:text-zinc-300 p-1"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">
                    Display name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="e.g. ci-indexer"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Kind</label>
                  <select
                    value={regKind}
                    onChange={(e) => setRegKind(e.target.value as PrincipalKind)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600"
                  >
                    <option value="agent">agent</option>
                    <option value="human">human</option>
                  </select>
                  <p className="text-[10px] text-zinc-600 mt-1.5">
                    Humans normally arrive via invite (F-AUTH). Use this for agent / service principals.
                  </p>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-2">
                <button
                  onClick={() => setRegisterOpen(false)}
                  className="px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-400"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRegister}
                  disabled={registering || !regName.trim()}
                  className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-white font-medium"
                >
                  {registering ? "Registering…" : "Register"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ value, label, tone }: { value: number | string; label: string; tone?: string }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
      <p className={cn("text-2xl font-semibold", tone ?? "text-zinc-100")}>{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}
