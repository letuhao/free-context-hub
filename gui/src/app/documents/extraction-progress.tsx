"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X, AlertTriangle, CheckCircle2, Ban } from "lucide-react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { useProject } from "@/contexts/project-context";

interface ExtractionProgressProps {
  docId: string;
  docName: string;
  jobId: string;
  onDone: () => void;
  onCancelled: () => void;
  onFailed: (message: string) => void;
  /** Close without cancelling — job keeps running in background. */
  onClose: () => void;
}

const POLL_INTERVAL_MS = 1500;

export function ExtractionProgress({
  docId,
  docName,
  jobId,
  onDone,
  onCancelled,
  onFailed,
  onClose,
}: ExtractionProgressProps) {
  const { projectId } = useProject();
  const [status, setStatus] = useState<string>("queued");
  const [pct, setPct] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const terminatedRef = useRef(false);

  // Elapsed timer
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 500);
    return () => clearInterval(t);
  }, []);

  // Stash callbacks in refs so the polling effect doesn't re-run — and
  // reset — whenever the parent re-renders with new callback identities.
  const onDoneRef = useRef(onDone);
  const onCancelledRef = useRef(onCancelled);
  const onFailedRef = useRef(onFailed);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => { onCancelledRef.current = onCancelled; }, [onCancelled]);
  useEffect(() => { onFailedRef.current = onFailed; }, [onFailed]);

  // Single-fire terminal helper — guards against double-invocation when a
  // stale poll resolves after the ref already flipped.
  const fireTerminal = (kind: "done" | "cancelled" | "failed", msg?: string) => {
    if (terminatedRef.current) return;
    terminatedRef.current = true;
    if (kind === "done") onDoneRef.current();
    else if (kind === "cancelled") onCancelledRef.current();
    else onFailedRef.current(msg ?? "Extraction failed");
  };

  // Poll job status
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled || terminatedRef.current) return;
      try {
        const res = await api.getExtractionStatus(docId, { project_id: projectId });
        if (cancelled || terminatedRef.current) return;

        const job = res.job;
        if (!job) {
          fireTerminal("failed", "Job not found");
          return;
        }

        setStatus(job.status);
        setPct(job.progress_pct);
        setMessage(job.progress_message);

        if (job.status === "succeeded") {
          fireTerminal("done");
          return;
        }
        if (job.status === "cancelled") {
          fireTerminal("cancelled");
          return;
        }
        if (job.status === "failed" || job.status === "dead_letter") {
          setErrorMsg(job.error_message ?? "Extraction failed");
          fireTerminal("failed", job.error_message ?? "Extraction failed");
          return;
        }
      } catch (err) {
        // Transient network errors — just retry on next tick
        console.warn("extraction-status poll failed:", err);
      }
    };

    // Kick off immediately, then interval
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, projectId, jobId]);

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await api.cancelExtractionJob(docId, jobId, { project_id: projectId });
      // Poll will pick up the cancelled state and invoke onCancelled
    } catch (err) {
      setCancelling(false);
      setErrorMsg(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  const displayPct = pct !== null ? Math.round(pct) : null;
  const isTerminal = status === "succeeded" || status === "failed" || status === "cancelled" || status === "dead_letter";

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
        onClick={() => { if (isTerminal) onClose(); }}
      />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 pointer-events-none">
        <div
          role="dialog"
          aria-label="Vision extraction progress"
          className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto"
        >
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                {status === "succeeded" ? (
                  <CheckCircle2 size={16} className="text-emerald-400" />
                ) : status === "cancelled" ? (
                  <Ban size={16} className="text-zinc-400" />
                ) : status === "failed" || status === "dead_letter" ? (
                  <AlertTriangle size={16} className="text-red-400" />
                ) : (
                  <Loader2 size={16} className="text-purple-400 animate-spin" />
                )}
                Vision extraction
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-md">{docName}</p>
            </div>
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 p-1"
              title="Close (job keeps running in background)"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            {/* Status chip */}
            <div className="flex items-center gap-2 text-[11px]">
              <span className={`px-2 py-0.5 rounded-full font-medium ${
                status === "succeeded" ? "bg-emerald-500/10 text-emerald-400" :
                status === "cancelled" ? "bg-zinc-700 text-zinc-400" :
                status === "failed" || status === "dead_letter" ? "bg-red-500/10 text-red-400" :
                status === "running" ? "bg-purple-500/10 text-purple-300" :
                "bg-blue-500/10 text-blue-300"
              }`}>
                {status}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-500">{elapsed}s elapsed</span>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-zinc-500">{message ?? "Waiting for worker to pick up job…"}</span>
                {displayPct !== null && (
                  <span className="text-[11px] text-zinc-400 font-mono">{displayPct}%</span>
                )}
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    status === "succeeded" ? "bg-emerald-500" :
                    status === "failed" || status === "dead_letter" ? "bg-red-500" :
                    status === "cancelled" ? "bg-zinc-500" :
                    "bg-purple-500"
                  } ${displayPct === null ? "animate-pulse w-1/4" : ""}`}
                  style={displayPct !== null ? { width: `${displayPct}%` } : undefined}
                />
              </div>
            </div>

            {errorMsg && (
              <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
                <p className="text-[11px] text-red-300 font-medium mb-1">Error</p>
                <p className="text-[11px] text-zinc-400 break-words">{errorMsg}</p>
              </div>
            )}

            {!isTerminal && (
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Vision extraction runs asynchronously in the background. You can close this modal and come back later —
                the job will continue and the document list will update when it finishes.
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between">
            <div className="text-[10px] text-zinc-600">Job ID: <span className="font-mono">{jobId.slice(0, 8)}…</span></div>
            <div className="flex gap-2">
              {!isTerminal && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  {cancelling ? "Cancelling…" : "Cancel job"}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onClose}>
                {isTerminal ? "Close" : "Hide"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
