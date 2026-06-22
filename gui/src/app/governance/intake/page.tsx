"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api, type IntakeItem } from "@/lib/api";
import { Breadcrumb, PageHeader, Button, EmptyState } from "@/components/ui";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { NoProjectGuard } from "@/components/no-project-guard";
import { ProjectBadge } from "@/components/project-badge";
import { Plus, Inbox } from "lucide-react";

const KINDS = ["suggestion", "request", "violation_report"] as const;
const STATUS_STYLES: Record<string, string> = {
  received: "bg-blue-500/10 text-blue-400",
  triaged: "bg-emerald-500/10 text-emerald-400",
  dismissed: "bg-zinc-500/15 text-zinc-500",
};

function IntakeInner() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [items, setItems] = useState<IntakeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  // Submit
  const [kind, setKind] = useState<string>("suggestion");
  const [body, setBody] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Triage
  const [triageItem, setTriageItem] = useState<IntakeItem | null>(null);
  const [routeKind, setRouteKind] = useState("task");
  const [tActor, setTActor] = useState("");
  const [tTopic, setTTopic] = useState("");
  const [tRoutedTo, setTRoutedTo] = useState("");
  const [tSubject, setTSubject] = useState("");
  const [tParties, setTParties] = useState("");
  const [tProcedure, setTProcedure] = useState("unilateral");

  const fetchItems = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.listIntake(projectId, statusFilter ? { status: statusFilter } : {});
      setItems(res.data?.items ?? []);
    } catch {
      toastRef.current("error", "Failed to load intake");
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const submit = async () => {
    if (!projectId || !body.trim() || !submittedBy.trim()) return;
    setSubmitting(true);
    try {
      await api.submitIntake({ project_id: projectId, kind, body: body.trim(), submitted_by: submittedBy.trim() });
      toastRef.current("success", "Intake submitted");
      setBody("");
      fetchItems();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const dismiss = async (it: IntakeItem) => {
    try {
      await api.dismissIntake(it.intake_id);
      toastRef.current("success", "Dismissed");
      fetchItems();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Dismiss failed");
    }
  };

  const submitTriage = async () => {
    if (!triageItem || !tActor.trim() || !tTopic.trim()) return;
    const route: Record<string, unknown> =
      routeKind === "dispute"
        ? {
            route_kind: "dispute", actor_id: tActor.trim(), topic_id: tTopic.trim(),
            subject_ref: tSubject.trim(),
            parties: tParties.split(",").map((p) => p.trim()).filter(Boolean),
            procedure: tProcedure, submitted_by: tActor.trim(),
          }
        : { route_kind: routeKind, actor_id: tActor.trim(), topic_id: tTopic.trim(), routed_to: tRoutedTo.trim() };
    try {
      const res = await api.triageIntake(triageItem.intake_id, route);
      toastRef.current("success", `Triaged → ${routeKind} (${res.data.status})`);
      setTriageItem(null); setTRoutedTo(""); setTSubject(""); setTParties("");
      fetchItems();
    } catch (e) {
      toastRef.current("error", e instanceof Error ? e.message : "Triage failed");
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <PageHeader
        title="Governance — Intake"
        subtitle="A project mailbox for reports, suggestions, and requests — triage each to a task, request, motion, or dispute."
        breadcrumb={<Breadcrumb items={[{ label: "Governance" }, { label: "Intake" }]} />}
        projectBadge={<ProjectBadge />}
      />

      {/* Submit */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 mb-5">
        <div className="flex flex-wrap items-start gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-2 text-sm text-zinc-200 outline-none">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="What's the report / suggestion / request?"
            className="flex-1 min-w-[16rem] rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600 resize-none" />
          <input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} placeholder="your actor id"
            className="w-32 rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600" />
          <Button onClick={submit} disabled={submitting || !body.trim() || !submittedBy.trim()}>
            <Plus size={16} /> {submitting ? "…" : "Submit"}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-zinc-600">Filter:</span>
        {["", "received", "triaged", "dismissed"].map((s) => (
          <button key={s || "all"} onClick={() => setStatusFilter(s)}
            className={`text-xs px-2 py-0.5 rounded ${statusFilter === s ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
            {s || "all"}
          </button>
        ))}
      </div>

      {loading ? (
        <TableSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon="📥" title="Inbox empty" description="Submitted intake items appear here for triage." />
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.intake_id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] rounded bg-zinc-800 text-zinc-300 px-1.5 py-0.5">{it.kind}</span>
                    <span className={`text-[10px] rounded-full px-2 py-0.5 ${STATUS_STYLES[it.status] ?? "bg-zinc-700 text-zinc-300"}`}>{it.status}</span>
                  </div>
                  <p className="text-sm text-zinc-200 mt-1">{it.body}</p>
                  <div className="text-[11px] text-zinc-600 mt-0.5">by {it.submitted_by} · {new Date(it.created_at).toLocaleString()}</div>
                </div>
                {it.status === "received" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="outline" onClick={() => { setTriageItem(it); setTTopic(it.topic_id ?? ""); }}>Triage</Button>
                    <Button variant="ghost" onClick={() => dismiss(it)}>Dismiss</Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Triage dialog */}
      {triageItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setTriageItem(null)}>
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-zinc-100 mb-1">Triage intake</h2>
            <p className="text-xs text-zinc-600 mb-4 line-clamp-2">{triageItem.body}</p>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-zinc-500">Route to</span>
                <select value={routeKind} onChange={(e) => setRouteKind(e.target.value)}
                  className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none">
                  <option value="task">task</option>
                  <option value="request">request</option>
                  <option value="motion">motion</option>
                  <option value="dispute">dispute</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-zinc-500">Actor id</span>
                  <input value={tActor} onChange={(e) => setTActor(e.target.value)} placeholder="you"
                    className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none" />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">Topic id</span>
                  <input value={tTopic} onChange={(e) => setTTopic(e.target.value)} placeholder="topic"
                    className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none" />
                </label>
              </div>
              {routeKind === "dispute" ? (
                <>
                  <label className="block">
                    <span className="text-xs text-zinc-500">Subject ref</span>
                    <input value={tSubject} onChange={(e) => setTSubject(e.target.value)} placeholder="artifact / subject"
                      className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-xs text-zinc-500">Parties (comma-separated)</span>
                    <input value={tParties} onChange={(e) => setTParties(e.target.value)} placeholder="alice, bob"
                      className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-xs text-zinc-500">Procedure</span>
                    <select value={tProcedure} onChange={(e) => setTProcedure(e.target.value)}
                      className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none">
                      <option value="unilateral">unilateral</option>
                      <option value="collective">collective</option>
                    </select>
                  </label>
                </>
              ) : (
                <label className="block">
                  <span className="text-xs text-zinc-500">Routed to (target id)</span>
                  <input value={tRoutedTo} onChange={(e) => setTRoutedTo(e.target.value)} placeholder="task / request / motion id"
                    className="mt-1 w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none" />
                </label>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setTriageItem(null)}>Cancel</Button>
              <Button onClick={submitTriage} disabled={!tActor.trim() || !tTopic.trim()}>Triage</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IntakePage() {
  return (
    <NoProjectGuard>
      <IntakeInner />
    </NoProjectGuard>
  );
}
