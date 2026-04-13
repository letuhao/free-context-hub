"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";
import { X, FileText, Table as TableIcon, Code, FileImage, Hash } from "lucide-react";
import { MarkdownContent } from "../chat/markdown-content";
import type { Doc, DocumentChunk, ChunkType } from "./types";

interface ExtractionReviewProps {
  open: boolean;
  doc: Pick<Doc, "doc_id" | "name" | "doc_type">;
  initialChunks?: DocumentChunk[];
  onClose: () => void;
  onReExtract?: () => void;
}

const TYPE_BADGE: Record<ChunkType, { label: string; cls: string; icon: any }> = {
  text: { label: "text", cls: "bg-zinc-700 text-zinc-300", icon: FileText },
  table: { label: "table", cls: "bg-amber-500/15 text-amber-400", icon: TableIcon },
  code: { label: "code", cls: "bg-blue-500/15 text-blue-400", icon: Code },
  diagram_description: { label: "diagram", cls: "bg-purple-500/15 text-purple-400", icon: FileImage },
  mermaid: { label: "mermaid", cls: "bg-cyan-500/15 text-cyan-400", icon: FileImage },
};

export function ExtractionReview({ open, doc, initialChunks, onClose, onReExtract }: ExtractionReviewProps) {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [chunks, setChunks] = useState<DocumentChunk[]>(initialChunks ?? []);
  const [loading, setLoading] = useState(!initialChunks);
  const [activeChunkIdx, setActiveChunkIdx] = useState(0);

  const fetchChunks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDocumentChunks(doc.doc_id, { project_id: projectId });
      setChunks(res.chunks ?? []);
      if (!res.chunks || res.chunks.length === 0) {
        toast("info", "No chunks yet — run extraction first");
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load chunks");
    } finally {
      setLoading(false);
    }
  }, [doc.doc_id, projectId, toast]);

  useEffect(() => {
    if (open && !initialChunks) fetchChunks();
  }, [open, initialChunks, fetchChunks]);

  // Sync state when initialChunks prop changes (e.g. after re-extraction).
  // Also reset the active chunk pointer to avoid out-of-bounds when chunk
  // count shrinks.
  useEffect(() => {
    if (initialChunks) {
      setChunks(initialChunks);
      setActiveChunkIdx(0);
    }
  }, [initialChunks]);

  // Clamp activeChunkIdx if chunks array shrinks for any reason
  useEffect(() => {
    if (activeChunkIdx >= chunks.length && chunks.length > 0) {
      setActiveChunkIdx(0);
    }
  }, [chunks.length, activeChunkIdx]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Group chunks by page for the navigator
  const pages = useMemo(() => {
    const map = new Map<number | string, DocumentChunk[]>();
    for (const c of chunks) {
      const key = c.page_number ?? "all";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries()).map(([key, list]) => ({
      key,
      label: typeof key === "number" ? `p${key}` : "all",
      chunks: list.sort((a, b) => a.chunk_index - b.chunk_index),
    }));
  }, [chunks]);

  const activeChunk = chunks[activeChunkIdx];

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div role="dialog" aria-label="Extraction review" className="w-full h-[90vh] max-w-7xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <h2 className="text-base font-semibold text-zinc-100 truncate max-w-md">{doc.name}</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-medium">
                {doc.doc_type.toUpperCase()}
              </span>
              {chunks.length > 0 && (
                <span className="text-xs text-zinc-500 flex items-center gap-1">
                  <Hash size={12} /> {chunks.length} chunks
                </span>
              )}
              {chunks[0]?.extraction_mode && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium">
                  {chunks[0].extraction_mode}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {onReExtract && chunks.length > 0 && (
                <Button variant="outline" size="sm" onClick={onReExtract}>
                  Re-extract
                </Button>
              )}
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1">
                <X size={18} />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-zinc-500">Loading chunks…</p>
            </div>
          ) : chunks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <p className="text-sm text-zinc-400">No chunks for this document yet</p>
              {onReExtract ? (
                <button
                  onClick={onReExtract}
                  className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white font-medium"
                >
                  Extract Now
                </button>
              ) : (
                <p className="text-xs text-zinc-600">Use the Extract button to run the extraction pipeline</p>
              )}
            </div>
          ) : (
            <div className="flex flex-1 min-h-0">
              {/* Left pane: chunk list */}
              <div className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto">
                <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 font-medium border-b border-zinc-800/60">
                  Chunks
                </div>
                <div className="py-1">
                  {chunks.map((c, i) => {
                    const isActive = i === activeChunkIdx;
                    const badge = TYPE_BADGE[c.chunk_type];
                    const Icon = badge.icon;
                    return (
                      <button
                        key={c.chunk_id}
                        onClick={() => setActiveChunkIdx(i)}
                        className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${
                          isActive
                            ? "bg-zinc-800/60 border-l-blue-500"
                            : "border-l-transparent hover:bg-zinc-800/30"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Icon size={11} className="text-zinc-500 shrink-0" />
                          <span className="text-[10px] text-zinc-500">#{c.chunk_index}</span>
                          {c.page_number !== null && (
                            <span className="text-[10px] text-zinc-600">p{c.page_number}</span>
                          )}
                          <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>
                        <p className={`text-xs truncate ${isActive ? "text-zinc-200" : "text-zinc-400"}`}>
                          {c.heading ?? c.content.slice(0, 60).replace(/\n/g, " ")}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right pane: active chunk preview */}
              <div className="flex-1 flex flex-col min-h-0">
                {activeChunk && (
                  <>
                    <div className="px-5 py-3 border-b border-zinc-800 shrink-0 flex items-center gap-3">
                      <span className="text-xs font-medium text-zinc-300">
                        Chunk #{activeChunk.chunk_index}
                      </span>
                      {activeChunk.heading && (
                        <span className="text-xs text-zinc-500 truncate">
                          {activeChunk.heading}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-600">
                        {activeChunk.content.length} chars
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto px-6 py-5">
                      {activeChunk.chunk_type === "code" || activeChunk.chunk_type === "mermaid" ? (
                        <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">
                          {activeChunk.content}
                        </pre>
                      ) : (
                        <MarkdownContent content={activeChunk.content} />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Page navigator footer */}
          {pages.length > 1 && (
            <div className="border-t border-zinc-800 px-4 py-2 shrink-0 flex items-center gap-3">
              <span className="text-[10px] text-zinc-600">Pages:</span>
              <div className="flex gap-1 overflow-x-auto">
                {pages.map((p) => {
                  const firstChunkIdx = chunks.findIndex((c) => c.chunk_index === p.chunks[0].chunk_index);
                  const isOnPage =
                    activeChunk?.page_number === (typeof p.key === "number" ? p.key : null);
                  return (
                    <button
                      key={String(p.key)}
                      onClick={() => setActiveChunkIdx(firstChunkIdx)}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                        isOnPage
                          ? "bg-blue-500/15 text-blue-400 border border-blue-500/40"
                          : "bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-transparent"
                      }`}
                    >
                      {p.label}
                      <span className="ml-1 text-[9px] opacity-60">({p.chunks.length})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
