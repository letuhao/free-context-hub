"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { X, Pencil, Save, Undo2, Archive, ArrowRight, RefreshCw, Copy } from "lucide-react";
import type { Lesson } from "./types";

interface LessonDetailProps {
  lesson: Lesson | null;
  onClose: () => void;
  onStatusChange: () => void;
  onTagClick: (tag: string) => void;
}

export function LessonDetail({ lesson, onClose, onStatusChange, onTagClick }: LessonDetailProps) {
  const { toast } = useToast();
  const { projectId } = useProject();

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Reset edit state when lesson changes
  useEffect(() => {
    if (lesson) {
      setEditTitle(lesson.title);
      setEditContent(lesson.content);
      setEditTags([...lesson.tags]);
      setEditing(false);
      setDirty(false);
    }
  }, [lesson]);

  // Track dirty state
  useEffect(() => {
    if (!lesson || !editing) { setDirty(false); return; }
    const titleChanged = editTitle !== lesson.title;
    const contentChanged = editContent !== lesson.content;
    const tagsChanged = JSON.stringify(editTags) !== JSON.stringify(lesson.tags);
    setDirty(titleChanged || contentChanged || tagsChanged);
  }, [editing, editTitle, editContent, editTags, lesson]);

  // Ctrl+S save
  useEffect(() => {
    if (!editing || !dirty) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  // ESC to close or cancel edit
  useEffect(() => {
    if (!lesson) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editing) handleCancel();
        else onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [lesson, editing, onClose]);

  const handleSave = useCallback(async () => {
    if (!lesson || !dirty) return;
    setSaving(true);
    try {
      await api.updateLesson(lesson.lesson_id, {
        project_id: projectId,
        title: editTitle !== lesson.title ? editTitle : undefined,
        content: editContent !== lesson.content ? editContent : undefined,
        tags: JSON.stringify(editTags) !== JSON.stringify(lesson.tags) ? editTags : undefined,
        changed_by: "gui-user",
      });
      toast("success", "Lesson updated");
      setEditing(false);
      setDirty(false);
      onStatusChange();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [lesson, dirty, editTitle, editContent, editTags, projectId, toast, onStatusChange]);

  const handleCancel = () => {
    if (lesson) {
      setEditTitle(lesson.title);
      setEditContent(lesson.content);
      setEditTags([...lesson.tags]);
    }
    setEditing(false);
    setDirty(false);
  };

  const changeStatus = async (status: string) => {
    if (!lesson) return;
    try {
      await api.updateLessonStatus(lesson.lesson_id, { project_id: projectId, status });
      toast("success", `Lesson marked as ${status}`);
      onStatusChange();
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Status change failed");
    }
  };

  const copyJson = () => {
    if (!lesson) return;
    navigator.clipboard.writeText(JSON.stringify(lesson, null, 2));
    toast("success", "Copied to clipboard");
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !editTags.includes(tag)) {
      setEditTags([...editTags, tag]);
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    setEditTags(editTags.filter(t => t !== tag));
  };

  if (!lesson) return null;

  const created = new Date(lesson.created_at);
  const dateStr = created.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-[fadeIn_0.15s_ease-out]" onClick={onClose} />

      {/* Center modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl max-h-[85vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col animate-[fadeInScale_0.2s_ease-out]">

          {/* Header */}
          <div className="px-6 pt-4 pb-3 border-b border-zinc-800 shrink-0">
            <div className="flex items-center justify-between mb-2">
              {editing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-base font-semibold text-zinc-100 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 w-full focus:outline-none focus:border-zinc-500 transition-colors"
                />
              ) : (
                <h2 className="text-base font-semibold text-zinc-100 leading-snug pr-4">{lesson.title}</h2>
              )}
              <div className="flex items-center gap-1 shrink-0 ml-3">
                <button
                  onClick={() => editing ? handleCancel() : setEditing(true)}
                  className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                  title={editing ? "Cancel edit" : "Edit"}
                >
                  {editing ? <Undo2 size={16} /> : <Pencil size={16} />}
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge value={lesson.lesson_type} variant="type" />
              <Badge value={lesson.status} variant="status" />
              {editing && dirty && (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 ml-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  Unsaved changes
                </span>
              )}
              {!editing && (
                <span className="text-xs text-zinc-600 ml-1">Press ESC to close</span>
              )}
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {/* Metadata */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 font-mono">
              <span>ID: {lesson.lesson_id.slice(0, 8)}</span>
              <span>{dateStr}</span>
              {lesson.captured_by && <span>by {lesson.captured_by}</span>}
            </div>

            {/* Content */}
            <div>
              <h3 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Content</h3>
              {editing ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={12}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-300 leading-relaxed focus:outline-none focus:border-zinc-500 transition-colors resize-y font-mono"
                />
              ) : (
                <div className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">
                  {lesson.content}
                </div>
              )}
            </div>

            {/* Tags */}
            {(lesson.tags.length > 0 || editing) && (
              <div>
                <h3 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Tags</h3>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {(editing ? editTags : lesson.tags).map((t) => (
                    <span
                      key={t}
                      onClick={() => { if (!editing) { onClose(); onTagClick(t); } }}
                      className={`px-2.5 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-400 ${
                        editing ? "" : "hover:text-zinc-200 cursor-pointer"
                      } transition-colors inline-flex items-center gap-1`}
                    >
                      {t}
                      {editing && (
                        <button onClick={() => removeTag(t)} className="hover:text-red-400 ml-0.5">
                          <X size={10} />
                        </button>
                      )}
                    </span>
                  ))}
                  {editing && (
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                      placeholder="Add tag..."
                      className="px-2 py-0.5 text-xs bg-zinc-800 border border-dashed border-zinc-600 rounded-full text-zinc-400 placeholder-zinc-600 w-20 focus:outline-none focus:border-zinc-500"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Source refs */}
            {lesson.source_refs.length > 0 && (
              <div>
                <h3 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Source Refs</h3>
                <div className="font-mono text-xs text-zinc-600 leading-loose">
                  {lesson.source_refs.map((ref, i) => (
                    <div key={i}>{ref}</div>
                  ))}
                </div>
              </div>
            )}

            {lesson.superseded_by && (
              <div>
                <h3 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Superseded By</h3>
                <span className="font-mono text-xs text-zinc-500">{lesson.superseded_by}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-zinc-800 flex items-center gap-2 shrink-0">
            {editing ? (
              <>
                <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || saving}>
                  <Save size={13} className="mr-1" />
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
                <Button variant="outline" size="sm" onClick={handleCancel}>Cancel</Button>
                <span className="text-[10px] text-zinc-600 ml-2">Ctrl+S to save</span>
              </>
            ) : (
              <>
                {lesson.status === "active" && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => changeStatus("superseded")}>
                      <ArrowRight size={13} className="mr-1" /> Supersede
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => changeStatus("archived")}>
                      <Archive size={13} className="mr-1" /> Archive
                    </Button>
                  </>
                )}
                {lesson.status === "archived" && (
                  <Button variant="outline" size="sm" onClick={() => changeStatus("active")}>
                    <RefreshCw size={13} className="mr-1" /> Reactivate
                  </Button>
                )}
                {lesson.status === "draft" && (
                  <Button variant="primary" size="sm" onClick={() => changeStatus("active")}>
                    Approve
                  </Button>
                )}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={copyJson}>
                  <Copy size={13} className="mr-1" /> Copy JSON
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
