"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import {
  Breadcrumb,
  PageHeader,
  Badge,
  Button,
  EmptyState,
  TableSkeleton,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { relTime } from "@/lib/rel-time";
import { Check, X, Eye, CheckCheck, Pencil, Shield, ChevronDown, ChevronRight } from "lucide-react";
import { LessonDetail } from "../lessons/lesson-detail";
import type { Lesson } from "../lessons/types";

type ReviewFilter = "all" | "draft" | "pending_review";

const REJECT_REASONS = ["Inaccurate", "Duplicate", "Too vague", "Not relevant", "Other"] as const;

/** Avatar circle for agent/user names */
function AgentAvatar({ name }: { name: string }) {
  const colors: Record<string, string> = {
    c: "bg-purple-500/20 text-purple-400",
    l: "bg-blue-500/20 text-blue-400",
    g: "bg-green-500/20 text-green-400",
    cu: "bg-sky-500/20 text-sky-400",
  };
  const key = name.toLowerCase().slice(0, 2);
  const style = colors[key] ?? colors[name.charAt(0).toLowerCase()] ?? "bg-zinc-500/20 text-zinc-400";
  const initial = name.charAt(0).toUpperCase();
  return (
    <span className={`w-5 h-5 rounded-full ${style} text-[10px] font-bold flex items-center justify-center shrink-0`}>
      {initial}
    </span>
  );
}

