"use client";

import { useState, useRef, useEffect } from "react";
import { useProject, ALL_PROJECTS_SENTINEL } from "@/contexts/project-context";
import { getColorClasses, getInitials } from "@/lib/project-colors";
import { cn } from "@/lib/cn";
import { Search, ChevronDown, Check, Plus, LayoutGrid } from "lucide-react";
import Link from "next/link";

export function ProjectSelector({ onCreateClick }: { onCreateClick?: () => void }) {
  const {
    projectId, setProjectId, projects, includeGroups, setIncludeGroups,
    selectedProjectIds, setSelectedProjectIds, isAllProjects,
  } = useProject();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) { setSearch(""); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); e.stopPropagation(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const filtered = projects.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.project_id.toLowerCase().includes(q) || (p.name ?? "").toLowerCase().includes(q);
  });

  const totalLessons = projects.reduce((sum, p) => sum + (p.lesson_count ?? 0), 0);

  const isSelected = (pid: string) => isAllProjects || selectedProjectIds.includes(pid);

  const toggleProject = (pid: string) => {
    if (isAllProjects) { setSelectedProjectIds([pid]); return; }
    const next = selectedProjectIds.includes(pid)
      ? selectedProjectIds.filter(id => id !== pid)
      : [...selectedProjectIds, pid];
    if (next.length === 0) return;
    setSelectedProjectIds(next);
  };

  const selectAll = () => { setSelectedProjectIds([ALL_PROJECTS_SENTINEL]); setOpen(false); };
  const selectSingle = (pid: string) => { setProjectId(pid); setOpen(false); };

  // ── Empty state ──
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

  // ── Trigger content ──
  const current = projects.find((p) => p.project_id === projectId);

  function TriggerContent() {
    if (isAllProjects) {
      return (
        <>
          <div className="w-7 h-7 rounded-md bg-gradient-to-r from-blue-600 via-purple-600 to-emerald-600 flex items-center justify-center shrink-0">
            <LayoutGrid size={12} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-200 font-medium">All Projects</div>
            <div className="text-[10px] text-zinc-600">{projects.length} projects · {totalLessons} lessons</div>
          </div>
        </>
      );
    }
    if (selectedProjectIds.length > 1) {
      const selected = projects.filter(p => selectedProjectIds.includes(p.project_id));
      return (
        <>
          <div className="flex -space-x-1 shrink-0">
            {selected.slice(0, 3).map(p => {
              const c = getColorClasses(p.color);
              return (
                <div key={p.project_id} className={cn("w-6 h-6 rounded-md bg-gradient-to-br flex items-center justify-center text-[8px] font-bold text-white border border-zinc-950", c.from, c.to)}>
                  {getInitials(p.name ?? p.project_id)}
                </div>
              );
            })}
            {selected.length > 3 && <div className="w-6 h-6 rounded-md bg-zinc-800 flex items-center justify-center text-[9px] text-zinc-400 border border-zinc-950">+{selected.length - 3}</div>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-200 font-medium">{selected.length} projects</div>
            <div className="text-[10px] text-zinc-600">{selected.reduce((s, p) => s + (p.lesson_count ?? 0), 0)} lessons</div>
          </div>
        </>
      );
    }
    const c = getColorClasses(current?.color);
    const name = current?.name ?? current?.project_id ?? projectId;
    return (
      <>
        <div className={cn("w-7 h-7 rounded-md bg-gradient-to-br flex items-center justify-center text-[11px] font-bold text-white shrink-0", c.from, c.to)}>
          {getInitials(name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-zinc-200 font-medium truncate">{name}</div>
          <div className="text-[10px] text-zinc-600">{current?.lesson_count ?? 0} lessons</div>
        </div>
      </>
    );
  }

  return (
    <div className="px-3 py-2 space-y-1.5" ref={ref}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "w-full flex items-center gap-2.5 px-2.5 py-2 border rounded-lg text-left transition-colors",
          open ? "bg-zinc-800 border-zinc-700" : "bg-zinc-900 border-zinc-800 hover:border-zinc-700",
        )}
      >
        <TriggerContent />
        <ChevronDown size={12} className={cn("text-zinc-600 shrink-0 transition-transform", open && "rotate-180 text-zinc-400")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl overflow-hidden">
          {/* Search */}
          <div className="px-3 py-2 border-b border-zinc-800">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md">
              <Search size={12} className="text-zinc-500 shrink-0" />
              <input ref={inputRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects..." className="bg-transparent text-xs text-zinc-300 outline-none flex-1 placeholder-zinc-600" />
            </div>
          </div>

          {/* "All Projects" option */}
          {!search && (
            <div className="px-2 py-1.5 border-b border-zinc-800">
              <button onClick={selectAll}
                className={cn("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors text-left", isAllProjects ? "bg-zinc-800/60" : "hover:bg-zinc-800/40")}>
                <div className="w-5 h-5 rounded-md bg-gradient-to-r from-blue-600 via-purple-600 to-emerald-600 flex items-center justify-center shrink-0">
                  <LayoutGrid size={10} className="text-white" />
                </div>
                <span className="text-xs text-zinc-300 font-medium flex-1">All Projects</span>
                <span className="text-[10px] text-zinc-600">{totalLessons} lessons</span>
                {isAllProjects && <Check size={14} className="text-blue-400 shrink-0 ml-1" />}
              </button>
            </div>
          )}

          {/* Project list with checkboxes */}
          <div className="max-h-48 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-600">No projects found</div>
            ) : (
              filtered.map((p) => {
                const color = getColorClasses(p.color);
                const name = p.name ?? p.project_id;
                const initials = getInitials(name);
                const active = isSelected(p.project_id);
                return (
                  <div key={p.project_id} className={cn("flex items-center gap-2 px-3 py-1.5 transition-colors", active ? "bg-zinc-800/40" : "hover:bg-zinc-800/30")}>
                    <button onClick={() => toggleProject(p.project_id)}
                      className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                        active ? "border-blue-500 bg-blue-500" : "border-zinc-700 hover:border-zinc-500")}>
                      {active && <Check size={10} className="text-white" />}
                    </button>
                    <button onClick={() => selectSingle(p.project_id)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                      <div className={cn("w-5 h-5 rounded-md bg-gradient-to-br flex items-center justify-center text-[9px] font-bold text-white shrink-0", color.from, color.to)}>
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={cn("text-xs truncate", active ? "text-zinc-200 font-medium" : "text-zinc-400")}>{name}</div>
                        <div className="text-[10px] text-zinc-600">{p.lesson_count} lessons</div>
                      </div>
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-zinc-800 px-3 py-2 flex items-center justify-between">
            <button onClick={() => { setOpen(false); onCreateClick?.(); }} className="text-[10px] text-blue-400 hover:text-blue-300">+ New Project</button>
            <Link href="/projects" onClick={() => setOpen(false)} className="text-[10px] text-zinc-500 hover:text-zinc-300">Manage →</Link>
          </div>
        </div>
      )}

      {/* Include groups toggle (single-project mode only) */}
      {!isAllProjects && selectedProjectIds.length === 1 && (
        <label className="flex items-center gap-1.5 cursor-pointer px-1">
          <input type="checkbox" checked={includeGroups} onChange={(e) => setIncludeGroups(e.target.checked)}
            className="w-3 h-3 rounded border-zinc-700 bg-zinc-800 accent-blue-500" />
          <span className="text-[10px] text-zinc-500">Include group knowledge</span>
        </label>
      )}
    </div>
  );
}
