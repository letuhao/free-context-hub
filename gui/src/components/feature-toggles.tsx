"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { GitBranch, Sparkles, ClipboardCheck, Activity } from "lucide-react";

/**
 * S6 polish: the feature-toggle logic previously lived inlined inside
 * `gui/src/app/projects/settings/page.tsx`. Extracted here as a reusable,
 * self-contained component so any page that surfaces a project can show the
 * same per-project feature switches.
 *
 * Behaviour is identical to the original inline block: each toggle reads the
 * current `settings.features[key]` flag and PATCHes the project settings,
 * preserving every other settings key, then asks the caller to refresh.
 */

export interface ProjectLike {
  settings?: Record<string, unknown> | null;
}

interface FeatureToggleDef {
  key: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  colorClass: string;
  hint: string;
}

/** Frozen feature catalogue — mirrors the original project-settings block. */
export const PROJECT_FEATURES: readonly FeatureToggleDef[] = [
  {
    key: "git_ingest",
    label: "Git Intelligence",
    desc: "Auto-ingest commits and suggest lessons",
    icon: <GitBranch size={16} strokeWidth={1.5} />,
    colorClass: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    hint: "",
  },
  {
    key: "knowledge_graph",
    label: "Knowledge Graph",
    desc: "Neo4j symbol extraction and dependency tracing",
    icon: <Activity size={16} strokeWidth={1.5} />,
    colorClass: "bg-zinc-800 border-zinc-700 text-zinc-500",
    hint: "Requires NEO4J_URI to be configured",
  },
  {
    key: "distillation",
    label: "AI Distillation",
    desc: "LLM-powered reflection, compression, and project summaries",
    icon: <Sparkles size={16} strokeWidth={1.5} />,
    colorClass: "bg-purple-500/10 border-purple-500/20 text-purple-400",
    hint: "",
  },
  {
    key: "auto_review",
    label: "Auto Review",
    desc: "Route AI-generated lessons to review inbox based on agent trust level",
    icon: <ClipboardCheck size={16} strokeWidth={1.5} />,
    colorClass: "bg-blue-500/10 border-blue-500/20 text-blue-400",
    hint: "",
  },
];

interface FeatureTogglesProps {
  projectId: string;
  /** The current project record (or whatever carries `settings.features`). */
  project: ProjectLike | undefined;
  /** Called after a successful toggle so the parent can refetch projects. */
  onChange?: () => void;
  /** Render the surrounding card chrome (header + description). Default true. */
  withChrome?: boolean;
}

export function FeatureToggles({ projectId, project, onChange, withChrome = true }: FeatureTogglesProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const features: Record<string, boolean> = (project?.settings as Record<string, unknown> | undefined)
    ?.features as Record<string, boolean> ?? {};

  const toggle = async (def: FeatureToggleDef, enabled: boolean) => {
    setSaving(true);
    const currentSettings = (project?.settings ?? {}) as Record<string, unknown>;
    const currentFeatures = (currentSettings.features ?? {}) as Record<string, boolean>;
    const newSettings = {
      ...currentSettings,
      features: { ...currentFeatures, [def.key]: !enabled },
    };
    try {
      await api.updateProject(projectId, { settings: newSettings });
      onChange?.();
      toast("success", `${def.label} ${!enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      toast("error", `Failed to update: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const list = (
    <div className="space-y-1">
      {PROJECT_FEATURES.map((f) => {
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
              disabled={saving}
              onClick={() => toggle(f, enabled)}
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
  );

  if (!withChrome) return list;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-zinc-200">Features</h2>
        <span className="text-[10px] text-zinc-600">Saved to project settings</span>
      </div>
      <p className="text-xs text-zinc-500 mb-5">Enable or disable features for this project. Changes take effect immediately.</p>
      {list}
    </div>
  );
}