/** Reject dialog */
function RejectDialog({ open, lessonTitle, onReject, onClose }: {
  open: boolean;
  lessonTitle: string;
  onReject: (reason: string, note: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(REJECT_REASONS[0] as string);
  const [note, setNote] = useState("");

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-sm w-full p-5 shadow-2xl animate-[fadeInScale_0.2s_ease-out]">
          <h3 className="text-sm font-semibold text-zinc-100 mb-1 flex items-center gap-2">
            <X size={18} className="text-red-400" />
            Reject Lesson
          </h3>
          <p className="text-xs text-zinc-500 mb-4 truncate">{lessonTitle}</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Reason</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-xs text-zinc-300 outline-none"
              >
                {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Optional note</label>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-xs text-zinc-300 outline-none resize-none placeholder-zinc-600"
                placeholder="Add context for the agent..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <button
              onClick={() => { onReject(reason, note); setReason(REJECT_REASONS[0]); setNote(""); }}
              className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 rounded-md text-white transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ReviewInboxPage() {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewLesson, setPreviewLesson] = useState<Lesson | null>(null);
  const [editAndApprove, setEditAndApprove] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  // Reject dialog
  const [rejectTarget, setRejectTarget] = useState<Lesson | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [agentsOpen, setAgentsOpen] = useState(false);

  const fetchReviewItems = useCallback(async () => {
    setLoading(true);
    try {
      const statuses = filter === "all" ? ["draft", "pending_review"] : [filter];
      const results = await Promise.all(
        statuses.map((status) =>
          api.listLessons({ project_id: projectId, status, limit: 100 })
        )
      );
      const all = results.flatMap((r) => r.items ?? []);
      const seen = new Set<string>();
      const deduped = all.filter((l: Lesson) => {
        if (seen.has(l.lesson_id)) return false;
        seen.add(l.lesson_id);
        return true;
      });
      deduped.sort((a: Lesson, b: Lesson) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setLessons(deduped);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load review items");
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, toast]);

  useEffect(() => { fetchReviewItems(); }, [fetchReviewItems]);

  // Fetch agents
  useEffect(() => {
    api.listAgents({ project_id: projectId })
      .then((res) => setAgents(res.agents ?? []))
      .catch(() => {});
  }, [projectId]);
  useEffect(() => { setSelectedIds(new Set()); }, [filter]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === lessons.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(lessons.map((l) => l.lesson_id)));
    }
  };

  const batchAction = async (status: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setActing(true);
    try {
      const result = await api.batchUpdateLessonStatus({
        project_id: projectId,
        lesson_ids: ids,
        status,
      });
      const count = result.updated_count ?? ids.length;
      toast("success", `${count} lesson(s) ${status === "active" ? "approved" : "archived"}`);
      setSelectedIds(new Set());
      fetchReviewItems();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Batch action failed");
    } finally {
      setActing(false);
    }
  };

  const singleAction = async (lesson: Lesson, status: string) => {
    try {
      await api.updateLessonStatus(lesson.lesson_id, { project_id: projectId, status });
      toast("success", `Lesson ${status === "active" ? "approved" : status === "archived" ? "rejected" : status}`);
      fetchReviewItems();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Action failed");
    }
  };

  const handleReject = async (lesson: Lesson, reason: string, note: string) => {
    try {
      await api.updateLessonStatus(lesson.lesson_id, { project_id: projectId, status: "archived" });
      toast("success", `Lesson rejected: ${reason}${note ? ` — ${note}` : ""}`);
      setRejectTarget(null);
      fetchReviewItems();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Reject failed");
    }
  };

  const handleEditAndApprove = (lesson: Lesson) => {
    setEditAndApprove(true);
    setPreviewLesson(lesson);
  };

  // Stats
  const agentBreakdown = lessons.reduce<Record<string, number>>((acc, l) => {
    const agent = l.captured_by ?? "unknown";
    acc[agent] = (acc[agent] ?? 0) + 1;
    return acc;
  }, {});
  const draftCount = lessons.filter((l) => l.status === "draft").length;
  const pendingCount = lessons.filter((l) => l.status === "pending_review").length;

  return (
    <div className="p-6">
      <Breadcrumb items={[{ label: "Knowledge", href: "/lessons" }, { label: "Review Inbox" }]} />
      <PageHeader
        title="Review Inbox"
        subtitle="Review and approve AI-generated lessons"
        actions={
          lessons.length > 0 ? (
            <Button variant="primary" onClick={() => batchAction("active")} disabled={acting}>
              <CheckCheck size={14} className="mr-1" />
              Approve All Visible
            </Button>
          ) : undefined
        }
      />

      {/* Stats bar */}
      {!loading && lessons.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-zinc-500 mb-5">
          <span className="flex items-center gap-1.5">
            <span className="text-zinc-300 font-medium">{lessons.length}</span> pending review
          </span>
          {Object.entries(agentBreakdown).map(([agent, count]) => (
            <span key={agent} className="flex items-center gap-1.5">
              <span className="text-zinc-700">&middot;</span>
              <AgentAvatar name={agent} />
              <span className="text-zinc-300 font-medium">{count}</span>
              <span>from {agent}</span>
            </span>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800 mb-5">
        {([
          { label: "All Pending", value: "all" as ReviewFilter, count: lessons.length },
          { label: "Draft", value: "draft" as ReviewFilter, count: draftCount },
          { label: "Pending Review", value: "pending_review" as ReviewFilter, count: pendingCount },
        ]).map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-3 py-2 text-xs font-medium -mb-px transition-colors ${
              filter === tab.value
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
            {!loading && <span className="ml-1">({tab.count})</span>}
          </button>
        ))}
      </div>

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-3 py-2 bg-zinc-900/60 border border-zinc-800 rounded-lg animate-[fadeIn_0.15s_ease-out]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.size === lessons.length && lessons.length > 0}
              onChange={selectAll}
              className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
            />
            <span className="text-xs text-zinc-400">Select all</span>
          </label>
          <span className="text-xs text-zinc-500">&middot;</span>
          <span className="text-xs text-zinc-300 font-medium">{selectedIds.size} selected</span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => batchAction("active")}
              disabled={acting}
              className="px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 rounded-md text-white transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <Check size={12} /> Approve Selected
            </button>
            <button
              onClick={() => batchAction("archived")}
              disabled={acting}
              className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-800 rounded-md text-zinc-300 hover:text-red-400 transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <X size={12} /> Reject Selected
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <TableSkeleton rows={5} />
      ) : lessons.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Inbox zero!"
          description="No lessons waiting for review. New AI-generated lessons will appear here."
        />
      ) : (
        <div className="space-y-3">
          {/* Select all (when nothing selected) */}
          {selectedIds.size === 0 && (
            <div className="flex items-center gap-2 px-1 mb-1">
              <input
                type="checkbox"
                checked={false}
                onChange={selectAll}
                className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-800 accent-blue-500"
              />
              <span className="text-[11px] text-zinc-600">Select all</span>
            </div>
          )}

          {/* Review cards */}
          {lessons.map((lesson) => {
            const isExpanded = expandedId === lesson.lesson_id;
            const isSelected = selectedIds.has(lesson.lesson_id);
            return (
              <div
                key={lesson.lesson_id}
                className={`border rounded-lg overflow-hidden transition-colors ${
                  isSelected
                    ? "border-blue-500/30 bg-zinc-900/80"
                    : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                }`}
              >
                <div className="px-4 py-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(lesson.lesson_id)}
                    className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500 mt-1 shrink-0"
                  />
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    role="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedId(isExpanded ? null : lesson.lesson_id)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium text-zinc-100 truncate">{lesson.title}</h3>
                      <Badge value={lesson.status} variant="status" />
                      <Badge value={lesson.lesson_type} variant="type" />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      {lesson.captured_by && (
                        <>
                          <AgentAvatar name={lesson.captured_by} />
                          <span>by <span className="text-zinc-400">{lesson.captured_by}</span></span>
                          <span className="text-zinc-700">&middot;</span>
                        </>
                      )}
                      <span>{relTime(lesson.created_at)}</span>
                    </div>
                    {!isExpanded && (
                      <p className="text-xs text-zinc-500 mt-1 truncate leading-relaxed">
                        {lesson.content}
                      </p>
                    )}

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="mt-3 space-y-3">
                        <div className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">
                          {lesson.content}
                        </div>
                        {lesson.tags.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            {lesson.tags.map((t) => (
                              <span key={t} className="px-1.5 py-0.5 text-[10px] bg-zinc-800 text-zinc-400 rounded">{t}</span>
                            ))}
                          </div>
                        )}
                        {/* Expanded actions */}
                        <div className="flex items-center gap-2 pt-3 border-t border-zinc-800">
                          <button
                            onClick={(e) => { e.stopPropagation(); singleAction(lesson, "active"); }}
                            className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 rounded-md text-white transition-colors flex items-center gap-1.5"
                          >
                            <Check size={14} /> Approve
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditAndApprove(lesson); }}
                            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md text-zinc-300 transition-colors flex items-center gap-1.5"
                          >
                            <Pencil size={14} /> Edit & Approve
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setRejectTarget(lesson); }}
                            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-800 rounded-md text-zinc-300 hover:text-red-400 transition-colors flex items-center gap-1.5"
                          >
                            <X size={14} /> Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Collapsed quick actions */}
                  {!isExpanded && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => { setEditAndApprove(false); setPreviewLesson(lesson); }}
                        className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                        title="Preview"
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        onClick={() => singleAction(lesson, "active")}
                        className="p-1.5 rounded-md hover:bg-emerald-500/10 text-zinc-500 hover:text-emerald-400 transition-colors"
                        title="Approve"
                      >
                        <Check size={15} />
                      </button>
                      <button
                        onClick={() => handleEditAndApprove(lesson)}
                        className="p-1.5 rounded-md hover:bg-blue-500/10 text-zinc-500 hover:text-blue-400 transition-colors"
                        title="Edit & Approve"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setRejectTarget(lesson)}
                        className="p-1.5 rounded-md hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
                        title="Reject"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Dialog */}
      <RejectDialog
        open={!!rejectTarget}
        lessonTitle={rejectTarget?.title ?? ""}
        onReject={(reason, note) => {
          if (rejectTarget) handleReject(rejectTarget, reason, note);
        }}
        onClose={() => setRejectTarget(null)}
      />

      {/* Agent Trust Levels */}
      <details className="border border-zinc-800 rounded-lg bg-zinc-900/50 mt-6" open={agentsOpen} onToggle={(e) => setAgentsOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="px-4 py-3 text-sm font-medium text-zinc-300 cursor-pointer flex items-center gap-2 hover:text-zinc-100">
          <Shield size={18} />
          Agent Trust Levels
        </summary>
        <div className="px-4 pb-4">
          {agents.length === 0 ? (
            <p className="text-xs text-zinc-600 py-2">No agents tracked yet</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="text-left py-2 font-medium">Agent</th>
                  <th className="text-left py-2 font-medium">Trust Level</th>
                  <th className="text-left py-2 font-medium">Auto-approve</th>
                  <th className="text-right py-2 font-medium">Lessons</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {agents.map((a: any) => (
                  <tr key={a.agent_id} className="border-b border-zinc-800/50">
                    <td className="py-2.5">{a.agent_id}</td>
                    <td className="py-2.5">
                      <select
                        value={a.trust_level ?? "normal"}
                        onChange={async (e) => {
                          try {
                            await api.updateAgentTrust(a.agent_id, { project_id: projectId, trust_level: e.target.value });
                            const res = await api.listAgents({ project_id: projectId });
                            setAgents(res.agents ?? []);
                          } catch {}
                        }}
                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-300 outline-none"
                      >
                        <option value="untrusted">Untrusted</option>
                        <option value="normal">Normal</option>
                        <option value="trusted">Trusted</option>
                      </select>
                    </td>
                    <td className="py-2.5">
                      <button
                        onClick={async () => {
                          try {
                            await api.updateAgentTrust(a.agent_id, { project_id: projectId, auto_approve: !a.auto_approve });
                            const res = await api.listAgents({ project_id: projectId });
                            setAgents(res.agents ?? []);
                          } catch {}
                        }}
                        className={`w-8 h-[18px] rounded-full relative transition-colors ${a.auto_approve ? "bg-blue-600" : "bg-zinc-700"}`}
                      >
                        <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full shadow-sm transition-all ${a.auto_approve ? "right-0.5 bg-white" : "left-0.5 bg-zinc-400"}`} />
                      </button>
                    </td>
                    <td className="py-2.5 text-right text-zinc-500">{a.lesson_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>

      {/* Lesson Detail Modal */}
      <LessonDetail
        lesson={previewLesson}
        onClose={() => { setPreviewLesson(null); setEditAndApprove(false); }}
        onStatusChange={fetchReviewItems}
        onTagClick={() => {}}
        initialEditMode={editAndApprove}
      />
    </div>
  );
}
