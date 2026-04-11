"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Breadcrumb, PageHeader, SearchBar, Badge, EmptyState } from "@/components/ui";
import { LineSkeleton } from "@/components/ui/loading-skeleton";
import { NoProjectGuard } from "@/components/no-project-guard";
import { ProjectBadge } from "@/components/project-badge";
import { useToast } from "@/components/ui/toast";

type SearchResult = {
  file_path: string;
  snippet: string;
  score?: number;
  kind?: string;
  tier?: string;
  chunk_index?: number;
};

const KIND_OPTIONS = [
  "all",
  "source",
  "type_def",
  "test",
  "migration",
  "config",
  "dependency",
  "api_spec",
  "doc",
  "script",
  "infra",
  "style",
  "generated",
] as const;

type Kind = (typeof KIND_OPTIONS)[number];

const TIER_COLORS: Record<string, string> = {
  exact: "bg-green-900/50 text-green-400",
  glob: "bg-blue-900/50 text-blue-400",
  fts: "bg-yellow-900/50 text-yellow-400",
  semantic: "bg-purple-900/50 text-purple-400",
};

export default function CodeSearchPage() {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Debounce query (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const doSearch = useCallback(async () => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      const params: Record<string, unknown> = {
        project_id: projectId,
        query: debouncedQuery.trim(),
        max_files: 30,
      };
      if (kind !== "all") params.kind = kind;

      const res = await api.searchCode(params);
      setResults(res.results ?? res.items ?? res.files ?? []);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, debouncedQuery, kind, toast]);

  useEffect(() => {
    doSearch();
  }, [doSearch]);

  return (
    <NoProjectGuard requireSingleProject pageName="Code Search">
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Knowledge", href: "/lessons" }, { label: "Code Search" }]} />
      <PageHeader
        title="Code Search"
        projectBadge={<ProjectBadge />}
        subtitle="Search project code with tiered retrieval"
      />

      {/* Search + Kind filter */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search code files..."
          />
        </div>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-sm text-zinc-300 outline-none focus:border-zinc-600 transition-colors shrink-0"
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k === "all" ? "All kinds" : k.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="p-4 border border-zinc-800 rounded-lg">
              <LineSkeleton lines={2} />
            </div>
          ))}
        </div>
      )}

      {/* Empty: no query yet */}
      {!loading && !searched && (
        <EmptyState
          icon="\uD83D\uDD0D"
          title="Enter a search query to find code"
          description="Search across project files by name, content, or semantic meaning"
        />
      )}

      {/* Empty: no results */}
      {!loading && searched && results.length === 0 && (
        <EmptyState
          icon="\uD83D\uDDC2\uFE0F"
          title={`No results found for "${debouncedQuery}"`}
          description="Try a different query or change the kind filter"
        />
      )}

      {/* Results list */}
      {!loading && results.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-600 mb-2">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </div>
          {results.map((r, i) => (
            <div
              key={`${r.file_path}-${r.chunk_index ?? i}`}
              className="p-4 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors"
            >
              {/* Header row: path + badges */}
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="font-mono text-sm text-blue-400 break-all">
                  {r.file_path}
                </span>
                {r.kind && <Badge value={r.kind} variant="type" />}
                {r.tier && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${TIER_COLORS[r.tier] ?? "bg-zinc-800 text-zinc-400"}`}
                  >
                    {r.tier}
                  </span>
                )}
                {r.score != null && (
                  <span className="text-[11px] text-zinc-600 ml-auto">
                    score {r.score.toFixed(2)}
                  </span>
                )}
              </div>

              {/* Snippet preview */}
              {r.snippet && (
                <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3 whitespace-pre-wrap font-mono">
                  {r.snippet.length > 200
                    ? r.snippet.slice(0, 200) + "..."
                    : r.snippet}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    </NoProjectGuard>
  );
}
