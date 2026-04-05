"use client";

import { useState, useRef, useEffect } from "react";
import { useProject } from "@/contexts/project-context";
import { getColorClasses, getInitials } from "@/lib/project-colors";
import { cn } from "@/lib/cn";
import { Search, ChevronDown, Check, Plus, Settings } from "lucide-react";
import Link from "next/link";

export function ProjectSelector({ onCreateClick }: { onCreateClick?: () => void }) {
  const { projectId, setProjectId, projects, includeGroups, setIncludeGroups } = useProject();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) {
      setSearch("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); e.stopPropagation(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const current = projects.find((p) => p.project_id === projectId);
  const filtered = projects.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.project_id.toLowerCase().includes(q) || (p.name ?? "").toLowerCase().includes(q);
  });

  // Empty state: no projects at all
  if (projects.length === 0) {
    return (
      <div className="px-3 py-2">
        <button
          onClick={onCreateClick}
          className="w-full flex items-center gap-2.5 px-2.5 py-3 bg-zinc-900 border border-dashed border-zinc-700 rounded-lg hover:border-blue-600/50 hover:bg-blue-500/5 transition-colors text-left group"
        >
          <div className="w-7 h-7 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 group-hover:border-blue-600/50">
            <Plus size={14} className="text-zinc-600 group-hover:text-blue-400" />
          </div>
          <div className="flex-1">
            <div className="text-xs text-zinc-400 group-hover:text-blue-400">Create your first project</div>
            <div className="text-[10px] text-zinc-600">Get started with ContextHub</div>
          </div>
        </button>
      </div>
    );
  }

  const currentColor = getColorClasses(current?.color);
  const currentName = current?.name ?? current?.project_id ?? projectId;
  const currentInitials = getInitials(currentName);

  return (
    <div className="px-3 py-2 space-y-1.5" ref={ref}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Select project, current: ${currentName}`}
        className={cn(
          "w-full flex items-center gap-2.5 px-2.5 py-2 border rounded-lg text-left transition-colors",
          open
            ? "bg-zinc-800 border-zinc-700"
            : "bg-zinc-900 border-zinc-800 hover:border-zinc-700",
        )}
      >
        <div className={cn("w-7 h-7 rounded-md bg-gradient-to-br flex items-center justify-center text-[11px] font-bold text-white shrink-0", currentColor.from, currentColor.to)}>
          {currentInitials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-zinc-200 font-medium truncate">{currentName}</div>
          <div className="text-[10px] text-zinc-600">{current?.lesson_count ?? 0} lessons</div>
        </div>
        <ChevronDown size={12} className={cn("text-zinc-600 shrink-0 transition-transform", open && "rotate-180 text-zinc-400")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl overflow-hidden">
          {/* Search */}
          <div className="px-3 py-2 border-b border-zinc-800">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md">
              <Search size={12} className="text-zinc-500 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects..."
                className="bg-transparent text-xs text-zinc-300 outline-none flex-1 placeholder-zinc-600"
              />
            </div>
          </div>

          {/* Project list */}
          <div className="max-h-48 overflow-y-auto py-1" role="listbox" aria-label="Projects">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-600">No projects found</div>
            ) : (
              filtered.map((p) => {
                const color = getColorClasses(p.color);
                const name = p.name ?? p.project_id;
                const initials = getInitials(name);
                const isActive = p.project_id === projectId;
                return (
                  <button
                    key={p.project_id}
                    role="option"
                    aria-selected={p.project_id === projectId}
                    onClick={() => { setProjectId(p.project_id); setOpen(false); }}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 transition-colors text-left",
                      isActive ? "bg-zinc-800/60" : "hover:bg-zinc-800/40",
                    )}
                  >
                    <div className={cn("w-6 h-6 rounded-md bg-gradient-to-br flex items-center justify-center text-[9px] font-bold text-white shrink-0", color.from, color.to)}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn("text-xs truncate", isActive ? "text-zinc-200 font-medium" : "text-zinc-300")}>{name}</div>
                      <div className="text-[10px] text-zinc-600">{p.lesson_count} lessons</div>
                    </div>
                    {isActive && <Check size={14} className="text-blue-400 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {/* Create new */}
          <div className="border-t border-zinc-800 px-3 py-2">
            <button
              onClick={() => { setOpen(false); onCreateClick?.(); }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors"
            >
              <Plus size={14} />
              Create New Project
            </button>
          </div>

          {/* Manage */}
          <div className="border-t border-zinc-800 px-3 py-2">
            <Link
              href="/projects"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-md transition-colors"
            >
              <Settings size={14} />
              Manage Projects
            </Link>
          </div>
        </div>
      )}

      {/* Include groups toggle */}
      <label className="flex items-center gap-1.5 cursor-pointer px-1">
        <input
          type="checkbox"
          checked={includeGroups}
          onChange={(e) => setIncludeGroups(e.target.checked)}
          className="w-3 h-3 rounded border-zinc-700 bg-zinc-800 accent-blue-500"
        />
        <span className="text-[10px] text-zinc-500">Include group knowledge</span>
      </label>
    </div>
  );
}
