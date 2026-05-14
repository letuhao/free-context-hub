"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api, type LeaseSummary } from "@/lib/api";
import { relTime } from "@/lib/rel-time";
import { Breadcrumb, StatCard, Button } from "@/components/ui";
import { StatCardSkeleton } from "@/components/ui/loading-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { ProjectBadge } from "@/components/project-badge";
import { Plus, Shield, Edit3, Search, Ban, Check, X, AlertTriangle, RefreshCw } from "lucide-react";

interface AuditEntry {
  id: string;
  action_type: string;
  agent_id: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  pass: boolean | null;
  created_at: string;
}

interface AuditStats {
  total_actions: number;
  guardrail_checks: number;
  blocked_count: number;
  lesson_creates: number;
  active_agents: number;
  approval_rate: number;
}

const ACTION_ICONS: Record<string, { icon: typeof Plus; colorClass: string }> = {
  "lesson.created": { icon: Plus, colorClass: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" },
  "lesson.updated": { icon: Edit3, colorClass: "bg-amber-500/10 border-amber-500/20 text-amber-400" },
  "guardrail.check": { icon: Shield, colorClass: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
  "guardrail.blocked": { icon: Ban, colorClass: "bg-red-500/10 border-red-500/20 text-red-400" },
};

const TABS = [
  { key: "", label: "All Actions" },
  { key: "lesson", label: "Lesson Changes" },
  { key: "guardrail", label: "Guardrail Checks" },
] as const;

const TIME_RANGES = [
  { label: "Last 24h", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "All time", days: 0 },
] as const;

export default function AgentAuditPage() {
  const { projectId, isAllProjects, effectiveProjectIds, projectsLoaded } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [items, setItems] = useState<AuditEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);

  const [tab, setTab] = useState("");
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);
  const pageSize = 12;

  // Agent detail slide-over
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<any>(null);

  const fetchData = useCallback(async () => {
    try {
      const useMulti = isAllProjects && projectsLoaded && effectiveProjectIds.length > 0;
      const [logRes, statsRes] = await Promise.all([
        useMulti
          ? api.listAuditLogMulti({
              project_ids: effectiveProjectIds,
              limit: pageSize,
              offset: (page - 1) * pageSize,
              days: days || undefined,
            })
          : api.listAuditLog({
              project_id: projectId,
              limit: pageSize,
              offset: (page - 1) * pageSize,
              action_type: tab || undefined,
              days: days || undefined,
            }),
        useMulti
          ? api.getAuditStatsMulti({ project_ids: effectiveProjectIds })
          : api.getAuditStats({ project_id: projectId }),
      ]);
      setItems(logRes.items ?? []);
      setTotalCount(logRes.total_count ?? 0);
      setStats(statsRes);
    } catch {
      toastRef.current("error", "Failed to load audit data");
    } finally {
      setInitialLoad(false);
    }
  }, [projectId, tab, days, page, isAllProjects, effectiveProjectIds, projectsLoaded]);

  useEffect(() => { setInitialLoad(true); fetchData(); }, [fetchData]);

  // Fetch agent detail
  useEffect(() => {
    if (!selectedAgent) { setAgentDetail(null); return; }
    api.getAgent(selectedAgent, { project_id: projectId })
      .then(setAgentDetail)
      .catch(() => setAgentDetail(null));
  }, [selectedAgent, projectId]);

  const handleTrustUpdate = async (trustLevel: string) => {
    if (!selectedAgent) return;
    try {
      await api.updateAgent(selectedAgent, { project_id: projectId, trust_level: trustLevel });
      toastRef.current("success", `Trust level updated to ${trustLevel}`);
      // Refresh
      const detail = await api.getAgent(selectedAgent, { project_id: projectId });
      setAgentDetail(detail);
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleAutoApproveToggle = async () => {
    if (!selectedAgent || !agentDetail) return;
    try {
      await api.updateAgent(selectedAgent, {
        project_id: projectId,
        auto_approve: !agentDetail.auto_approve,
      });
      const detail = await api.getAgent(selectedAgent, { project_id: projectId });
      setAgentDetail(detail);
      toastRef.current("success", `Auto-approve ${detail.auto_approve ? "enabled" : "disabled"}`);
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Update failed");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "System" }, { label: "Agent Audit" }]} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1"><ProjectBadge /></div>
          <h1 className="text-lg font-semibold text-zinc-100">Agent Audit Trail</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Track agent actions, guardrail checks, and lesson modifications</p>
        </div>
        <select
          value={days}
          onChange={(e) => { setDays(Number(e.target.value)); setPage(1); }}
          className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none appearance-none cursor-pointer"
        >
          {TIME_RANGES.map((r) => (
            <option key={r.days} value={r.days}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* Stats */}
      {initialLoad ? (
        <StatCardSkeleton count={4} />
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard value={stats.total_actions} label="Total Actions" />
          <StatCard value={`${stats.approval_rate}%`} label="Approval Rate" />
          <StatCard value={stats.blocked_count} label="Blocked" />
          <StatCard value={stats.active_agents} label="Active Agents" />
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-zinc-800 pb-px">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setPage(1); }}
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
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        {items.length === 0 && !initialLoad && (
          <div className="py-12 text-center text-xs text-zinc-600">No audit entries found for this time range.</div>
        )}
        {items.map((entry) => {
          const config = ACTION_ICONS[entry.action_type] ?? ACTION_ICONS["guardrail.check"];
          const Icon = config.icon;
          const isBlocked = entry.action_type === "guardrail.blocked";
          const actionContext = entry.details as Record<string, unknown> | null;

          return (
            <div
              key={entry.id}
              className={cn(
                "bg-zinc-900 border rounded-lg p-4",
                isBlocked ? "border-red-500/20" : "border-zinc-800",
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn("w-8 h-8 rounded-full border flex items-center justify-center shrink-0 mt-0.5", config.colorClass)}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {entry.agent_id && (
                      <button
                        onClick={() => setSelectedAgent(entry.agent_id)}
                        className="text-xs font-medium text-zinc-200 hover:text-blue-400 transition-colors"
                      >
                        {entry.agent_id}
                      </button>
                    )}
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded",
                      isBlocked ? "bg-red-500/10 text-red-400" : entry.action_type.startsWith("lesson")
                        ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400",
                    )}>
                      {entry.action_type}
                    </span>
                    {entry.pass === true && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">passed</span>
                    )}
                    {entry.pass === false && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">blocked</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">{entry.summary}</p>
                  {isBlocked && !!actionContext?.action && (
                    <div className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 mt-2">
                      <p className="text-[10px] text-zinc-500 mb-1">Action attempted:</p>
                      <p className="text-xs text-amber-400">{String(actionContext.action)}</p>
                    </div>
                  )}
                  <div className="text-[10px] text-zinc-600 mt-1">
                    {relTime(entry.created_at)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalCount > pageSize && (
        <div className="mt-6">
          <Pagination
            page={page}
            pageSize={pageSize}
            totalPages={Math.ceil(totalCount / pageSize)}
            totalCount={totalCount}
            onPageChange={setPage}
          />
        </div>
      )}

      {/* Phase 13 Sprint 13.2 — Active Work panel (artifact leases) */}
      <div className="mt-12 border-t border-zinc-800 pt-8">
        <ActiveWorkPanel />
      </div>

      {/* Agent Detail Slide-over */}
      {selectedAgent && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedAgent(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-96 bg-zinc-900 border-l border-zinc-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-100">Agent Details</h3>
              <button onClick={() => setSelectedAgent(null)} aria-label="Close" className="text-zinc-500 hover:text-zinc-300 p-1">
                <X size={16} />
              </button>
            </div>

            {agentDetail ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Agent header */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-sm font-bold text-white">
                    {selectedAgent.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">{selectedAgent}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                        {agentDetail.trust_level ?? "new"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-center">
                    <p className="text-lg font-semibold text-zinc-100">{agentDetail.lessons_created ?? 0}</p>
                    <p className="text-[10px] text-zinc-600">Lessons</p>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-center">
                    <p className="text-lg font-semibold text-emerald-400">{agentDetail.approval_rate ?? 0}%</p>
                    <p className="text-[10px] text-zinc-600">Approved</p>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-center">
                    <p className="text-lg font-semibold text-zinc-100">{agentDetail.auto_approve ? "Yes" : "No"}</p>
                    <p className="text-[10px] text-zinc-600">Auto</p>
                  </div>
                </div>

                {/* Trust level */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-xs text-zinc-300">Trust Level</div>
                      <div className="text-[10px] text-zinc-600">Controls review requirements</div>
                    </div>
                    <select
                      value={agentDetail.trust_level ?? "new"}
                      onChange={(e) => handleTrustUpdate(e.target.value)}
                      className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none appearance-none cursor-pointer"
                    >
                      <option value="new">new</option>
                      <option value="standard">standard</option>
                      <option value="trusted">trusted</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-xs text-zinc-300">Auto-approve</div>
                      <div className="text-[10px] text-zinc-600">Skip review for this agent&apos;s lessons</div>
                    </div>
                    <button
                      onClick={handleAutoApproveToggle}
                      className={cn(
                        "w-9 h-5 rounded-full relative transition-colors shrink-0",
                        agentDetail.auto_approve ? "bg-blue-600" : "bg-zinc-700",
                      )}
                      aria-label={`${agentDetail.auto_approve ? "Disable" : "Enable"} auto-approve`}
                    >
                      <span className={cn(
                        "absolute top-[3px] w-[14px] h-[14px] rounded-full transition-all shadow-sm",
                        agentDetail.auto_approve ? "left-[19px] bg-white" : "left-[3px] bg-zinc-400",
                      )} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-zinc-600">Loading agent details...</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Phase 13 Sprint 13.2 — Active Work panel
// ──────────────────────────────────────────────────────────────────────────
// Lists currently-active artifact leases. Auto-refreshes every 10s when the
// tab is visible. Force-release column visibility is gated on role+scope:
//   - role must be 'admin'
//   - scope must be either null (global) or match the row's project_id
// An auth-disabled banner surfaces production-misconfiguration risk per
// Sprint 13.2 design v4 §8 (post-Adversary r3 BLOCK 1).
// ──────────────────────────────────────────────────────────────────────────

interface LeaseRow extends LeaseSummary {
  _project_id: string;
}

function ActiveWorkPanel() {
  const { projectId, isAllProjects, effectiveProjectIds, projectsLoaded } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [claims, setClaims] = useState<LeaseRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmRelease, setConfirmRelease] = useState<{ leaseId: string; projectId: string; artifactId: string } | null>(null);

  // Identity context (loaded once on mount)
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [currentScope, setCurrentScope] = useState<string | null>(null);
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null);
  // post-audit R3 fix: keySource was dropped from v4 impl — restore it so
  // env_token mode is observable in the GUI banner.
  const [keySource, setKeySource] = useState<string | null>(null);

  // Ticker for live countdown of seconds_remaining
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch identity once on mount
  useEffect(() => {
    api
      .getCurrentUser()
      .then((me) => {
        setCurrentRole(me.role ?? null);
        setCurrentScope(me.project_scope ?? null);
        setAuthEnabled(me.auth_enabled ?? null);
        setKeySource(me.key_source ?? null);
      })
      .catch(() => {
        setCurrentRole(null);
        setCurrentScope(null);
        setAuthEnabled(null);
        setKeySource(null);
      });
  }, []);

  // post-audit R1 fix: header presence now only checks role. Per-row decides
  // button vs em-dash based on row's project vs caller's scope. This restores
  // the v4 design narrative (line 928) — scoped admin in "All Projects" mode
  // sees a MIXED table: force-release for in-scope rows, em-dash for others.
  const canForceReleaseRow = useCallback(
    (rowProjectId: string) =>
      currentRole === "admin" && (currentScope === null || currentScope === rowProjectId),
    [currentRole, currentScope],
  );
  const headerShowsForceRelease = currentRole === "admin";

  const fetchClaims = useCallback(async () => {
    if (!projectsLoaded) return;
    setLoading(true);
    try {
      if (isAllProjects && effectiveProjectIds.length > 0) {
        const results = await Promise.all(
          effectiveProjectIds.map((pid) =>
            api
              .listActiveLeases(pid)
              .then((r) => ({ pid, claims: r.claims ?? [] }))
              .catch(() => ({ pid, claims: [] as LeaseSummary[] })),
          ),
        );
        const rows: LeaseRow[] = results.flatMap(({ pid, claims }) =>
          claims.map((c) => ({ ...c, _project_id: pid })),
        );
        setClaims(rows);
      } else if (projectId) {
        const r = await api.listActiveLeases(projectId);
        setClaims((r.claims ?? []).map((c) => ({ ...c, _project_id: projectId })));
      } else {
        setClaims([]);
      }
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, [projectId, isAllProjects, effectiveProjectIds, projectsLoaded]);

  // 10s auto-refresh, paused when tab is hidden
  useEffect(() => {
    fetchClaims();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchClaims();
    }, 10_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchClaims();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchClaims]);

  const handleForceRelease = async (leaseId: string, projectIdForLease: string) => {
    try {
      await api.forceReleaseLease(projectIdForLease, leaseId);
      toastRef.current("success", "Lease force-released");
      await fetchClaims();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("403")) {
        toastRef.current("error", "Admin role required to force-release");
      } else {
        toastRef.current("error", "Force-release failed");
      }
    } finally {
      setConfirmRelease(null);
    }
  };

  const computeRemaining = (expiresAt: string): number => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.floor(ms / 1000));
  };

  const formatRemaining = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Active Work</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Artifact leases currently held by agents. Refreshes every 10 seconds.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] text-zinc-600">
              Updated {relTime(lastUpdated.toISOString())}
            </span>
          )}
          <button
            onClick={fetchClaims}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-zinc-300 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-50"
            aria-label="Refresh active work list"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* post-audit R3 fix: banner now distinguishes no_auth from env_token */}
      {authEnabled === false && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Authentication is disabled — all UI actions are unrestricted (dev mode). In production
            set <code className="font-mono text-[10px]">MCP_AUTH_ENABLED=true</code>.
          </span>
        </div>
      )}
      {authEnabled === true && keySource === "env_token" && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Connected via the shared env-var token (admin scope, no per-user audit). For better
            traceability, prefer DB-backed API keys with explicit roles.
          </span>
        </div>
      )}

      {claims.length === 0 ? (
        <div className="py-12 text-center text-xs text-zinc-600">
          No active work claims — agents are not currently claiming artifacts.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="min-w-full text-xs">
            <thead className="bg-zinc-900/50 text-zinc-500">
              <tr>
                {isAllProjects && (
                  <th className="px-3 py-2 text-left font-medium">Project</th>
                )}
                <th className="px-3 py-2 text-left font-medium">Artifact</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Agent</th>
                <th className="px-3 py-2 text-left font-medium">Task</th>
                <th className="px-3 py-2 text-left font-medium">Remaining</th>
                {headerShowsForceRelease && (
                  <th className="px-3 py-2 text-right font-medium">Action</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {claims.map((c) => {
                const remaining = computeRemaining(c.expires_at);
                const canRelease = canForceReleaseRow(c._project_id);
                return (
                  <tr key={c.lease_id} className="hover:bg-zinc-900/40">
                    {isAllProjects && (
                      <td className="px-3 py-2 text-zinc-400">{c._project_id}</td>
                    )}
                    <td className="px-3 py-2 font-mono text-zinc-200">{c.artifact_id}</td>
                    <td className="px-3 py-2 text-zinc-400">{c.artifact_type}</td>
                    <td className="px-3 py-2 text-zinc-300">{c.agent_id}</td>
                    <td className="px-3 py-2 text-zinc-400 max-w-md truncate" title={c.task_description}>
                      {c.task_description}
                    </td>
                    <td className={cn(
                      "px-3 py-2 font-mono",
                      remaining < 60 ? "text-amber-400" : "text-zinc-300",
                    )}>
                      {formatRemaining(remaining)}
                    </td>
                    {headerShowsForceRelease && (
                      <td className="px-3 py-2 text-right">
                        {canRelease ? (
                          <button
                            onClick={() => setConfirmRelease({ leaseId: c.lease_id, projectId: c._project_id, artifactId: c.artifact_id })}
                            className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          >
                            Force-release
                          </button>
                        ) : (
                          <span className="text-[10px] text-zinc-700">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm modal */}
      {confirmRelease && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmRelease(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-96 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-2">Force-release lease?</h3>
            <p className="text-xs text-zinc-400 mb-4">
              This will release the lease on <span className="font-mono text-zinc-200">{confirmRelease.artifactId}</span> regardless of which agent owns it. The agent currently holding it will not be notified.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmRelease(null)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={() => handleForceRelease(confirmRelease.leaseId, confirmRelease.projectId)}>
                Force-release
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
