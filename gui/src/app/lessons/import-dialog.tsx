"use client";

import { useState, useRef, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { Badge, Button } from "@/components/ui";
import { X, Upload, FileText } from "lucide-react";

type ImportTab = "json" | "csv" | "markdown";
type PreviewLesson = { title: string; lesson_type: string; content: string; tags: string[]; status: "ready" | "duplicate" };

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    values.push(current.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

function parseMarkdownLessons(text: string): Array<{ title: string; content: string }> {
  const lessons: Array<{ title: string; content: string }> = [];
  const headingRegex = /^#{1,3}\s+(.+)/;
  const lines = text.split("\n");
  let currentTitle = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const match = headingRegex.exec(line);
    if (match) {
      if (currentTitle) {
        lessons.push({ title: currentTitle, content: currentContent.join("\n").trim() });
      }
      currentTitle = match[1].trim();
      currentContent = [];
    } else if (currentTitle) {
      currentContent.push(line);
    }
  }
  if (currentTitle) {
    lessons.push({ title: currentTitle, content: currentContent.join("\n").trim() });
  }
  return lessons.filter((l) => l.content.length > 0);
}

export function ImportDialog({ open, onClose, onImported }: ImportDialogProps) {
  const { projectId } = useProject();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<ImportTab>("json");
  const [rawInput, setRawInput] = useState("");
  const [preview, setPreview] = useState<PreviewLesson[]>([]);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");

  const resetState = () => {
    setPreview([]);
    setParsed(false);
    setRawInput("");
    setFileName("");
  };

  const handleFileRead = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setRawInput(text);
      setParsed(false);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileRead(file);
  }, [handleFileRead]);

  const acceptForTab = tab === "json" ? ".json" : tab === "csv" ? ".csv" : ".md,.markdown,.txt";

  const handleParse = async () => {
    try {
      let lessons: Array<{ title: string; lesson_type?: string; content: string; tags?: string[] }> = [];

      if (tab === "json") {
        const data = JSON.parse(rawInput);
        lessons = Array.isArray(data) ? data : data.lessons ?? [data];
      } else if (tab === "csv") {
        const rows = parseCsv(rawInput);
        if (rows.length === 0) { toast("error", "No data rows found. Expected CSV with header row."); return; }
        lessons = rows.map((r) => ({
          title: r.title || r.name || "Untitled",
          lesson_type: r.lesson_type || r.type || "general_note",
          content: r.content || r.description || r.body || "",
          tags: (r.tags || "").split(";").map((t: string) => t.trim()).filter(Boolean),
        }));
      } else {
        const parsed = parseMarkdownLessons(rawInput);
        if (parsed.length === 0) { toast("error", "No headings found. Use # headings to separate lessons."); return; }
        lessons = parsed.map((l) => ({
          title: l.title,
          lesson_type: "general_note",
          content: l.content,
          tags: [],
        }));
      }

      // Duplicate check
      let existingTitles = new Set<string>();
      try {
        const existing = await api.listLessons({ project_id: projectId, limit: 200 });
        existingTitles = new Set((existing.items ?? []).map((l: any) => l.title?.toLowerCase()));
      } catch {}

      const items: PreviewLesson[] = lessons.map((l) => ({
        title: l.title ?? "Untitled",
        lesson_type: l.lesson_type ?? "general_note",
        content: l.content ?? "",
        tags: l.tags ?? [],
        status: existingTitles.has((l.title ?? "").toLowerCase()) ? "duplicate" as const : "ready" as const,
      }));
      setPreview(items);
      setParsed(true);
    } catch {
      toast("error", tab === "json" ? "Invalid JSON format" : "Failed to parse file");
    }
  };

  const handleImport = async () => {
    const ready = preview.filter((p) => p.status === "ready");
    if (ready.length === 0) return;
    setImporting(true);
    try {
      const result = await api.importLessons({
        project_id: projectId,
        lessons: ready.map((p) => ({
          title: p.title,
          lesson_type: p.lesson_type,
          content: p.content,
          tags: p.tags,
        })),
      });
      toast("success", `${result.imported_count ?? ready.length} lesson(s) imported`);
      onImported();
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  const readyCount = preview.filter((p) => p.status === "ready").length;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60] animate-[fadeIn_0.15s_ease-out]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
        <div role="dialog" aria-label="Import lessons" className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-[600px] max-h-[80vh] overflow-y-auto animate-[fadeInScale_0.2s_ease-out]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-100">Import Lessons</h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-zinc-800">
            {(["json", "csv", "markdown"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); resetState(); }}
                className={`px-4 py-2.5 text-xs font-medium transition-colors ${
                  tab === t ? "text-blue-400 border-b-2 border-blue-400 -mb-px" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t === "json" ? "JSON" : t === "csv" ? "CSV" : "From Markdown"}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Shared drag-drop zone for all tabs */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center mb-4 cursor-pointer transition-colors ${
                dragOver ? "border-blue-500 bg-blue-500/5" : fileName ? "border-emerald-700 bg-emerald-500/5" : "border-zinc-700 hover:border-zinc-600"
              }`}
            >
              {tab === "markdown" ? (
                <FileText size={18} className={`mx-auto mb-2 ${fileName ? "text-emerald-500" : "text-zinc-500"}`} />
              ) : (
                <Upload size={18} className={`mx-auto mb-2 ${fileName ? "text-emerald-500" : "text-zinc-500"}`} />
              )}
              {fileName ? (
                <p className="text-xs text-emerald-400">{fileName}</p>
              ) : (
                <>
                  <p className="text-xs text-zinc-400">
                    {tab === "json" && "Drop a .json file or paste JSON below"}
                    {tab === "csv" && "Drop a .csv file or paste CSV below"}
                    {tab === "markdown" && "Drop a .md file or paste markdown below"}
                  </p>
                  <p className="text-[10px] text-zinc-600 mt-1">
                    {tab === "markdown" && "Each # heading becomes a separate lesson"}
                    {tab === "csv" && "Expected columns: title, content, lesson_type, tags (semicolon-separated)"}
                  </p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptForTab}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileRead(f); }}
              />
            </div>

            {/* Text area for paste */}
            <textarea
              rows={tab === "json" ? 3 : 5}
              value={rawInput}
              onChange={(e) => { setRawInput(e.target.value); setParsed(false); }}
              placeholder={
                tab === "json" ? 'Paste JSON here... [{"title": "...", "content": "...", "lesson_type": "decision"}]'
                : tab === "csv" ? "title,content,lesson_type,tags\n\"My Lesson\",\"Content here\",decision,\"tag1;tag2\""
                : "# Lesson Title\n\nLesson content goes here...\n\n# Another Lesson\n\nMore content..."
              }
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-xs text-zinc-300 outline-none placeholder-zinc-600 resize-none mb-4 font-mono"
            />

            {!parsed && rawInput.trim() && (
              <div className="flex justify-end mb-4">
                <button onClick={handleParse} className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded-md text-zinc-300 transition-colors">
                  Parse & Preview
                </button>
              </div>
            )}

            {/* Preview table */}
            {preview.length > 0 && (
              <>
                <div className="border border-zinc-800 rounded-lg overflow-hidden mb-3">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-800/50">
                        <th className="px-3 py-2 text-[10px] font-medium text-zinc-500 uppercase">Title</th>
                        <th className="px-3 py-2 text-[10px] font-medium text-zinc-500 uppercase w-20">Type</th>
                        <th className="px-3 py-2 text-[10px] font-medium text-zinc-500 uppercase">Tags</th>
                        <th className="px-3 py-2 text-[10px] font-medium text-zinc-500 uppercase w-20">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {preview.map((p, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-xs text-zinc-300 truncate max-w-[200px]">{p.title}</td>
                          <td className="px-3 py-2"><Badge value={p.lesson_type} variant="type" /></td>
                          <td className="px-3 py-2 text-[10px] text-zinc-500">{p.tags.join(", ") || "—"}</td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                              p.status === "ready" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
                            }`}>
                              {p.status === "ready" ? "Ready" : "Duplicate"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-zinc-500 mb-4">
                  {readyCount} lesson(s) ready to import
                  {preview.length - readyCount > 0 && `, ${preview.length - readyCount} duplicate(s) will be skipped`}
                </p>
              </>
            )}

            {/* Actions */}
            {parsed && preview.length > 0 && (
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                <button
                  onClick={handleImport}
                  disabled={readyCount === 0 || importing}
                  className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white transition-colors disabled:opacity-50"
                >
                  {importing ? "Importing..." : `Import ${readyCount} Lesson${readyCount !== 1 ? "s" : ""}`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
