"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Breadcrumb, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PROJECT_COLORS, getColorClasses, getInitials, type ProjectColorKey } from "@/lib/project-colors";
import { cn } from "@/lib/cn";
import { NoProjectGuard } from "@/components/no-project-guard";
import { Copy, Users, AlertTriangle, GitBranch, Sparkles, ClipboardCheck, Activity } from "lucide-react";
import { ExchangePanel } from "./exchange-panel";

export default function ProjectSettingsPage() {
  const { projectId, projects, refreshProjects } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const current = projects.find((p) => p.project_id === projectId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<ProjectColorKey>("blue");
  const [saving, setSaving] = useState(false);
  const [savingFeature, setSavingFeature] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Groups for this project
  const [groups, setGroups] = useState<Array<{ group_id: string; name: string; member_count?: number }>>([]);

  // Load current values when project changes (not on every projects array update)
  const currentName = current?.name ?? "";
  const currentDescription = current?.description ?? "";
  const currentColor = (current?.color as ProjectColorKey) ?? "blue";
  useEffect(() => {
    setName(currentName);
    setDescription(currentDescription);
    setColor(currentColor);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchGroups = useCallback(() => {
    api.listGroupsForProject(projectId)
      .then((res) => setGroups(res.groups ?? []))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateProject(projectId, {
        name: name || undefined,
        description: description || undefined,
        color,
      });
      refreshProjects();
      toastRef.current("success", "Settings saved");
    } catch (err) {
      toastRef.current("error", `Save failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteWorkspace(projectId);
      refreshProjects();
      toastRef.current("success", "Project deleted");
    } catch (err) {
      toastRef.current("error", `Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleLeaveGroup = async (groupId: string) => {
    try {
      await api.removeProjectFromGroup(groupId, projectId);
      fetchGroups();
      refreshProjects();
      toastRef.current("success", "Left group");
    } catch (err) {
      toastRef.current("error", `Failed to leave group: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const headerColor = getColorClasses(color);
  const initials = getInitials(name || projectId);

  return (
    <NoProjectGuard requireSingleProject pageName="Project Settings">
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Project", href: "/projects" }, { label: "Settings" }]} />

      <div className="flex items-center gap-3 mb-6">
        <div className={cn("w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-sm font-bold text-white", headerColor.from, headerColor.to)}>
          {initials}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Project Settings</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{projectId}</p>
        </div>
      </div>

      {/* General Section */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
        <h2 className="text-sm font-semibold text-zinc-200 mb-4">General</h2>
        <div className="space-y-5">
          {/* Project ID (read-only) */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Project ID</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={projectId}
                disabled
                className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-500 font-mono cursor-not-allowed"
              />
              <button
                onClick={() => { navigator.clipboard.writeText(projectId); toastRef.current("success", "Copied"); }}
                className="p-2 text-zinc-600 hover:text-zinc-400 transition-colors"
                title="Copy"
              >
                <Copy size={14} />
              </button>
            </div>
            <p className="text-[10px] text-zinc-600 mt-1">Cannot be changed after creation.</p>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none focus:border-zinc-600 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 outline-none resize-none focus:border-zinc-600 transition-colors"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Project Color</label>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setColor(c.key)}
                  className={cn(
                    "w-7 h-7 rounded-md bg-gradient-to-br transition-all",
                    c.from, c.to,
                    color === c.key
                      ? `ring-2 ${c.ring} ring-offset-2 ring-offset-zinc-900`
                      : "",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>

      {/* Groups Section */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-200">Groups</h2>
        </div>
        <p className="text-xs text-zinc-500 mb-3">Projects in the same group can share lessons when &quot;Include group knowledge&quot; is enabled.</p>
        {groups.length > 0 ? (
          <div className="space-y-2">
            {groups.map((g) => (
              <div key={g.group_id} className="flex items-center justify-between px-3 py-2.5 bg-zinc-800/40 border border-zinc-800 rounded-lg">
                <div className="flex items-center gap-2.5">
                  <Users size={16} className="text-zinc-500" strokeWidth={1.5} />
                  <div>
                    <div className="text-xs text-zinc-300 font-medium">{g.name}</div>
                    {g.member_count !== undefined && (
                      <div className="text-[10px] text-zinc-600">{g.member_count} projects</div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleLeaveGroup(g.group_id)}
                  className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                >
                  Leave
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">Not a member of any groups.</p>
        )}
      </div>

      {/* Features Section */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-zinc-200">Features</h2>
          <span className="text-[10px] text-zinc-600">Saved to project settings</span>
        </div>
        <p className="text-xs text-zinc-500 mb-5">Enable or disable features for this project. Changes take effect immediately.</p>
        <div className="space-y-1">
          {([
            { key: "git_ingest", label: "Git Intelligence", desc: "Auto-ingest commits and suggest lessons", icon: <GitBranch size={16} strokeWidth={1.5} />, colorClass: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400", hint: "" },
            { key: "knowledge_graph", label: "Knowledge Graph", desc: "Neo4j symbol extraction and dependency tracing", icon: <Activity size={16} strokeWidth={1.5} />, colorClass: "bg-zinc-800 border-zinc-700 text-zinc-500", hint: "Requires NEO4J_URI to be configured" },
            { key: "distillation", label: "AI Distillation", desc: "LLM-powered reflection, compression, and project summaries", icon: <Sparkles size={16} strokeWidth={1.5} />, colorClass: "bg-purple-500/10 border-purple-500/20 text-purple-400", hint: "" },
            { key: "auto_review", label: "Auto Review", desc: "Route AI-generated lessons to review inbox based on agent trust level", icon: <ClipboardCheck size={16} strokeWidth={1.5} />, colorClass: "bg-blue-500/10 border-blue-500/20 text-blue-400", hint: "" },
          ] as const).map((f) => {
            const features: Record<string, boolean> = (current?.settings as any)?.features ?? {};
            const enabled = !!features[f.key];
            return (
              <div key={f.key} className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={cn("w-8 h-8 rounded-lg border flex items-center justify-center shrink-0", enabled ? f.colorClass : "bg-zinc-800 border-zinc-700 text-zinc-500")}>
                    {f.icon}
                  </div>
                  <div>
                    <div className={cn("text-xs font-medium", enabled ? "text-zinc-200" : "text-zinc-400")}>{f.label}</div>
                    <div className="text-[10px] text-zinc-600">{f.desc}</div>
                    {f.hint && !enabled && (
                      <div className="text-[10px] text-amber-500 mt-0.5">{f.hint}</div>
                    )}
                  </div>
                </div>
                <button
                  disabled={savingFeature}
                  onClick={async () => {
                    setSavingFeature(true);
                    const currentSettings = (current?.settings ?? {}) as Record<string, unknown>;
                    const currentFeatures = (currentSettings.features ?? {}) as Record<string, boolean>;
                    const newSettings = {
                      ...currentSettings,
                      features: { ...currentFeatures, [f.key]: !enabled },
                    };
                    try {
                      await api.updateProject(projectId, { settings: newSettings });
                      refreshProjects();
                      toastRef.current("success", `${f.label} ${!enabled ? "enabled" : "disabled"}`);
                    } catch (err) {
                      toastRef.current("error", `Failed to update: ${err instanceof Error ? err.message : "Unknown error"}`);
                    } finally {
                      setSavingFeature(false);
                    }
                  }}
                  className={cn(
                    "w-9 h-5 rounded-full relative transition-colors shrink-0",
                    enabled ? "bg-blue-600" : "bg-zinc-700",
                  )}
                  aria-label={`${enabled ? "Disable" : "Enable"} ${f.label}`}
                >
                  <span className={cn(
                    "absolute top-[3px] w-[14px] h-[14px] rounded-full transition-all shadow-sm",
                    enabled ? "left-[19px] bg-white" : "left-[3px] bg-zinc-400",
                  )} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Phase 11.4: Knowledge Exchange (export + import) */}
      <ExchangePanel projectId={projectId} />

      {/* Danger Zone */}
      <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-6">
        <h2 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2">
          <AlertTriangle size={16} />
          Danger Zone
        </h2>
        <p className="text-xs text-zinc-500 mb-4">These actions are irreversible. Proceed with caution.</p>
        <div className="flex items-center justify-between py-3 px-4 bg-zinc-900/60 border border-zinc-800 rounded-lg">
          <div>
            <div className="text-xs text-zinc-300 font-medium">Delete Project</div>
            <div className="text-[10px] text-zinc-600">Permanently delete this project and all its data.</div>
          </div>
          <Button variant="danger" size="sm" onClick={() => setDeleteDialogOpen(true)} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete Project"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Delete Project"
        description={`This will permanently delete all data for project "${projectId}". This action cannot be undone.`}
        confirmText="Delete"
        confirmValue={projectId}
        destructive
      />
    </div>
    </NoProjectGuard>
  );
}
