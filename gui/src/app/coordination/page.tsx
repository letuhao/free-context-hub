"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useProject } from "@/contexts/project-context";
import { api, type TopicRecord } from "@/lib/api";
import { Breadcrumb, PageHeader, Button, EmptyState } from "@/components/ui";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { NoProjectGuard } from "@/components/no-project-guard";
import { ProjectBadge } from "@/components/project-badge";
import { useActingActor } from "@/contexts/auth-context";
import { useActorNames } from "@/lib/useActorNames";
import { Plus, ArrowRight } from "lucide-react";

const TOPIC_STATUS_STYLES: Record<string, string> = {
  chartered: "bg-blue-500/10 text-blue-400",
  active: "bg-emerald-500/10 text-emerald-400",
  closing: "bg-amber-500/10 text-amber-400",
  closed: "bg-zinc-500/15 text-zinc-500",
};

export function TopicStatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${TOPIC_STATUS_STYLES[status] ?? "bg-zinc-700 text-zinc-300"}`}>
      {status}
    </span>
  );
}

function CoordinationInner() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [topics, setTopics] = useState<TopicRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const nameOf = useActorNames();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [charter, setCharter] = useState("");
  const [createdBy, setCreatedBy] = useActingActor();
  const [creating, setCreating] = useState(false);

  const fetchTopics = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.listTopics({ project_id: projectId });
      setTopics(res.data?.topics ?? []);
    } catch {
      toastRef.current("error", "Failed to load topics");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  const submitCharter = async () => {
    if (!projectId || !name.trim() || !charter.trim() || !createdBy.trim()) return;
    setCreating(true);
    try {
      await api.charterTopic({ project_id: projectId, name: name.trim(), charter: charter.trim(), created_by: createdBy.trim() });
      toastRef.current("success", "Topic chartered");
      setCreateOpen(false);
      setName(""); setCharter(""); setCreatedBy("");
      fetchTopics();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Failed to charter topic");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <PageHeader
        title="Coordination — Topics"
        subtitle="Bounded collaborative initiatives with a durable event log and participant roster."
        breadcrumb={<Breadcrumb items={[{ label: "Coordination" }, { label: "Topics" }]} />}
        projectBadge={<ProjectBadge />}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> Charter topic
          </Button>
        }
      />

      {loading ? (
        <TableSkeleton />
      ) : topics.length === 0 ? (
        <EmptyState
          icon="🧭"
          title="No topics yet"
          description="Charter a topic to coordinate a multi-actor initiative on this project."
        />
      ) : (
        <div className="space-y-2">
          {topics.map((t) => (
            <Link
              key={t.topic_id}
              href={`/coordination/topics/${encodeURIComponent(t.topic_id)}`}
              className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 hover:bg-zinc-900 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-100 truncate">{t.name}</span>
                  <TopicStatusPill status={t.status} />
                </div>
                <p className="text-xs text-zinc-500 truncate mt-0.5">{t.charter}</p>
              </div>
              <div className="text-[11px] text-zinc-600 shrink-0 text-right">
                <div>by {nameOf(t.created_by)}</div>
                <div>{new Date(t.created_at).toLocaleDateString()}</div>
              </div>
              <ArrowRight size={16} className="text-zinc-600 shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {/* Charter dialog */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !creating && setCreateOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-zinc-100 mb-4">Charter a topic</h2>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-zinc-500">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 auth migration"
                  className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-500">Charter (purpose / scope)</span>
                <textarea value={charter} onChange={(e) => setCharter(e.target.value)} rows={3} placeholder="What this initiative is bounded to do"
                  className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600 resize-none" />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-500">Acting as (defaults to you)</span>
                <input value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} placeholder="your principal id"
                  className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
              <Button onClick={submitCharter} disabled={creating || !name.trim() || !charter.trim() || !createdBy.trim()}>
                {creating ? "Chartering…" : "Charter"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CoordinationPage() {
  return (
    <NoProjectGuard>
      <CoordinationInner />
    </NoProjectGuard>
  );
}
