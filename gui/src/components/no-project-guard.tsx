"use client";

import { useProject } from "@/contexts/project-context";
import { getColorClasses, getInitials } from "@/lib/project-colors";
import { cn } from "@/lib/cn";
import { FolderOpen, AlertTriangle, Plus } from "lucide-react";
import { type ReactNode } from "react";

interface NoProjectGuardProps {
  children: ReactNode;
  /** Optional: trigger the create project modal */
  onCreateClick?: () => void;
  /** When true, this page requires a single project — shows warning in "All Projects" mode. */
  requireSingleProject?: boolean;
  /** Label for the warning (e.g. "Graph Explorer"). Defaults to "This page". */
  pageName?: string;
}

/**
 * Wraps page content. If no valid project is selected, shows a prompt
 * instead of the actual page content.
 */
export function NoProjectGuard({ children, onCreateClick, requireSingleProject, pageName }: NoProjectGuardProps) {
  const { projectId, projects, isAllProjects, selectedProjectIds, setProjectId } = useProject();

  // Per-project-only guard: show warning when All Projects or multi-select is active
  if (requireSingleProject && (isAllProjects || selectedProjectIds.length > 1)) {
    const label = pageName ?? "This page";
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="border border-amber-500/20 rounded-lg bg-amber-500/5 p-5 max-w-2xl mx-auto mt-12">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-amber-300">The {label} page requires a single project</h3>
              <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                {label} cannot be used in All Projects mode. Select a specific project to continue.
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                {projects.slice(0, 6).map((p) => {
                  const color = getColorClasses(p.color);
                  const name = p.name ?? p.project_id;
                  return (
                    <button
                      key={p.project_id}
                      onClick={() => setProjectId(p.project_id)}
                      className="flex items-center gap-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-xs text-zinc-300 hover:border-zinc-500 transition-colors"
                    >
                      <div className={cn("w-4 h-4 rounded bg-gradient-to-br flex items-center justify-center text-[7px] font-bold text-white", color.from, color.to)}>
                        {getInitials(name)}
                      </div>
                      {name}
                    </button>
                  );
                })}
                {projects.length > 6 && (
                  <span className="flex items-center px-2 text-[10px] text-zinc-600">+{projects.length - 6} more</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No project selected at all
  // Only show this when projects have loaded (avoids flash during hydration)
  if (projects.length > 0 && (!projectId || projectId === "default")) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-full w-16 h-16 flex items-center justify-center mb-3">
          <FolderOpen size={28} className="text-zinc-600" strokeWidth={1.5} />
        </div>
        <div className="text-sm text-zinc-400 mb-1">No project selected</div>
        <div className="text-xs text-zinc-600 mb-4">Select a project from the sidebar or create a new one to get started.</div>
        {onCreateClick && (
          <button
            onClick={onCreateClick}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-sm text-white font-medium transition-colors flex items-center gap-1.5"
          >
            <Plus size={14} />
            Create Project
          </button>
        )}
      </div>
    );
  }

  // Project ID set but not found in the projects list (and list has loaded)
  if (projects.length > 0 && !projects.find((p) => p.project_id === projectId)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-full w-16 h-16 flex items-center justify-center mb-3">
          <AlertTriangle size={28} className="text-amber-500" strokeWidth={1.5} />
        </div>
        <div className="text-sm text-zinc-400 mb-1">Project not found</div>
        <div className="text-xs text-zinc-600 mb-1">
          The project <span className="font-mono text-zinc-500">&quot;{projectId}&quot;</span> no longer exists.
        </div>
        <div className="text-xs text-zinc-600">Select another project from the sidebar.</div>
      </div>
    );
  }

  return <>{children}</>;
}
