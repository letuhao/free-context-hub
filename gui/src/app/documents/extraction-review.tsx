"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";
import { X, FileText, Table as TableIcon, Code, FileImage, Hash, Edit2, Trash2, Save, Wand2 } from "lucide-react";
import { MarkdownContent } from "../chat/markdown-content";
import { MermaidChunk } from "./mermaid-chunk";
import type { Doc, DocumentChunk, ChunkType } from "./types";

interface ExtractionReviewProps {
  open: boolean;
  doc: Pick<Doc, "doc_id" | "name" | "doc_type">;
  initialChunks?: DocumentChunk[];
  onClose: () => void;
  onReExtract?: () => void;
  /** Optional: trigger re-extraction with a specific prompt template (F8). */
  onReExtractAsMermaid?: () => void;
}

const TYPE_BADGE: Record<ChunkType, { label: string; cls: string; icon: any }> = {
  text: { label: "text", cls: "bg-zinc-700 text-zinc-300", icon: FileText },
  table: { label: "table", cls: "bg-amber-500/15 text-amber-400", icon: TableIcon },
  code: { label: "code", cls: "bg-blue-500/15 text-blue-400", icon: Code },
  diagram_description: { label: "diagram", cls: "bg-purple-500/15 text-purple-400", icon: FileImage },
  mermaid: { label: "mermaid", cls: "bg-cyan-500/15 text-cyan-400", icon: FileImage },
};

/** Colour for confidence indicator (F10). */
function confidenceColor(conf: number | null): { bg: string; text: string; label: string } {
  if (conf === null) return { bg: "bg-zinc-800", text: "text-zinc-500", label: "n/a" };
  if (conf >= 0.9) return { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "high" };
  if (conf >= 0.5) return { bg: "bg-amber-500/15", text: "text-amber-400", label: "partial" };
  return { bg: "bg-red-500/15", text: "text-red-400", label: "failed" };
}

