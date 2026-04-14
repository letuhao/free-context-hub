"use client";

/**
 * Phase 11 Sprint 11.4 — Knowledge Exchange panel
 *
 * Embedded in the Project Settings page. Two subsections:
 *
 *  - Export: two toggles + a download button that points the browser
 *    at /api/projects/:id/export with the right query string. No JS
 *    fetch — let the browser stream the zip natively.
 *
 *  - Import: drag-drop file picker + conflict policy radio + Preview
 *    (dry-run) and Apply buttons. Renders the ImportResult counts
 *    table and the conflicts list (capped server-side at 50 by
 *    default; we display "+N more" if conflicts_truncated).
 */

import { useState, useEffect, useRef, useCallback, type DragEvent, type ChangeEvent } from "react";
import { Download, Upload, FileArchive, X, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";

type ConflictPolicy = "skip" | "overwrite" | "fail";

interface EntityCounts {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}

interface ImportConflict {
  entity: string;
  id: string;
  reason: string;
}

interface ImportResult {
  source_project_id: string;
  target_project_id: string;
  schema_version: number;
  generated_at: string;
  policy: ConflictPolicy;
  dry_run: boolean;
  applied: boolean;
  counts: {
    lessons: EntityCounts;
    guardrails: EntityCounts;
    lesson_types: EntityCounts;
    documents: EntityCounts;
    chunks: EntityCounts;
    document_lessons: EntityCounts;
  };
  conflicts: ImportConflict[];
  conflicts_truncated: boolean;
}

const ENTITIES: { key: keyof ImportResult["counts"]; label: string }[] = [
  { key: "lessons", label: "Lessons" },
  { key: "guardrails", label: "Guardrails" },
  { key: "lesson_types", label: "Lesson types" },
  { key: "documents", label: "Documents" },
  { key: "chunks", label: "Chunks" },
  { key: "document_lessons", label: "Doc↔lesson links" },
];

interface ExchangePanelProps {
  projectId: string;
}

export function ExchangePanel({ projectId }: ExchangePanelProps) {
  const { toast } = useToast();

  // ── export state ──
  const [includeDocs, setIncludeDocs] = useState(true);
  const [includeChunks, setIncludeChunks] = useState(true);
  const exportHref = api.exportProjectUrl({
    projectId,
    includeDocuments: includeDocs,
    includeChunks,
  });

  // ── import state ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [policy, setPolicy] = useState<ConflictPolicy>("skip");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Reset all import state when the user switches projects via the
  // project selector — otherwise the result panel would show the old
  // project's import outcome under a different project's header, and a
  // half-uploaded file could be applied to the wrong target. Toggles
  // are intentionally NOT reset (user preference for export shape).
  useEffect(() => {
    setFile(null);
    setResult(null);
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [projectId]);

  const handleFileChosen = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith(".zip")) {
      toast("error", "Bundle must be a .zip file");
      return;
    }
    if (f.size > 500 * 1024 * 1024) {
      toast("error", "Bundle exceeds 500 MB upload limit");
      return;
    }
    setFile(f);
    // Clear any prior result so the panel doesn't stay stale
    setResult(null);
  }, [toast]);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileChosen(f);
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFileChosen(f);
  };

  /** Clear a stale result whenever the policy changes — otherwise a
   *  user who previewed under "skip" then switched to "overwrite"
   *  would still see the skip-policy preview while Apply would use
   *  the new policy. The mismatch is misleading; force a re-preview. */
  const handlePolicyChange = (next: ConflictPolicy) => {
    setPolicy(next);
    setResult(null);
  };

  const runImport = async (dryRun: boolean) => {
    if (!file) {
      toast("error", "Pick a bundle file first");
      return;
    }
    setBusy(true);
    try {
      const res = await api.importProject(file, {
        projectId,
        policy,
        dryRun,
      });
      setResult(res as ImportResult);
      toast(
        "success",
        dryRun
          ? "Dry-run complete — review the result below"
          : `Imported — ${res.applied ? "applied" : "no changes"}`,
      );
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-6">
      <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
        <FileArchive size={16} /> Knowledge Exchange
      </h2>

      {/* ─── Export ─── */}
      <section>
        <h3 className="text-xs font-medium text-zinc-300 mb-1">Export</h3>
        <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">
          Stream this project's full state as a portable <code className="text-zinc-400">.zip</code> bundle. Includes
          lessons, guardrails, lesson types, document↔lesson links, and optionally documents + extracted chunks.
        </p>

        <div className="space-y-2 mb-4">
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeDocs}
              onChange={(e) => setIncludeDocs(e.target.checked)}
              className="accent-blue-500"
            />
            Include document binaries
            <span className="text-[10px] text-zinc-600">(PDFs, images, etc.)</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeChunks}
              onChange={(e) => setIncludeChunks(e.target.checked)}
              className="accent-blue-500"
            />
            Include extracted chunks
            <span className="text-[10px] text-zinc-600">(text + embeddings)</span>
          </label>
        </div>

        {/* The `download` HTML attribute is ignored for cross-origin URLs
            (GUI on :3002, API on :3001), so the actual download filename
            comes from the BE's Content-Disposition header. We keep the
            attribute for the same-origin case (production deployments
            behind a single domain).
            Footgun: if the export endpoint errors (e.g. project deleted
            mid-session), the browser navigates to the API URL and
            shows raw JSON. The NoProjectGuard wrapping this page makes
            that race rare in practice; a real fix would intercept the
            click, fetch via JS, then trigger a Blob download. */}
        <a
          href={exportHref}
          download
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white font-medium transition-colors"
        >
          <Download size={12} /> Download bundle.zip
        </a>
      </section>

      <div className="border-t border-zinc-800" />

      {/* ─── Import ─── */}
      <section>
        <h3 className="text-xs font-medium text-zinc-300 mb-1">Import</h3>
        <p className="text-[11px] text-zinc-500 mb-3 leading-relaxed">
          Apply a previously exported bundle to this project. UUIDs are preserved — re-importing the same bundle
          under <code className="text-zinc-400">skip</code> is a no-op. Rows owned by other projects are refused.
        </p>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors mb-4 ${
            dragOver
              ? "border-blue-500 bg-blue-500/5"
              : file
                ? "border-emerald-700 bg-emerald-500/5"
                : "border-zinc-700 hover:border-zinc-500"
          }`}
        >
          {file ? (
            <>
              <FileArchive size={20} className="mx-auto mb-2 text-emerald-500" />
              <p className="text-xs text-zinc-300 mb-0.5">{file.name}</p>
              <p className="text-[10px] text-zinc-600">
                {(file.size / (1024 * 1024)).toFixed(2)} MB · click or drop to replace
              </p>
            </>
          ) : (
            <>
              <Upload size={20} className="mx-auto mb-2 text-zinc-500" />
              <p className="text-xs text-zinc-300 mb-0.5">Drop bundle.zip here or click to browse</p>
              <p className="text-[10px] text-zinc-600">.zip up to 500 MB</p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        {/* Policy radio */}
        <div className="mb-4">
          <div className="text-[11px] text-zinc-500 mb-1.5">Conflict policy</div>
          <div className="flex gap-3 text-xs text-zinc-300">
            {(["skip", "overwrite", "fail"] as ConflictPolicy[]).map((p) => (
              <label key={p} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="policy"
                  checked={policy === p}
                  onChange={() => handlePolicyChange(p)}
                  className="accent-blue-500"
                />
                <span className="capitalize">{p}</span>
              </label>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600 mt-1.5 leading-relaxed">
            <strong className="text-zinc-500">skip</strong>: leave existing rows alone.{" "}
            <strong className="text-zinc-500">overwrite</strong>: replace existing rows (cross-tenant rows are refused).{" "}
            <strong className="text-zinc-500">fail</strong>: abort the whole import on the first conflict.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runImport(true)}
            disabled={!file || busy}
          >
            {busy ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
            Preview (dry-run)
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => runImport(false)}
            disabled={!file || busy}
          >
            {busy ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
            Apply
          </Button>
          {file && (
            <button
              onClick={() => {
                setFile(null);
                setResult(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="ml-auto text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
              title="Clear selected file and result"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>

        {/* Result panel */}
        {result && <ResultPanel result={result} />}
      </section>
    </div>
  );
}

function ResultPanel({ result }: { result: ImportResult }) {
  const isApplied = result.applied;
  return (
    <div className="mt-5 border border-zinc-800 rounded-lg p-4 bg-zinc-950/50">
      <div className="flex items-center gap-2 mb-3">
        {isApplied ? (
          <CheckCircle2 size={14} className="text-emerald-400" />
        ) : result.dry_run ? (
          <FileArchive size={14} className="text-blue-400" />
        ) : (
          <AlertTriangle size={14} className="text-amber-400" />
        )}
        <span className="text-xs font-medium text-zinc-200">
          {result.dry_run ? "Dry-run preview" : isApplied ? "Imported" : "Not applied"}
        </span>
        <span className="text-[10px] text-zinc-600">
          source: <code className="text-zinc-400">{result.source_project_id}</code> · generated:{" "}
          {result.generated_at.slice(0, 19).replace("T", " ")}
        </span>
      </div>

      {/* Counts table */}
      <table className="w-full text-[11px] mb-3">
        <thead>
          <tr className="text-zinc-600 border-b border-zinc-800">
            <th className="text-left py-1.5 font-medium">Entity</th>
            <th className="text-right py-1.5 font-medium w-16">Total</th>
            <th className="text-right py-1.5 font-medium w-16">Created</th>
            <th className="text-right py-1.5 font-medium w-16">Updated</th>
            <th className="text-right py-1.5 font-medium w-16">Skipped</th>
          </tr>
        </thead>
        <tbody>
          {ENTITIES.map(({ key, label }) => {
            const c = result.counts[key];
            return (
              <tr key={key} className="border-b border-zinc-900 last:border-b-0">
                <td className="py-1 text-zinc-400">{label}</td>
                <td className="py-1 text-right text-zinc-300 tabular-nums">{c.total}</td>
                <td className="py-1 text-right text-emerald-400 tabular-nums">
                  {c.created > 0 ? c.created : <span className="text-zinc-700">—</span>}
                </td>
                <td className="py-1 text-right text-amber-400 tabular-nums">
                  {c.updated > 0 ? c.updated : <span className="text-zinc-700">—</span>}
                </td>
                <td className="py-1 text-right text-zinc-500 tabular-nums">
                  {c.skipped > 0 ? c.skipped : <span className="text-zinc-700">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Conflicts list */}
      {result.conflicts.length > 0 && (
        <div>
          <div className="text-[10px] text-zinc-500 mb-1.5">
            Conflicts ({result.conflicts.length}
            {result.conflicts_truncated ? "+" : ""})
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {result.conflicts.map((c, i) => (
              <div key={i} className="text-[10px] text-zinc-500 leading-relaxed">
                <span className="text-zinc-400">{c.entity}</span>
                <span className="text-zinc-700"> · </span>
                <code className="text-zinc-500">{c.id}</code>
                <span className="text-zinc-700"> — </span>
                {c.reason}
              </div>
            ))}
            {result.conflicts_truncated && (
              <div className="text-[10px] text-zinc-600 italic pt-1">
                more conflicts hidden — increase conflicts_cap on the API call to see them all
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
