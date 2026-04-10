"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { relTime } from "@/lib/rel-time";
import {
  Breadcrumb,
  PageHeader,
  DataTable,
  Badge,
  Button,
  EmptyState,
  TableSkeleton,
  type Column,
} from "@/components/ui";
import { SlideOver, SlideOverSection } from "@/components/ui/slide-over";
import { Pagination } from "@/components/ui/pagination";
import { NoProjectGuard } from "@/components/no-project-guard";
import { useToast } from "@/components/ui/toast";

type GeneratedDoc = {
  doc_id: string;
  doc_type: string;
  doc_key: string;
  title: string | null;
  content: string | null;
  source_job_id: string | null;
  promoted: boolean;
  created_at: string;
  updated_at: string;
};

const DOC_TYPE_TABS = ["all", "faq", "raptor", "qc_report", "qc_artifact", "benchmark_artifact"] as const;
type DocTypeTab = (typeof DOC_TYPE_TABS)[number];

const DOC_TYPE_LABELS: Record<string, string> = {
  all: "All",
  faq: "FAQ",
  raptor: "RAPTOR",
  qc_report: "QC Report",
  qc_artifact: "QC Artifact",
  benchmark_artifact: "Benchmark",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  faq: "bg-emerald-500/10 text-emerald-400",
  raptor: "bg-blue-500/10 text-blue-400",
  qc_report: "bg-amber-500/10 text-amber-400",
  qc_artifact: "bg-amber-500/10 text-amber-400",
  benchmark_artifact: "bg-purple-500/10 text-purple-400",
};

export default function GeneratedDocsPage() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [docs, setDocs] = useState<GeneratedDoc[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [activeTab, setActiveTab] = useState<DocTypeTab>("all");
  const [selectedDoc, setSelectedDoc] = useState<GeneratedDoc | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 12;

  const fetchDocs = useCallback(async () => {
    try {
      const result = await api.listGeneratedDocs({
        project_id: projectId,
        include_content: "true",
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setDocs(result.items ?? []);
      setTotalCount(result.total_count ?? 0);
    } catch {
      toastRef.current("error", "Failed to load generated documents");
    } finally {
      setInitialLoad(false);
    }
  }, [projectId, page]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const filtered =
    activeTab === "all" ? docs : docs.filter((d) => d.doc_type === activeTab);

  const handlePromote = async (doc: GeneratedDoc) => {
    setPromoting(true);
    try {
      await api.promoteGeneratedDoc(doc.doc_id, {
        project_id: projectId,
      });
      toastRef.current("success", "Document promoted successfully");
      setSelectedDoc(null);
      fetchDocs();
    } catch (err) {
      toastRef.current(
        "error",
        err instanceof Error ? err.message : "Failed to promote document",
      );
    } finally {
      setPromoting(false);
    }
  };

  // ── Table columns ──
  const columns: Column<GeneratedDoc>[] = [
    {
      key: "doc_type",
      header: "Type",
      className: "w-[120px]",
      render: (row) => {
        const color = DOC_TYPE_COLORS[row.doc_type] ?? "bg-zinc-500/10 text-zinc-400";
        return (
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}
          >
            {DOC_TYPE_LABELS[row.doc_type] ?? row.doc_type}
          </span>
        );
      },
    },
    {
      key: "title",
      header: "Title / Key",
      className: "max-w-[400px]",
      render: (row) => (
        <span className="text-zinc-200 truncate block">
          {row.title ?? row.doc_key}
        </span>
      ),
    },
    {
      key: "updated_at",
      header: "Updated",
      className: "w-[120px]",
      render: (row) => (
        <span className="text-zinc-600 text-xs">{relTime(row.updated_at)}</span>
      ),
    },
  ];

  return (
    <NoProjectGuard>
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Knowledge", href: "/lessons" }, { label: "Generated Docs" }]} />
      <PageHeader
        title="Generated Documents"
        subtitle="Browse FAQ, RAPTOR summaries, QC reports, and benchmark artifacts"
      />

      {/* Type filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-zinc-800">
        {DOC_TYPE_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-zinc-100 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {DOC_TYPE_LABELS[tab] ?? tab}
          </button>
        ))}
      </div>

      {/* Content */}
      {initialLoad ? (
        <TableSkeleton rows={8} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No generated documents yet"
          description="Generated documents are created by running FAQ, RAPTOR, or QC jobs. Enqueue a job from the Jobs page to build your first document."
        />
      ) : (
        <>
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(r) => r.doc_id}
          onRowClick={(r) => setSelectedDoc(r)}
        />
        {totalCount > pageSize && (
          <Pagination page={page} totalPages={Math.ceil(totalCount / pageSize)} totalCount={totalCount} pageSize={pageSize} onPageChange={(p) => { setPage(p);}} />
        )}
        </>
      )}

      {/* SlideOver detail panel */}
      <SlideOver
        open={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        title={selectedDoc?.title ?? selectedDoc?.doc_key ?? "Document"}
        subtitle={
          selectedDoc ? (
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                  DOC_TYPE_COLORS[selectedDoc.doc_type] ?? "bg-zinc-500/10 text-zinc-400"
                }`}
              >
                {DOC_TYPE_LABELS[selectedDoc.doc_type] ?? selectedDoc.doc_type}
              </span>
              <span className="text-xs text-zinc-600">
                Updated {relTime(selectedDoc.updated_at)}
              </span>
              {selectedDoc.promoted && (
                <span className="text-xs text-emerald-400">Promoted</span>
              )}
            </div>
          ) : undefined
        }
        wide
        footer={
          selectedDoc ? (
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={() => handlePromote(selectedDoc)}
                disabled={promoting || selectedDoc.promoted}
              >
                {promoting
                  ? "Promoting..."
                  : selectedDoc.promoted
                    ? "Already Promoted"
                    : "Promote"}
              </Button>
            </div>
          ) : undefined
        }
      >
        {selectedDoc && (
          <>
            <SlideOverSection title="Content">
              <pre className="whitespace-pre-wrap text-sm text-zinc-300 leading-relaxed font-sans">
                {selectedDoc.content ?? "No content available."}
              </pre>
            </SlideOverSection>

            {selectedDoc.source_job_id && (
              <SlideOverSection title="Source">
                <span className="text-xs text-zinc-500 font-mono">
                  Job: {selectedDoc.source_job_id}
                </span>
              </SlideOverSection>
            )}
          </>
        )}
      </SlideOver>
    </div>
    </NoProjectGuard>
  );
}
