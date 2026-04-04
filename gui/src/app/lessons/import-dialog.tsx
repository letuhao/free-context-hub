"use client";

import { useState } from "react";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { Badge, Button } from "@/components/ui";
import { X, Upload } from "lucide-react";

type ImportTab = "json" | "csv" | "markdown";
type PreviewLesson = { title: string; lesson_type: string; content: string; tags: string[]; status: "ready" | "duplicate" };

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ImportDialog({ open, onClose, onImported }: ImportDialogProps) {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [tab, setTab] = useState<ImportTab>("json");
  const [rawInput, setRawInput] = useState("");
  const [preview, setPreview] = useState<PreviewLesson[]>([]);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState(false);

  const handleParse = () => {
    try {
      const data = JSON.parse(rawInput);
      const lessons = Array.isArray(data) ? data : data.lessons ?? [data];
      const items: PreviewLesson[] = lessons.map((l: any) => ({
        title: l.title ?? "Untitled",
        lesson_type: l.lesson_type ?? "general_note",
        content: l.content ?? "",
        tags: l.tags ?? [],
        status: "ready" as const,
      }));
      setPreview(items);
      setParsed(true);
    } catch {
      toast("error", "Invalid JSON format");
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
                onClick={() => { setTab(t); setPreview([]); setParsed(false); setRawInput(""); }}
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
            {tab === "json" && (
              <>
                <div className="border-2 border-dashed border-zinc-700 rounded-lg p-6 text-center mb-4 hover:border-zinc-600 transition-colors">
                  <Upload size={18} className="text-zinc-500 mx-auto mb-2" />
                  <p className="text-xs text-zinc-400">Drop a .json file or paste JSON</p>
                </div>
                <textarea
                  rows={3}
                  value={rawInput}
                  onChange={(e) => { setRawInput(e.target.value); setParsed(false); }}
                  placeholder='Paste JSON here... [{"title": "...", "content": "...", "lesson_type": "decision"}]'
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-xs text-zinc-300 outline-none placeholder-zinc-600 resize-none mb-4 font-mono"
                />
                {!parsed && rawInput.trim() && (
                  <div className="flex justify-end mb-4">
                    <button onClick={handleParse} className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded-md text-zinc-300 transition-colors">
                      Parse & Preview
                    </button>
                  </div>
                )}
              </>
            )}
            {tab === "csv" && (
              <div className="text-center py-8">
                <p className="text-xs text-zinc-500">CSV import coming soon</p>
              </div>
            )}
            {tab === "markdown" && (
              <div className="border-2 border-dashed border-zinc-700 rounded-lg p-6 text-center hover:border-zinc-600 transition-colors">
                <FileText size={18} className="text-zinc-500 mx-auto mb-2" />
                <p className="text-xs text-zinc-400">Paste or upload a .md file. AI will parse it into separate lessons.</p>
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
                <p className="text-[10px] text-zinc-500 mb-4">{readyCount} lesson(s) ready to import</p>
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

// For the markdown tab reference
function FileText(props: any) {
  return <Upload {...props} />;
}
