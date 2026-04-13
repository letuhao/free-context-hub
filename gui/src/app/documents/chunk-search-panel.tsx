"use client";

import { useState } from "react";
import { Search, Loader2, FileText, Table as TableIcon, Code, FileImage, X, AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import type { Doc } from "./types";

interface ChunkSearchResult {
  chunk_id: string;
  doc_id: string;
  doc_name: string;
  doc_type: string;
  chunk_index: number;
  content_snippet: string;
  page_number: number | null;
  heading: string | null;
  chunk_type: string;
  extraction_mode: string | null;
  score: number;
  sem_score: number;
  fts_score: number;
}

const CHUNK_TYPES = ["text", "table", "code", "diagram_description", "mermaid"] as const;
type ChunkTypeFilter = typeof CHUNK_TYPES[number];

const TYPE_ICON: Record<string, any> = {
  text: FileText,
  table: TableIcon,
  code: Code,
  diagram_description: FileImage,
  mermaid: FileImage,
};

const TYPE_COLOR: Record<string, string> = {
  text: "bg-zinc-700/50 text-zinc-300",
  table: "bg-amber-500/15 text-amber-400",
  code: "bg-blue-500/15 text-blue-400",
  diagram_description: "bg-purple-500/15 text-purple-400",
  mermaid: "bg-cyan-500/15 text-cyan-400",
};

interface ChunkSearchPanelProps {
  onOpenDocument: (doc: Pick<Doc, "doc_id" | "name" | "doc_type"> & { doc_type: any }) => void;
}

export function ChunkSearchPanel({ onOpenDocument }: ChunkSearchPanelProps) {
  const { projectId } = useProject();
  const { toast } = useToast();
  const PAGE_SIZE = 20;
  const MAX_RESULTS = 100;
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [results, setResults] = useState<ChunkSearchResult[] | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<ChunkTypeFilter>>(new Set());
  const [explanations, setExplanations] = useState<string[]>([]);
  /** Has the latest request likely hit the server-side cap? We can't know
   *  for sure without a cursor, so "more available" = last batch returned
   *  a full PAGE_SIZE AND total < MAX_RESULTS. */
  const [hasMore, setHasMore] = useState(false);

  const toggleType = (t: ChunkTypeFilter) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    try {
      const res = await api.searchDocumentChunks({
        project_id: projectId,
        query: q,
        limit: PAGE_SIZE,
        chunk_types: selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined,
      });
      setResults(res.matches);
      setExplanations(res.explanations ?? []);
      setHasMore(res.matches.length >= PAGE_SIZE);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Search failed");
      setResults([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  /** Load more results. The backend endpoint doesn't support offset yet,
   *  so we re-query with a larger limit and slice off the head we already
   *  have. Capped at MAX_RESULTS to bound the largest single request. */
  const loadMore = async () => {
    const q = query.trim();
    if (!q || !results) return;
    const nextLimit = Math.min(results.length + PAGE_SIZE, MAX_RESULTS);
    setLoadingMore(true);
    try {
      const res = await api.searchDocumentChunks({
        project_id: projectId,
        query: q,
        limit: nextLimit,
        chunk_types: selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined,
      });
      setResults(res.matches);
      setHasMore(res.matches.length >= nextLimit && nextLimit < MAX_RESULTS);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Load more failed");
    } finally {
      setLoadingMore(false);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setResults(null);
    setExplanations([]);
    setSelectedTypes(new Set());
  };

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Search size={14} className="text-zinc-500" />
        <span className="text-xs font-medium text-zinc-300">Semantic chunk search</span>
        <span className="text-[10px] text-zinc-600">— search inside extracted documents</span>
      </div>

      {/* Query input */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg focus-within:border-blue-500 transition-colors">
          <Search size={12} className="text-zinc-600 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            placeholder="e.g. retry policy, authentication flow, request payload schema…"
            className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          {query && (
            <button onClick={clearSearch} className="text-zinc-600 hover:text-zinc-400">
              <X size={12} />
            </button>
          )}
        </div>
        <button
          onClick={runSearch}
          disabled={loading || !query.trim()}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-white font-medium flex items-center gap-1"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
          Search
        </button>
      </div>

      {/* Type filters */}
      <div className="flex flex-wrap gap-1 mb-2">
        <span className="text-[10px] text-zinc-600 mr-1 self-center">Type:</span>
        {CHUNK_TYPES.map((t) => {
          const active = selectedTypes.has(t);
          return (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                active
                  ? "bg-blue-500/15 text-blue-300 border-blue-500/40"
                  : "bg-zinc-800 text-zinc-500 border-zinc-800 hover:border-zinc-700"
              }`}
            >
              {t}
            </button>
          );
        })}
        {selectedTypes.size > 0 && (
          <button
            onClick={() => setSelectedTypes(new Set())}
            className="px-2 py-0.5 rounded-full text-[10px] text-zinc-600 hover:text-zinc-400"
          >
            clear
          </button>
        )}
      </div>

      {/* Results */}
      {results !== null && (
        <div className="mt-3 pt-3 border-t border-zinc-800/60">
          {/* P3: embedding-down warning banner — surfaces the fallback
              explanation from searchChunks so users know results are
              keyword-only, not semantic. */}
          {explanations.some((e) => e.toLowerCase().includes("embedding service unavailable")) && (
            <div className="mb-2 border border-amber-500/30 bg-amber-500/5 rounded-md p-2 flex items-start gap-2">
              <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-amber-300 font-medium mb-0.5">
                  Semantic search unavailable
                </p>
                <p className="text-[10px] text-zinc-500 break-words">
                  Results are ranked by keyword match only. Check the embeddings service and retry.
                </p>
              </div>
              <button
                onClick={runSearch}
                disabled={loading}
                className="shrink-0 text-[10px] text-amber-300 hover:text-amber-200 flex items-center gap-1"
              >
                <RefreshCw size={10} className={loading ? "animate-spin" : ""} /> retry
              </button>
            </div>
          )}

          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-zinc-500">
              {results.length} result{results.length !== 1 ? "s" : ""}
              {explanations.length > 0 && (
                <span className="text-zinc-600"> · {explanations[0]}</span>
              )}
            </span>
          </div>

          {results.length === 0 ? (
            <p className="text-[11px] text-zinc-600 py-4 text-center">
              No chunks matched. Try different terms, remove type filters, or extract more documents.
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {results.map((r) => {
                const Icon = TYPE_ICON[r.chunk_type] ?? FileText;
                const color = TYPE_COLOR[r.chunk_type] ?? TYPE_COLOR.text;
                return (
                  <button
                    key={r.chunk_id}
                    onClick={() => onOpenDocument({ doc_id: r.doc_id, name: r.doc_name, doc_type: r.doc_type as any })}
                    className="w-full text-left p-3 border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/60 hover:border-zinc-700 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon size={11} className="text-zinc-500 shrink-0" />
                      <span className="text-xs font-medium text-zinc-200 truncate">{r.doc_name}</span>
                      {r.page_number !== null && (
                        <span className="text-[10px] text-zinc-600">p{r.page_number}</span>
                      )}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${color}`}>
                        {r.chunk_type}
                      </span>
                      <span className="ml-auto text-[10px] font-mono text-blue-400">
                        {(r.score * 100).toFixed(0)}%
                      </span>
                    </div>
                    {r.heading && (
                      <p className="text-[10px] text-zinc-500 mb-1 truncate">§ {r.heading}</p>
                    )}
                    <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-3">
                      {r.content_snippet}
                    </p>
                  </button>
                );
              })}
              {hasMore && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore || results.length >= MAX_RESULTS}
                  className="w-full py-2 text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800/40 rounded-md transition-colors flex items-center justify-center gap-1.5"
                >
                  {loadingMore ? (
                    <><Loader2 size={11} className="animate-spin" /> Loading…</>
                  ) : (
                    <>Load more ({MAX_RESULTS - results.length} max)</>
                  )}
                </button>
              )}
              {results.length >= MAX_RESULTS && (
                <p className="text-[10px] text-zinc-600 text-center py-1">
                  Reached maximum of {MAX_RESULTS} results — refine your query for narrower matches
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
