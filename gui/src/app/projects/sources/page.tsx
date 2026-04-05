"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Breadcrumb, PageHeader, Button, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type SourceConfig = {
  source_type: string;
  git_url?: string;
  default_ref?: string;
};

type WorkspaceRoot = {
  root_id: string;
  project_id: string;
  path: string;
  registered_at: string;
};

export default function SourcesPage() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [initialLoad, setInitialLoad] = useState(true);
  const [source, setSource] = useState<SourceConfig | null>(null);
  const [roots, setRoots] = useState<WorkspaceRoot[]>([]);

  // Configure Source form
  const [sourceType, setSourceType] = useState<"local_workspace" | "remote_git">("local_workspace");
  const [gitUrl, setGitUrl] = useState("");
  const [defaultRef, setDefaultRef] = useState("main");
  const [configuringSource, setConfiguringSource] = useState(false);

  // Register Root form
  const [rootPath, setRootPath] = useState("");
  const [registeringRoot, setRegisteringRoot] = useState(false);

  // Action buttons
  const [scanning, setScanning] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [sourceResult, rootsResult] = await Promise.all([
        api.getProjectSource({ project_id: projectId }).catch(() => null),
        api.listWorkspaceRoots({ project_id: projectId }).catch(() => ({ items: [] })),
      ]);
      setSource(sourceResult);
      setRoots(rootsResult?.items ?? rootsResult?.roots ?? []);
    } catch {
      toastRef.current("error", "Failed to load source config");
    } finally {
      setInitialLoad(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleConfigureSource = async () => {
    setConfiguringSource(true);
    try {
      const body: Record<string, unknown> = {
        project_id: projectId,
        source_type: sourceType,
        default_ref: defaultRef || "main",
      };
      if (sourceType === "remote_git" && gitUrl.trim()) {
        body.git_url = gitUrl.trim();
      }
      await api.configureSource(body);
      toastRef.current("success", "Source configured");
      fetchData();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Configure failed");
    } finally {
      setConfiguringSource(false);
    }
  };

  const handleRegisterRoot = async () => {
    if (!rootPath.trim()) return;
    setRegisteringRoot(true);
    try {
      await api.registerWorkspaceRoot({
        project_id: projectId,
        path: rootPath.trim(),
      });
      toastRef.current("success", "Workspace root registered");
      setRootPath("");
      fetchData();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Register failed");
    } finally {
      setRegisteringRoot(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      await api.scanWorkspace({ project_id: projectId });
      toastRef.current("success", "Workspace scan started");
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handlePrepareRepo = async () => {
    const url = source?.git_url || gitUrl.trim();
    if (!url) {
      toastRef.current("error", "No git URL configured");
      return;
    }
    setPreparing(true);
    try {
      await api.prepareRepo({ project_id: projectId, git_url: url });
      toastRef.current("success", "Remote repo prepared");
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Prepare failed");
    } finally {
      setPreparing(false);
    }
  };

  const isRemote = source?.source_type === "remote_git" || sourceType === "remote_git";

  if (initialLoad) {
    return (
      <div className="p-6">
        <Breadcrumb items={[{ label: "Project", href: "/projects" }, { label: "Sources" }]} />
        <PageHeader title="Sources" subtitle="Configure project sources and workspace roots" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-zinc-900 border border-zinc-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <Breadcrumb items={[{ label: "Project", href: "/projects" }, { label: "Sources" }]} />
      <PageHeader
        title="Sources"
        subtitle="Configure project sources and workspace roots"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleScan} disabled={scanning}>
              {scanning ? "Scanning..." : "Scan for Changes"}
            </Button>
            {isRemote && (
              <Button variant="primary" onClick={handlePrepareRepo} disabled={preparing}>
                {preparing ? "Preparing..." : "Prepare Remote Repo"}
              </Button>
            )}
          </div>
        }
      />

      {/* Current Source Config */}
      <div className="border border-zinc-800 rounded-lg bg-zinc-900 p-4 mb-5">
        <div className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider">Current Source</div>
        {source ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-zinc-600">Type:</span>{" "}
              <span className="text-zinc-200 font-mono">{source.source_type}</span>
            </div>
            {source.git_url && (
              <div>
                <span className="text-zinc-600">Git URL:</span>{" "}
                <span className="text-zinc-200 font-mono text-xs">{source.git_url}</span>
              </div>
            )}
            {source.default_ref && (
              <div>
                <span className="text-zinc-600">Default Ref:</span>{" "}
                <span className="text-zinc-200 font-mono">{source.default_ref}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-zinc-500">No source configured yet</div>
        )}
      </div>

      {/* Configure Source Form */}
      <div className="border border-zinc-800 rounded-lg bg-zinc-900 p-4 mb-5">
        <div className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider">Configure Source</div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Source Type</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as "local_workspace" | "remote_git")}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none focus:border-zinc-600"
            >
              <option value="local_workspace">local_workspace</option>
              <option value="remote_git">remote_git</option>
            </select>
          </div>

          {sourceType === "remote_git" && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Git URL</label>
              <input
                type="text"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/org/repo.git"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Default Ref</label>
            <input
              type="text"
              value={defaultRef}
              onChange={(e) => setDefaultRef(e.target.value)}
              placeholder="main"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none focus:border-zinc-600"
            />
          </div>

          <div className="pt-1">
            <Button variant="primary" onClick={handleConfigureSource} disabled={configuringSource}>
              {configuringSource ? "Saving..." : "Save Source Config"}
            </Button>
          </div>
        </div>
      </div>

      {/* Workspace Roots */}
      <div className="border border-zinc-800 rounded-lg bg-zinc-900 p-4 mb-5">
        <div className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider">
          Workspace Roots
          {roots.length > 0 && <span className="ml-1.5 text-zinc-600">({roots.length})</span>}
        </div>

        {roots.length === 0 ? (
          <div className="text-sm text-zinc-500 mb-4">No workspace roots registered</div>
        ) : (
          <div className="space-y-1.5 mb-4">
            {roots.map((root) => (
              <div
                key={root.root_id ?? root.path}
                className="flex items-center justify-between px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md"
              >
                <span className="text-sm text-zinc-200 font-mono">{root.path}</span>
                {root.registered_at && (
                  <span className="text-[11px] text-zinc-600">
                    {new Date(root.registered_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Register Root Form */}
        <div className="flex gap-2">
          <input
            type="text"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRegisterRoot()}
            placeholder="/path/to/workspace"
            className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none focus:border-zinc-600"
          />
          <Button variant="primary" onClick={handleRegisterRoot} disabled={registeringRoot || !rootPath.trim()}>
            {registeringRoot ? "Registering..." : "Register Root"}
          </Button>
        </div>
      </div>
    </div>
  );
}
