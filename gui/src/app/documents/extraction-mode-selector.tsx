"use client";

import { useState, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui";
import { X, FileText, Eye, Zap, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import { ExtractionProgress } from "./extraction-progress";
import type { Doc, DocumentChunk, ExtractionMode } from "./types";

interface ExtractionModeSelectorProps {
  open: boolean;
  doc: Pick<Doc, "doc_id" | "name" | "doc_type" | "file_size_bytes">;
  onClose: () => void;
  onExtracted: (chunks: DocumentChunk[], mode: ExtractionMode) => void;
}

const MODE_INFO: Record<ExtractionMode, { title: string; subtitle: string; tags: { label: string; color: "good" | "neutral" | "warn" }[] }> = {
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
      { label: "Async", color: "neutral" },
      { label: "Diagrams ✓", color: "good" },
      { label: "Tables ✓", color: "good" },
      { label: "Slow", color: "warn" },
    ],
  },
};

const VISION_SUPPORTED_TYPES = ["pdf", "image"];

const tagColor = (c: "good" | "neutral" | "warn") =>
  c === "good"
    ? "bg-emerald-500/10 text-emerald-400"
    : c === "warn"
      ? "bg-amber-500/10 text-amber-400"
      : "bg-zinc-800 text-zinc-500";

interface Estimate {
  page_count: number | null;
  estimated_usd: number | null;
  provider: string;
  estimated_seconds: number;
}

export function ExtractionModeSelector({ open, doc, onClose, onExtracted }: ExtractionModeSelectorProps) {
  const { projectId } = useProject();
  const { toast } = useToast();
  const [selected, setSelected] = useState<ExtractionMode>("fast");
  const [extracting, setExtracting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // F2: cost estimate state
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  // F3/F4: async vision progress tracking
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const visionUnsupported = !VISION_SUPPORTED_TYPES.includes(doc.doc_type);

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

  // F2: fetch estimate when Vision is selected
  useEffect(() => {
    if (!open || selected !== "vision" || visionUnsupported) {
      setEstimate(null);
      setEstimateError(null);
      return;
    }
    let cancelled = false;
    setEstimateLoading(true);
    setEstimateError(null);
    api
      .extractEstimate(doc.doc_id, { project_id: projectId, mode: "vision" })
      .then((res) => {
        if (cancelled) return;
        setEstimate({
          page_count: res.page_count,
          estimated_usd: res.estimated_usd,
          provider: res.provider,
          estimated_seconds: res.estimated_seconds,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setEstimateError(err instanceof Error ? err.message : "Could not fetch estimate");
      })
      .finally(() => {
        if (!cancelled) setEstimateLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, selected, visionUnsupported, doc.doc_id, projectId]);

  if (!open) return null;

  // F3/F4: if a vision job is active, show the progress modal instead
  if (activeJobId) {
    return (
      <ExtractionProgress
        docId={doc.doc_id}
        docName={doc.name}
        jobId={activeJobId}
        onDone={async () => {
          // Fetch the chunks and propagate to parent
          try {
            const res = await api.getDocumentChunks(doc.doc_id, { project_id: projectId });
            onExtracted(res.chunks as DocumentChunk[], "vision");
            toast("success", `Extracted ${res.chunks.length} chunks via vision`);
          } catch (err) {
            toast("error", err instanceof Error ? err.message : "Failed to load chunks");
          }
          setActiveJobId(null);
          onClose();
        }}
        onCancelled={() => {
          setActiveJobId(null);
          toast("info", "Vision extraction cancelled");
        }}
        onFailed={(msg) => {
          setActiveJobId(null);
          toast("error", msg || "Vision extraction failed");
        }}
        onClose={() => setActiveJobId(null)}
      />
    );
  }

  const handleExtract = async () => {
    setExtracting(true);
    try {
      const res = await api.extractDocument(doc.doc_id, {
        project_id: projectId,
        mode: selected,
      });

      // Async path: vision returns { status: 'queued', job_id }
      if (res.status === "queued" && res.job_id) {
        setExtracting(false);
        setActiveJobId(res.job_id);
        return;
      }

      // Sync path: fast/quality return chunks immediately
      if (res.chunks) {
        toast("success", `Extracted ${res.chunks.length} chunks from ${res.pages} page${res.pages !== 1 ? "s" : ""}`);
        onExtracted(res.chunks as DocumentChunk[], selected);
        onClose();
      }
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
        <div role="dialog" aria-label="Extract document" className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto max-h-[90vh] overflow-y-auto">
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
              const isDisabled = mode === "vision" && visionUnsupported;
              return (
                <button
                  key={mode}
                  onClick={() => !isDisabled && setSelected(mode)}
                  disabled={isDisabled}
                  title={isDisabled ? `Vision mode supports ${VISION_SUPPORTED_TYPES.join(", ")} only — use Quality Text for ${doc.doc_type}` : undefined}
                  className={`w-full text-left border-2 rounded-xl p-4 transition-all ${
                    isDisabled
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
                          isSelected && !isDisabled ? "border-blue-500" : "border-zinc-700"
                        }`}>
                          {isSelected && !isDisabled && <div className="w-2 h-2 rounded-full bg-blue-500" />}
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

            {/* F2: cost estimate panel for vision */}
            {selected === "vision" && !visionUnsupported && (
              <div className="mt-3 border border-purple-500/30 bg-purple-500/5 rounded-lg p-3">
                <p className="text-[11px] font-medium text-purple-300 mb-1.5">Vision cost estimate</p>
                {estimateLoading && (
                  <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                    <Loader2 size={11} className="animate-spin" /> Calculating…
                  </p>
                )}
                {estimateError && (
                  <p className="text-[11px] text-amber-400">{estimateError}</p>
                )}
                {estimate && !estimateLoading && (
                  <div className="grid grid-cols-3 gap-3 text-[11px]">
                    <div>
                      <div className="text-zinc-600 uppercase tracking-wide">Pages</div>
                      <div className="text-zinc-200 font-medium">{estimate.page_count ?? "?"}</div>
                    </div>
                    <div>
                      <div className="text-zinc-600 uppercase tracking-wide">Provider</div>
                      <div className="text-zinc-200 font-medium capitalize">{estimate.provider}</div>
                    </div>
                    <div>
                      <div className="text-zinc-600 uppercase tracking-wide">Est. cost</div>
                      <div className="text-zinc-200 font-medium">
                        {estimate.estimated_usd === null || estimate.estimated_usd === 0
                          ? "Free (local)"
                          : `$${estimate.estimated_usd.toFixed(4)}`}
                      </div>
                    </div>
                    <div className="col-span-3 pt-1 border-t border-purple-500/20">
                      <span className="text-zinc-600">~{estimate.estimated_seconds}s wall clock</span>
                      <span className="text-zinc-700"> · runs in background — you can close this modal</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {selected === "vision" && visionUnsupported && (
              <div className="mt-3 border border-amber-500/30 bg-amber-500/5 rounded-lg p-3">
                <p className="text-[11px] text-amber-300">
                  Vision mode currently supports PDF and images only. For <span className="font-mono">{doc.doc_type}</span>, use Quality Text mode instead.
                </p>
              </div>
            )}
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
                disabled={extracting || (selected === "vision" && visionUnsupported)}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white font-medium disabled:opacity-50 flex items-center gap-1.5"
              >
                {extracting && <Loader2 size={12} className="animate-spin" />}
                {extracting ? "Extracting…" : selected === "vision" ? "Start Vision Job" : "Start Extraction"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
