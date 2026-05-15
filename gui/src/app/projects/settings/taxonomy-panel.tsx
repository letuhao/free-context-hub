"use client";

/**
 * Phase 13 Sprint 13.6 — Taxonomy panel on Project Settings.
 *
 * Lists available profiles (built-ins + this project's custom), shows the
 * active one, activate/deactivate flows. Deactivation requires confirmation
 * because lessons keep their custom type strings as raw text.
 */

import { useState, useEffect, useCallback } from "react";
import { api, type TaxonomyProfile } from "@/lib/api";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tag, Check } from "lucide-react";

interface TaxonomyPanelProps {
  projectId: string;
}

export function TaxonomyPanel({ projectId }: TaxonomyPanelProps) {
  const { toast } = useToast();
  const [active, setActive] = useState<TaxonomyProfile | null>(null);
  const [available, setAvailable] = useState<TaxonomyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [acting, setActing] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [activeRes, builtins, custom] = await Promise.all([
        api.getActiveTaxonomyProfile(projectId),
        api.listTaxonomyProfiles({ owner_project_id: null, is_builtin: true }),
        api.listTaxonomyProfiles({ owner_project_id: projectId, is_builtin: false }),
      ]);
      setActive(activeRes.profile);
      const merged = [...builtins.profiles, ...custom.profiles];
      setAvailable(merged.filter((p) => p.profile_id !== activeRes.profile?.profile_id));
      if (merged.length > 0 && !activeRes.profile) {
        setSelectedSlug(merged[0].slug);
      } else {
        setSelectedSlug("");
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load taxonomy profiles");
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleActivate = async () => {
    if (!selectedSlug) return;
    setActing(true);
    try {
      const r = await api.activateTaxonomyProfile(projectId, { slug: selectedSlug, activated_by: "gui-user" });
      if (r.status === "activated") {
        toast("success", `Activated profile: ${r.profile?.name ?? selectedSlug}`);
        await fetchAll();
      } else {
        toast("error", `Profile not found: ${selectedSlug}`);
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Activate failed");
    } finally {
      setActing(false);
    }
  };

  const handleDeactivate = async () => {
    setActing(true);
    try {
      const r = await api.deactivateTaxonomyProfile(projectId);
      if (r.status === "deactivated") {
        toast("success", "Taxonomy profile deactivated");
      } else {
        toast("error", "No active profile to deactivate");
      }
      await fetchAll();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Deactivate failed");
    } finally {
      setActing(false);
      setConfirmDeactivate(false);
    }
  };

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-6">
      <h2 className="text-sm font-semibold text-zinc-100 mb-1 flex items-center gap-2">
        <Tag size={16} className="text-blue-400" />
        Taxonomy
      </h2>
      <p className="text-xs text-zinc-500 mb-4">
        Activate a taxonomy profile to extend the project&apos;s lesson-type vocabulary. When active,
        agents can add lessons with profile types (e.g., <code className="text-zinc-400">candidate-decision</code>)
        in addition to the built-in types.
      </p>

      {loading ? (
        <div className="text-xs text-zinc-600 py-4">Loading profiles&hellip;</div>
      ) : (
        <>
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Active profile</div>
            {active ? (
              <div className="bg-zinc-950/50 border border-zinc-800 rounded-md p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                        <Check size={10} /> active
                      </span>
                      <span className="text-xs font-semibold text-zinc-100">{active.name}</span>
                      <span className="text-[10px] text-zinc-600">v{active.version}</span>
                      {active.is_builtin && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">built-in</span>
                      )}
                    </div>
                    <code className="text-[10px] text-zinc-500">{active.slug}</code>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeactivate(true)}
                    disabled={acting}
                  >
                    Deactivate
                  </Button>
                </div>
                {active.description && (
                  <p className="text-xs text-zinc-400 mt-2 mb-3">{active.description}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {active.lesson_types.map((lt) => (
                    <span
                      key={lt.type}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border"
                      style={{
                        backgroundColor: lt.color ? `${lt.color}15` : "rgba(63,63,70,0.4)",
                        borderColor: lt.color ? `${lt.color}40` : "rgb(63,63,70)",
                        color: lt.color ?? "rgb(212,212,216)",
                      }}
                      title={lt.description}
                    >
                      {lt.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-zinc-500 italic py-2">
                No taxonomy profile active. Lessons use only the 5 built-in types
                (<code className="text-zinc-400">decision</code>, <code className="text-zinc-400">preference</code>,
                {" "}<code className="text-zinc-400">guardrail</code>, <code className="text-zinc-400">workaround</code>,
                {" "}<code className="text-zinc-400">general_note</code>).
              </div>
            )}
          </div>

          {available.length > 0 && (
            <div className="border-t border-zinc-800 pt-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">
                {active ? "Switch to another profile" : "Available profiles"}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-200 outline-none focus:border-blue-500/40"
                >
                  {available.map((p) => (
                    <option key={p.profile_id} value={p.slug}>
                      {p.name}
                      {p.is_builtin ? " (built-in)" : " (custom)"} &mdash; {p.slug}
                    </option>
                  ))}
                </select>
                <Button variant="primary" size="sm" onClick={handleActivate} disabled={acting || !selectedSlug}>
                  Activate
                </Button>
              </div>
              <p className="text-[10px] text-zinc-600 mt-2">
                Activating a profile is non-destructive. Existing lessons keep their current
                lesson_type strings; only new lessons benefit from the extended vocabulary.
              </p>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={handleDeactivate}
        title="Deactivate taxonomy profile?"
        description={
          `Deactivating '${active?.name ?? ""}' will not change existing lesson data. ` +
          `Lessons with profile-specific types (e.g., 'candidate-decision') will continue to exist, ` +
          `but the GUI will display their raw type string until you re-activate a profile. ` +
          `New lessons will only accept the 5 built-in types.`
        }
        confirmText="Deactivate"
        destructive
      />
    </div>
  );
}
