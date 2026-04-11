"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Breadcrumb, PageHeader, Badge, Button, EmptyState, TableSkeleton, StatCard } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { relTime } from "@/lib/rel-time";
import { FileText, Link2, Upload, Trash2, Eye, Sparkles } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { NoProjectGuard } from "@/components/no-project-guard";
import { ProjectBadge } from "@/components/project-badge";
import { UploadDialog } from "./upload-dialog";
import { DocumentViewer } from "./document-viewer";

type Doc = {
  document_id: string;
  name: string;
  doc_type: string;
  url: string | null;
  file_size_bytes: number | null;
  description: string | null;
  created_at: string;
  linked_lesson_count?: number;
};

type DocFilter = "all" | "pdf" | "markdown" | "url" | "linked" | "unlinked";

const TYPE_BADGES: Record<string, string> = {
  pdf: "bg-red-500/20 text-red-400",
  markdown: "bg-purple-500/20 text-purple-400",
  url: "bg-cyan-500/20 text-cyan-400",
  text: "bg-zinc-700 text-zinc-300",
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DocFilter>("all");
  const [uploadMode, setUploadMode] = useState<"upload" | "url" | null>(null);
  const [viewDoc, setViewDoc] = useState<Doc | null>(null);
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 12;

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = { project_id: projectId, limit: pageSize, offset: (page - 1) * pageSize };
      if (filter === "pdf" || filter === "markdown" || filter === "url") params.doc_type = filter;
      if (filter === "linked" || filter === "unlinked") params.linked = filter;
      const res = await api.listDocuments(params);
      setDocs(res.documents ?? res.items ?? []);
      setTotalCount(res.total_count ?? 0);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, page, toast]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const handleDelete = async (doc: Doc) => {
    try {
      await api.deleteDocument(doc.document_id, { project_id: projectId });
      toast("success", "Document deleted");
      fetchDocs();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Delete failed");
    }
  };

  // Stats
  const displayCount = totalCount || docs.length;
  const linkedCount = docs.filter((d) => (d.linked_lesson_count ?? 0) > 0).length;

  const TABS: { label: string; value: DocFilter }[] = [
    { label: "All", value: "all" },
    { label: "PDF", value: "pdf" },
    { label: "Markdown", value: "markdown" },
    { label: "URL", value: "url" },
    { label: "Linked", value: "linked" },
    { label: "Unlinked", value: "unlinked" },
  ];

  return (
    <NoProjectGuard>
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Knowledge", href: "/lessons" }, { label: "Documents" }]} />
      <PageHeader
        projectBadge={<ProjectBadge />}
        title="Documents"
        subtitle="Attach reference documents to your project"
        actions={
          <>
            <Button variant="outline" onClick={() => setUploadMode("url")}>
              <Link2 size={14} className="mr-1" /> Link URL
            </Button>
            <Button variant="primary" onClick={() => setUploadMode("upload")}>
              <Upload size={14} className="mr-1" /> + Upload Document
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Documents" value={totalCount} icon={<FileText size={16} />} />
        <StatCard label="Linked to Lessons" value={linkedCount} icon={<Link2 size={16} />} />
        <StatCard label="Pending Review" value={totalCount - linkedCount} icon={<Sparkles size={16} />} highlight={totalCount - linkedCount > 0} />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-zinc-800 pb-0">
        {TABS.map((tab) => (
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
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton rows={5} />
      ) : docs.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No documents"
          description={filter !== "all" ? "No documents match this filter" : "Upload or link your first document"}
          action={filter === "all" ? <Button variant="primary" onClick={() => setUploadMode("upload")}>+ Upload Document</Button> : undefined}
        />
      ) : (
        <>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-10 bg-zinc-900">
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider w-24">Type</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider w-28">Size / URL</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider w-32">Linked Lessons</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider w-24">Uploaded</th>
                <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider w-56">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {docs.map((doc) => (
                <tr key={doc.document_id} className="hover:bg-zinc-800/50 cursor-pointer transition-colors" onClick={() => setViewDoc(doc)}>
                  <td className="px-4 py-3 text-sm text-zinc-300 truncate max-w-[260px]">{doc.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${TYPE_BADGES[doc.doc_type] ?? TYPE_BADGES.text}`}>
                      {doc.doc_type.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {doc.doc_type === "url" ? "External" : formatSize(doc.file_size_bytes)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                      (doc.linked_lesson_count ?? 0) > 0 ? "bg-blue-500/20 text-blue-400" : "bg-zinc-700/50 text-zinc-500"
                    }`}>
                      {doc.linked_lesson_count ?? 0} lesson{(doc.linked_lesson_count ?? 0) !== 1 ? "s" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{relTime(doc.created_at)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1.5">
                      <button onClick={() => { setAutoGenerate(false); setViewDoc(doc); }} className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 transition-colors">
                        View
                      </button>
                      <button onClick={() => { setAutoGenerate(true); setViewDoc(doc); }} className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 transition-colors">
                        Generate Lessons
                      </button>
                      <button onClick={() => handleDelete(doc)} className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-red-400/70 hover:text-red-400 transition-colors">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalCount > pageSize && (
          <Pagination page={page} totalPages={Math.ceil(totalCount / pageSize)} totalCount={totalCount} pageSize={pageSize} onPageChange={(p) => { setPage(p);}} />
        )}
        </>
      )}

      {/* Upload dialog */}
      {uploadMode && (
        <UploadDialog
          open={true}
          mode={uploadMode}
          onClose={() => setUploadMode(null)}
          onUploaded={fetchDocs}
        />
      )}

      {/* Document viewer */}
      {viewDoc && (
        <DocumentViewer
          doc={viewDoc}
          onClose={() => { setViewDoc(null); setAutoGenerate(false); }}
          onChanged={fetchDocs}
          autoGenerate={autoGenerate}
        />
      )}
    </div>
    </NoProjectGuard>
  );
}
