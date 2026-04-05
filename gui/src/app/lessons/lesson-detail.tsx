"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Badge, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { X, Pencil, Save, Undo2, Archive, ArrowRight, RefreshCw, Copy, History, ChevronDown, ChevronRight, Sparkles, FileText, Link2, Plus, ThumbsUp, ThumbsDown, Bookmark, MessageSquare } from "lucide-react";
import { relTime } from "@/lib/rel-time";
import { AiEditor } from "./ai-editor";
import type { Lesson } from "./types";

type LessonVersion = {
  version_number: number;
  title: string;
  content: string;
  tags: string[];
  changed_by: string | null;
  changed_at: string;
  change_summary: string | null;
};

interface LessonDetailProps {
  lesson: Lesson | null;
  onClose: () => void;
  onStatusChange: () => void;
  onTagClick: (tag: string) => void;
  initialEditMode?: boolean;
}

/** Avatar circle for author names */
function AuthorAvatar({ name }: { name: string }) {
  const colors: Record<string, string> = {
    c: "bg-purple-600", l: "bg-blue-600", g: "bg-green-600", r: "bg-rose-600",
  };
  const initial = name.charAt(0).toUpperCase();
  const bg = colors[name.charAt(0).toLowerCase()] ?? "bg-zinc-600";
  return (
    <span className={`w-4 h-4 rounded-full ${bg} flex items-center justify-center text-[7px] font-bold text-white shrink-0`}>
      {initial}
    </span>
  );
}

