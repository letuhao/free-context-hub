"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { Badge, Button } from "@/components/ui";
import { X, Search, ChevronUp, ChevronDown, Copy, Check, Sparkles, Link2 } from "lucide-react";
import { MarkdownContent } from "../chat/markdown-content";

type Doc = {
  document_id: string;
  name: string;
  doc_type: string;
  url: string | null;
  file_size_bytes: number | null;
  created_at: string;
};

type LinkedLesson = {
  lesson_id: string;
  title: string;
  lesson_type: string;
};

type Suggestion = {
  title: string;
  lesson_type: string;
  content: string;
  accepted: boolean | null;
};

const TYPE_BADGES: Record<string, string> = {
  pdf: "bg-red-500/10 text-red-400",
  markdown: "bg-purple-500/10 text-purple-400",
  url: "bg-cyan-500/10 text-cyan-400",
  text: "bg-zinc-700 text-zinc-300",
};

interface DocumentViewerProps {
  doc: Doc;
  onClose: () => void;
  onChanged: () => void;
  autoGenerate?: boolean;
}

export function DocumentViewer({ doc, onClose, onChanged, autoGenerate }: DocumentViewerProps) {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [content, setContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(true);
  const [linkedLessons, setLinkedLessons] = useState<LinkedLesson[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkSearchOpen, setLinkSearchOpen] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState("");
  const [linkSearchResults, setLinkSearchResults] = useState<{ lesson_id: string; title: string; lesson_type: string }[]>([]);

  // Fetch document content
  useEffect(() => {
    setLoadingContent(true);
    api.getDocument(doc.document_id, { project_id: projectId })
      .then((res) => setContent(res.content ?? ""))
      .catch(() => setContent("(Failed to load content)"))
      .finally(() => setLoadingContent(false));
  }, [doc.document_id, projectId]);

  // Auto-generate if requested
  useEffect(() => {
    if (autoGenerate && !loadingContent && content && suggestions.length === 0 && !generating) {
      handleGenerateLessons();
    }
  }, [autoGenerate, loadingContent, content]);

  // Fetch linked lessons
  const fetchLinked = useCallback(() => {
    api.listDocLessons(doc.document_id, { project_id: projectId })
      .then((res) => setLinkedLessons(res.lessons ?? []))
      .catch(() => setLinkedLessons([]));
  }, [doc.document_id, projectId]);

  useEffect(() => { fetchLinked(); }, [fetchLinked]);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // In-doc search: count matches
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim() || !content) return 0;
    const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return (content.match(regex) || []).length;
  }, [searchQuery, content]);

  // Highlight content with search
  const highlightedContent = useMemo(() => {
    if (!searchQuery.trim() || !content) return content;
    return content.replace(
      new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
      '<mark class="bg-amber-500/30 text-amber-200 rounded px-0.5">$1</mark>'
    );
  }, [searchQuery, content]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateLessons = async () => {
    setGenerating(true);
    setSuggestions([]);
    try {
      const res = await api.generateLessonsFromDoc(doc.document_id, { project_id: projectId });
      const items: Suggestion[] = (res.suggestions ?? []).map((s: any) => ({
        title: s.title ?? "Untitled",
        lesson_type: s.lesson_type ?? "decision",
        content: s.content ?? "",
        accepted: null,
      }));
      setSuggestions(items);
      if (items.length === 0) toast("info", "No lessons suggested for this document");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleAcceptSuggestion = async (idx: number) => {
    const s = suggestions[idx];
    try {
      const res = await api.addLesson({
        project_id: projectId,
        title: s.title,
        content: s.content,
        lesson_type: s.lesson_type,
        tags: [],
        source_refs: [],
        captured_by: "ai-doc-generator",
        status: "draft",
      });
      // Link lesson to document
      const lessonId = res.lesson_id ?? res.id;
      if (lessonId) {
        await api.linkDocLesson(doc.document_id, lessonId, { project_id: projectId });
      }
      setSuggestions((prev) => prev.map((s, i) => i === idx ? { ...s, accepted: true } : s));
      fetchLinked();
      onChanged();
      toast("success", `Lesson "${s.title}" created`);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to create lesson");
    }
  };

  const handleDismiss = (idx: number) => {
    setSuggestions((prev) => prev.map((s, i) => i === idx ? { ...s, accepted: false } : s));
  };

  // Link lesson search
  useEffect(() => {
    if (!linkSearchOpen || !linkSearchQuery.trim()) { setLinkSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await api.listLessons({ project_id: projectId, q: linkSearchQuery, limit: 5, status: "active" });
        setLinkSearchResults((res.items ?? []).map((l: any) => ({ lesson_id: l.lesson_id, title: l.title, lesson_type: l.lesson_type })));
      } catch { setLinkSearchResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [linkSearchQuery, linkSearchOpen, projectId]);

  const handleLinkLesson = async (lessonId: string) => {
    try {
      await api.linkDocLesson(doc.document_id, lessonId, { project_id: projectId });
      fetchLinked();
      onChanged();
      setLinkSearchOpen(false);
      setLinkSearchQuery("");
      toast("success", "Lesson linked");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Link failed");
    }
  };

  const handleUnlink = async (lessonId: string) => {
    try {
      await api.unlinkDocLesson(doc.document_id, lessonId, { project_id: projectId });
      fetchLinked();
      onChanged();
      toast("success", "Lesson unlinked");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Unlink failed");
    }
  };

  const dateStr = new Date(doc.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-[fadeIn_0.15s_ease-out]" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div role="dialog" aria-label={doc.name} className="w-full max-w-4xl max-h-[85vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col animate-[fadeInScale_0.2s_ease-out]">

          {/* Header */}
          <div className="px-6 pt-4 pb-2 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <h2 className="text-base font-semibold text-zinc-100 truncate">{doc.name}</h2>
              <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full shrink-0 ${TYPE_BADGES[doc.doc_type] ?? TYPE_BADGES.text}`}>
                {doc.doc_type.toUpperCase()}
              </span>
              <span className="text-xs text-zinc-600 shrink-0">Uploaded {dateStr}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleGenerateLessons}
                disabled={generating}
                className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                <Sparkles size={12} />
                {generating ? "Generating..." : "Generate Lessons"}
              </button>
              <button onClick={handleCopy} className="px-2.5 py-1 text-xs bg-transparent border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 rounded-md transition-colors flex items-center gap-1">
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 ml-1">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* In-doc search */}
          <div className="px-6 pb-3 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg">
              <Search size={14} className="text-zinc-500 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchIdx(0); }}
                placeholder="Search in document..."
                className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
              />
              {searchQuery && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-zinc-500">
                    {searchMatches > 0 ? `${Math.min(searchIdx + 1, searchMatches)} of ${searchMatches}` : "0 results"}
                  </span>
                  <button onClick={() => setSearchIdx(Math.max(0, searchIdx - 1))} className="text-zinc-500 hover:text-zinc-300">
                    <ChevronUp size={14} />
                  </button>
                  <button onClick={() => setSearchIdx(Math.min(searchMatches - 1, searchIdx + 1))} className="text-zinc-500 hover:text-zinc-300">
                    <ChevronDown size={14} />
                  </button>
                  <button onClick={() => { setSearchQuery(""); setSearchIdx(0); }} className="text-zinc-600 hover:text-zinc-400 text-xs ml-0.5">
                    &times;
                  </button>
                </div>
              )}
              <kbd className="text-[9px] text-zinc-600 bg-zinc-800 px-1 py-0.5 rounded shrink-0">Ctrl+F</kbd>
            </div>
          </div>

          {/* Content + Sidebar */}
          <div className="flex flex-1 overflow-hidden">
            {/* Content area */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {loadingContent ? (
                <div className="text-xs text-zinc-600 py-8 text-center">Loading document...</div>
              ) : searchQuery && highlightedContent !== content ? (
                <div
                  className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: highlightedContent }}
                />
              ) : doc.doc_type === "markdown" ? (
                <MarkdownContent content={content} />
              ) : (
                <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{content}</div>
              )}
            </div>

            {/* Sidebar */}
            <div className="w-64 shrink-0 border-l border-zinc-800 overflow-y-auto p-4 space-y-4">
              <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Linked Lessons</h4>

              {linkedLessons.length === 0 ? (
                <p className="text-[11px] text-zinc-600">No lessons linked yet</p>
              ) : (
                linkedLessons.map((l) => (
                  <div key={l.lesson_id} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge value={l.lesson_type} variant="type" />
                      <span className="text-xs text-zinc-300 truncate">{l.title}</span>
                    </div>
                    <button
                      onClick={() => handleUnlink(l.lesson_id)}
                      className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      Unlink
                    </button>
                  </div>
                ))
              )}

              {linkSearchOpen ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={linkSearchQuery}
                    onChange={(e) => setLinkSearchQuery(e.target.value)}
                    placeholder="Search lessons..."
                    autoFocus
                    className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-700 rounded-md text-xs text-zinc-300 outline-none focus:border-zinc-500 placeholder:text-zinc-600"
                  />
                  {linkSearchResults.map((l) => (
                    <button
                      key={l.lesson_id}
                      onClick={() => handleLinkLesson(l.lesson_id)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md hover:border-zinc-600 transition-colors text-left"
                    >
                      <Badge value={l.lesson_type} variant="type" />
                      <span className="text-xs text-zinc-300 truncate">{l.title}</span>
                    </button>
                  ))}
                  {linkSearchQuery && linkSearchResults.length === 0 && (
                    <p className="text-[10px] text-zinc-600 text-center py-1">No lessons found</p>
                  )}
                  <button onClick={() => { setLinkSearchOpen(false); setLinkSearchQuery(""); }} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors w-full text-center">
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setLinkSearchOpen(true)} className="w-full px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md text-zinc-400 hover:text-zinc-200 transition-colors text-center">
                  + Link Existing Lesson
                </button>
              )}

              {/* Generate section */}
              <div className="border-t border-zinc-800 pt-4 space-y-3">
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Generate from this document</h4>
                <p className="text-[11px] text-zinc-500 leading-relaxed">AI will analyze this document and suggest lessons</p>
                <button
                  onClick={handleGenerateLessons}
                  disabled={generating}
                  className="w-full px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-md text-white transition-colors disabled:opacity-50"
                >
                  {generating ? "Generating..." : "Generate Lessons"}
                </button>

                {/* Suggestion cards */}
                {suggestions.map((s, idx) => (
                  s.accepted === false ? null : (
                    <div key={idx} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge value={s.lesson_type} variant="type" />
                        <span className="text-xs text-zinc-300 truncate">{s.title}</span>
                      </div>
                      {s.accepted === null && (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleAcceptSuggestion(idx)}
                            className="px-2 py-0.5 text-[10px] bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded transition-colors"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => handleDismiss(idx)}
                            className="px-2 py-0.5 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-500 rounded transition-colors"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                      {s.accepted === true && (
                        <span className="text-[10px] text-emerald-400">✓ Created</span>
                      )}
                    </div>
                  )
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-zinc-800 flex items-center justify-between shrink-0">
            <span className="text-xs text-zinc-600">Document ID: <span className="font-mono">{doc.document_id.slice(0, 12)}</span></span>
            <span className="text-[10px] text-zinc-600">Press ESC to close</span>
          </div>
        </div>
      </div>
    </>
  );
}
