"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api } from "@/lib/api";

type ProjectInfo = {
  project_id: string;
  name: string | null;
  groups: Array<{ group_id: string; name: string }>;
  lesson_count: number;
};

interface ProjectContextValue {
  projectId: string;
  setProjectId: (id: string) => void;
  /** All known projects (from GET /api/projects). Empty until fetched. */
  projects: ProjectInfo[];
  /** When true, searches include lessons from all groups this project belongs to. */
  includeGroups: boolean;
  setIncludeGroups: (v: boolean) => void;
  /** Refreshes the projects list from the API. */
  refreshProjects: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "contexthub-project-id";
const INCLUDE_GROUPS_KEY = "contexthub-include-groups";
const DEFAULT_PROJECT = process.env.NEXT_PUBLIC_CONTEXTHUB_DEFAULT_PROJECT ?? "default";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectIdState] = useState(DEFAULT_PROJECT);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [includeGroups, setIncludeGroupsState] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setProjectIdState(stored);
    const storedGroups = localStorage.getItem(INCLUDE_GROUPS_KEY);
    if (storedGroups === "true") setIncludeGroupsState(true);
  }, []);

  const setProjectId = useCallback((id: string) => {
    setProjectIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
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

  return (
    <ProjectContext.Provider
      value={{ projectId, setProjectId, projects, includeGroups, setIncludeGroups, refreshProjects }}
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
