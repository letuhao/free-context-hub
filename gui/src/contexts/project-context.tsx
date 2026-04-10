"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api } from "@/lib/api";

type ProjectInfo = {
  project_id: string;
  name: string | null;
  description: string | null;
  color: string | null;
  settings: Record<string, unknown>;
  groups: Array<{ group_id: string; name: string }>;
  lesson_count: number;
};

/** Sentinel value for "all projects" mode. */
export const ALL_PROJECTS_SENTINEL = "__ALL__";

interface ProjectContextValue {
  /** Primary project ID (backward compat — first of selectedProjectIds, or legacy single). */
  projectId: string;
  setProjectId: (id: string) => void;
  /** All known projects (from GET /api/projects). Empty until fetched. */
  projects: ProjectInfo[];
  /** When true, searches include lessons from all groups this project belongs to. */
  includeGroups: boolean;
  setIncludeGroups: (v: boolean) => void;
  /** Multi-project selection. ["__ALL__"] = all projects; ["id1","id2"] = specific; ["id1"] = single. */
  selectedProjectIds: string[];
  setSelectedProjectIds: (ids: string[]) => void;
  /** True when selectedProjectIds is ["__ALL__"]. */
  isAllProjects: boolean;
  /** Resolved array of actual project IDs (expands __ALL__ to all project IDs). */
  effectiveProjectIds: string[];
  /** Refreshes the projects list from the API. */
  refreshProjects: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "contexthub-project-id";
const INCLUDE_GROUPS_KEY = "contexthub-include-groups";
const SELECTED_IDS_KEY = "contexthub-selected-project-ids";
const DEFAULT_PROJECT = process.env.NEXT_PUBLIC_CONTEXTHUB_DEFAULT_PROJECT ?? "default";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectIdState] = useState(DEFAULT_PROJECT);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [includeGroups, setIncludeGroupsState] = useState(false);
  const [selectedProjectIds, setSelectedIdsState] = useState<string[]>([DEFAULT_PROJECT]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setProjectIdState(stored);
    const storedGroups = localStorage.getItem(INCLUDE_GROUPS_KEY);
    if (storedGroups === "true") setIncludeGroupsState(true);
    const storedSelected = localStorage.getItem(SELECTED_IDS_KEY);
    if (storedSelected) {
      try {
        const parsed = JSON.parse(storedSelected);
        if (Array.isArray(parsed) && parsed.length > 0) setSelectedIdsState(parsed);
      } catch { /* ignore corrupt data */ }
    }
  }, []);

  const setProjectId = useCallback((id: string) => {
    setProjectIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
    // Sync: single select updates selectedProjectIds too
    setSelectedIdsState([id]);
    localStorage.setItem(SELECTED_IDS_KEY, JSON.stringify([id]));
  }, []);

  const setSelectedProjectIds = useCallback((ids: string[]) => {
    setSelectedIdsState(ids);
    localStorage.setItem(SELECTED_IDS_KEY, JSON.stringify(ids));
    // Sync: update legacy projectId to first non-sentinel ID
    const firstReal = ids.find(id => id !== ALL_PROJECTS_SENTINEL);
    if (firstReal) {
      setProjectIdState(firstReal);
      localStorage.setItem(STORAGE_KEY, firstReal);
    }
  }, []);

  const setIncludeGroups = useCallback((v: boolean) => {
    setIncludeGroupsState(v);
    localStorage.setItem(INCLUDE_GROUPS_KEY, String(v));
  }, []);

  const refreshProjects = useCallback(() => {
    api.listProjects()
      .then((res) => setProjects(res.projects ?? []))
      .catch(() => { /* silent — projects list is optional */ });
  }, []);

  // Fetch projects on mount.
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Derived state
  const isAllProjects = selectedProjectIds.length === 1 && selectedProjectIds[0] === ALL_PROJECTS_SENTINEL;
  const effectiveProjectIds = isAllProjects
    ? projects.map(p => p.project_id)
    : selectedProjectIds.filter(id => id !== ALL_PROJECTS_SENTINEL);

  return (
    <ProjectContext.Provider
      value={{
        projectId, setProjectId, projects, includeGroups, setIncludeGroups,
        selectedProjectIds, setSelectedProjectIds, isAllProjects, effectiveProjectIds,
        refreshProjects,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
