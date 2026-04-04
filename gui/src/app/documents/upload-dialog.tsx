"use client";

import { useState } from "react";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";
import { FileText, Link2, X } from "lucide-react";

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
  mode: "upload" | "url";
}

export function UploadDialog({ open, onClose, onUploaded, mode }: UploadDialogProps) {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) { setTags([...tags, t]); setTagInput(""); }
  };

  const handleSubmit = async () => {
    setUploading(true);
    try {
      if (mode === "url") {
        if (!url.trim()) { toast("error", "URL is required"); return; }
        await api.createDocument({
          project_id: projectId,
          name: name.trim() || url.trim(),
          doc_type: "url",
          url: url.trim(),
          description: description.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
        });
      } else {
        if (!name.trim() || !content.trim()) { toast("error", "Name and content are required"); return; }
        const docType = name.endsWith(".md") ? "markdown" : name.endsWith(".pdf") ? "pdf" : "text";
        await api.createDocument({
          project_id: projectId,
          name: name.trim(),
          doc_type: docType,
          content: content.trim(),
          file_size_bytes: new Blob([content]).size,
          description: description.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
        });
      }
      toast("success", mode === "url" ? "URL linked" : "Document uploaded");
      onUploaded();
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] animate-[fadeIn_0.15s_ease-out]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
        <div role="dialog" aria-label={mode === "url" ? "Link URL" : "Upload Document"} className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl animate-[fadeInScale_0.2s_ease-out]">
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-100">
              {mode === "url" ? "Link External URL" : "Upload Document"}
            </h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-5">
            {mode === "upload" ? (
              <>
                {/* Drag & drop zone (simplified — paste/type content) */}
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Document name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. API Design Guidelines.md"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Content</label>
                  <textarea
                    rows={8}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Paste document content here..."
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none placeholder:text-zinc-600 resize-y focus:border-zinc-600 transition-colors font-mono"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">URL</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <Link2 size={14} className="text-zinc-500 shrink-0" />
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://docs.example.com/..."
                    className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {mode === "url" && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Display name <span className="text-zinc-600">(optional)</span></label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Auto-detected from URL"
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600 transition-colors"
                />
              </div>
            )}

            {/* Tags */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Tags <span className="text-zinc-600">(optional)</span></label>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded-full text-zinc-400">
                    {t}
                    <button onClick={() => setTags(tags.filter((x) => x !== t))} className="hover:text-red-400"><X size={8} /></button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                placeholder="Add tag + Enter"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600 transition-colors"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Description <span className="text-zinc-600">(optional)</span></label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description..."
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none placeholder:text-zinc-600 resize-none focus:border-zinc-600 transition-colors"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <button
              onClick={handleSubmit}
              disabled={uploading}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white transition-colors disabled:opacity-50"
            >
              {uploading ? "Saving..." : mode === "url" ? "Link" : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
