"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Search, BookOpen, FileText, Shield, GitCommit, ArrowRight } from "lucide-react";

type SearchResult = { id: string; title: string; subtitle?: string; href: string; group: string };

const GROUP_ICONS: Record<string, React.ReactNode> = {
  Lessons: <BookOpen size={12} className="text-blue-400" />,
  Documents: <FileText size={12} className="text-purple-400" />,
  Guardrails: <Shield size={12} className="text-red-400" />,
  Commits: <GitCommit size={12} className="text-zinc-400" />,
  Actions: <ArrowRight size={12} className="text-zinc-500" />,
};

const STATIC_ACTIONS: SearchResult[] = [
  { id: "nav-dashboard", title: "Go to Dashboard", group: "Actions", href: "/" },
  { id: "nav-lessons", title: "Go to Lessons", group: "Actions", href: "/lessons" },
  { id: "nav-chat", title: "Go to Chat", group: "Actions", href: "/chat" },
  { id: "nav-review", title: "Go to Review Inbox", group: "Actions", href: "/review" },
  { id: "nav-documents", title: "Go to Documents", group: "Actions", href: "/documents" },
  { id: "nav-analytics", title: "Go to Analytics", group: "Actions", href: "/analytics" },
  { id: "nav-settings", title: "Go to Settings", group: "Actions", href: "/settings" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { projectId } = useProject();

  // Ctrl+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setActiveIndex(0);
        setResults([]);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Search with debounce
  useEffect(() => {
    if (!open || !query.trim()) {
      setResults(query.trim() ? [] : STATIC_ACTIONS);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.globalSearch({ project_id: projectId, q: query, limit: 5 });
        const items: SearchResult[] = [];
        for (const l of res.lessons ?? []) {
          items.push({ id: l.lesson_id, title: l.title, subtitle: l.lesson_type, href: "/lessons", group: "Lessons" });
        }
        for (const d of res.documents ?? []) {
          items.push({ id: d.document_id ?? d.doc_id, title: d.name ?? d.title, subtitle: d.doc_type, href: "/documents", group: "Documents" });
        }
        for (const c of (res as any).chunks ?? []) {
          const pageBit = c.page_number !== null && c.page_number !== undefined ? ` · p${c.page_number}` : "";
          const subtitle = `${c.doc_name}${pageBit}${c.heading ? ` — ${c.heading}` : ""}`;
          items.push({
            id: c.chunk_id,
            title: String(c.snippet ?? "").slice(0, 120),
            subtitle,
            href: "/documents",
            group: "Chunks",
          });
        }
        for (const g of res.guardrails ?? []) {
          items.push({ id: g.lesson_id ?? g.id, title: g.title ?? g.name, group: "Guardrails", href: "/guardrails" });
        }
        for (const c of res.commits ?? []) {
          items.push({ id: c.sha, title: c.message?.slice(0, 80), subtitle: c.sha?.slice(0, 7), href: "/projects/git", group: "Commits" });
        }
        // Add matching nav actions
        const actionMatches = STATIC_ACTIONS.filter((a) => a.title.toLowerCase().includes(query.toLowerCase()));
        items.push(...actionMatches);
        setResults(items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, open, projectId]);

  const grouped: Record<string, SearchResult[]> = {};
  for (const r of results) (grouped[r.group] ??= []).push(r);
  const flat = results;

  const handleSelect = (item: SearchResult) => {
    router.push(item.href);
    setOpen(false);
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, flat.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" && flat[activeIndex]) { handleSelect(flat[activeIndex]); }
      else if (e.key === "Escape") { setOpen(false); }
    },
    [flat, activeIndex],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-[fadeIn_0.1s_ease-out]" onClick={() => setOpen(false)} />
      <div role="dialog" aria-label="Search" className="relative w-[560px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden animate-[fadeInScale_0.15s_ease-out]">
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <Search size={18} strokeWidth={1.5} className="text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search lessons, documents, guardrails..."
            className="flex-1 bg-transparent border-none text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          {searching && <span className="text-[10px] text-zinc-600 animate-pulse">Searching...</span>}
          <kbd className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[420px] overflow-y-auto py-1">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div className="px-3 py-1.5 text-[11px] uppercase text-zinc-600 tracking-wide flex items-center gap-1.5">
                {GROUP_ICONS[group]}
                {group}
                <span className="text-zinc-700 ml-1">({items.length})</span>
              </div>
              {items.map((item) => {
                const idx = flat.indexOf(item);
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex items-center justify-between px-3 py-2 mx-1 rounded-md text-sm cursor-pointer transition-colors ${
                      idx === activeIndex ? "bg-zinc-800 text-zinc-100" : "text-zinc-400"
                    }`}
                  >
                    <span className="truncate">{item.title}</span>
                    {item.subtitle && <span className="text-xs text-zinc-600 font-mono shrink-0 ml-2">{item.subtitle}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {results.length === 0 && query.trim() && !searching && (
            <div className="px-4 py-6 text-center text-sm text-zinc-600">No results for &ldquo;{query}&rdquo;</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-4 text-[10px] text-zinc-600">
          <span><kbd className="bg-zinc-800 px-1 py-0.5 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="bg-zinc-800 px-1 py-0.5 rounded">↵</kbd> select</span>
          <span><kbd className="bg-zinc-800 px-1 py-0.5 rounded">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
