"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { Breadcrumb, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import { Plus, X, Shield } from "lucide-react";

const TYPE_COLORS = ["blue", "purple", "red", "amber", "emerald", "cyan", "pink", "zinc"] as const;

const colorDotClass: Record<string, string> = {
  blue: "bg-blue-500", purple: "bg-purple-500", red: "bg-red-500",
  amber: "bg-amber-500", emerald: "bg-emerald-500", cyan: "bg-cyan-500",
  pink: "bg-pink-500", zinc: "bg-zinc-500",
};

interface LessonTypeItem {
  type_key: string;
  display_name: string;
  description: string | null;
  color: string;
  template: string | null;
  is_builtin: boolean;
  lesson_count?: number;
}

export default function LessonTypesPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [types, setTypes] = useState<LessonTypeItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createColor, setCreateColor] = useState<string>("cyan");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Edit template modal
  const [editType, setEditType] = useState<LessonTypeItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editTemplate, setEditTemplate] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTypes = useCallback(async () => {
    try {
      const res = await api.listLessonTypes();
      setTypes(res.types ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  // ── Create handler ──
  const handleCreate = async () => {
    if (!createKey) { setCreateError("Type key is required."); return; }
    if (!createName) { setCreateError("Display name is required."); return; }
    setCreating(true);
    setCreateError("");
    try {
      await api.createLessonType({
        type_key: createKey,
        display_name: createName,
        description: createDesc || undefined,
        color: createColor,
      });
      toastRef.current("success", `Type "${createKey}" created`);
      setCreateOpen(false);
      fetchTypes();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create");
    } finally { setCreating(false); }
  };

  // ── Edit handler ──
  const openEdit = (t: LessonTypeItem) => {
    setEditType(t);
    setEditName(t.display_name);
    setEditDesc(t.description ?? "");
    setEditColor(t.color);
    setEditTemplate(t.template ?? "");
  };

  const handleSave = async () => {
    if (!editType) return;
    setSaving(true);
    try {
      await api.updateLessonType(editType.type_key, {
        display_name: editName,
        description: editDesc || undefined,
        color: editColor,
        template: editTemplate || undefined,
      });
      toastRef.current("success", "Template saved");
      setEditType(null);
      fetchTypes();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };

  // ── Delete handler ──
  const handleDelete = async () => {
    if (!deleteKey) return;
    setDeleting(true);
    try {
      await api.deleteLessonType(deleteKey);
      toastRef.current("success", `Type "${deleteKey}" deleted`);
      setDeleteKey(null);
      fetchTypes();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Delete failed");
    } finally { setDeleting(false); }
  };

  // Reset create form
  useEffect(() => {
    if (createOpen) { setCreateKey(""); setCreateName(""); setCreateDesc(""); setCreateColor("cyan"); setCreateError(""); }
  }, [createOpen]);

  const builtIn = types.filter((t) => t.is_builtin);
  const custom = types.filter((t) => !t.is_builtin);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Settings", href: "/settings" }, { label: "Lesson Types" }]} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Lesson Types & Templates</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Configure lesson categories and default templates</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} className="mr-1" /> Add Custom Type
        </Button>
      </div>

      {/* Built-in Types */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Shield size={14} className="text-zinc-500" strokeWidth={1.5} />
          Built-in Types
          <span className="text-[10px] text-zinc-600 font-normal">(cannot be removed)</span>
        </h2>
        <div className="space-y-2">
          {builtIn.map((t) => (
            <div key={t.type_key} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-start gap-4">
              <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", colorDotClass[t.color] ?? "bg-zinc-500")} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-zinc-200">{t.type_key}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">built-in</span>
                </div>
                <p className="text-xs text-zinc-500">{t.description ?? t.display_name}</p>
              </div>
              <button onClick={() => openEdit(t)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors shrink-0">
                Edit template
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Custom Types */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Plus size={14} className="text-zinc-500" strokeWidth={1.5} />
          Custom Types
        </h2>
        {custom.length > 0 ? (
          <div className="space-y-2">
            {custom.map((t) => (
              <div key={t.type_key} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-start gap-4">
                <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", colorDotClass[t.color] ?? "bg-zinc-500")} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-zinc-200">{t.type_key}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">custom</span>
                  </div>
                  <p className="text-xs text-zinc-500">{t.description ?? t.display_name}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openEdit(t)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Edit</button>
                  <button onClick={() => setDeleteKey(t.type_key)} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">No custom types yet. Click &quot;Add Custom Type&quot; to create one.</p>
        )}
      </div>

      {/* ── Create Modal ── */}
      {createOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setCreateOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div role="dialog" aria-modal="true" aria-labelledby="create-type-title" className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-center justify-between">
                <h2 id="create-type-title" className="text-base font-semibold text-zinc-100">Add Custom Lesson Type</h2>
                <button onClick={() => setCreateOpen(false)} aria-label="Close" className="text-zinc-500 hover:text-zinc-300 p-1"><X size={18} /></button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Type Key <span className="text-red-400">*</span></label>
                  <input type="text" value={createKey}
                    onChange={(e) => { setCreateKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")); setCreateError(""); }}
                    placeholder="e.g. api_change" className={cn("w-full px-3 py-2 bg-zinc-950 border rounded-lg text-sm text-zinc-200 font-mono outline-none focus:border-zinc-600", createError ? "border-red-500/50" : "border-zinc-800")} />
                  {createError ? <p className="text-[10px] text-red-400 mt-1">{createError}</p> : <p className="text-[10px] text-zinc-600 mt-1">Lowercase with underscores. Used in MCP tool calls.</p>}
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Display Name <span className="text-red-400">*</span></label>
                  <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g. API Change"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-600" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Description</label>
                  <input type="text" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="What this type is used for..."
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Color</label>
                  <div className="flex gap-2">
                    {TYPE_COLORS.map((c) => (
                      <button key={c} type="button" aria-label={`Color: ${c}`} onClick={() => setCreateColor(c)}
                        className={cn("w-6 h-6 rounded-full transition-all", colorDotClass[c], createColor === c ? "ring-2 ring-offset-2 ring-offset-zinc-900 ring-white/50" : "hover:scale-110")} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-2">
                <button onClick={() => setCreateOpen(false)} className="px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-400">Cancel</button>
                <button onClick={handleCreate} disabled={creating || !createKey || !createName}
                  className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-white font-medium">
                  {creating ? "Creating..." : "Create Type"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Edit Template Modal ── */}
      {editType && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setEditType(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div role="dialog" aria-modal="true" aria-labelledby="edit-type-title" className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h2 id="edit-type-title" className="text-base font-semibold text-zinc-100">Edit: {editType.type_key}</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Update display settings and default template</p>
                </div>
                <button onClick={() => setEditType(null)} aria-label="Close" className="text-zinc-500 hover:text-zinc-300 p-1"><X size={18} /></button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Display Name</label>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-600" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Description</label>
                  <input type="text" value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none focus:border-zinc-600" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Color</label>
                  <div className="flex gap-2">
                    {TYPE_COLORS.map((c) => (
                      <button key={c} type="button" aria-label={`Color: ${c}`} onClick={() => setEditColor(c)}
                        className={cn("w-6 h-6 rounded-full transition-all", colorDotClass[c], editColor === c ? "ring-2 ring-offset-2 ring-offset-zinc-900 ring-white/50" : "hover:scale-110")} />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Default Template <span className="text-zinc-600">(markdown)</span></label>
                  <textarea rows={6} value={editTemplate} onChange={(e) => setEditTemplate(e.target.value)}
                    placeholder="## Context&#10;What problem triggered this?&#10;&#10;## Decision&#10;What was decided?"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 font-mono outline-none resize-none focus:border-zinc-600" />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-2">
                <button onClick={() => setEditType(null)} className="px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-400">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-white font-medium">
                  {saving ? "Saving..." : "Save Template"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteKey}
        onClose={() => setDeleteKey(null)}
        onConfirm={handleDelete}
        title="Delete Lesson Type"
        description={`Delete the custom type "${deleteKey}"? This cannot be undone. Types with existing lessons cannot be deleted.`}
        confirmText="Delete"
        destructive
      />
    </div>
  );
}
