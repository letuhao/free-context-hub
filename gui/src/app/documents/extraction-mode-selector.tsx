"use client";

import { useState, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui";
import { X, FileText, Eye, Zap, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import type { Doc, DocumentChunk, ExtractionMode } from "./types";

interface ExtractionModeSelectorProps {
  open: boolean;
  doc: Pick<Doc, "doc_id" | "name" | "doc_type" | "file_size_bytes">;
  onClose: () => void;
  onExtracted: (chunks: DocumentChunk[], mode: ExtractionMode) => void;
}

const MODE_INFO: Record<ExtractionMode, { title: string; subtitle: string; tags: { label: string; color: "good" | "neutral" | "warn" }[]; disabled?: boolean; disabledReason?: string }> = {
  fast: {
    title: "Fast Text",
    subtitle: "Pure JS extraction (pdf-parse + mammoth). Instant, free, runs locally. Best for clean text PDFs and simple DOCX.",
    tags: [
      { label: "Free", color: "good" },
      { label: "Instant", color: "good" },
      { label: "No diagrams", color: "neutral" },
      { label: "Limited tables", color: "neutral" },
    ],
  },
  quality: {
    title: "Quality Text",
    subtitle: "Uses pdftotext and pandoc. Better DOCX/PDF, supports EPUB, ODT, RTF, HTML.",
    tags: [
      { label: "Free", color: "good" },
      { label: "Instant", color: "good" },
      { label: "Tables ✓", color: "good" },
      { label: "More formats", color: "good" },
    ],
  },
  vision: {
    title: "Vision Extraction",
    subtitle: "Sends pages as images to your configured vision model. Best for diagrams, complex tables, scans.",
    tags: [
      { label: "Coming Sprint 10.3", color: "warn" },
    ],
    disabled: true,
    disabledReason: "Vision mode will be available in Sprint 10.3",
  },
};

const tagColor = (c: "good" | "neutral" | "warn") =>
  c === "good"
    ? "bg-emerald-500/10 text-emerald-400"
    : c === "warn"
      ? "bg-amber-500/10 text-amber-400"
      : "bg-zinc-800 text-zinc-500";

export function ExtractionModeSelector({ open, doc, onClose, onExtracted }: ExtractionModeSelectorProps) {
  const { projectId } = useProject();
  const { toast } = useToast();
  const [selected, setSelected] = useState<ExtractionMode>("fast");
  const [extracting, setExtracting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick elapsed seconds during extraction so the user knows the request is alive
  useEffect(() => {
    if (extracting) {
      setElapsed(0);
      elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, [extracting]);

  if (!open) return null;

  const handleExtract = async () => {
    setExtracting(true);
    try {
      const res = await api.extractDocument(doc.doc_id, {
        project_id: projectId,
        mode: selected,
      });
      toast("success", `Extracted ${res.chunks.length} chunks from ${res.pages} page${res.pages !== 1 ? "s" : ""}`);
      onExtracted(res.chunks, selected);
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  const sizeKb = doc.file_size_bytes ? `${(doc.file_size_bytes / 1024).toFixed(1)} KB` : "";

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
        onClick={() => { if (!extracting) onClose(); }}
      />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 pointer-events-none">
        <div role="dialog" aria-label="Extract document" className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto">
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-100">Extract Document</h2>
              <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-md">
                {doc.name} {sizeKb && <span className="text-zinc-700">· {sizeKb}</span>}
              </p>
            </div>
            <button onClick={onClose} disabled={extracting} className="text-zinc-500 hover:text-zinc-300 p-1 disabled:opacity-30">
              <X size={18} />
            </button>
          </div>

          {/* Extraction in-progress banner */}
          {extracting && (
            <div className="px-6 pt-5">
              <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-4 flex items-center gap-3">
                <Loader2 size={20} className="text-blue-400 animate-spin shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-blue-300 font-medium">Extracting with {MODE_INFO[selected].title}…</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Reading content, chunking, and embedding (~{Math.max(elapsed, 1)}s elapsed). This may take 10–30 seconds for large documents.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Mode cards */}
          <div className={`px-6 py-5 space-y-3 ${extracting ? "opacity-40 pointer-events-none" : ""}`}>
            <p className="text-xs text-zinc-500 mb-1">Choose extraction mode</p>
            {(["fast", "quality", "vision"] as ExtractionMode[]).map((mode) => {
              const info = MODE_INFO[mode];
              const isSelected = selected === mode;
              return (
                <button
                  key={mode}
                  onClick={() => !info.disabled && setSelected(mode)}
                  disabled={info.disabled}
                  className={`w-full text-left border-2 rounded-xl p-4 transition-all ${
                    info.disabled
                      ? "border-zinc-800 bg-zinc-900/30 opacity-50 cursor-not-allowed"
                      : isSelected
                        ? "border-blue-500 bg-blue-500/5"
                        : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-600"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      mode === "fast" ? "bg-blue-500/10 text-blue-400" :
                      mode === "quality" ? "bg-emerald-500/10 text-emerald-400" :
                      "bg-purple-500/10 text-purple-400"
                    }`}>
                      {mode === "fast" ? <Zap size={16} /> : mode === "quality" ? <FileText size={16} /> : <Eye size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-medium text-zinc-100">{info.title}</h3>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          isSelected && !info.disabled ? "border-blue-500" : "border-zinc-700"
                        }`}>
                          {isSelected && !info.disabled && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-500 leading-relaxed mb-2">{info.subtitle}</p>
                      <div className="flex flex-wrap gap-1">
                        {info.tags.map((t) => (
                          <span key={t.label} className={`px-1.5 py-0.5 rounded-full text-[10px] ${tagColor(t.color)}`}>
                            {t.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between">
            <p className="text-[10px] text-zinc-600">
              {extracting
                ? "Please wait — closing the modal won't cancel the request"
                : "Extraction will replace any existing chunks for this document"}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={extracting}>
                Cancel
              </Button>
              <button
                onClick={handleExtract}
                disabled={extracting || MODE_INFO[selected].disabled}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white font-medium disabled:opacity-50 flex items-center gap-1.5"
              >
                {extracting && <Loader2 size={12} className="animate-spin" />}
                {extracting ? "Extracting…" : "Start Extraction"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