export function ExtractionReview({ open, doc, initialChunks, onClose, onReExtract, onReExtractAsMermaid }: ExtractionReviewProps) {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [chunks, setChunks] = useState<DocumentChunk[]>(initialChunks ?? []);
  const [loading, setLoading] = useState(!initialChunks);
  const [activeChunkIdx, setActiveChunkIdx] = useState(0);

  // F6: chunk editing state
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState("");
  const [saving, setSaving] = useState(false);

  // F7: delete-in-progress
  const [deleting, setDeleting] = useState(false);

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

  useEffect(() => {
    if (initialChunks) {
      setChunks(initialChunks);
      setActiveChunkIdx(0);
    }
  }, [initialChunks]);

  useEffect(() => {
    if (activeChunkIdx >= chunks.length && chunks.length > 0) {
      setActiveChunkIdx(0);
    }
  }, [chunks.length, activeChunkIdx]);

  // Cancel edit mode whenever the active chunk changes.
  // Guard against silent data loss if the user has unsaved edits.
  useEffect(() => {
    if (editing && editBuffer && editBuffer !== chunks[activeChunkIdx]?.content) {
      // Unsaved edits for the *previous* chunk were already lost by the time
      // this fires (activeChunkIdx has already moved). Best we can do is warn.
      // The navigator click handler below should gate the switch instead.
    }
    setEditing(false);
    setEditBuffer("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChunkIdx]);

  /** Gated chunk switch — prompts if there are unsaved edits. */
  const switchToChunk = (nextIdx: number) => {
    if (nextIdx === activeChunkIdx) return;
    if (editing && editBuffer && editBuffer !== chunks[activeChunkIdx]?.content) {
      if (!confirm("You have unsaved changes to this chunk. Discard them?")) return;
    }
    setActiveChunkIdx(nextIdx);
  };

  // ESC closes (but first exits edit mode if active)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editing) {
          setEditing(false);
          setEditBuffer("");
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, editing]);

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
      // Worst confidence on the page (drives F10 page badge colour)
      minConfidence: list.reduce<number | null>((acc, c) => {
        if (c.confidence === null) return acc;
        return acc === null ? c.confidence : Math.min(acc, c.confidence);
      }, null),
    }));
  }, [chunks]);

  const activeChunk = chunks[activeChunkIdx];

  // F6: save edited content
  const handleSaveEdit = async () => {
    if (!activeChunk || saving) return;
    const trimmed = editBuffer.trim();
    if (!trimmed) {
      toast("error", "Chunk content cannot be empty — use Delete instead");
      return;
    }
    setSaving(true);
    try {
      const res = await api.updateDocumentChunk(doc.doc_id, activeChunk.chunk_id, {
        project_id: projectId,
        content: trimmed,
        expected_updated_at: activeChunk.updated_at,
      });
      if (res.status === "ok" && res.chunk) {
        setChunks((prev) =>
          prev.map((c) => (c.chunk_id === activeChunk.chunk_id ? (res.chunk as DocumentChunk) : c)),
        );
        toast("success", "Chunk saved and re-embedded");
        setEditing(false);
        setEditBuffer("");
      } else {
        toast("error", "Failed to save chunk");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      if (msg.includes("409")) {
        toast("error", "Chunk was modified elsewhere — reload and try again");
      } else {
        toast("error", msg);
      }
    } finally {
      setSaving(false);
    }
  };

  // F7: delete (skip) chunk
  const handleDelete = async () => {
    if (!activeChunk || deleting) return;
    if (!confirm(`Delete chunk #${activeChunk.chunk_index}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteDocumentChunk(doc.doc_id, activeChunk.chunk_id, { project_id: projectId });
      setChunks((prev) => prev.filter((c) => c.chunk_id !== activeChunk.chunk_id));
      toast("success", "Chunk deleted");
      // Adjust pointer
      setActiveChunkIdx((idx) => Math.max(0, Math.min(idx, chunks.length - 2)));
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]" onClick={() => { if (!editing) onClose(); }} />
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
              {onReExtractAsMermaid && chunks.length > 0 && (
                <Button variant="outline" size="sm" onClick={onReExtractAsMermaid} title="Re-run vision extraction with a diagram-focused prompt">
                  <Wand2 size={12} className="mr-1" /> Extract as Mermaid
                </Button>
              )}
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
                    const conf = confidenceColor(c.confidence);
                    return (
                      <button
                        key={c.chunk_id}
                        onClick={() => switchToChunk(i)}
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
                          {c.confidence !== null && c.confidence < 0.9 && (
                            <span className={`text-[9px] px-1 py-0.5 rounded ${conf.bg} ${conf.text}`} title={`confidence ${(c.confidence * 100).toFixed(0)}%`}>
                              {conf.label}
                            </span>
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

              {/* Right pane: active chunk preview / editor */}
              <div className="flex-1 flex flex-col min-h-0">
                {activeChunk && (
                  <>
                    <div className="px-5 py-3 border-b border-zinc-800 shrink-0 flex items-center gap-3 flex-wrap">
                      <span className="text-xs font-medium text-zinc-300">
                        Chunk #{activeChunk.chunk_index}
                      </span>
                      {activeChunk.heading && (
                        <span className="text-xs text-zinc-500 truncate max-w-xs">
                          {activeChunk.heading}
                        </span>
                      )}
                      {activeChunk.confidence !== null && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${confidenceColor(activeChunk.confidence).bg} ${confidenceColor(activeChunk.confidence).text}`}>
                          conf {(activeChunk.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-600">
                        {activeChunk.content.length} chars
                      </span>
                      {!editing ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditing(true);
                              setEditBuffer(activeChunk.content);
                            }}
                          >
                            <Edit2 size={11} className="mr-1" /> Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDelete}
                            disabled={deleting}
                          >
                            <Trash2 size={11} className="mr-1" /> {deleting ? "Deleting…" : "Skip"}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setEditing(false); setEditBuffer(""); }}
                            disabled={saving}
                          >
                            Cancel
                          </Button>
                          <button
                            onClick={handleSaveEdit}
                            disabled={saving}
                            className="px-3 py-1 text-[11px] bg-blue-600 hover:bg-blue-500 rounded text-white font-medium disabled:opacity-50 flex items-center gap-1"
                          >
                            <Save size={11} /> {saving ? "Saving…" : "Save & re-embed"}
                          </button>
                        </>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto px-6 py-5">
                      {editing ? (
                        <textarea
                          value={editBuffer}
                          onChange={(e) => setEditBuffer(e.target.value)}
                          className="w-full h-full min-h-[400px] bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-200 font-mono leading-relaxed resize-none focus:outline-none focus:border-blue-500"
                          spellCheck={false}
                          autoFocus
                        />
                      ) : activeChunk.chunk_type === "mermaid" ? (
                        <MermaidChunk code={activeChunk.content} />
                      ) : activeChunk.chunk_type === "code" ? (
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

          {/* F10: Page navigator footer with confidence legend */}
          {pages.length > 0 && (
            <div className="border-t border-zinc-800 px-4 py-2 shrink-0 flex items-center gap-3 flex-wrap">
              {pages.length > 1 && (
                <>
                  <span className="text-[10px] text-zinc-600">Pages:</span>
                  <div className="flex gap-1 overflow-x-auto">
                    {pages.map((p) => {
                      const firstChunkIdx = chunks.findIndex((c) => c.chunk_index === p.chunks[0].chunk_index);
                      const isOnPage =
                        activeChunk?.page_number === (typeof p.key === "number" ? p.key : null);
                      const conf = confidenceColor(p.minConfidence);
                      return (
                        <button
                          key={String(p.key)}
                          onClick={() => switchToChunk(firstChunkIdx)}
                          className={`px-2 py-1 rounded text-[10px] font-medium transition-colors border ${
                            isOnPage
                              ? "bg-blue-500/15 text-blue-400 border-blue-500/40"
                              : `${conf.bg} ${conf.text} border-transparent hover:border-zinc-700`
                          }`}
                          title={p.minConfidence !== null ? `min confidence: ${(p.minConfidence * 100).toFixed(0)}%` : undefined}
                        >
                          {p.label}
                          <span className="ml-1 text-[9px] opacity-60">({p.chunks.length})</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {/* Confidence legend */}
              <div className="ml-auto flex items-center gap-2 text-[9px] text-zinc-600">
                <span>Confidence:</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">high</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">partial</span>
                <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">failed</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
