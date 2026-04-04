"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { relTime } from "@/lib/rel-time";
import { Breadcrumb, PageHeader, DataTable, JobStatusBadge, Button, EmptyState, TableSkeleton, type Column } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type Job = {
  job_id: string;
  project_id: string | null;
  job_type: string;
  status: string;
  correlation_id: string | null;
  payload: Record<string, unknown>;
  error: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

const STATUS_TABS = ["all", "running", "queued", "succeeded", "failed", "dead_letter"] as const;
type StatusTab = typeof STATUS_TABS[number];

const JOB_TYPES = [
  "index.run", "git.ingest", "faq.build", "raptor.build",
  "quality.eval", "knowledge.refresh", "knowledge.loop.shallow",
  "knowledge.loop.deep", "knowledge.memory.build", "repo.sync",
  "workspace.scan", "workspace.delta_index",
] as const;

export default function JobsPage() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [jobs, setJobs] = useState<Job[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [activeTab, setActiveTab] = useState<StatusTab>("all");
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  // Enqueue dialog
  const [enqueueOpen, setEnqueueOpen] = useState(false);
  const [enqueueType, setEnqueueType] = useState<string>(JOB_TYPES[0]);
  const [enqueuePayload, setEnqueuePayload] = useState("{}");
  const [submitting, setSubmitting] = useState(false);

  const fetchJobs = useCallback(async () => {
    try {
      const params: Record<string, string | number | undefined> = {
        project_id: projectId,
        limit: 50,
      };
      if (activeTab !== "all") params.status = activeTab;
      const result = await api.listJobs(params);
      setJobs(result.items ?? []);
    } catch {
      toastRef.current("error", "Failed to load jobs");
    } finally {
      setInitialLoad(false);
    }
  }, [projectId, activeTab]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // Auto-refresh: 5s for running/queued, 30s otherwise. Pause on hidden.
  useEffect(() => {
    const interval = activeTab === "running" || activeTab === "queued" || activeTab === "all" ? 5_000 : 30_000;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(fetchJobs, interval); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => { if (document.hidden) stop(); else { fetchJobs(); start(); } };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [fetchJobs, activeTab]);

  const handleEnqueue = async () => {
    setSubmitting(true);
    try {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(enqueuePayload); } catch { /* keep empty */ }
      await api.enqueueJob({
        project_id: projectId,
        job_type: enqueueType,
        payload,
      });
      toastRef.current("success", `Job ${enqueueType} enqueued`);
      setEnqueueOpen(false);
      setEnqueuePayload("{}");
      fetchJobs();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Enqueue failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Tab counts
  const counts: Record<string, number> = { all: jobs.length };
  for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;

  const columns: Column<Job>[] = [
    {
      key: "status",
      header: "Status",
      className: "w-24",
      render: (row) => <JobStatusBadge status={row.status} />,
    },
    {
      key: "job_type",
      header: "Type",
      render: (row) => <span className="text-zinc-200 font-mono text-xs">{row.job_type}</span>,
    },
    {
      key: "job_id",
      header: "Job ID",
      render: (row) => <span className="text-zinc-600 font-mono text-[11px]">{row.job_id.slice(0, 8)}</span>,
    },
    {
      key: "attempts",
      header: "Attempts",
      className: "w-20",
      render: (row) => <span className="text-zinc-500 text-xs">{row.attempts}/{row.max_attempts}</span>,
    },
    {
      key: "created_at",
      header: "Age",
      className: "w-16",
      render: (row) => <span className="text-zinc-600 text-xs">{relTime(row.created_at)}</span>,
    },
  ];

  return (
    <div className="p-6 max-w-[1000px]">
      <Breadcrumb items={[{ label: "System", href: "/settings" }, { label: "Jobs" }]} />
      <PageHeader
        title="Jobs"
        subtitle="Monitor and manage the async job queue"
        actions={
          <Button variant="primary" onClick={() => setEnqueueOpen(true)}>+ Enqueue Job</Button>
        }
      />

      {/* Status Tabs */}
      <div className="flex gap-0 border-b border-zinc-800 mb-4">
        {STATUS_TABS.map((tab) => {
          const count = tab === "all" ? jobs.length : (counts[tab] ?? 0);
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "text-zinc-100 border-zinc-100"
                  : "text-zinc-500 border-transparent hover:text-zinc-300"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1).replace("_", " ")}
              {count > 0 && <span className="ml-1.5 text-zinc-600">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Refresh indicator */}
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-600 mb-3">
        <span className="w-1 h-1 rounded-full bg-zinc-600 animate-pulse" />
        Auto-refresh {activeTab === "running" || activeTab === "queued" || activeTab === "all" ? "5s" : "30s"}
      </div>

      {/* Table */}
      {initialLoad ? (
        <TableSkeleton rows={6} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon="⚡"
          title={activeTab === "all" ? "No jobs" : `No ${activeTab} jobs`}
          description={activeTab === "all" ? "Enqueue a job to get started" : "No jobs with this status"}
          action={activeTab === "all" ? <Button variant="primary" onClick={() => setEnqueueOpen(true)}>+ Enqueue Job</Button> : undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          data={jobs}
          rowKey={(r) => r.job_id}
          onRowClick={(r) => setExpandedJob(expandedJob === r.job_id ? null : r.job_id)}
          rowActions={(row) => (
            expandedJob === row.job_id ? (
              <div className="text-xs text-zinc-500 mt-1 p-3 bg-zinc-950 rounded-md border border-zinc-800">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><span className="text-zinc-600">Correlation:</span> <span className="font-mono">{row.correlation_id?.slice(0, 12) ?? "—"}</span></div>
                  <div><span className="text-zinc-600">Created:</span> {new Date(row.created_at).toLocaleString()}</div>
                  {row.started_at && <div><span className="text-zinc-600">Started:</span> {new Date(row.started_at).toLocaleString()}</div>}
                  {row.completed_at && <div><span className="text-zinc-600">Completed:</span> {new Date(row.completed_at).toLocaleString()}</div>}
                </div>
                {row.error && (
                  <div className="mt-2 p-2 bg-red-500/5 border border-red-500/20 rounded text-red-400 text-xs font-mono whitespace-pre-wrap">
                    {row.error}
                  </div>
                )}
                <div className="mt-2">
                  <span className="text-zinc-600">Payload:</span>
                  <pre className="mt-1 p-2 bg-zinc-900 rounded text-[11px] text-zinc-400 overflow-x-auto">
                    {JSON.stringify(row.payload, null, 2)}
                  </pre>
                </div>
              </div>
            ) : null
          )}
        />
      )}

      {/* Enqueue Dialog */}
      {enqueueOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEnqueueOpen(false)} />
          <div className="relative w-[460px] bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-zinc-100 mb-5">Enqueue Job</h3>

            <div className="mb-3.5">
              <label className="block text-xs text-zinc-500 mb-1">Job Type</label>
              <select
                value={enqueueType}
                onChange={(e) => setEnqueueType(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none"
              >
                {JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="mb-3.5">
              <label className="block text-xs text-zinc-500 mb-1">Payload (JSON)</label>
              <textarea
                value={enqueuePayload}
                onChange={(e) => setEnqueuePayload(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none min-h-[100px] resize-y font-mono"
                placeholder='{ "root": "/path/to/project" }'
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-800">
              <Button variant="outline" onClick={() => setEnqueueOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleEnqueue} disabled={submitting}>
                {submitting ? "Enqueuing..." : "Enqueue"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