export function LessonDetail({ lesson, onClose, onStatusChange, onTagClick, initialEditMode }: LessonDetailProps) {
  const { toast } = useToast();
  const { projectId } = useProject();

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Version history
  const [versions, setVersions] = useState<LessonVersion[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [aiEditorOpen, setAiEditorOpen] = useState(false);
  const [linkedDocs, setLinkedDocs] = useState<{ document_id: string; name: string; doc_type: string; file_size_bytes?: number }[]>([]);

  // Selection toolbar
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<{ show: boolean; top: number; left: number; text: string }>({ show: false, top: 0, left: 0, text: "" });

  // Suggested tags
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [loadingSuggestedTags, setLoadingSuggestedTags] = useState(false);

  // Feedback
  const [feedback, setFeedback] = useState<{ up_count: number; down_count: number; user_vote: number; retrieval_count: number }>({ up_count: 0, down_count: 0, user_vote: 0, retrieval_count: 0 });

  // Bookmark
  const [bookmarked, setBookmarked] = useState(false);

  // Comments
  const [comments, setComments] = useState<any[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [replyToId, setReplyToId] = useState<string | null>(null);

  // Reset edit state when lesson changes
  useEffect(() => {
    if (lesson) {
      setEditTitle(lesson.title);
      setEditContent(lesson.content);
      setEditTags([...lesson.tags]);
      setEditing(!!initialEditMode);
      setDirty(false);
      setVersions([]);
      setVersionsOpen(false);
      setExpandedVersion(null);
    }
  }, [lesson, initialEditMode]);

  // Fetch versions when section is opened
  const fetchVersions = useCallback(() => {
    if (!lesson) return;
    setVersionsLoading(true);
    api.listLessonVersions(lesson.lesson_id, { project_id: projectId })
      .then((res) => setVersions(res.versions ?? []))
      .catch(() => setVersions([]))
      .finally(() => setVersionsLoading(false));
  }, [lesson, projectId]);

  useEffect(() => {
    if (versionsOpen && lesson) fetchVersions();
  }, [versionsOpen, lesson, fetchVersions]);

  // Fetch linked documents (reverse lookup via lesson_id filter)
  useEffect(() => {
    if (!lesson) { setLinkedDocs([]); return; }
    api.listDocuments({ project_id: projectId, lesson_id: lesson.lesson_id, limit: 20 })
      .then((res) => setLinkedDocs((res.items ?? []).map((d: any) => ({
        document_id: d.document_id ?? d.doc_id,
        name: d.name,
        doc_type: d.doc_type,
        file_size_bytes: d.file_size_bytes,
      }))))
      .catch(() => setLinkedDocs([]));
  }, [lesson, projectId]);

  // Fetch feedback
  useEffect(() => {
    if (!lesson) return;
    api.getFeedback(lesson.lesson_id, "gui-user")
      .then((res) => setFeedback({ up_count: res.up_count ?? 0, down_count: res.down_count ?? 0, user_vote: res.user_vote ?? 0, retrieval_count: res.retrieval_count ?? 0 }))
      .catch(() => {});
  }, [lesson]);

  // Fetch bookmark state
  useEffect(() => {
    if (!lesson) { setBookmarked(false); return; }
    api.listBookmarks({ user_id: "gui-user", project_id: projectId })
      .then((res) => {
        const bkIds = new Set((res.bookmarks ?? []).map((b: any) => b.lesson_id));
        setBookmarked(bkIds.has(lesson.lesson_id));
      })
      .catch(() => setBookmarked(false));
  }, [lesson, projectId]);

  // Fetch comments
  const fetchComments = useCallback(() => {
    if (!lesson) return;
    api.listComments(lesson.lesson_id)
      .then((res) => setComments(res.comments ?? []))
      .catch(() => setComments([]));
  }, [lesson]);

  useEffect(() => { if (commentsOpen) fetchComments(); }, [commentsOpen, fetchComments]);

  const handleVote = async (vote: 1 | -1) => {
    if (!lesson) return;
    try {
      await api.voteFeedback(lesson.lesson_id, { user_id: "gui-user", vote });
      const res = await api.getFeedback(lesson.lesson_id, "gui-user");
      setFeedback({ up_count: res.up_count ?? 0, down_count: res.down_count ?? 0, user_vote: res.user_vote ?? 0, retrieval_count: res.retrieval_count ?? 0 });
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Vote failed");
    }
  };

  const handleToggleBookmark = async () => {
    if (!lesson) return;
    try {
      if (bookmarked) {
        await api.removeBookmark({ user_id: "gui-user", lesson_id: lesson.lesson_id });
      } else {
        await api.addBookmark({ user_id: "gui-user", lesson_id: lesson.lesson_id });
      }
      setBookmarked(!bookmarked);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Bookmark failed");
    }
  };

  const handlePostComment = async () => {
    if (!lesson || !newComment.trim()) return;
    setPostingComment(true);
    try {
      await api.addComment(lesson.lesson_id, { author: "gui-user", content: newComment.trim(), parent_id: replyToId ?? undefined });
      setNewComment("");
      setReplyToId(null);
      fetchComments();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPostingComment(false);
    }
  };

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
      if (versionsOpen) fetchVersions();
      onStatusChange();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [lesson, dirty, editTitle, editContent, editTags, projectId, toast, onStatusChange, versionsOpen, fetchVersions]);

  const handleCancel = () => {
    if (lesson) {
      setEditTitle(lesson.title);
      setEditContent(lesson.content);
      setEditTags([...lesson.tags]);
    }
    setEditing(false);
    setDirty(false);
  };

  const handleRestore = async (v: LessonVersion) => {
    if (!lesson) return;
    setRestoring(true);
    try {
      await api.updateLesson(lesson.lesson_id, {
        project_id: projectId,
        title: v.title,
        content: v.content,
        tags: v.tags,
        changed_by: "gui-user",
        change_summary: `Restored from v${v.version_number}`,
      });
      toast("success", `Restored to v${v.version_number}`);
      if (versionsOpen) fetchVersions();
      onStatusChange();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
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
  const maxVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version_number)) : 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-[fadeIn_0.15s_ease-out]" onClick={onClose} />

      {/* Center modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div role="dialog" aria-label="Lesson detail" className="w-full max-w-3xl max-h-[85vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col animate-[fadeInScale_0.2s_ease-out]">

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
                  onClick={handleToggleBookmark}
                  className={`p-1.5 rounded-md hover:bg-zinc-800 transition-colors ${bookmarked ? "text-amber-400" : "text-zinc-500 hover:text-zinc-300"}`}
                  title={bookmarked ? "Remove bookmark" : "Bookmark"}
                >
                  <Bookmark size={16} fill={bookmarked ? "currentColor" : "none"} />
                </button>
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
              {lesson.captured_by && (
                <span className="inline-flex items-center gap-1">
                  <AuthorAvatar name={lesson.captured_by} />
                  {lesson.captured_by}
                </span>
              )}
            </div>

            {/* Feedback bar */}
            {!editing && (
              <div className="flex items-center gap-3 px-3 py-2 bg-zinc-800/40 border border-zinc-800 rounded-lg">
                <span className="text-xs text-zinc-500">Was this useful?</span>
                <button
                  onClick={() => handleVote(1)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs transition-colors ${
                    feedback.user_vote === 1
                      ? "bg-emerald-500/15 border border-emerald-500/20 text-emerald-400"
                      : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:bg-emerald-500/15 hover:border-emerald-500/20 hover:text-emerald-400"
                  }`}
                >
                  <ThumbsUp size={14} />
                  <span className="font-medium">{feedback.up_count}</span>
                </button>
                <button
                  onClick={() => handleVote(-1)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs transition-colors ${
                    feedback.user_vote === -1
                      ? "bg-red-500/15 border border-red-500/20 text-red-400"
                      : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:bg-red-500/15 hover:border-red-500/20 hover:text-red-400"
                  }`}
                >
                  <ThumbsDown size={14} />
                  <span className="font-medium">{feedback.down_count}</span>
                </button>
                {(feedback.up_count + feedback.down_count) > 0 && (
                  <div className="flex-1 max-w-[120px] h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${Math.round((feedback.up_count / (feedback.up_count + feedback.down_count)) * 100)}%` }}
                    />
                  </div>
                )}
                {feedback.retrieval_count > 0 && (
                  <span className="text-[11px] text-zinc-600">Retrieved {feedback.retrieval_count} times</span>
                )}
              </div>
            )}

            {/* Content */}
            <div>
              <h3 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Content</h3>
              {editing ? (
                <div className="relative">
                  <textarea
                    ref={contentRef}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onSelect={() => {
                      const ta = contentRef.current;
                      if (!ta) return;
                      const selected = ta.value.substring(ta.selectionStart, ta.selectionEnd).trim();
                      if (selected.length > 0) {
                        const rect = ta.getBoundingClientRect();
                        setSelectionToolbar({ show: true, top: -36, left: rect.width / 2, text: selected });
                      } else {
                        setSelectionToolbar((s) => ({ ...s, show: false }));
                      }
                    }}
                    onBlur={() => { setTimeout(() => setSelectionToolbar((s) => ({ ...s, show: false })), 200); }}
                    rows={12}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-300 leading-relaxed focus:outline-none focus:border-zinc-500 transition-colors resize-y font-mono"
                  />
                  {/* Floating selection toolbar */}
                  {selectionToolbar.show && (
                    <div
                      className="absolute z-10 flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800 border border-purple-700/50 rounded-lg shadow-xl animate-[fadeIn_0.1s_ease-out]"
                      style={{ top: selectionToolbar.top, left: selectionToolbar.left, transform: "translateX(-50%)" }}
                    >
                      <span className="text-[10px] text-zinc-500">{selectionToolbar.text.length} chars</span>
                      <button
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setAiEditorOpen(true);
                          setSelectionToolbar((s) => ({ ...s, show: false }));
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-purple-600/20 hover:bg-purple-600/30 border border-purple-700/40 rounded text-purple-400 font-medium transition-colors"
                      >
                        <Sparkles size={10} />
                        Ask AI
                      </button>
                    </div>
                  )}
                </div>
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
                    <>
                      <input
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                        placeholder="Add tag..."
                        className="px-2 py-0.5 text-xs bg-zinc-800 border border-dashed border-zinc-600 rounded-full text-zinc-400 placeholder-zinc-600 w-20 focus:outline-none focus:border-zinc-500"
                      />
                      <button
                        onClick={async () => {
                          setLoadingSuggestedTags(true);
                          setSuggestedTags([]);
                          try {
                            const res = await api.suggestTags(lesson.lesson_id, { project_id: projectId });
                            setSuggestedTags((res.suggestions ?? []).filter((t: string) => !editTags.includes(t)));
                          } catch {
                            toast("error", "Failed to suggest tags");
                          } finally {
                            setLoadingSuggestedTags(false);
                          }
                        }}
                        disabled={loadingSuggestedTags}
                        className="px-2 py-0.5 text-[10px] bg-purple-600/15 hover:bg-purple-600/25 border border-purple-700/40 rounded-full text-purple-400 transition-colors disabled:opacity-50 inline-flex items-center gap-0.5"
                      >
                        <Sparkles size={10} />
                        {loadingSuggestedTags ? "..." : "Suggest"}
                      </button>
                    </>
                  )}
                </div>
                {/* AI-suggested tags */}
                {editing && suggestedTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {suggestedTags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-purple-600/10 border border-dashed border-purple-600/30 text-purple-400"
                      >
                        <Sparkles size={9} className="opacity-60" />
                        {t}
                        <button
                          onClick={() => { setEditTags([...editTags, t]); setSuggestedTags(suggestedTags.filter((s) => s !== t)); }}
                          className="hover:text-emerald-400 ml-0.5 transition-colors"
                          title="Accept"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        </button>
                        <button
                          onClick={() => setSuggestedTags(suggestedTags.filter((s) => s !== t))}
                          className="hover:text-red-400 transition-colors"
                          title="Dismiss"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Linked Documents */}
            {!editing && (
              <div>
                <h3 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2 flex items-center gap-1.5">
                  <FileText size={14} className="text-zinc-500" />
                  Documents
                </h3>
                <div className="space-y-2">
                  {linkedDocs.length === 0 ? (
                    <p className="text-xs text-zinc-600">No documents linked</p>
                  ) : (
                    linkedDocs.map((d) => (
                      <div key={d.document_id} className="flex items-center gap-3 px-3 py-2.5 bg-zinc-800/40 border border-zinc-800 rounded-lg">
                        <FileText size={18} className={d.doc_type === "url" ? "text-blue-400 shrink-0" : "text-red-400 shrink-0"} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-300 truncate">{d.name}</p>
                          <p className="text-[11px] text-zinc-600">{d.doc_type === "url" ? "External" : `${((d.file_size_bytes ?? 0) / 1024).toFixed(0)} KB`}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button className="px-2 py-1 text-[10px] bg-zinc-700/50 hover:bg-zinc-700 border border-zinc-600/50 rounded text-zinc-400 hover:text-zinc-300 transition-colors">Open</button>
                          <button className="px-2 py-1 text-[10px] bg-zinc-700/50 hover:bg-red-600/20 border border-zinc-600/50 hover:border-red-700/50 rounded text-zinc-500 hover:text-red-400 transition-colors">Unlink</button>
                        </div>
                      </div>
                    ))
                  )}
                  <button className="flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 border border-dashed border-zinc-700 hover:border-zinc-500 rounded-lg transition-colors w-full justify-center">
                    <Plus size={14} />
                    Attach Document
                  </button>
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

            {/* AI Editor */}
            {aiEditorOpen && !editing && lesson && (
              <AiEditor
                lessonId={lesson.lesson_id}
                content={lesson.content}
                onApply={(newContent) => {
                  setEditContent(newContent);
                  setEditTitle(lesson.title);
                  setEditTags([...lesson.tags]);
                  setEditing(true);
                  setAiEditorOpen(false);
                }}
                onClose={() => setAiEditorOpen(false)}
              />
            )}

            {/* Comments */}
            {!editing && (
              <div>
                <button
                  onClick={() => setCommentsOpen(!commentsOpen)}
                  className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500 hover:text-zinc-300 transition-colors mb-2"
                >
                  <MessageSquare size={12} />
                  <span>Comments</span>
                  {commentsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {comments.length > 0 && (
                    <span className="text-zinc-600 normal-case tracking-normal">({comments.length})</span>
                  )}
                </button>
                {commentsOpen && (
                  <div className="space-y-3">
                    {comments.length === 0 && (
                      <p className="text-xs text-zinc-600 py-2">No comments yet</p>
                    )}
                    {comments.map((c: any) => (
                      <div key={c.comment_id} className="flex gap-3">
                        <AuthorAvatar name={c.author ?? "?"} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-zinc-300">{c.author}</span>
                            <span className="text-[11px] text-zinc-600">{relTime(c.created_at)}</span>
                          </div>
                          <p className="text-sm text-zinc-400 leading-relaxed">{c.content}</p>
                          <button onClick={() => setReplyToId(c.comment_id)} className="text-[11px] text-zinc-600 hover:text-zinc-400 mt-1 transition-colors">Reply</button>
                          {/* Nested replies */}
                          {c.replies?.map((r: any) => (
                            <div key={r.comment_id} className="flex gap-3 mt-3 pl-2 border-l-2 border-zinc-800">
                              <AuthorAvatar name={r.author ?? "?"} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium text-zinc-300">{r.author}</span>
                                  <span className="text-[11px] text-zinc-600">{relTime(r.created_at)}</span>
                                </div>
                                <p className="text-sm text-zinc-400 leading-relaxed">{r.content}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {/* Add comment */}
                    <div className="pt-3 border-t border-zinc-800">
                      {replyToId && (
                        <div className="flex items-center gap-2 mb-2 text-[11px] text-zinc-500">
                          <span>Replying to comment</span>
                          <button onClick={() => setReplyToId(null)} className="text-zinc-600 hover:text-zinc-400">&times; Cancel</button>
                        </div>
                      )}
                      <textarea
                        rows={2}
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder={replyToId ? "Write a reply..." : "Add a comment..."}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-300 outline-none placeholder-zinc-600 resize-none focus:border-zinc-600 transition-colors"
                      />
                      <div className="flex items-center justify-end mt-2">
                        <button
                          onClick={handlePostComment}
                          disabled={!newComment.trim() || postingComment}
                          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white font-medium transition-colors disabled:opacity-50"
                        >
                          {postingComment ? "Posting..." : "Post Comment"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Version History — flat row layout matching draft */}
            {!editing && (
              <div>
                <button
                  onClick={() => setVersionsOpen(!versionsOpen)}
                  className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500 hover:text-zinc-300 transition-colors mb-2"
                >
                  <History size={12} />
                  <span>History</span>
                  {versionsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {versions.length > 0 && (
                    <span className="text-[10px] text-zinc-600 normal-case tracking-normal ml-1">
                      ({versions.length})
                    </span>
                  )}
                </button>
                {versionsOpen && (
                  <div className="space-y-0">
                    {versionsLoading ? (
                      <div className="text-xs text-zinc-600 py-2">Loading versions...</div>
                    ) : versions.length === 0 ? (
                      <div className="text-xs text-zinc-600 py-2">No previous versions</div>
                    ) : (
                      versions.map((v) => {
                        const isCurrent = v.version_number === maxVersion;
                        const isExpanded = expandedVersion === v.version_number;
                        return (
                          <div key={v.version_number}>
                            {/* Flat row */}
                            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-zinc-800/60">
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded shrink-0 ${
                                isCurrent
                                  ? "bg-blue-500/15 text-blue-400 border border-blue-500/20"
                                  : "bg-zinc-700/50 text-zinc-400 border border-zinc-700"
                              }`}>
                                v{v.version_number}
                              </span>
                              <span className="text-xs text-zinc-400 flex-1 truncate">
                                {v.change_summary ?? "No description"}
                              </span>
                              {v.changed_by && (
                                <span className="inline-flex items-center gap-1 shrink-0">
                                  <AuthorAvatar name={v.changed_by} />
                                  <span className="text-[11px] text-zinc-500">{v.changed_by}</span>
                                </span>
                              )}
                              <span className="text-[11px] text-zinc-600 shrink-0">{relTime(v.changed_at)}</span>
                              {isCurrent ? (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shrink-0">
                                  Current
                                </span>
                              ) : (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => setExpandedVersion(isExpanded ? null : v.version_number)}
                                    className="px-2 py-0.5 text-[10px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-300 transition-colors"
                                  >
                                    {isExpanded ? "Hide" : "View"}
                                  </button>
                                  <button
                                    onClick={() => handleRestore(v)}
                                    disabled={restoring}
                                    className="px-2 py-0.5 text-[10px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-300 transition-colors disabled:opacity-50"
                                  >
                                    Restore
                                  </button>
                                </div>
                              )}
                            </div>
                            {/* Expanded content (View) */}
                            {isExpanded && (
                              <div className="px-4 py-3 bg-zinc-800/30 border-b border-zinc-800/60 space-y-2">
                                <div className="text-xs text-zinc-500 font-medium">Title</div>
                                <div className="text-sm text-zinc-400">{v.title}</div>
                                <div className="text-xs text-zinc-500 font-medium pt-1">Content</div>
                                <div className="text-sm text-zinc-400 whitespace-pre-wrap max-h-40 overflow-y-auto font-mono text-xs leading-relaxed bg-zinc-800/50 rounded p-2">
                                  {v.content}
                                </div>
                                {v.tags.length > 0 && (
                                  <>
                                    <div className="text-xs text-zinc-500 font-medium pt-1">Tags</div>
                                    <div className="flex flex-wrap gap-1">
                                      {v.tags.map((t) => (
                                        <span key={t} className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-500">{t}</span>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
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
                {(lesson.status === "draft" || lesson.status === "pending_review") && (
                  <Button variant="primary" size="sm" onClick={() => changeStatus("active")}>
                    Approve
                  </Button>
                )}
                <button
                  onClick={() => setAiEditorOpen(!aiEditorOpen)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-600/20 hover:bg-purple-600/30 border border-purple-700/50 rounded-md text-purple-400 transition-colors"
                >
                  <Sparkles size={13} />
                  {aiEditorOpen ? "Close AI" : "Improve with AI"}
                </button>
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
