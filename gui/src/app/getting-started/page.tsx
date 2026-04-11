"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Breadcrumb, PageHeader, Badge, Button, TableSkeleton } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { NoProjectGuard } from "@/components/no-project-guard";
import { ProjectBadge } from "@/components/project-badge";
import { CheckCircle2, Circle, Play, RotateCcw, Share2, ArrowRight } from "lucide-react";

type LearningItem = {
  lesson_id: string;
  title: string;
  lesson_type: string;
  content: string;
  completed: boolean;
};

type LearningSection = {
  title: string;
  icon: string;
  items: LearningItem[];
};

export default function GettingStartedPage() {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [sections, setSections] = useState<LearningSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchPath = useCallback(async () => {
    setLoading(true);
    try {
      // Try to load learning paths; fallback to building from lessons
      const res = await api.listLearningPaths({ project_id: projectId, user_id: "gui-user" });
      const paths = res.paths ?? res.items ?? [];

      if (paths.length > 0) {
        // Use learning path data
        setSections(paths.map((p: any) => ({
          title: p.title ?? "Section",
          icon: p.icon ?? "📚",
          items: (p.lessons ?? []).map((l: any) => ({
            lesson_id: l.lesson_id,
            title: l.title,
            lesson_type: l.lesson_type ?? "general_note",
            content: l.content ?? "",
            completed: l.completed ?? false,
          })),
        })));
      } else {
        // Fallback: build sections from active lessons grouped by type
        const lessonsRes = await api.listLessons({ project_id: projectId, status: "active", limit: 50 });
        const lessons = lessonsRes.items ?? [];
        const grouped: Record<string, LearningItem[]> = {};
        for (const l of lessons) {
          const type = l.lesson_type ?? "general_note";
          (grouped[type] ??= []).push({
            lesson_id: l.lesson_id,
            title: l.title,
            lesson_type: type,
            content: l.content ?? "",
            completed: false,
          });
        }
        const sectionNames: Record<string, string> = {
          decision: "Architecture & Design",
          preference: "Code Conventions",
          workaround: "Known Workarounds",
          guardrail: "Safety & Guardrails",
          general_note: "General Knowledge",
        };
        setSections(
          Object.entries(grouped).map(([type, items]) => ({
            title: sectionNames[type] ?? type,
            icon: type,
            items,
          }))
        );
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load learning path");
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => { fetchPath(); }, [fetchPath]);

  const totalItems = sections.reduce((s, sec) => s + sec.items.length, 0);
  const completedItems = sections.reduce((s, sec) => s + sec.items.filter((i) => i.completed).length, 0);
  const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  const toggleComplete = async (lessonId: string) => {
    // Optimistic update
    const wasCompleted = sections.flatMap(s => s.items).find(i => i.lesson_id === lessonId)?.completed ?? false;
    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        items: sec.items.map((item) =>
          item.lesson_id === lessonId ? { ...item, completed: !item.completed } : item
        ),
      }))
    );
    // Persist to API
    try {
      await api.updateLearningProgress("default", { user_id: "gui-user", lesson_id: lessonId, completed: !wasCompleted });
    } catch {
      // Revert on failure
      setSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          items: sec.items.map((item) =>
            item.lesson_id === lessonId ? { ...item, completed: wasCompleted } : item
          ),
        }))
      );
      toast("error", "Failed to save progress");
    }
  };

  // Find next uncompleted item
  const nextItem = sections.flatMap((s) => s.items).find((i) => !i.completed);

  return (
    <NoProjectGuard>
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Knowledge", href: "/lessons" }, { label: "Getting Started" }]} />
      <PageHeader
        projectBadge={<ProjectBadge />}
        title="Getting Started"
        subtitle="Learn your project's key decisions, patterns, and guardrails"
        actions={
          <>
            <Button variant="outline" onClick={() => { setSections((s) => s.map((sec) => ({ ...sec, items: sec.items.map((i) => ({ ...i, completed: false })) }))); }}>
              <RotateCcw size={14} className="mr-1" /> Reset Progress
            </Button>
          </>
        }
      />

      {/* Progress overview */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-zinc-300">{completedItems} of {totalItems} completed</span>
          <span className="text-sm font-semibold text-emerald-400">{progressPct}%</span>
        </div>
        <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        {totalItems > completedItems && (
          <p className="text-xs text-zinc-500 mt-2 flex items-center gap-1.5">
            <Circle size={14} className="text-zinc-600" />
            Estimated time: ~{(totalItems - completedItems) * 2} min remaining
          </p>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : sections.length === 0 ? (
        <div className="text-center py-12 text-sm text-zinc-500">
          No lessons found. Add some lessons to build your learning path.
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => {
            const secCompleted = section.items.filter((i) => i.completed).length;
            return (
              <div key={section.title}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-medium text-zinc-200">{section.title}</h2>
                  <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                    {secCompleted}/{section.items.length} completed
                  </span>
                </div>
                <div className="space-y-1 ml-1">
                  {section.items.map((item) => {
                    const isExpanded = expandedId === item.lesson_id;
                    const isCurrent = item.lesson_id === nextItem?.lesson_id && !item.completed;

                    if (item.completed) {
                      return (
                        <div key={item.lesson_id} className="flex items-center gap-3 px-3 py-2 rounded-md">
                          <button onClick={() => toggleComplete(item.lesson_id)}>
                            <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                          </button>
                          <span className="text-xs text-zinc-500 line-through">{item.title}</span>
                          <Badge value={item.lesson_type} variant="type" />
                        </div>
                      );
                    }

                    if (isCurrent) {
                      return (
                        <div key={item.lesson_id} className="border-l-2 border-blue-500 bg-blue-500/5 rounded-r-lg px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Play size={16} className="text-blue-400 shrink-0" />
                            <span className="text-xs text-zinc-100 font-medium">{item.title}</span>
                            <Badge value={item.lesson_type} variant="type" />
                          </div>
                          <div className="mt-2 ml-7 text-xs text-zinc-400 leading-relaxed">
                            <p>{item.content.slice(0, 200)}{item.content.length > 200 ? "..." : ""}</p>
                          </div>
                          <div className="mt-2 ml-7 flex items-center gap-3">
                            <button
                              onClick={() => toggleComplete(item.lesson_id)}
                              className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
                            >
                              <CheckCircle2 size={14} /> Mark Complete
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={item.lesson_id} className="flex items-center gap-3 px-3 py-2 rounded-md">
                        <Circle size={16} className="text-zinc-600 shrink-0" />
                        <span className="text-xs text-zinc-400">{item.title}</span>
                        <Badge value={item.lesson_type} variant="type" />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </NoProjectGuard>
  );
}
