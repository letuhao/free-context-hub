"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { relTime } from "@/lib/rel-time";
import { PageHeader, StatCard, Button, EmptyState } from "@/components/ui";
import { StatCardSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Stats {
  lessons: number;
  guardrails: number;
  commits: number;
  docs: number;
}

interface ProjectSummary {
  summary?: string;
  generated_at?: string;
}

export default function ProjectsPage() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [stats, setStats] = useState<Stats>({ lessons: 0, guardrails: 0, commits: 0, docs: 0 });
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Action loading states
  const [indexing, setIndexing] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

      // Extract guardrail count from lessons with type "guardrail"
      let guardrailCount = 0;
      try {
        const grRes = await api.listLessons({ project_id: projectId, lesson_type: "guardrail", limit: 1 });
        guardrailCount = grRes.total_count ?? 0;
      } catch { /* ignore */ }

      setStats({ lessons: lessonCount, guardrails: guardrailCount, commits: commitCount, docs: docCount });

      if (summaryRes.status === "fulfilled" && summaryRes.value) {
        setSummary(summaryRes.value);
      }
    } catch (err) {
      toastRef.current("error", "Failed to load project data");
    } finally {
      setInitialLoad(false);
    }
  }, [projectId]);

  useEffect(() => {
    setInitialLoad(true);
    fetchAll();
  }, [fetchAll]);

  // Auto-refresh every 30s (no skeleton flash)
  useEffect(() => {
    const interval = setInterval(fetchAll, 30_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // ── Actions ──

  const handleIndex = async () => {
    setIndexing(true);
    try {
      await api.indexProject(projectId);
      toastRef.current("success", "Re-index started");
      fetchAll();
    } catch (err) {
      toastRef.current("error", `Re-index failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIndexing(false);
    }
  };

  const handleReflect = async () => {
    setReflecting(true);
    try {
      await api.reflectProject(projectId, { project_id: projectId });
      toastRef.current("success", "Reflection started");
      fetchAll();
    } catch (err) {
      toastRef.current("error", `Reflect failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setReflecting(false);
    }
  };

  const handleIngestGit = async () => {
    setIngesting(true);
    try {
      await api.ingestGit({ project_id: projectId });
      toastRef.current("success", "Git ingest started");
      fetchAll();
    } catch (err) {
      toastRef.current("error", `Git ingest failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIngesting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteWorkspace(projectId);
      toastRef.current("success", "Workspace deleted");
    } catch (err) {
      toastRef.current("error", `Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl">
      <PageHeader
        title="Project Overview"
        subtitle={projectId}
        actions={
          <div className="flex items-center gap-2">
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
        }
      />

      {/* ── Stats ── */}
      {initialLoad ? (
        <StatCardSkeleton count={4} />
      ) : (
        <div className="flex gap-4 flex-wrap">
          <StatCard value={stats.lessons} label="Lessons" />
          <StatCard value={stats.guardrails} label="Guardrails" />
          <StatCard value={stats.commits} label="Commits" />
          <StatCard value={stats.docs} label="Generated Docs" />
        </div>
      )}

      {/* ── Project Summary ── */}
      <div className="mt-8">
        <button
          onClick={() => setSummaryOpen(!summaryOpen)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
        >
          <span className="text-zinc-600 text-xs">{summaryOpen ? "\u25BC" : "\u25B6"}</span>
          Project Summary
        </button>

        {summaryOpen && (
          <div className="mt-3 p-4 bg-zinc-900 border border-zinc-800 rounded-lg">
            {summary?.summary ? (
              <>
                <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                  {summary.summary}
                </p>
                {summary.generated_at && (
                  <p className="text-xs text-zinc-600 mt-3">
                    Generated {relTime(summary.generated_at)}
                  </p>
                )}
              </>
            ) : (
              <EmptyState
                title="No summary yet"
                description="Click Reflect to generate a project summary."
              />
            )}
          </div>
        )}
      </div>

      {/* ── Danger Zone ── */}
      <div className="mt-10">
        <button
          onClick={() => setDangerOpen(!dangerOpen)}
          className="flex items-center gap-2 text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
        >
          <span className="text-red-600 text-xs">{dangerOpen ? "\u25BC" : "\u25B6"}</span>
          Danger Zone
        </button>

        {dangerOpen && (
          <div className="mt-3 p-4 bg-zinc-900 border border-red-500/20 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-100">Delete Workspace</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Permanently delete all lessons, guardrails, commits, and generated docs for this project.
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Workspace"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Delete Confirm Dialog ── */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Delete Workspace"
        description={`This will permanently delete all data for project "${projectId}". This action cannot be undone.`}
        confirmText="Delete"
        confirmValue={projectId}
        destructive
      />
    </div>
  );
}
