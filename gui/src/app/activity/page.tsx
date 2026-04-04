"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Breadcrumb, PageHeader, Button, EmptyState, TableSkeleton } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { relTime } from "@/lib/rel-time";
import { BookOpen, Shield, Zap, FileText, Users, CheckCheck, Settings, X } from "lucide-react";

type ActivityItem = {
  activity_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  description: string;
  metadata: any;
  created_at: string;
  is_read?: boolean;
};

type ActivityFilter = "all" | "lessons" | "jobs" | "guardrails" | "documents";
type TimeRange = "today" | "week" | "month" | "all";

const EVENT_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  lesson_created: { icon: <BookOpen size={14} />, color: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
  lesson_updated: { icon: <BookOpen size={14} />, color: "bg-amber-500/10 border-amber-500/20 text-amber-400" },
  guardrail_triggered: { icon: <Shield size={14} />, color: "bg-red-500/10 border-red-500/20 text-red-400" },
  job_succeeded: { icon: <Zap size={14} />, color: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" },
  job_failed: { icon: <X size={14} />, color: "bg-red-500/10 border-red-500/20 text-red-400" },
  document_uploaded: { icon: <FileText size={14} />, color: "bg-purple-500/10 border-purple-500/20 text-purple-400" },
  group_created: { icon: <Users size={14} />, color: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" },
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
  const { projectId } = useProject();
  const { toast } = useToast();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const [notifSettings, setNotifSettings] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIF_TOGGLES.map((t) => [t.key, t.default]))
  );

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = { project_id: projectId, limit: 50 };
      if (filter !== "all") params.entity_type = filter;
      if (timeRange !== "all") params.time_range = timeRange;
      const res = await api.listActivity(params);
      setItems(res.items ?? res.activities ?? []);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, timeRange, toast]);

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
    <div className="p-6 max-w-[1100px]">
      <Breadcrumb items={[{ label: "System", href: "/jobs" }, { label: "Activity" }]} />
      <PageHeader
        title="Activity & Notifications"
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
      <div className="flex gap-6">
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
                const evt = EVENT_ICONS[item.event_type] ?? EVENT_ICONS.lesson_created;
                return (
                  <div key={item.activity_id} className="flex gap-4 p-4 rounded-lg hover:bg-zinc-900/50 transition-colors relative">
                    {!item.is_read && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500" />
                    )}
                    <div className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 z-10 ${evt.color}`}>
                      {evt.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200">{item.description}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[11px] text-zinc-600">{relTime(item.created_at)}</span>
                        <span className="text-[11px] text-zinc-600">Project: <span className="text-zinc-500">{projectId}</span></span>
                      </div>
                      <div className="flex gap-3 mt-2">
                        {item.entity_type === "lesson" && (
                          <a href="/lessons" className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors">View Lesson →</a>
                        )}
                        {item.entity_type === "job" && (
                          <a href="/jobs" className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors">View Job →</a>
                        )}
                        {item.entity_type === "guardrail" && (
                          <a href="/guardrails" className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors">View Guardrail →</a>
                        )}
                        {item.entity_type === "document" && (
                          <a href="/documents" className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors">View Document →</a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Notification settings */}
        <div className="w-72 shrink-0">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 sticky top-6">
            <h3 className="text-sm font-semibold text-zinc-100 mb-4">Notification Settings</h3>
            <div className="space-y-3">
              {NOTIF_TOGGLES.map((t) => (
                <div key={t.key} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">{t.label}</span>
                  <button
                    onClick={() => setNotifSettings((p) => ({ ...p, [t.key]: !p[t.key] }))}
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
  );
}
