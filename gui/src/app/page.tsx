"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { relTime } from "@/lib/rel-time";
import { PageHeader, StatCard, Badge, Button } from "@/components/ui";
import { StatCardSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { BookOpen, GitCommit, FileText, Loader, Lightbulb, AlertTriangle, TrendingUp, FolderOpen, Shield, MessageSquare, Plus, CheckCircle2, Circle, Key, Cpu } from "lucide-react";
import { CreateProjectModal } from "@/components/create-project-modal";

type FeatureStatus = {
  enabled: boolean;
  model?: string | null;
  type?: string;
  backend?: string;
};

type SystemInfo = {
  features: Record<string, FeatureStatus>;
};

type GeneratedDoc = {
  doc_id: string;
  doc_type: string;
  doc_key: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

type Lesson = {
  lesson_id: string;
  lesson_type: string;
  title: string;
  created_at: string;
};

type Job = {
  job_id: string;
  job_type: string;
  status: string;
  created_at: string;
};

type Commit = {
  sha: string;
  message: string;
  author: string;
  committed_at: string;
  created_at?: string;
};

export default function DashboardPage() {
  const { projectId, projects } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const router = useRouter();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [stats, setStats] = useState({ lessons: 0, guardrails: 0, commits: 0, docs: 0, jobsActive: 0 });
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [recentLessons, setRecentLessons] = useState<Lesson[]>([]);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [recentCommits, setRecentCommits] = useState<Commit[]>([]);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([]);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [insights, setInsights] = useState<{ text: string; type: "warning" | "success" }[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [hasMcpLesson, setHasMcpLesson] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(false);

  // Re-read dismissed state when project changes
  useEffect(() => {
    try { setChecklistDismissed(localStorage.getItem(`chub_checklist_dismissed_${projectId}`) === "1"); }
    catch { setChecklistDismissed(false); }
  }, [projectId]);

  // FIX #3: Use ref for toast to avoid fetchAll re-creation
  // FIX #2: Reduced from 9 to 6 parallel calls (consolidated lessons queries)
  const fetchAll = useCallback(async () => {
    try {
      const [lessonsRes, guardrailsRes, jobsRes, commitsRes, infoRes, docsRes, summaryRes, apiKeysRes] = await Promise.allSettled([
        api.listLessons({ project_id: projectId, limit: 5, offset: 0, sort: "created_at", order: "desc" }),
        api.listLessons({ project_id: projectId, lesson_type: "guardrail", limit: 1 }),
        api.listJobs({ project_id: projectId, limit: 10 }),
        api.listCommits({ project_id: projectId, limit: 5 }),
        api.info(),
        api.listGeneratedDocs({ project_id: projectId, limit: 10 }),
        api.getProjectSummary(projectId),
        api.listApiKeys(),
      ]);

      const val = <T,>(r: PromiseSettledResult<T>, fallback: T): T => r.status === "fulfilled" ? r.value : fallback;

      const lessonsData = val(lessonsRes, { items: [], total_count: 0 });
      const guardrailsData = val(guardrailsRes, { total_count: 0 });
      const jobsData = val(jobsRes, { items: [] });
      const commitsData = val(commitsRes, { items: [] });
      const infoData = val(infoRes, null);
      const docsData = val(docsRes, { items: [] });
      const summaryData = val(summaryRes, null);
      const apiKeysData = val(apiKeysRes, { keys: [] });

      // Checklist: API keys and MCP-connected lessons
      setHasApiKey((apiKeysData.keys?.length ?? 0) > 0);
      setHasMcpLesson((lessonsData.items ?? []).some((l: any) => l.added_by === "mcp"));

      const jobItems: Job[] = jobsData.items ?? [];
      const activeJobItems = jobItems.filter((j: Job) => j.status === "running" || j.status === "queued");

      setStats({
        lessons: lessonsData.total_count ?? 0,
        guardrails: guardrailsData.total_count ?? 0,
        commits: commitsData.items?.length ?? 0,
        docs: docsData.items?.length ?? 0,
        jobsActive: activeJobItems.length,
      });

      setSystemInfo(infoData);
      setSummary(summaryData?.summary ?? null);
      setRecentLessons(lessonsData.items ?? []);
      setActiveJobs(activeJobItems);
      setRecentCommits(commitsData.items ?? []);
      setGeneratedDocs(docsData.items ?? []);

      // Compute health score (simple heuristic)
      const lessonCount = lessonsData.total_count ?? 0;
      const docCount = docsData.items?.length ?? 0;
      const lessonHealth = Math.min(100, lessonCount * 5);
      const docHealth = Math.min(100, docCount * 15);
      const overallHealth = lessonCount > 0 ? Math.round((lessonHealth + docHealth) / 2) : 0;
      setHealthScore(overallHealth);

      // Build insights
      const newInsights: { text: string; type: "warning" | "success" }[] = [];
      if (lessonCount === 0) newInsights.push({ text: "No lessons yet — add your first lesson to get started", type: "warning" });
      if (activeJobItems.length > 0) newInsights.push({ text: `${activeJobItems.length} job(s) currently running`, type: "success" });
      if (lessonCount > 10) newInsights.push({ text: `${lessonCount} lessons in knowledge base — good coverage`, type: "success" });
      setInsights(newInsights);
    } catch {
      toastRef.current("error", "Failed to load dashboard data");
    } finally {
      setInitialLoad(false);
    }
  }, [projectId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // FIX #5: Auto-refresh only when tab is visible
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (!interval) interval = setInterval(fetchAll, 60_000);
    };
    const stop = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { fetchAll(); start(); }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [fetchAll]);

  const isEmpty = stats.lessons === 0 && stats.commits === 0 && generatedDocs.length === 0;

  // Feature status items
  const features = systemInfo?.features ?? {};
  const featureItems: { label: string; enabled: boolean; detail?: string }[] = [
    { label: "Embeddings", enabled: true, detail: features.embeddings?.model ?? undefined },
    { label: "Distillation", enabled: !!features.distillation?.enabled, detail: features.distillation?.model ?? undefined },
    { label: "Reranking", enabled: true, detail: features.rerank?.type ?? undefined },
    { label: "Knowledge Graph", enabled: !!features.knowledge_graph?.enabled },
    { label: "Queue", enabled: !!features.queue?.enabled, detail: features.queue?.backend ?? undefined },
    { label: "Git Ingest", enabled: !!features.git_ingest?.enabled },
    { label: "Builder Memory", enabled: !!features.builder_memory?.enabled },
    { label: "Knowledge Loop", enabled: !!features.knowledge_loop?.enabled },
    { label: "Redis Cache", enabled: !!features.redis_cache?.enabled },
  ];

  const docTypeBadge: Record<string, string> = {
    faq: "bg-emerald-500/10 text-emerald-400",
    raptor: "bg-blue-500/10 text-blue-400",
    qc_report: "bg-amber-500/10 text-amber-400",
    qc_artifact: "bg-amber-500/10 text-amber-400",
    benchmark_artifact: "bg-purple-500/10 text-purple-400",
  };

  // First-time user: no projects at all
  // Only show after initial data load completes (avoids flash during hydration)
  if (!initialLoad && projects.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-md mx-auto text-center">
          <div className="relative mb-6">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-xl" style={{ boxShadow: "0 0 0 6px rgba(59,130,246,0.08), 0 0 0 12px rgba(59,130,246,0.04)" }}>
              <FolderOpen size={36} className="text-white" strokeWidth={1.5} />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-zinc-100 mb-2">Welcome to ContextHub</h1>
          <p className="text-sm text-zinc-500 mb-6">Create your first project to start building persistent knowledge for your AI agents.</p>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white font-medium transition-colors flex items-center gap-2 shadow-lg"
          >
            <Plus size={16} />
            Create Your First Project
          </button>
          <div className="mt-10 grid grid-cols-3 gap-6 text-left">
            <div>
              <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-2">
                <BookOpen size={16} className="text-blue-400" strokeWidth={1.5} />
              </div>
              <p className="text-xs text-zinc-300 font-medium">Lessons</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">Capture decisions, patterns, and workarounds</p>
            </div>
            <div>
              <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-2">
                <Shield size={16} className="text-red-400" strokeWidth={1.5} />
              </div>
              <p className="text-xs text-zinc-300 font-medium">Guardrails</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">Pre-action safety checks for your agents</p>
            </div>
            <div>
              <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-2">
                <MessageSquare size={16} className="text-emerald-400" strokeWidth={1.5} />
              </div>
              <p className="text-xs text-zinc-300 font-medium">AI Chat</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">Query your knowledge base in natural language</p>
            </div>
          </div>
        </div>
        <CreateProjectModal open={createModalOpen} onClose={() => setCreateModalOpen(false)} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <PageHeader
        title="Dashboard"
        subtitle={`${projectId} — project overview`}
        actions={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-600">
              <span className="w-1 h-1 rounded-full bg-zinc-600 animate-pulse" />
              Auto-refresh 60s
            </span>
            <Button variant="outline" size="sm" onClick={fetchAll}>↻ Refresh</Button>
          </div>
        }
      />

      {/* ═══ STATS ROW (FIX #7: skeleton only on initial load) ═══ */}
      {initialLoad ? (
        <StatCardSkeleton count={5} />
      ) : (
        <div className="flex gap-3 mb-5 flex-wrap">
          <StatCard value={stats.lessons} label="Lessons" onClick={() => router.push("/lessons")} icon={<BookOpen size={18} />} />
          <StatCard value={stats.commits} label="Commits" onClick={() => router.push("/projects")} icon={<GitCommit size={18} />} />
          <StatCard value={stats.docs} label="Generated Docs" onClick={() => router.push("/knowledge/docs")} icon={<FileText size={18} />} />
          <StatCard value={stats.jobsActive} label="Active Jobs" highlight={stats.jobsActive > 0} onClick={() => router.push("/jobs")} icon={<Loader size={18} />} />
          {/* Knowledge Health Score */}
          {healthScore !== null && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 min-w-[180px]">
              <p className="text-xs text-zinc-500 mb-2">Knowledge Health</p>
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <svg width="48" height="48" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="#27272a" strokeWidth="4" />
                    <circle cx="24" cy="24" r="20" fill="none"
                      stroke={healthScore >= 70 ? "#10b981" : healthScore >= 40 ? "#f59e0b" : "#ef4444"}
                      strokeWidth="4"
                      strokeDasharray="125.66"
                      strokeDashoffset={125.66 - (125.66 * healthScore / 100)}
                      strokeLinecap="round"
                      transform="rotate(-90 24 24)"
                    />
                  </svg>
                  <span className={`absolute inset-0 flex items-center justify-center text-xs font-semibold ${healthScore >= 70 ? "text-emerald-400" : healthScore >= 40 ? "text-amber-400" : "text-red-400"}`}>
                    {healthScore}%
                  </span>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500">Lessons: <span className="text-zinc-400">{stats.lessons}</span></p>
                  <p className="text-[10px] text-zinc-500">Docs: <span className="text-zinc-400">{stats.docs}</span></p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Insights Panel */}
      {!initialLoad && insights.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb size={18} className="text-amber-400" />
            <h2 className="text-sm font-medium text-zinc-300">Insights</h2>
          </div>
          <div className="space-y-2">
            {insights.map((ins, i) => (
              <div key={i} className={`flex items-center justify-between border-l-2 pl-3 py-1 ${ins.type === "warning" ? "border-amber-500" : "border-emerald-500"}`}>
                <p className="text-xs text-zinc-400">{ins.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ SETUP CHECKLIST ═══ */}
      {!initialLoad && !checklistDismissed && stats.lessons < 3 && (
        (() => {
          const items = [
            { done: stats.lessons > 0, label: "Add your first lesson", desc: "Record a decision, workaround, or guardrail", href: "/lessons", icon: <BookOpen size={14} /> },
            { done: stats.guardrails > 0, label: "Set up a guardrail", desc: "Define safety rules for AI agents", href: "/guardrails", icon: <Shield size={14} /> },
            { done: hasApiKey, label: "Create an API key", desc: "Enable authenticated access to your project", href: "/settings/access", icon: <Key size={14} /> },
            { done: hasMcpLesson, label: "Connect an agent via MCP", desc: "Have an AI agent add a lesson through the MCP server", href: "/getting-started", icon: <Cpu size={14} /> },
          ];
          const doneCount = items.filter(i => i.done).length;
          const allDone = doneCount === items.length;
          return (
            <div className="border border-zinc-800 rounded-lg bg-zinc-900 mb-5 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-blue-400" />
                  <h3 className="text-sm font-semibold text-zinc-300">Setup Checklist</h3>
                  <span className="text-[10px] text-zinc-600">{doneCount}/{items.length}</span>
                </div>
                <button
                  onClick={() => { setChecklistDismissed(true); try { localStorage.setItem(`chub_checklist_dismissed_${projectId}`, "1"); } catch {} }}
                  className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  {allDone ? "Done!" : "Dismiss"}
                </button>
              </div>
              <div className="p-3 grid grid-cols-2 gap-2">
                {items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => router.push(item.href)}
                    className="flex items-start gap-3 p-3 rounded-lg text-left hover:bg-zinc-800/50 transition-colors group"
                  >
                    <span className="mt-0.5 shrink-0">
                      {item.done ? (
                        <CheckCircle2 size={16} className="text-emerald-500" />
                      ) : (
                        <Circle size={16} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                      )}
                    </span>
                    <div>
                      <span className={`text-xs font-medium ${item.done ? "text-zinc-500 line-through" : "text-zinc-300"}`}>{item.label}</span>
                      <p className="text-[10px] text-zinc-600 mt-0.5">{item.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              {/* Progress bar */}
              <div className="px-4 pb-3">
                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${(doneCount / items.length) * 100}%` }} />
                </div>
              </div>
            </div>
          );
        })()
      )}

      {/* ═══ ONBOARDING ═══ */}
      {!initialLoad && isEmpty && (
        <div className="border border-dashed border-zinc-800 rounded-xl p-12 text-center mb-6">
          <h2 className="text-xl font-semibold text-zinc-100 mb-2">Welcome to ContextHub</h2>
          <p className="text-sm text-zinc-500 mb-8">Get your project&apos;s knowledge base up and running in 3 steps</p>
          <div className="flex gap-5 justify-center max-w-[720px] mx-auto">
            {[
              { n: "1", title: "Index your project", desc: "Point to your repo and we'll index the source code.", btn: "Index Project →", href: "/projects" },
              { n: "2", title: "Add your first lesson", desc: "Record a decision, workaround, or guardrail.", btn: "Add Lesson →", href: "/lessons" },
              { n: "3", title: "Try the AI chat", desc: "Ask questions about your project knowledge.", btn: "Open Chat →", href: "/chat" },
            ].map((step) => (
              <div key={step.n} className="flex-1 p-5 border border-zinc-800 rounded-lg bg-zinc-900 text-left">
                <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs flex items-center justify-center font-semibold mb-3">{step.n}</div>
                <div className="text-sm font-semibold text-zinc-200 mb-1">{step.title}</div>
                <div className="text-xs text-zinc-500 mb-4 leading-relaxed">{step.desc}</div>
                <Button variant="primary" size="sm" onClick={() => router.push(step.href)}>{step.btn}</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ FEATURE STATUS ═══ */}
      {!initialLoad && systemInfo && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-2 px-4 py-3 border border-zinc-800 rounded-lg bg-zinc-900 mb-5">
          {featureItems.map((f) => (
            <div key={f.label} className="flex items-center gap-1.5 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${f.enabled ? "bg-emerald-500" : "bg-zinc-600"}`} />
              <span className={f.enabled ? "text-zinc-300" : "text-zinc-600"}>{f.label}</span>
              {f.detail && <span className="text-zinc-600 font-mono text-[10px] truncate">{f.detail}</span>}
            </div>
          ))}
        </div>
      )}

      {/* ═══ QUICK ACTIONS ═══ */}
      {!initialLoad && !isEmpty && (
        <div className="flex gap-2 flex-wrap mb-5">
          {[
            { icon: "📝", label: "Add Lesson", href: "/lessons" },
            { icon: "💬", label: "Ask AI", href: "/chat" },
            { icon: "🔄", label: "Re-index", href: "/projects" },
            { icon: "🛡", label: "Check Guardrail", href: "/guardrails" },
            { icon: "📦", label: "Ingest Git", href: "/projects" },
          ].map((a) => (
            <button
              key={a.label}
              onClick={() => router.push(a.href)}
              className="flex items-center gap-1.5 px-3 py-2 border border-zinc-800 rounded-lg bg-zinc-900 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
            >
              <span>{a.icon}</span> {a.label}
            </button>
          ))}
        </div>
      )}

      {/* ═══ PROJECT SUMMARY ═══ */}
      {!initialLoad && summary && (
        <div className="border border-zinc-800 rounded-lg bg-zinc-900 mb-5 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-300">Project Summary</h3>
            <Button variant="outline" size="sm" onClick={() => toastRef.current("info", "Reflect triggered")}>💭 Refresh</Button>
          </div>
          <div className="px-4 py-3 text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
            {summary}
          </div>
        </div>
      )}

      {/* ═══ GENERATED DOCS ═══ */}
      {!initialLoad && generatedDocs.length > 0 && (
        <div className="border border-zinc-800 rounded-lg bg-zinc-900 mb-5 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-300">Generated Documents</h3>
          </div>
          <div className="p-4 grid grid-cols-3 gap-3">
            {generatedDocs.slice(0, 6).map((doc) => (
              <div key={doc.doc_id} className="p-3 border border-zinc-800 rounded-lg bg-zinc-950 hover:border-zinc-700 cursor-pointer transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${docTypeBadge[doc.doc_type] ?? "bg-zinc-700 text-zinc-400"}`}>
                    {doc.doc_type}
                  </span>
                  <span className="text-[10px] text-zinc-600">{relTime(doc.updated_at)}</span>
                </div>
                <div className="text-xs text-zinc-300 font-medium truncate">{doc.title ?? doc.doc_key}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ TWO-COL: Recent Lessons + Active Jobs ═══ */}
      {!initialLoad && !isEmpty && (
        <div className="grid grid-cols-2 gap-4 mb-5">
          {/* Recent Lessons */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-900 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-300">Recent Lessons</h3>
            </div>
            <div className="px-4 py-1">
              {recentLessons.length === 0 ? (
                <div className="py-6 text-center text-xs text-zinc-600">No lessons yet</div>
              ) : (
                recentLessons.map((l) => (
                  <div key={l.lesson_id} onClick={() => router.push("/lessons")} className="flex items-center gap-2 py-2 border-b border-zinc-800/50 last:border-0 cursor-pointer hover:bg-zinc-800/30 -mx-4 px-4 transition-colors">
                    <Badge value={l.lesson_type} variant="type" />
                    <span className="text-xs text-zinc-300 flex-1 truncate">{l.title}</span>
                    <span className="text-[10px] text-zinc-600 shrink-0">{relTime(l.created_at)}</span>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => router.push("/lessons")} className="block w-full text-center py-2 text-[11px] text-blue-500 border-t border-zinc-800 cursor-pointer hover:bg-zinc-800/30">View all lessons →</button>
          </div>

          {/* Active Jobs */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-900 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-300">Active Jobs</h3>
              {activeJobs.length > 0 && (
                <div className="flex gap-1">
                  {activeJobs.filter((j) => j.status === "running").length > 0 && (
                    <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">
                      {activeJobs.filter((j) => j.status === "running").length} running
                    </span>
                  )}
                  {activeJobs.filter((j) => j.status === "queued").length > 0 && (
                    <span className="text-[10px] text-zinc-400 bg-zinc-500/10 px-2 py-0.5 rounded-full">
                      {activeJobs.filter((j) => j.status === "queued").length} queued
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="px-4 py-1">
              {activeJobs.length === 0 ? (
                <div className="py-6 text-center text-xs text-zinc-600">No active jobs</div>
              ) : (
                activeJobs.map((j) => (
                  <div key={j.job_id} className="flex items-center gap-2 py-2 border-b border-zinc-800/50 last:border-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${j.status === "running" ? "bg-blue-500 animate-pulse" : "border border-zinc-500"}`} />
                    <span className="text-xs text-zinc-300 flex-1">{j.job_type}</span>
                    <span className="text-[10px] text-zinc-600">{j.status}</span>
                    <span className="text-[10px] text-zinc-600 w-8 text-right">{relTime(j.created_at)}</span>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => router.push("/jobs")} className="block w-full text-center py-2 text-[11px] text-blue-500 border-t border-zinc-800 cursor-pointer hover:bg-zinc-800/30">View all jobs →</button>
          </div>
        </div>
      )}

      {/* ═══ RECENT COMMITS ═══ */}
      {!initialLoad && recentCommits.length > 0 && (
        <div className="border border-zinc-800 rounded-lg bg-zinc-900 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-300">Recent Commits</h3>
            <Button variant="outline" size="sm" onClick={() => toastRef.current("info", "Ingest triggered")}>📦 Ingest New</Button>
          </div>
          <div className="px-4 py-1">
            {recentCommits.map((c, i) => (
              <div key={c.sha ?? i} className="flex items-center gap-2 py-2 border-b border-zinc-800/50 last:border-0">
                <span className="font-mono text-[11px] text-blue-500 w-14 shrink-0">{(c.sha ?? "").slice(0, 7)}</span>
                <span className="text-xs text-zinc-300 flex-1 truncate">{c.message}</span>
                <span className="text-[10px] text-zinc-600 shrink-0">{relTime(c.committed_at ?? c.created_at ?? "")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
