"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Breadcrumb, PageHeader, Button, EmptyState, TableSkeleton } from "@/components/ui";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { relTime } from "@/lib/rel-time";
import { NoProjectGuard } from "@/components/no-project-guard";
import { ProjectBadge } from "@/components/project-badge";
import { BookOpen, Shield, Zap, FileText, Users, CheckCheck, Settings, X } from "lucide-react";

type ActivityItem = {
  activity_id: string;
  event_type: string;
  title: string;
  detail: string | null;
  actor: string | null;
  metadata: any;
  created_at: string;
  project_id?: string;
};

type ActivityFilter = "all" | "lessons" | "jobs" | "guardrails" | "documents";
type TimeRange = "today" | "week" | "month" | "all";

/** Map frontend filter labels to backend event_type prefix */
const FILTER_TO_EVENT_PREFIX: Record<string, string> = {
  lessons: "lesson",
  jobs: "job",
  guardrails: "guardrail",
  documents: "document",
};

const EVENT_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  "lesson.created": { icon: <BookOpen size={14} />, color: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
  "lesson.updated": { icon: <BookOpen size={14} />, color: "bg-amber-500/10 border-amber-500/20 text-amber-400" },
  "lesson.status_changed": { icon: <BookOpen size={14} />, color: "bg-amber-500/10 border-amber-500/20 text-amber-400" },
  "lesson.deleted": { icon: <X size={14} />, color: "bg-red-500/10 border-red-500/20 text-red-400" },
  "guardrail.triggered": { icon: <Shield size={14} />, color: "bg-red-500/10 border-red-500/20 text-red-400" },
  "guardrail.passed": { icon: <Shield size={14} />, color: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" },
  "job.queued": { icon: <Zap size={14} />, color: "bg-zinc-500/10 border-zinc-500/20 text-zinc-400" },
  "job.succeeded": { icon: <Zap size={14} />, color: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" },
  "job.failed": { icon: <X size={14} />, color: "bg-red-500/10 border-red-500/20 text-red-400" },
  "document.uploaded": { icon: <FileText size={14} />, color: "bg-purple-500/10 border-purple-500/20 text-purple-400" },
  "document.deleted": { icon: <FileText size={14} />, color: "bg-red-500/10 border-red-500/20 text-red-400" },
  "group.created": { icon: <Users size={14} />, color: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" },
  "comment.added": { icon: <BookOpen size={14} />, color: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
};

const DEFAULT_EVENT_ICON = { icon: <Zap size={14} />, color: "bg-zinc-500/10 border-zinc-500/20 text-zinc-400" };

/** Derive entity type from event_type (e.g. "lesson.created" → "lesson") */
function entityFromEvent(eventType: string): string | null {
  const dot = eventType.indexOf(".");
  return dot > 0 ? eventType.slice(0, dot) : null;
}

const ENTITY_LINKS: Record<string, { href: string; label: string }> = {
  lesson: { href: "/lessons", label: "View Lesson →" },
  job: { href: "/jobs", label: "View Job →" },
  guardrail: { href: "/guardrails", label: "View Guardrail →" },
  document: { href: "/documents", label: "View Document →" },
};

const NOTIF_TOGGLES = [
  { key: "job_failures", label: "Job failures", default: true },
  { key: "guardrail_violations", label: "Guardrail violations", default: true },
  { key: "new_lessons", label: "New lessons by agents", default: true },
  { key: "lesson_updates", label: "Lesson updates", default: false },
  { key: "job_completions", label: "Job completions", default: false },
  { key: "document_uploads", label: "Document uploads", default: false },
];

export default function ActivityPage() {
  const { projectId, isAllProjects, effectiveProjectIds, projectsLoaded } = useProject();
  const { toast } = useToast();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 12;
  const [notifSettings, setNotifSettings] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIF_TOGGLES.map((t) => [t.key, t.default]))
  );

  // Load persisted notification settings
  useEffect(() => {
    api.getNotificationSettings({ project_id: projectId })
      .then((res) => {
        if (res.settings && Object.keys(res.settings).length > 0) {
          setNotifSettings((prev) => ({ ...prev, ...res.settings }));
        }
      })
      .catch(() => {});
  }, [projectId]);

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    try {
      const useMulti = isAllProjects && projectsLoaded && effectiveProjectIds.length > 0;
      const eventPrefix = filter !== "all" ? FILTER_TO_EVENT_PREFIX[filter] : undefined;
      const res = useMulti
        ? await api.listActivityMulti({
            project_ids: effectiveProjectIds,
            event_type: eventPrefix,
            limit: pageSize,
            offset: (page - 1) * pageSize,
          })
        : await api.listActivity({
            project_id: projectId, limit: pageSize, offset: (page - 1) * pageSize,
            ...(eventPrefix ? { event_type: eventPrefix } : {}),
            ...(timeRange !== "all" ? { time_range: timeRange } : {}),
          });
      setItems(res.items ?? res.activities ?? []);
      setTotalCount(res.total_count ?? 0);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, timeRange, page, isAllProjects, effectiveProjectIds, projectsLoaded, toast]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  const handleMarkAllRead = async () => {
    try {
      await api.markNotificationsRead({});
      toast("success", "All notifications marked as read");
      fetchActivity();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to mark notifications");
    }
  };

  const FILTER_TABS: { label: string; value: ActivityFilter }[] = [
    { label: "All", value: "all" },
    { label: "Lessons", value: "lessons" },
    { label: "Jobs", value: "jobs" },
    { label: "Guardrails", value: "guardrails" },
    { label: "Documents", value: "documents" },
  ];

  const TIME_TABS: { label: string; value: TimeRange }[] = [
    { label: "Today", value: "today" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
    { label: "All Time", value: "all" },
  ];

  return (
    <NoProjectGuard>
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "System", href: "/jobs" }, { label: "Activity" }]} />
      <PageHeader
        title="Activity & Notifications"
        projectBadge={<ProjectBadge />}
        subtitle="Track changes made by agents and team members"
        actions={
          <>
            <Button variant="outline" onClick={() => toast("info", "Settings panel on right")}>
              <Settings size={14} className="mr-1" /> Settings
            </Button>
            <Button variant="primary" onClick={handleMarkAllRead}>
              <CheckCheck size={14} className="mr-1" /> Mark All Read
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1 border-b border-zinc-800 pb-0">
          {FILTER_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value)}
              className={`px-3 py-2 text-xs font-medium -mb-px transition-colors ${
                filter === t.value ? "text-blue-400 border-b-2 border-blue-400" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          {TIME_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTimeRange(t.value)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                timeRange === t.value ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feed + Settings */}
      <div className="flex flex-col-reverse md:flex-row gap-6">
        {/* Activity feed */}
        <div className="flex-1 relative">
          {/* Vertical line */}
          <div className="absolute left-[15px] top-4 bottom-4 w-px bg-zinc-800" />

          {loading ? (
            <TableSkeleton rows={5} />
          ) : items.length === 0 ? (
            <EmptyState icon="📋" title="No activity" description="Activity from agents and team members will appear here" />
          ) : (
            <div className="space-y-0">
              {items.map((item) => {
                const evt = EVENT_ICONS[item.event_type] ?? DEFAULT_EVENT_ICON;
                const entity = entityFromEvent(item.event_type);
                const entityLink = entity ? ENTITY_LINKS[entity] : null;
                return (
                  <div key={item.activity_id} className="flex gap-4 p-4 rounded-lg hover:bg-zinc-900/50 transition-colors relative">
                    <div className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 z-10 ${evt.color}`}>
                      {evt.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200">{item.title}</p>
                      {item.detail && (
                        <p className="text-xs text-zinc-500 mt-0.5">{item.detail}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[11px] text-zinc-600">{relTime(item.created_at)}</span>
                        {item.actor && (
                          <span className="text-[11px] text-zinc-600">by <span className="text-zinc-500">{item.actor}</span></span>
                        )}
                        <span className="text-[11px] text-zinc-600">Project: <span className="text-zinc-500">{item.project_id ?? projectId}</span></span>
                      </div>
                      {entityLink && (
                        <div className="flex gap-3 mt-2">
                          <a href={entityLink.href} className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors">{entityLink.label}</a>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {totalCount > pageSize && (
            <Pagination page={page} totalPages={Math.ceil(totalCount / pageSize)} totalCount={totalCount} pageSize={pageSize} onPageChange={(p) => { setPage(p);}} />
          )}
        </div>

        {/* Notification settings */}
        <div className="w-full md:w-72 shrink-0">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 sticky top-6">
            <h3 className="text-sm font-semibold text-zinc-100 mb-4">Notification Settings</h3>
            <div className="space-y-3">
              {NOTIF_TOGGLES.map((t) => (
                <div key={t.key} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">{t.label}</span>
                  <button
                    onClick={() => {
                      const newVal = !notifSettings[t.key];
                      setNotifSettings((p) => ({ ...p, [t.key]: newVal }));
                      api.updateNotificationSettings({ project_id: projectId, settings: { [t.key]: newVal } }).catch(() => {});
                    }}
                    className={`w-8 h-[18px] rounded-full relative transition-colors ${
                      notifSettings[t.key] ? "bg-blue-600" : "bg-zinc-700"
                    }`}
                  >
                    <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full shadow-sm transition-all ${
                      notifSettings[t.key] ? "right-0.5 bg-white" : "left-0.5 bg-zinc-400"
                    }`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
    </NoProjectGuard>
  );
}
