"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface ProjectContextValue {
  projectId: string;
  setProjectId: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "contexthub-project-id";
const DEFAULT_PROJECT = process.env.NEXT_PUBLIC_CONTEXTHUB_DEFAULT_PROJECT ?? "default";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectIdState] = useState(DEFAULT_PROJECT);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setProjectIdState(stored);
  }, []);

  const setProjectId = useCallback((id: string) => {
    setProjectIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return (
    <ProjectContext.Provider value={{ projectId, setProjectId }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
