"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { relTime } from "@/lib/rel-time";
import {
  Breadcrumb,
  PageHeader,
  DataTable,
  Button,
  EmptyState,
  TableSkeleton,
  type Column,
} from "@/components/ui";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";

type Commit = {
  sha: string;
  message: string;
  author: string;
  date: string;
  files_changed?: number;
};

type CommitDetail = {
  sha: string;
  message: string;
  author: string;
  date: string;
  files: { path: string; status: string; additions: number; deletions: number }[];
};

type SuggestedLesson = {
  title: string;
  content: string;
  lesson_type: string;
  tags?: string[];
};

export default function GitHistoryPage() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [commits, setCommits] = useState<Commit[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Ingest state
  const [ingesting, setIngesting] = useState(false);

  // Suggest lessons state
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedLesson[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 12;

  const fetchCommits = useCallback(async () => {
    try {
      const result = await api.listCommits({ project_id: projectId, limit: pageSize, offset: (page - 1) * pageSize });
      setCommits(result.items ?? []);
      setTotalCount(result.total_count ?? 0);
    } catch {
      toastRef.current("error", "Failed to load commits");
    } finally {
      setInitialLoad(false);
    }
  }, [projectId, page]);

  useEffect(() => { fetchCommits(); }, [fetchCommits]);

  // Expand row: fetch commit detail
  const handleRowClick = useCallback(async (row: Commit) => {
    if (expandedSha === row.sha) {
      setExpandedSha(null);
      setCommitDetail(null);
      return;
    }
    setExpandedSha(row.sha);
    setCommitDetail(null);
    setDetailLoading(true);
    try {
      const detail = await api.getCommit(row.sha, { project_id: projectId });
      setCommitDetail(detail);
    } catch {
      toastRef.current("error", "Failed to load commit details");
      setExpandedSha(null);
    } finally {
      setDetailLoading(false);
    }
  }, [expandedSha, projectId]);

  const handleIngest = async () => {
    setIngesting(true);
    try {
      await api.ingestGit({ project_id: projectId });
      toastRef.current("success", "Git history ingestion started");
      fetchCommits();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setIngesting(false);
    }
  };

  const handleSuggestLessons = async () => {
    setSuggesting(true);
    try {
      const result = await api.suggestLessons({ project_id: projectId });
      const items = result.suggestions ?? result.items ?? [];
      setSuggestions(items);
      setShowSuggestions(true);
      if (items.length === 0) {
        toastRef.current("info", "No lesson suggestions found");
      } else {
        toastRef.current("success", `${items.length} lesson(s) suggested`);
      }
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Suggest failed");
    } finally {
      setSuggesting(false);
    }
  };

  const columns: Column<Commit>[] = [
    {
      key: "sha",
      header: "SHA",
      className: "w-24",
      render: (row) => (
        <span className="font-mono text-xs text-blue-400">{row.sha.slice(0, 7)}</span>
      ),
    },
    {
      key: "message",
      header: "Message",
      className: "max-w-[420px]",
      render: (row) => (
        <span className="text-zinc-200 truncate block max-w-[420px]">
          {row.message.length > 80 ? row.message.slice(0, 80) + "..." : row.message}
        </span>
      ),
    },
    {
      key: "author",
      header: "Author",
      className: "w-36",
      render: (row) => <span className="text-zinc-400 text-xs">{row.author}</span>,
    },
    {
      key: "date",
      header: "Age",
      className: "w-20",
      render: (row) => <span className="text-zinc-600 text-xs">{relTime(row.date)}</span>,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Project", href: "/projects" }, { label: "Git History" }]} />
      <PageHeader
        title="Git History"
        subtitle="Browse commits, ingest history, suggest lessons"
        actions={
          <>
            <Button variant="outline" onClick={handleSuggestLessons} disabled={suggesting}>
              {suggesting ? "Suggesting..." : "Suggest Lessons"}
            </Button>
            <Button variant="primary" onClick={handleIngest} disabled={ingesting}>
              {ingesting ? "Ingesting..." : "Ingest New Commits"}
            </Button>
          </>
        }
      />

      {/* Suggested lessons panel */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="mb-4 border border-zinc-800 rounded-lg bg-zinc-950 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-zinc-200">Suggested Lessons</h3>
            <button
              onClick={() => setShowSuggestions(false)}
              className="text-xs text-zinc-600 hover:text-zinc-400"
            >
              Dismiss
            </button>
          </div>
          <ul className="space-y-2">
            {suggestions.map((s, i) => (
              <li key={i} className="p-3 bg-zinc-900 border border-zinc-800 rounded-md">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-zinc-200">{s.title}</span>
                  <span className="px-1.5 py-0.5 rounded text-[11px] bg-zinc-800 text-zinc-500">
                    {s.lesson_type}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">{s.content}</p>
                {s.tags && s.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {s.tags.map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-600">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Table */}
      {initialLoad ? (
        <TableSkeleton rows={8} />
      ) : commits.length === 0 ? (
        <EmptyState
          icon="📂"
          title="No commits ingested yet"
          description="Ingest your git history to browse commits and generate lessons"
          action={
            <Button variant="primary" onClick={handleIngest} disabled={ingesting}>
              {ingesting ? "Ingesting..." : "Ingest Git History"}
            </Button>
          }
        />
      ) : (
        <>
        <DataTable
          columns={columns}
          data={commits}
          rowKey={(r) => r.sha}
          onRowClick={handleRowClick}
          rowActions={(row) =>
            expandedSha === row.sha ? (
              <div className="text-xs text-zinc-500 mt-1 p-3 bg-zinc-950 rounded-md border border-zinc-800">
                {detailLoading ? (
                  <div className="flex items-center gap-2 text-zinc-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-pulse" />
                    Loading commit details...
                  </div>
                ) : commitDetail ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div>
                        <span className="text-zinc-600">SHA:</span>{" "}
                        <span className="font-mono text-blue-400">{commitDetail.sha}</span>
                      </div>
                      <div>
                        <span className="text-zinc-600">Author:</span>{" "}
                        <span className="text-zinc-300">{commitDetail.author}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-zinc-600">Date:</span>{" "}
                        <span className="text-zinc-400">{new Date(commitDetail.date).toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="mb-2">
                      <span className="text-zinc-600">Message:</span>
                      <p className="mt-1 text-zinc-300 whitespace-pre-wrap">{commitDetail.message}</p>
                    </div>
                    {commitDetail.files && commitDetail.files.length > 0 && (
                      <div>
                        <span className="text-zinc-600">
                          Files changed ({commitDetail.files.length}):
                        </span>
                        <div className="mt-1.5 space-y-1 max-h-[200px] overflow-y-auto">
                          {commitDetail.files.map((f) => (
                            <div
                              key={f.path}
                              className="flex items-center gap-2 px-2 py-1 bg-zinc-900 rounded text-[11px] font-mono"
                            >
                              <span
                                className={
                                  f.status === "added"
                                    ? "text-green-500"
                                    : f.status === "deleted"
                                    ? "text-red-500"
                                    : "text-yellow-500"
                                }
                              >
                                {f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M"}
                              </span>
                              <span className="text-zinc-400 truncate flex-1">{f.path}</span>
                              {(f.additions > 0 || f.deletions > 0) && (
                                <span className="text-zinc-600 shrink-0">
                                  <span className="text-green-600">+{f.additions}</span>{" "}
                                  <span className="text-red-600">-{f.deletions}</span>
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            ) : null
          }
        />
        {totalCount > pageSize && (
          <Pagination page={page} totalPages={Math.ceil(totalCount / pageSize)} totalCount={totalCount} pageSize={pageSize} onPageChange={(p) => { setPage(p);}} />
        )}
        </>
      )}
    </div>
  );
}
