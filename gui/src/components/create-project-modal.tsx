"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { PROJECT_COLORS, getColorClasses, getInitials, type ProjectColorKey } from "@/lib/project-colors";
import { cn } from "@/lib/cn";
import { X } from "lucide-react";

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateProjectModal({ open, onClose }: CreateProjectModalProps) {
  const { setProjectId, refreshProjects } = useProject();
  const { toast } = useToast();

  const [projectIdInput, setProjectIdInput] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<ProjectColorKey>("blue");
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState<Array<{ group_id: string; name: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Fetch groups for the dropdown
  useEffect(() => {
    if (!open) return;
    api.listGroups().then((res) => setGroups(res.groups ?? [])).catch(() => {});
  }, [open]);

  // Reset form on open
  useEffect(() => {
    if (open) {
      setProjectIdInput("");
      setName("");
      setDescription("");
      setColor("blue");
      setGroupId("");
      setError("");
    }
  }, [open]);

  // Auto-generate name from ID
  const displayName = name || projectIdInput.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const validateId = (id: string): string | null => {
    if (!id) return "Project ID is required.";
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id)) return "Use lowercase letters, numbers, and hyphens only (no leading/trailing hyphens).";
    if (id.length > 128) return "Must be 128 characters or fewer.";
    return null;
  };

  const handleSubmit = async () => {
    const idError = validateId(projectIdInput);
    if (idError) { setError(idError); return; }

    setSubmitting(true);
    setError("");
    try {
      await api.createProject({
        project_id: projectIdInput,
        name: name || undefined,
        description: description || undefined,
        color,
        group_id: groupId || undefined,
      });
      refreshProjects();
      setProjectId(projectIdInput);
      toast("success", `Project "${projectIdInput}" created`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create project";
      if (msg.includes("duplicate") || msg.includes("already exists") || msg.includes("unique")) {
        setError("A project with this ID already exists.");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard: Escape to close, Enter to submit
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const previewColor = getColorClasses(color);
  const previewInitials = getInitials(displayName || "NP");

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-project-title"
          className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto animate-[fadeIn_0.15s_ease-out]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h2 id="create-project-title" className="text-base font-semibold text-zinc-100">Create New Project</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Set up a new knowledge container for your codebase</p>
            </div>
            <button onClick={onClose} aria-label="Close dialog" className="text-zinc-500 hover:text-zinc-300 transition-colors p-1">
              <X size={18} />
            </button>
          </div>

          {/* Form */}
          <div className="px-6 py-5 space-y-5">
            {/* Project ID */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">
                Project ID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={projectIdInput}
                onChange={(e) => { setProjectIdInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); setError(""); }}
                placeholder="e.g. my-backend-api"
                className={cn(
                  "w-full px-3 py-2 bg-zinc-950 border rounded-lg text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600 transition-colors font-mono",
                  error ? "border-red-500/50" : "border-zinc-800",
                )}
              />
              {error ? (
                <p className="text-[10px] text-red-400 mt-1">{error}</p>
              ) : (
                <p className="text-[10px] text-zinc-600 mt-1">Unique identifier. Lowercase letters, numbers, hyphens only.</p>
              )}
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Display Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Human-readable name"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600 transition-colors"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">
                Description <span className="text-zinc-600">(optional)</span>
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this project..."
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none placeholder:text-zinc-600 resize-none focus:border-zinc-600 transition-colors"
              />
            </div>

            {/* Color */}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Color</label>
              <div className="flex gap-2">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-label={`Color: ${c.key}`}
                    onClick={() => setColor(c.key)}
                    className={cn(
                      "w-7 h-7 rounded-md bg-gradient-to-br transition-all",
                      c.from, c.to,
                      color === c.key
                        ? `ring-2 ${c.ring} ring-offset-2 ring-offset-zinc-900`
                        : "hover:scale-110",
                    )}
                  />
                ))}
              </div>
            </div>

            {/* Group */}
            {groups.length > 0 && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Add to Group <span className="text-zinc-600">(optional)</span>
                </label>
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600"
                >
                  <option value="">No group</option>
                  {groups.map((g) => (
                    <option key={g.group_id} value={g.group_id}>{g.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-zinc-600 mt-1">Projects in the same group share knowledge when &quot;Include groups&quot; is enabled.</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn("w-8 h-8 rounded-md bg-gradient-to-br flex items-center justify-center text-[10px] font-bold text-white", previewColor.from, previewColor.to)}>
                {previewInitials}
              </div>
              <div>
                <div className="text-xs text-zinc-300 font-medium">{projectIdInput || "project-id"}</div>
                <div className="text-[10px] text-zinc-600">Preview</div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !projectIdInput}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-white font-medium transition-colors"
              >
                {submitting ? "Creating..." : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
