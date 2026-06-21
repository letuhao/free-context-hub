"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  governanceApi,
  type GrantRow,
  type PrincipalSummary,
  type Capability,
  type ScopeType,
} from "@/lib/governanceApi";
import { useProject } from "@/contexts/project-context";
import { Breadcrumb, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import { relTime } from "@/lib/rel-time";
import { Plus, X, ChevronRight, ChevronDown, Check } from "lucide-react";

const capBadge: Record<Capability, string> = {
  read: "bg-zinc-700 text-zinc-300",
  write: "bg-blue-500/10 text-blue-400",
  admin: "bg-rose-500/10 text-rose-300",
  delegate: "bg-amber-500/10 text-amber-300 border border-amber-500/20",
};

function scopeLabel(g: Pick<GrantRow, "scope_type" | "scope_id">): string {
  return g.scope_type === "global" ? "global" : `${g.scope_type}:${g.scope_id ?? ""}`;
}

function scopeBadgeClass(t: ScopeType): string {
  switch (t) {
    case "global":
      return "bg-amber-500/10 text-amber-300 border border-amber-500/20";
    case "project":
      return "bg-blue-500/10 text-blue-300";
    case "topic":
      return "bg-sky-500/10 text-sky-300";
    case "task":
      return "bg-teal-500/10 text-teal-300";
    default:
      return "bg-zinc-700 text-zinc-300";
  }
}

interface TreeNode {
  principalId: string;
  label: string;
  kind?: string;
  /** the grant edge that placed this node under its parent (null for the synthetic root). */
  edge: GrantRow | null;
  children: TreeNode[];
}

/** Build the delegation tree from grant edges keyed on granted_by → grantee. */
function buildTree(grants: GrantRow[], principals: PrincipalSummary[]): TreeNode {
  const nameOf = (id: string) =>
    principals.find((p) => p.principal_id === id)?.display_name ?? id;
  const kindOf = (id: string) => principals.find((p) => p.principal_id === id)?.kind;
  const root = principals.find((p) => p.is_root);
  const rootId = root?.principal_id ?? "__root__";

  const byGranter = new Map<string, GrantRow[]>();
  for (const g of grants) {
    if (g.revoked_at) continue;
    if (!byGranter.has(g.granted_by)) byGranter.set(g.granted_by, []);
    byGranter.get(g.granted_by)!.push(g);
  }

  const seen = new Set<string>();
  const make = (principalId: string, edge: GrantRow | null): TreeNode => {
    seen.add(principalId);
    const childEdges = byGranter.get(principalId) ?? [];
    const children: TreeNode[] = [];
    for (const e of childEdges) {
      if (seen.has(e.grantee_principal)) continue; // guard cycles
      children.push(make(e.grantee_principal, e));
    }
    return {
      principalId,
      label: nameOf(principalId),
      kind: kindOf(principalId),
      edge,
      children,
    };
  };

  return make(rootId, null);
}

function TreeRow({
  node,
  depth,
  onRevoke,
}: {
  node: TreeNode;
  depth: number;
  onRevoke: (g: GrantRow) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={cn("flex items-center gap-2 flex-wrap py-1", depth > 0 && "ml-3")}
        style={{ paddingLeft: depth > 0 ? 8 : 0 }}
      >
        {hasChildren ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-zinc-600 hover:text-zinc-300 shrink-0"
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}

        {node.edge === null ? (
          <>
            <span className="text-sm font-semibold text-amber-100">{node.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">
              axiomatic · origin of the tree
            </span>
            <span className="text-[10px] text-zinc-600">out-of-band · not grantable</span>
          </>
        ) : (
          <>
            <span className="text-[10px] text-zinc-600">└─ grants</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded", capBadge[node.edge.capability])}>
              {node.edge.capability}
            </span>
            <span className="text-xs text-zinc-500">@</span>
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded",
                scopeBadgeClass(node.edge.scope_type),
              )}
            >
              {scopeLabel(node.edge)}
            </span>
            <span className="text-xs text-zinc-500">to</span>
            <span className="text-sm font-medium text-zinc-200">{node.label}</span>
            {node.kind && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400">
                {node.kind}
              </span>
            )}
            <button
              onClick={() => onRevoke(node.edge!)}
              className="text-[10px] text-zinc-600 hover:text-red-400 ml-1"
            >
              revoke
            </button>
          </>
        )}
      </div>
      {open && hasChildren && (
        <div className="ml-3 border-l border-zinc-800 pl-2">
          {node.children.map((c) => (
            <TreeRow key={c.edge?.grant_id ?? c.principalId} node={c} depth={depth + 1} onRevoke={onRevoke} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DelegationPage() {
  const { projects } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [principals, setPrincipals] = useState<PrincipalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<"tree" | "flat">("tree");
  const [includeRevoked, setIncludeRevoked] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);

  // Grant modal
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantee, setGrantee] = useState("");
  const [capability, setCapability] = useState<Capability>("write");
  const [scopeType, setScopeType] = useState<ScopeType>("project");
  const [scopeId, setScopeId] = useState("");
  const [granting, setGranting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [gRes, pRes] = await Promise.all([
        governanceApi.listGrants({ include_revoked: true }),
        governanceApi.listPrincipals(),
      ]);
      setGrants(gRes.grants ?? []);
      setPrincipals(pRes.principals ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const activeGrants = useMemo(() => grants.filter((g) => !g.revoked_at), [grants]);
  const tree = useMemo(() => buildTree(activeGrants, principals), [activeGrants, principals]);
  const flatRows = includeRevoked ? grants : activeGrants;

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await governanceApi.revokeGrant(revokeTarget.grant_id);
      toastRef.current("success", "Grant revoked");
      setRevokeTarget(null);
      fetchData();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Revoke failed");
    }
  };

  const handleGrant = async () => {
    if (!grantee || (scopeType !== "global" && !scopeId.trim())) return;
    setGranting(true);
    try {
      await governanceApi.grantCapability({
        grantee_principal: grantee,
        capability,
        scope_type: scopeType,
        scope_id: scopeType === "global" ? null : scopeId.trim(),
      });
      toastRef.current("success", "Capability granted");
      setGrantOpen(false);
      fetchData();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Grant failed");
    } finally {
      setGranting(false);
    }
  };

  const granteeOptions = principals.filter((p) => !p.is_root);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "Governance" }, { label: "Delegation" }]} />

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Delegation</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            The data boundary, made of rows. Every authority flows down from root as a scoped grant.
            Nothing grants upward or sideways.
          </p>
        </div>
        <Button size="sm" onClick={() => setGrantOpen(true)}>
          <Plus size={14} className="mr-1" /> Grant Capability
        </Button>
      </div>

      {/* Scope coverage explainer */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 mb-6">
        <p className="text-[10px] uppercase tracking-wide text-zinc-600 mb-2">
          Scope coverage — a grant covers a resource at-or-below its scope
        </p>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
            global
          </span>
          <ChevronRight size={14} className="text-zinc-600" />
          <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">project:&lt;id&gt;</span>
          <ChevronRight size={14} className="text-zinc-600" />
          <span className="px-2 py-1 rounded bg-sky-500/10 text-sky-300">topic:&lt;id&gt;</span>
          <ChevronRight size={14} className="text-zinc-600" />
          <span className="px-2 py-1 rounded bg-teal-500/10 text-teal-300">task:&lt;id&gt;</span>
          <span className="text-[11px] text-zinc-600 ml-3">
            project reuses <code className="text-zinc-500">callerScope / assertProjectScope</code> —
            cross-scope reads return <code className="text-zinc-500">NOT_FOUND</code>, never a leak.
          </span>
        </div>
      </div>

      {/* View toggle + filters */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 border border-zinc-800 rounded-md p-0.5">
          <button
            onClick={() => setView("tree")}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded",
              view === "tree" ? "bg-zinc-800 text-zinc-200" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            Tree
          </button>
          <button
            onClick={() => setView("flat")}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded",
              view === "flat" ? "bg-zinc-800 text-zinc-200" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            Flat table
          </button>
        </div>
        {view === "flat" && (
          <select
            value={includeRevoked ? "all" : "active"}
            onChange={(e) => setIncludeRevoked(e.target.value === "all")}
            className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none appearance-none cursor-pointer"
          >
            <option value="active">Active grants</option>
            <option value="all">Include revoked</option>
          </select>
        )}
      </div>

      {loadError ? (
        <div className="py-12 text-center text-xs text-zinc-600">
          Could not load grants. The governance API may not be available yet.
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-xs text-zinc-600">Loading delegation…</div>
      ) : view === "tree" ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
          {activeGrants.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-600">
              No active grants yet. The tree begins at root — grant a capability to start delegating.
            </div>
          ) : (
            <TreeRow node={tree} depth={0} onRevoke={setRevokeTarget} />
          )}
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Grantee</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Capability</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Scope</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Granted by</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">When</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {flatRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-600">
                    No grants to show.
                  </td>
                </tr>
              ) : (
                flatRows.map((g) => {
                  const revoked = !!g.revoked_at;
                  return (
                    <tr
                      key={g.grant_id}
                      className={cn("border-b border-zinc-800/50", revoked && "opacity-50")}
                    >
                      <td className="px-4 py-2.5 text-zinc-300">
                        {g.grantee_display_name ?? g.grantee_principal}{" "}
                        {g.grantee_kind && (
                          <span className="text-[10px] text-violet-400">{g.grantee_kind}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded", capBadge[g.capability])}>
                          {g.capability}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded",
                            scopeBadgeClass(g.scope_type),
                          )}
                        >
                          {scopeLabel(g)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400">
                        {g.granted_by_display_name ?? g.granted_by}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500">
                        {revoked ? `revoked ${relTime(g.revoked_at!)}` : relTime(g.granted_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded",
                            revoked ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400",
                          )}
                        >
                          {revoked ? "revoked" : "active"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {!revoked && (
                          <button
                            onClick={() => setRevokeTarget(g)}
                            className="text-[11px] text-zinc-500 hover:text-red-400"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Grant modal */}
      {grantOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setGrantOpen(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="grant-title"
              className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-start justify-between">
                <div>
                  <h2 id="grant-title" className="text-base font-semibold text-zinc-100">
                    Grant Capability
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    You can only grant within your own subtree — a capability you hold, at a scope you
                    cover.
                  </p>
                </div>
                <button
                  onClick={() => setGrantOpen(false)}
                  aria-label="Close"
                  className="text-zinc-500 hover:text-zinc-300 p-1"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">
                    Grantee <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={grantee}
                    onChange={(e) => setGrantee(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600"
                  >
                    <option value="">Select a principal…</option>
                    {granteeOptions.map((p) => (
                      <option key={p.principal_id} value={p.principal_id}>
                        {p.display_name} ({p.kind})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">
                      Capability <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={capability}
                      onChange={(e) => setCapability(e.target.value as Capability)}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600"
                    >
                      <option value="read">read</option>
                      <option value="write">write</option>
                      <option value="admin">admin</option>
                      <option value="delegate">delegate</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">
                      Scope type <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={scopeType}
                      onChange={(e) => setScopeType(e.target.value as ScopeType)}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600"
                    >
                      <option value="project">project</option>
                      <option value="topic">topic</option>
                      <option value="task">task</option>
                      <option value="global">global (root only)</option>
                    </select>
                  </div>
                </div>
                {scopeType !== "global" && (
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">
                      Scope target <span className="text-red-400">*</span>
                    </label>
                    {scopeType === "project" ? (
                      <select
                        value={scopeId}
                        onChange={(e) => setScopeId(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600"
                      >
                        <option value="">Select a project…</option>
                        {projects.map((p) => (
                          <option key={p.project_id} value={p.project_id}>
                            {p.name ?? p.project_id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={scopeId}
                        onChange={(e) => setScopeId(e.target.value)}
                        placeholder={`${scopeType} id`}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none focus:border-zinc-600"
                      />
                    )}
                  </div>
                )}
                {/* Subtree-bound preview — informational; the server is the authority. */}
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-md p-3 flex items-start gap-2">
                  <Check size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-zinc-400">
                    This grant must fall within your own subtree — you must hold{" "}
                    <span className="text-emerald-300">delegate</span> (or admin) at a scope that covers{" "}
                    <span className="text-emerald-300">
                      {capability} @ {scopeType === "global" ? "global" : `${scopeType}:${scopeId || "…"}`}
                    </span>
                    . The server rejects upward / sideways grants with{" "}
                    <code className="text-zinc-500">OUT_OF_SUBTREE</code>.
                  </p>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-2">
                <button
                  onClick={() => setGrantOpen(false)}
                  className="px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-400"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGrant}
                  disabled={granting || !grantee || (scopeType !== "global" && !scopeId.trim())}
                  className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-white font-medium"
                >
                  {granting ? "Granting…" : "Grant"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        title="Revoke grant"
        description={
          revokeTarget
            ? `Revoke ${revokeTarget.capability} @ ${scopeLabel(revokeTarget)} from ${
                revokeTarget.grantee_display_name ?? revokeTarget.grantee_principal
              }? Grants below it in the subtree are not automatically revoked.`
            : ""
        }
        confirmText="Revoke"
        destructive
      />
    </div>
  );
}
