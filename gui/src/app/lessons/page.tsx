"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import {
  Breadcrumb,
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
import { relTime } from "@/lib/rel-time";
import { Upload, Download, Bookmark } from "lucide-react";
import { LessonDetail } from "./lesson-detail";
import { AddLessonDialog } from "./add-lesson-dialog";
import { ImportDialog } from "./import-dialog";
import { FilterPanel } from "./filter-panel";
import { Pagination } from "@/components/ui/pagination";
import type { Lesson } from "./types";

type SortField = "created_at" | "title" | "lesson_type" | "status";
type SortOrder = "asc" | "desc";
type SearchMode = "text" | "semantic";

const PAGE_SIZE = 20;

export default function LessonsPage() {
  const { projectId, includeGroups } = useProject();
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

  // Tab counts
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});

  // Panels
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [showBookmarked, setShowBookmarked] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset page when filters/search change
  useEffect(() => { setPage(1); }, [debouncedQuery, filterType, filterStatus, filterTags, searchMode, showAllStatuses, showBookmarked]);

  // Fetch lessons
  const fetchLessons = useCallback(async () => {
    setLoading(true);
    try {
      if (debouncedQuery && searchMode === "semantic") {
        const result = await api.searchLessons({
          project_id: projectId,
          include_groups: includeGroups || undefined,
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
        let items = result.items ?? [];

        // Client-side bookmark filter
        if (showBookmarked) {
          try {
            const bk = await api.listBookmarks({ user_id: "gui-user", project_id: projectId });
            const bkIds = new Set((bk.bookmarks ?? []).map((b: any) => b.lesson_id));
            items = items.filter((l: any) => bkIds.has(l.lesson_id));
          } catch {}
        }

        setLessons(items);
        setTotalCount(showBookmarked ? items.length : (result.total_count ?? 0));
        setTotalPages(showBookmarked ? 1 : (result.total_pages ?? Math.max(1, Math.ceil((result.total_count ?? 0) / PAGE_SIZE))));
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load lessons");
    } finally {
      setLoading(false);
    }
  }, [projectId, page, debouncedQuery, searchMode, sortField, sortOrder, filterType, filterStatus, filterTags, showAllStatuses, showBookmarked, includeGroups, toast]);

  useEffect(() => { fetchLessons(); }, [fetchLessons]);

  // Fetch tab counts (on mount + when lessons change)
  useEffect(() => {
    const statuses = ["active", "draft", "pending_review", "superseded", "archived"];
    Promise.all(
      statuses.map((s) =>
        api.listLessons({ project_id: projectId, status: s, limit: 1 })
          .then((r) => [s, r.total_count ?? 0] as const)
          .catch(() => [s, 0] as const)
      )
    ).then((results) => {
      const counts: Record<string, number> = {};
      let total = 0;
      for (const [s, c] of results) { counts[s] = c; total += c; }
      counts.all = total;
      counts.review = (counts.draft ?? 0) + (counts.pending_review ?? 0);
      setTabCounts(counts);
    });
  }, [projectId, loading]); // re-fetch when loading changes (after data mutation)

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

  // ── Table columns ──
  const columns: Column<Lesson>[] = [
    // Show source project column when searching across groups.
    ...(includeGroups && searchMode === "semantic" && debouncedQuery
      ? [{
          key: "project_id" as const,
          header: "Source",
          render: (row: Lesson) => (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                row.project_id === projectId
                  ? "bg-zinc-800 text-zinc-400"
                  : "bg-blue-900/30 text-blue-400 border border-blue-800/40"
              }`}
            >
              {row.project_id}
            </span>
          ),
        }]
      : []),
    {
      key: "title",
      header: `Title`,
      className: "max-w-[320px] cursor-pointer",
      render: (row) => <span className="text-zinc-200">{row.title}</span>,
    },
    {
      key: "type",
      header: `Type`,
      className: "cursor-pointer",
      render: (row) => <Badge value={row.lesson_type} variant="type" />,
    },
    {
      key: "status",
      header: `Status`,
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
      key: "feedback",
      header: "Feedback",
      render: (row: any) => {
        const up = row.feedback_up ?? 0;
        const down = row.feedback_down ?? 0;
        const total = up + down;
        if (total === 0) return <span className="text-[10px] text-zinc-600">—</span>;
        const pct = Math.round((up / total) * 100);
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400 text-[10px]">↑{up}</span>
            <span className="text-red-400 text-[10px]">↓{down}</span>
            <div className="w-10 h-1 bg-zinc-700 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      key: "created_at",
      header: `Created`,
      className: "cursor-pointer",
      render: (row) => <span className="text-zinc-600 text-xs">{relTime(row.created_at)}</span>,
    },
  ];

  return (
    <div className="p-6 max-w-[1100px]">
      <Breadcrumb items={[{ label: "Knowledge", href: "/lessons" }, { label: "Lessons" }]} />
      <PageHeader
        title="Lessons"
        subtitle="Browse, search, and manage project knowledge"
        actions={
          <>
            <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
              <Upload size={12} className="mr-1" /> Import
            </Button>
            <Button variant="outline" onClick={async () => {
              try {
                const data = await api.exportLessons({ project_id: projectId, format: "json" });
                const blob = new Blob([JSON.stringify(data.lessons ?? data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = `${projectId}-lessons.json`; a.click();
                URL.revokeObjectURL(url);
                toast("success", "Lessons exported");
              } catch (err) { toast("error", err instanceof Error ? err.message : "Export failed"); }
            }}>
              <Download size={12} className="mr-1" /> Export
            </Button>
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

      {/* Status tabs + density */}
      <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-1">
          {([
            { label: "All", countKey: "all", statuses: undefined, hasAmberDot: false },
            { label: "Active", countKey: "active", statuses: "active", hasAmberDot: false },
            { label: "Draft / Pending Review", countKey: "review", statuses: "draft,pending_review", hasAmberDot: true },
            { label: "Superseded", countKey: "superseded", statuses: "superseded", hasAmberDot: false },
          ] as const).map((tab) => {
            // "All" tab is active when showAllStatuses is true
            // Other tabs match against their statuses
            const isActive = tab.statuses === undefined
              ? showAllStatuses
              : !showAllStatuses && (
                  tab.statuses.includes(",")
                    ? tab.statuses.split(",").includes(filterStatus ?? "")
                    : filterStatus === tab.statuses
                );
            const count = tabCounts[tab.countKey];
            return (
              <button
                key={tab.label}
                onClick={() => {
                  if (tab.statuses === undefined) {
                    setShowAllStatuses(true);
                    setFilterStatus(undefined);
                  } else {
                    setShowAllStatuses(false);
                    // For combined tab, filter by "draft" (shows both in BE query via multiple fetches in review inbox)
                    setFilterStatus(tab.statuses.includes(",") ? "draft" : tab.statuses);
                  }
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  isActive
                    ? "bg-zinc-800 text-zinc-100 border border-zinc-700"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                }`}
              >
                {tab.hasAmberDot && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                )}
                {tab.label}
                {count !== undefined && (
                  <span className={isActive ? "text-zinc-400" : "text-zinc-600"}>({count})</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBookmarked(!showBookmarked)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
              showBookmarked
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
            }`}
          >
            <Bookmark size={14} fill={showBookmarked ? "currentColor" : "none"} />
            Bookmarked
          </button>
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
            sortKey={sortField === "lesson_type" ? "type" : sortField === "status" ? "status" : sortField}
            sortOrder={sortOrder}
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

      <ImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImported={() => { fetchLessons(); setImportDialogOpen(false); }}
      />
    </div>
  );
}
