"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import {
  PageHeader,
  SearchBar,
  FilterChips,
  DataTable,
  Badge,
  Button,
  EmptyState,
  TableSkeleton,
  type Column,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { LessonDetail } from "./lesson-detail";
import { AddLessonDialog } from "./add-lesson-dialog";
import { FilterPanel } from "./filter-panel";
import { Pagination } from "./pagination";
import type { Lesson } from "./types";

type SortField = "created_at" | "title" | "lesson_type" | "status";
type SortOrder = "asc" | "desc";
type SearchMode = "text" | "semantic";

const PAGE_SIZE = 20;

export default function LessonsPage() {
  const { projectId } = useProject();
  const { toast } = useToast();

  // Data
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Pagination
  const [page, setPage] = useState(1);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("text");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Filters
  const [filterType, setFilterType] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>("active");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showAllStatuses, setShowAllStatuses] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  // Density
  const [compact, setCompact] = useState(false);

  // Panels
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset page when filters/search change
  useEffect(() => { setPage(1); }, [debouncedQuery, filterType, filterStatus, filterTags, searchMode, showAllStatuses]);

  // Fetch lessons
  const fetchLessons = useCallback(async () => {
    setLoading(true);
    try {
      if (debouncedQuery && searchMode === "semantic") {
        const result = await api.searchLessons({
          project_id: projectId,
          query: debouncedQuery,
          limit: PAGE_SIZE,
        });
        setLessons(result.results ?? result.items ?? []);
        setTotalCount(result.results?.length ?? result.items?.length ?? 0);
        setTotalPages(1);
      } else {
        const params: Record<string, string | number | undefined> = {
          project_id: projectId,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
          sort: sortField,
          order: sortOrder,
        };
        if (debouncedQuery && searchMode === "text") params.q = debouncedQuery;
        if (filterType) params.lesson_type = filterType;
        const effectiveStatus = showAllStatuses ? undefined : (filterStatus ?? "active");
        if (effectiveStatus) params.status = effectiveStatus;
        if (filterTags.length > 0) params.tags_any = filterTags.join(",");

        const result = await api.listLessons(params);
        setLessons(result.items ?? []);
        setTotalCount(result.total_count ?? 0);
        setTotalPages(result.total_pages ?? Math.max(1, Math.ceil((result.total_count ?? 0) / PAGE_SIZE)));
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load lessons");
    } finally {
      setLoading(false);
    }
  }, [projectId, page, debouncedQuery, searchMode, sortField, sortOrder, filterType, filterStatus, filterTags, showAllStatuses, toast]);

  useEffect(() => { fetchLessons(); }, [fetchLessons]);

  // ── Sort ──
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const sortArrow = (field: SortField) => {
    if (sortField !== field) return "";
    return sortOrder === "desc" ? " \u25BE" : " \u25B4";
  };

  // ── Filter chips ──
  const activeFilters: { label: string; value: string }[] = [];
  if (filterType) activeFilters.push({ label: "Type", value: filterType });
  if (filterStatus && !showAllStatuses) activeFilters.push({ label: "Status", value: filterStatus });
  for (const t of filterTags) activeFilters.push({ label: `Tag`, value: t });

  const removeFilter = (label: string, value?: string) => {
    if (label === "Type") setFilterType(undefined);
    else if (label === "Status") { setFilterStatus(undefined); setShowAllStatuses(true); }
    else if (label === "Tag" && value) setFilterTags((prev) => prev.filter((t) => t !== value));
  };

  const clearAllFilters = () => {
    setFilterType(undefined);
    setFilterStatus(undefined);
    setShowAllStatuses(true);
    setFilterTags([]);
  };

  const addTagFilter = (tag: string) => {
    setFilterTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  };

  // ── Bulk actions ──
  const handleBulkArchive = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => api.updateLessonStatus(id, { project_id: projectId, status: "archived" })));
      toast("success", `${ids.length} lesson(s) archived`);
      fetchLessons();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Archive failed");
    }
  };

  // ── Relative time ──
  const relativeTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  // ── Table columns (FIX #4: headers call handleSort on click) ──
  const columns: Column<Lesson>[] = [
    {
      key: "title",
      header: `Title${sortArrow("title")}`,
      className: "max-w-[320px] cursor-pointer",
      render: (row) => <span className="text-zinc-200">{row.title}</span>,
    },
    {
      key: "type",
      header: `Type${sortArrow("lesson_type")}`,
      className: "cursor-pointer",
      render: (row) => <Badge value={row.lesson_type} variant="type" />,
    },
    {
      key: "status",
      header: `Status${sortArrow("status")}`,
      className: "cursor-pointer",
      render: (row) => <Badge value={row.status} variant="status" />,
    },
    {
      key: "tags",
      header: "Tags",
      render: (row) => {
        const visible = row.tags.slice(0, 2);
        const rest = row.tags.length - 2;
        return (
          <div className="flex items-center gap-1">
            {visible.map((t) => (
              <span
                key={t}
                onClick={(e) => { e.stopPropagation(); addTagFilter(t); }}
                className="px-1.5 py-0.5 rounded text-[11px] bg-zinc-800 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 cursor-pointer transition-colors"
              >
                {t}
              </span>
            ))}
            {rest > 0 && (
              <span className="text-[11px] text-zinc-600" title={row.tags.slice(2).join(", ")}>
                +{rest}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "created_at",
      header: `Created${sortArrow("created_at")}`,
      className: "cursor-pointer",
      render: (row) => <span className="text-zinc-600 text-xs">{relativeTime(row.created_at)}</span>,
    },
  ];

  const isFiltered = filterStatus === "active" && !showAllStatuses;

  return (
    <div className="p-6 max-w-[1100px]">
      <PageHeader
        title="Lessons"
        subtitle="Browse, search, and manage project knowledge"
        actions={
          <>
            <Button variant="outline" onClick={() => toast("info", "Export coming soon")}>Export</Button>
            <Button variant="primary" onClick={() => setAddDialogOpen(true)}>+ Add Lesson</Button>
          </>
        }
      />

      {/* Search row with mode toggle */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search lessons..."
            filterSlot={
              <div className="relative">
                <Button variant="ghost" size="sm" onClick={() => setFilterPanelOpen(!filterPanelOpen)}>
                  Filters &#x25BE;
                </Button>
                <FilterPanel
                  open={filterPanelOpen}
                  onClose={() => setFilterPanelOpen(false)}
                  filterType={filterType}
                  filterStatus={showAllStatuses ? undefined : filterStatus}
                  onTypeChange={(v) => setFilterType(v)}
                  onStatusChange={(v) => { setFilterStatus(v); setShowAllStatuses(!v); }}
                  onClear={clearAllFilters}
                />
              </div>
            }
          />
        </div>
        <div className="flex border border-zinc-800 rounded-lg overflow-hidden shrink-0">
          <button
            onClick={() => setSearchMode("text")}
            className={`px-3 py-2 text-xs transition-colors ${searchMode === "text" ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"}`}
          >
            Text
          </button>
          <button
            onClick={() => setSearchMode("semantic")}
            className={`px-3 py-2 text-xs border-l border-zinc-800 transition-colors ${searchMode === "semantic" ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"}`}
          >
            Semantic
          </button>
        </div>
      </div>

      {/* Filter chips (FIX #3: pass value so correct tag is removed) */}
      <FilterChips
        filters={activeFilters}
        onRemove={removeFilter}
        onClearAll={clearAllFilters}
      />

      {/* Search indicator */}
      {debouncedQuery && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <span className={`w-1.5 h-1.5 rounded-full ${searchMode === "semantic" ? "bg-purple-500" : "bg-blue-500"}`} />
          {searchMode === "semantic" ? "Semantic" : "Text"} results for &ldquo;{debouncedQuery}&rdquo;
        </div>
      )}

      {/* Toolbar: hidden count + density */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-zinc-600">
          {isFiltered ? (
            <>
              Showing {totalCount} active lessons &middot;{" "}
              <button onClick={() => setShowAllStatuses(true)} className="text-blue-500 hover:underline">
                Show all
              </button>
            </>
          ) : (
            <>
              Showing all {totalCount} lessons &middot;{" "}
              <button onClick={() => { setFilterStatus("active"); setShowAllStatuses(false); }} className="text-blue-500 hover:underline">
                Active only
              </button>
            </>
          )}
        </div>
        <div className="flex border border-zinc-800 rounded-md overflow-hidden">
          <button
            onClick={() => setCompact(false)}
            className={`px-2.5 py-1 text-[11px] ${!compact ? "bg-zinc-800 text-zinc-300" : "text-zinc-600"}`}
          >
            Comfortable
          </button>
          <button
            onClick={() => setCompact(true)}
            className={`px-2.5 py-1 text-[11px] border-l border-zinc-800 ${compact ? "bg-zinc-800 text-zinc-300" : "text-zinc-600"}`}
          >
            Compact
          </button>
        </div>
      </div>

      {/* Table (FIX #4: onHeaderClick wired) */}
      {loading ? (
        <TableSkeleton rows={8} />
      ) : lessons.length === 0 ? (
        <EmptyState
          icon="📚"
          title="No lessons found"
          description={debouncedQuery ? "Try a different search query or clear filters" : "Add your first lesson to start building project knowledge"}
          action={!debouncedQuery ? <Button variant="primary" onClick={() => setAddDialogOpen(true)}>+ Add Lesson</Button> : undefined}
        />
      ) : (
        <div className={compact ? "[&_table]:text-xs [&_td]:py-1.5 [&_th]:py-1.5" : ""}>
          <DataTable
            columns={columns}
            data={lessons}
            rowKey={(r) => r.lesson_id}
            onRowClick={(r) => setSelectedLesson(r)}
            onHeaderClick={(key) => {
              const sortMap: Record<string, SortField> = { title: "title", type: "lesson_type", status: "status", created_at: "created_at" };
              const field = sortMap[key];
              if (field) handleSort(field);
            }}
            selectable
            bulkActions={[
              { label: "Archive", onClick: handleBulkArchive },
              { label: "Export JSON", onClick: (ids) => {
                const selected = lessons.filter((l) => ids.includes(l.lesson_id));
                navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
                toast("success", `${ids.length} lesson(s) copied to clipboard`);
              }},
            ]}
          />
        </div>
      )}

      {/* Pagination */}
      {!loading && lessons.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}

      <LessonDetail
        lesson={selectedLesson}
        onClose={() => setSelectedLesson(null)}
        onStatusChange={fetchLessons}
        onTagClick={addTagFilter}
      />

      <AddLessonDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdded={() => { fetchLessons(); setAddDialogOpen(false); }}
      />
    </div>
  );
}
