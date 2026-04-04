"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Breadcrumb, PageHeader, Badge, Button, StatCard, TableSkeleton } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { relTime } from "@/lib/rel-time";
import { TrendingUp, BookOpen, CheckCircle2, AlertTriangle, Archive } from "lucide-react";

type TimeRange = "7" | "30" | "90" | "all";

export default function AnalyticsPage() {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [days, setDays] = useState<TimeRange>("30");
  const [stats, setStats] = useState<any>(null);
  const [stale, setStale] = useState<any[]>([]);
  const [dead, setDead] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const daysNum = days === "all" ? undefined : Number(days);
      const [retrieval, staleRes, deadRes] = await Promise.all([
        api.getRetrievalStats({ project_id: projectId, days: daysNum }),
        api.getStaleStats({ project_id: projectId, days: 90 }),
        api.getDeadKnowledge({ project_id: projectId }),
      ]);
      setStats(retrieval);
      setStale(staleRes.lessons ?? staleRes.items ?? []);
      setDead(deadRes.lessons ?? deadRes.items ?? []);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [projectId, days, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalRetrievals = stats?.total_retrievals ?? 0;
  const activeLessons = stats?.active_lessons ?? 0;
  const approvalRate = stats?.approval_rate ?? 0;
  const staleLessonsCount = stale.length;
  const topLessons = stats?.top_lessons ?? [];
  const typeBreakdown = stats?.type_breakdown ?? {};
  const agentActivity = stats?.agent_activity ?? [];

  const typeColors: Record<string, string> = {
    decision: "bg-blue-500", workaround: "bg-amber-500", guardrail: "bg-red-500", preference: "bg-purple-500", general_note: "bg-zinc-500",
  };

  const TIME_TABS: { label: string; value: TimeRange }[] = [
    { label: "7d", value: "7" }, { label: "30d", value: "30" }, { label: "90d", value: "90" }, { label: "All", value: "all" },
  ];

  return (
    <div className="p-6 max-w-[1100px]">
      <Breadcrumb items={[{ label: "System", href: "/jobs" }, { label: "Analytics" }]} />
      <PageHeader
        title="Knowledge Analytics"
        subtitle="Track knowledge usage, quality, and trends"
        actions={
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            {TIME_TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setDays(t.value)}
                className={`px-3 py-1.5 text-xs transition-colors ${days === t.value ? "bg-zinc-700 text-zinc-200 font-medium" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      {loading ? (
        <TableSkeleton rows={8} />
      ) : (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <p className="text-2xl font-semibold text-zinc-100">{totalRetrievals}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Total Retrievals</p>
              <div className="flex items-center gap-1 mt-2">
                <TrendingUp size={12} className="text-emerald-400" />
                <span className="text-[10px] text-emerald-400">Active</span>
              </div>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <p className="text-2xl font-semibold text-zinc-100">{activeLessons}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Active Lessons</p>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <p className="text-2xl font-semibold text-zinc-100">{approvalRate}%</p>
              <p className="text-xs text-zinc-500 mt-0.5">Approval Rate</p>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <p className="text-2xl font-semibold text-amber-400">{staleLessonsCount}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Stale Lessons</p>
              <div className="flex items-center gap-1 mt-2">
                <AlertTriangle size={12} className="text-amber-400" />
                <span className="text-[10px] text-amber-400">&gt;90 days unreviewed</span>
              </div>
            </div>
          </div>

          {/* Charts: Lessons by Type (donut) */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Lessons by Type */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <h2 className="text-sm font-medium text-zinc-300 mb-4">Lessons by Type</h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {Object.entries(typeBreakdown).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-2 text-xs">
                    <span className={`w-2.5 h-2.5 rounded-sm ${typeColors[type] ?? "bg-zinc-500"}`} />
                    <span className="text-zinc-400">{type}</span>
                    <span className="ml-auto text-zinc-300 font-medium">{count as number}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Most retrieved */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <h2 className="text-sm font-medium text-zinc-300 mb-3">Most Retrieved Lessons</h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500">
                    <th className="text-left py-2 font-medium w-8">#</th>
                    <th className="text-left py-2 font-medium">Title</th>
                    <th className="text-left py-2 font-medium w-20">Type</th>
                    <th className="text-right py-2 font-medium w-16">Count</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {topLessons.slice(0, 5).map((l: any, i: number) => (
                    <tr key={l.lesson_id ?? i} className="border-b border-zinc-800/50">
                      <td className="py-2.5 text-zinc-500">{i + 1}</td>
                      <td className="py-2.5 font-medium truncate max-w-[200px]">{l.title}</td>
                      <td className="py-2.5"><Badge value={l.lesson_type} variant="type" /></td>
                      <td className="py-2.5 text-right text-zinc-400">{l.retrieval_count ?? 0}</td>
                    </tr>
                  ))}
                  {topLessons.length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-center text-zinc-600">No data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Dead Knowledge */}
          {dead.length > 0 && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 mb-6">
              <h2 className="text-sm font-medium text-amber-400 mb-3 flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400" />
                Dead Knowledge — Never Retrieved
              </h2>
              <div className="space-y-2">
                {dead.map((l: any) => (
                  <div key={l.lesson_id} className="flex items-center justify-between py-2 px-3 bg-zinc-900/60 rounded-md">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-300 font-medium">{l.title}</span>
                      <Badge value={l.lesson_type} variant="type" />
                      <span className="text-[10px] text-zinc-600">Created {relTime(l.created_at)}</span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={async () => {
                          try {
                            await api.updateLessonStatus(l.lesson_id, { project_id: projectId, status: "archived" });
                            toast("success", "Lesson archived");
                            fetchData();
                          } catch {}
                        }}
                        className="px-2 py-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400 transition-colors"
                      >
                        Archive
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agent Activity */}
          {agentActivity.length > 0 && (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <h2 className="text-sm font-medium text-zinc-300 mb-3">Agent Activity</h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500">
                    <th className="text-left py-2 font-medium">Agent</th>
                    <th className="text-right py-2 font-medium">Created</th>
                    <th className="text-right py-2 font-medium">Approved</th>
                    <th className="text-right py-2 font-medium">Rejected</th>
                    <th className="text-left py-2 font-medium pl-4 w-32">Approval Rate</th>
                    <th className="text-right py-2 font-medium">Last Active</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {agentActivity.map((a: any) => {
                    const rate = a.created > 0 ? Math.round((a.approved / a.created) * 100) : 0;
                    return (
                      <tr key={a.agent} className="border-b border-zinc-800/50">
                        <td className="py-2.5">{a.agent}</td>
                        <td className="py-2.5 text-right">{a.created}</td>
                        <td className="py-2.5 text-right text-emerald-400">{a.approved}</td>
                        <td className="py-2.5 text-right text-red-400">{a.rejected}</td>
                        <td className="py-2.5 pl-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${rate}%` }} />
                            </div>
                            <span className="text-zinc-400 text-[10px] w-8 text-right">{rate}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right text-zinc-500">{a.last_active ? relTime(a.last_active) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
