"use client";

import { useProject } from "@/contexts/project-context";
import { getColorClasses, getInitials } from "@/lib/project-colors";
import { cn } from "@/lib/cn";
import { LayoutGrid } from "lucide-react";

/**
 * ProjectBadge — inline badge showing current project context.
 * Used in PageHeader breadcrumbs and anywhere project identity is needed.
 *
 * Renders:
 * - Single project: color dot + project name
 * - All Projects: gradient dot + "All Projects"
 * - Multi-select: stacked dots + "N projects"
 */
export function ProjectBadge() {
  const { projectId, projects, selectedProjectIds, isAllProjects } = useProject();

  if (isAllProjects) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 shrink-0" />
        <span className="text-zinc-400 font-medium">All Projects</span>
      </span>
    );
  }

  if (selectedProjectIds.length > 1) {
    const selected = projects.filter(p => selectedProjectIds.includes(p.project_id));
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex -space-x-0.5">
          {selected.slice(0, 3).map(p => {
            const c = getColorClasses(p.color);
            return <span key={p.project_id} className={cn("w-2.5 h-2.5 rounded-full bg-gradient-to-br border border-zinc-950", c.from, c.to)} />;
          })}
        </span>
        <span className="text-zinc-400 font-medium">{selected.length} projects</span>
      </span>
    );
  }

  // Single project
  const current = projects.find(p => p.project_id === projectId);
  const color = getColorClasses(current?.color);
  const name = current?.name ?? current?.project_id ?? projectId;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("w-2.5 h-2.5 rounded-full bg-gradient-to-br shrink-0", color.from, color.to)} />
      <span className="text-zinc-400 font-medium">{name}</span>
    </span>
  );
}
