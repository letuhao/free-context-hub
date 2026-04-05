"use client";

import { useProject } from "@/contexts/project-context";
import { FolderOpen, AlertTriangle, Plus } from "lucide-react";
import { type ReactNode } from "react";

interface NoProjectGuardProps {
  children: ReactNode;
  /** Optional: trigger the create project modal */
  onCreateClick?: () => void;
}

/**
 * Wraps page content. If no valid project is selected, shows a prompt
 * instead of the actual page content.
 */
export function NoProjectGuard({ children, onCreateClick }: NoProjectGuardProps) {
  const { projectId, projects } = useProject();

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
