"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api, type BodyRecord, type ProxyGrant } from "@/lib/api";
import { Breadcrumb, PageHeader, Button, EmptyState } from "@/components/ui";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { NoProjectGuard } from "@/components/no-project-guard";
import { ProjectBadge } from "@/components/project-badge";
import { Plus, ChevronDown, ChevronRight, UserPlus, X } from "lucide-react";

function BodyDetail({ bodyId, onChanged }: { bodyId: string; onChanged: () => void }) {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [body, setBody] = useState<BodyRecord | null>(null);
  const [proxies, setProxies] = useState<ProxyGrant[]>([]);
  const [memberId, setMemberId] = useState("");
  const [weight, setWeight] = useState("1");
  const [pPrincipal, setPPrincipal] = useState("");
  const [pProxy, setPProxy] = useState("");

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([api.getBody(bodyId), api.listProxies(bodyId).catch(() => ({ data: { proxies: [] } }))]);
      setBody(b.data);
      setProxies(p.data?.proxies ?? []);
    } catch {
      toastRef.current("error", "Failed to load body");
    }
  }, [bodyId]);

  useEffect(() => { load(); }, [load]);

  const addMember = async () => {
    if (!memberId.trim()) return;
    try {
      await api.addBodyMember(bodyId, { actor_id: memberId.trim(), vote_weight: Number(weight) || 1 });
      toastRef.current("success", "Member added");
      setMemberId(""); setWeight("1");
      load(); onChanged();
    } catch (e) { toastRef.current("error", e instanceof Error ? e.message : "Add member failed"); }
  };

  const grantProxy = async () => {
    if (!pPrincipal.trim() || !pProxy.trim()) return;
    try {
      await api.grantProxy(bodyId, { principal: pPrincipal.trim(), proxy: pProxy.trim(), granted_by: pPrincipal.trim() });
      toastRef.current("success", "Proxy granted");
      setPPrincipal(""); setPProxy("");
      load();
    } catch (e) { toastRef.current("error", e instanceof Error ? e.message : "Grant proxy failed"); }
  };

  const revoke = async (g: ProxyGrant) => {
    try {
      await api.revokeProxy(bodyId, { principal: g.principal, proxy: g.proxy });
      toastRef.current("success", "Proxy revoked");
      load();
    } catch (e) { toastRef.current("error", e instanceof Error ? e.message : "Revoke failed"); }
  };

  if (!body) return <div className="px-3 py-2 text-xs text-zinc-600">Loading…</div>;

  return (
    <div className="border-t border-zinc-800 px-3 py-3 space-y-4 bg-zinc-950/40">
      <div className="text-[11px] text-zinc-600">
        quorum {body.quorum} · threshold {body.threshold} · veto: {body.veto_holders.length ? body.veto_holders.join(", ") : "none"}
      </div>

      {/* Members */}
      <div>
        <div className="text-xs font-semibold text-zinc-300 mb-1.5">Members ({body.members.length})</div>
        <div className="space-y-1">
          {body.members.map((m) => (
            <div key={m.actor_id} className="flex items-center justify-between text-xs rounded bg-zinc-900/50 px-2 py-1">
              <span className="text-zinc-200">{m.actor_id}</span>
              <span className="text-zinc-500">weight {m.vote_weight}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <input value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="actor id"
            className="flex-1 rounded bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none" />
          <input value={weight} onChange={(e) => setWeight(e.target.value)} type="number" min="0" step="0.5" placeholder="weight"
            className="w-20 rounded bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none" />
          <Button variant="outline" onClick={addMember} disabled={!memberId.trim()}><UserPlus size={14} /> Add</Button>
        </div>
      </div>

      {/* Proxies */}
      <div>
        <div className="text-xs font-semibold text-zinc-300 mb-1.5">Proxy grants ({proxies.length})</div>
        <div className="space-y-1">
          {proxies.map((g, i) => (
            <div key={`${g.principal}-${g.proxy}-${i}`} className="flex items-center justify-between text-xs rounded bg-zinc-900/50 px-2 py-1">
              <span className="text-zinc-300">{g.principal} → {g.proxy}</span>
              <button onClick={() => revoke(g)} className="text-zinc-500 hover:text-red-400"><X size={12} /></button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <input value={pPrincipal} onChange={(e) => setPPrincipal(e.target.value)} placeholder="principal"
            className="flex-1 rounded bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none" />
          <span className="text-zinc-600 text-xs">→</span>
          <input value={pProxy} onChange={(e) => setPProxy(e.target.value)} placeholder="proxy"
            className="flex-1 rounded bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none" />
          <Button variant="outline" onClick={grantProxy} disabled={!pPrincipal.trim() || !pProxy.trim()}>Grant</Button>
        </div>
      </div>
    </div>
  );
}

function DecisionBodiesInner() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [bodies, setBodies] = useState<BodyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [quorum, setQuorum] = useState("1");
  const [threshold, setThreshold] = useState("0.5");
  const [createdBy, setCreatedBy] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchBodies = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.listBodies(projectId);
      setBodies(res.data?.bodies ?? []);
    } catch {
      toastRef.current("error", "Failed to load decision bodies");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchBodies(); }, [fetchBodies]);

  const submitCreate = async () => {
    if (!projectId || !name.trim() || !createdBy.trim()) return;
    setCreating(true);
    try {
      await api.createBody({ project_id: projectId, name: name.trim(), quorum: Number(quorum) || 1, threshold: Number(threshold) || 0.5, created_by: createdBy.trim() });
      toastRef.current("success", "Decision body created");
      setCreateOpen(false); setName(""); setCreatedBy("");
      fetchBodies();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <PageHeader
        title="Governance — Decision Bodies"
        subtitle="Weighted electorates that vote on motions (quorum + threshold + optional veto holders)."
        breadcrumb={<Breadcrumb items={[{ label: "Governance" }, { label: "Decision Bodies" }]} />}
        projectBadge={<ProjectBadge />}
        actions={<Button onClick={() => setCreateOpen(true)}><Plus size={16} /> New body</Button>}
      />

      {loading ? (
        <TableSkeleton />
      ) : bodies.length === 0 ? (
        <EmptyState icon="🗳️" title="No decision bodies" description="Create a body, add weighted members, then propose motions from a topic." />
      ) : (
        <div className="space-y-2">
          {bodies.map((b) => (
            <div key={b.body_id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
              <button onClick={() => setExpanded(expanded === b.body_id ? null : b.body_id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-900 transition-colors text-left">
                {expanded === b.body_id ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-zinc-100 truncate">{b.name}</div>
                  <div className="text-[11px] text-zinc-600">{b.members.length} members · quorum {b.quorum} · threshold {b.threshold}</div>
                </div>
              </button>
              {expanded === b.body_id && <BodyDetail bodyId={b.body_id} onChanged={fetchBodies} />}
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !creating && setCreateOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-zinc-100 mb-4">New decision body</h2>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-zinc-500">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Core maintainers"
                  className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-zinc-500">Quorum (min weight)</span>
                  <input value={quorum} onChange={(e) => setQuorum(e.target.value)} type="number" min="0" step="0.5"
                    className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">Threshold (0–1)</span>
                  <input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" min="0" max="1" step="0.05"
                    className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-zinc-500">Created by (your actor id)</span>
                <input value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} placeholder="e.g. alice"
                  className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
              <Button onClick={submitCreate} disabled={creating || !name.trim() || !createdBy.trim()}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DecisionBodiesPage() {
  return (
    <NoProjectGuard>
      <DecisionBodiesInner />
    </NoProjectGuard>
  );
}
