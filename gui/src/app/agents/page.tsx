"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { relTime } from "@/lib/rel-time";
import { Breadcrumb, StatCard, Button } from "@/components/ui";
import { StatCardSkeleton } from "@/components/ui/loading-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { Plus, Shield, Edit3, Search, Ban, Check, X } from "lucide-react";

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
  const { projectId } = useProject();
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
      const [logRes, statsRes] = await Promise.all([
        api.listAuditLog({
          project_id: projectId,
          limit: pageSize,
          offset: (page - 1) * pageSize,
          action_type: tab || undefined,
          days: days || undefined,
        }),
        api.getAuditStats({ project_id: projectId }),
      ]);
      setItems(logRes.items ?? []);
      setTotalCount(logRes.total_count ?? 0);
      setStats(statsRes);
    } catch {
      toastRef.current("error", "Failed to load audit data");
    } finally {
      setInitialLoad(false);
    }
  }, [projectId, tab, days, page]);

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
