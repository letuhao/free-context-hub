"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api, type LeaseSummary } from "@/lib/api";
import { Breadcrumb, PageHeader, Button, EmptyState } from "@/components/ui";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { NoProjectGuard } from "@/components/no-project-guard";
import { ProjectBadge } from "@/components/project-badge";
import { useActorNames } from "@/lib/useActorNames";
import { RefreshCw } from "lucide-react";

function fmtRemaining(sec: number): string {
  if (sec <= 0) return "expired";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function LeasesInner() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const nameOf = useActorNames();
  const [leases, setLeases] = useState<LeaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState<string | null>(null);

  const fetchLeases = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.listActiveLeases(projectId);
      setLeases(res.claims ?? []);
    } catch {
      toastRef.current("error", "Failed to load leases");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchLeases();
    const t = setInterval(fetchLeases, 5000);
    return () => clearInterval(t);
  }, [fetchLeases]);

  const forceRelease = async (leaseId: string) => {
    if (!projectId) return;
    setReleasing(leaseId);
    try {
      const res = await api.forceReleaseLease(projectId, leaseId);
      toastRef.current(res.status === "force_released" ? "success" : "error", `Lease: ${res.status}`);
      fetchLeases();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Force-release failed");
    } finally {
      setReleasing(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <PageHeader
        title="Coordination — Artifact Leases"
        subtitle="Active exclusive leases that prevent two agents doing the same work."
        breadcrumb={<Breadcrumb items={[{ label: "Coordination", href: "/coordination" }, { label: "Leases" }]} />}
        projectBadge={<ProjectBadge />}
        actions={<Button variant="ghost" onClick={fetchLeases}><RefreshCw size={16} /> Refresh</Button>}
      />

      {loading ? (
        <TableSkeleton />
      ) : leases.length === 0 ? (
        <EmptyState icon="🔓" title="No active leases" description="When an agent claims an artifact, its lease appears here until it expires or is released." />
      ) : (
        <div className="space-y-2">
          {leases.map((l) => (
            <div key={l.lease_id} className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-zinc-100 font-mono truncate">{l.artifact_id}</div>
                <div className="text-[11px] text-zinc-600 truncate">
                  {l.artifact_type} · held by {nameOf(l.agent_id)}{l.task_description ? ` · ${l.task_description}` : ""}
                </div>
              </div>
              <span className={`text-[11px] shrink-0 ${l.seconds_remaining <= 0 ? "text-red-400" : "text-zinc-400"}`}>
                {fmtRemaining(l.seconds_remaining)}
              </span>
              <Button variant="ghost" onClick={() => forceRelease(l.lease_id)} disabled={releasing === l.lease_id}>
                {releasing === l.lease_id ? "Releasing…" : "Force release"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LeasesPage() {
  return (
    <NoProjectGuard>
      <LeasesInner />
    </NoProjectGuard>
  );
}
