"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { relTime } from "@/lib/rel-time";
import { Breadcrumb, Button, EmptyState, StatCard } from "@/components/ui";
import { StatCardSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getColorClasses, getInitials } from "@/lib/project-colors";
import { cn } from "@/lib/cn";
import Link from "next/link";
import {
  Settings, RefreshCw, Sparkles, GitBranch, Activity,
  Users, ChevronDown, Clock, FolderOpen,
} from "lucide-react";

interface Stats {
  lessons: number;
  guardrails: number;
  commits: number;
  docs: number;
}

export default function ProjectsPage() {
  const { projectId, projects } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const current = projects.find((p) => p.project_id === projectId);

  const [stats, setStats] = useState<Stats>({ lessons: 0, guardrails: 0, commits: 0, docs: 0 });
  const [summary, setSummary] = useState<{ summary?: string; generated_at?: string } | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Activity items (recent)
  const [recentActivity, setRecentActivity] = useState<Array<{ type: string; description: string; time: string }>>([]);

  // Groups
  const [groups, setGroups] = useState<Array<{ group_id: string; name: string; member_count?: number }>>([]);

  // Action loading states
  const [indexing, setIndexing] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [lessonsRes, commitsRes, docsRes, summaryRes] = await Promise.allSettled([
        api.listLessons({ project_id: projectId, limit: 1 }),
        api.listCommits({ project_id: projectId, limit: 1 }),
        api.listGeneratedDocs({ project_id: projectId, limit: 1 }),
        api.getProjectSummary(projectId),
      ]);

      const lessonCount = lessonsRes.status === "fulfilled" ? (lessonsRes.value.total_count ?? 0) : 0;
      const commitCount = commitsRes.status === "fulfilled" ? (commitsRes.value.total_count ?? 0) : 0;
      const docCount = docsRes.status === "fulfilled" ? (docsRes.value.total_count ?? 0) : 0;

      let guardrailCount = 0;
      try {
        const grRes = await api.listLessons({ project_id: projectId, lesson_type: "guardrail", limit: 1 });
        guardrailCount = grRes.total_count ?? 0;
      } catch { /* ignore */ }

      setStats({ lessons: lessonCount, guardrails: guardrailCount, commits: commitCount, docs: docCount });

      if (summaryRes.status === "fulfilled" && summaryRes.value) {
        setSummary(summaryRes.value);
      }
    } catch {
      toastRef.current("error", "Failed to load project data");
    } finally {
      setInitialLoad(false);
    }
  }, [projectId]);

  useEffect(() => { setInitialLoad(true); fetchAll(); }, [fetchAll]);
  useEffect(() => { const i = setInterval(fetchAll, 30_000); return () => clearInterval(i); }, [fetchAll]);

  // Fetch groups
  useEffect(() => {
    api.listGroupsForProject(projectId)
      .then((res) => setGroups(res.groups ?? []))
      .catch(() => {});
  }, [projectId]);

  // Actions
  const handleIndex = async () => {
    setIndexing(true);
    try { await api.indexProject(projectId); toastRef.current("success", "Re-index started"); fetchAll(); }
    catch (err) { toastRef.current("error", `Re-index failed: ${err instanceof Error ? err.message : "Unknown error"}`); }
    finally { setIndexing(false); }
  };

  const handleReflect = async () => {
    setReflecting(true);
    try { await api.reflectProject(projectId, { project_id: projectId }); toastRef.current("success", "Reflection started"); fetchAll(); }
    catch (err) { toastRef.current("error", `Reflect failed: ${err instanceof Error ? err.message : "Unknown error"}`); }
    finally { setReflecting(false); }
  };

  const handleIngestGit = async () => {
    setIngesting(true);
    try { await api.ingestGit({ project_id: projectId }); toastRef.current("success", "Git ingest started"); fetchAll(); }
    catch (err) { toastRef.current("error", `Git ingest failed: ${err instanceof Error ? err.message : "Unknown error"}`); }
    finally { setIngesting(false); }
  };

  const headerColor = getColorClasses(current?.color);
  const initials = getInitials(current?.name ?? projectId);

  return (
    <div className="p-6">
      <Breadcrumb items={[{ label: "Project", href: "/projects" }, { label: "Overview" }]} />

      {/* Project Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className={cn("w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-base font-bold text-white shadow-lg", headerColor.from, headerColor.to)}>
            {initials}
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">{current?.name ?? projectId}</h1>
            {current?.description && (
              <p className="text-xs text-zinc-500 mt-0.5">{current.description}</p>
            )}
            <div className="flex items-center gap-3 mt-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] text-zinc-600">
                <Clock size={12} strokeWidth={1.5} />
                {projectId}
              </span>
              {groups.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] text-zinc-600">
                  <Users size={12} strokeWidth={1.5} />
                  {groups.map((g) => g.name).join(", ")}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/projects/settings"
            className="px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors flex items-center gap-1.5"
          >
            <Settings size={14} />
            Settings
          </Link>
          <Button size="sm" onClick={handleIndex} disabled={indexing}>
            {indexing ? "Indexing..." : "Re-index"}
          </Button>
          <Button size="sm" onClick={handleReflect} disabled={reflecting}>
            {reflecting ? "Reflecting..." : "Reflect"}
          </Button>
          <Button size="sm" onClick={handleIngestGit} disabled={ingesting}>
            {ingesting ? "Ingesting..." : "Ingest Git"}
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      {initialLoad ? (
        <StatCardSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard value={stats.lessons} label="Lessons" />
          <StatCard value={stats.guardrails} label="Guardrails" />
          <StatCard value={stats.commits} label="Commits" />
          <StatCard value={stats.docs} label="Documents" />
        </div>
      )}

      {/* Quick Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Recent Activity */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Activity size={16} className="text-zinc-500" strokeWidth={1.5} />
            Recent Activity
          </h3>
          <div className="space-y-2">
            {stats.lessons > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-zinc-400 flex-1">{stats.lessons} lessons total</span>
              </div>
            )}
            {stats.docs > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="text-zinc-400 flex-1">{stats.docs} documents generated</span>
              </div>
            )}
            {stats.guardrails > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-zinc-400 flex-1">{stats.guardrails} guardrails active</span>
              </div>
            )}
          </div>
          <Link href="/activity" className="text-[10px] text-blue-400 hover:text-blue-300 mt-3 inline-block">
            View all activity &rarr;
          </Link>
        </div>

        {/* Groups */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Users size={16} className="text-zinc-500" strokeWidth={1.5} />
            Groups
          </h3>
          {groups.length > 0 ? (
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.group_id} className="flex items-center justify-between px-3 py-2 bg-zinc-800/40 border border-zinc-800 rounded-lg">
                  <div>
                    <div className="text-xs text-zinc-300">{g.name}</div>
                    {g.member_count !== undefined && (
                      <div className="text-[10px] text-zinc-600">{g.member_count} projects</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-600">Not a member of any groups.</p>
          )}
          <Link href="/projects/groups" className="text-[10px] text-blue-400 hover:text-blue-300 mt-3 inline-block">
            Manage groups &rarr;
          </Link>
        </div>
      </div>

      {/* Project Summary (collapsible) */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg">
        <button
          onClick={() => setSummaryOpen(!summaryOpen)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-medium text-zinc-300">Project Summary</span>
          <ChevronDown size={14} className={cn("text-zinc-600 transition-transform", summaryOpen && "rotate-180")} />
        </button>
        {summaryOpen && (
          <div className="px-4 pb-4">
            {summary?.summary ? (
              <div className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap bg-zinc-950 border border-zinc-800 rounded-lg p-4 max-h-60 overflow-y-auto">
                {summary.summary}
              </div>
            ) : (
              <EmptyState
                title="No summary yet"
                description="Click Reflect to generate a project summary."
              />
            )}
            {summary?.generated_at && (
              <p className="text-[10px] text-zinc-600 mt-2">
                Generated {relTime(summary.generated_at)}
              </p>
            )}
            <button
              onClick={handleReflect}
              disabled={reflecting}
              className="mt-2 px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5"
            >
              <RefreshCw size={12} />
              {reflecting ? "Refreshing..." : "Refresh Summary"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
