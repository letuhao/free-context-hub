"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { Breadcrumb, Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import { Plus, X, Copy, AlertTriangle, Key } from "lucide-react";
import { relTime } from "@/lib/rel-time";

interface ApiKeyItem {
  key_id: string;
  name: string;
  key_prefix: string;
  role: string;
  project_scope: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked: boolean;
  created_at: string;
}

const ROLES = ["admin", "writer", "reader"] as const;

const roleBadge: Record<string, string> = {
  admin: "bg-blue-500/10 text-blue-400",
  writer: "bg-emerald-500/10 text-emerald-400",
  reader: "bg-zinc-700 text-zinc-400",
};

const PERMISSIONS = [
  { label: "Search lessons", admin: true, writer: true, reader: true },
  { label: "Check guardrails", admin: true, writer: true, reader: true },
  { label: "View summaries", admin: true, writer: true, reader: true },
  { label: "Add/update lessons", admin: true, writer: true, reader: false },
  { label: "Ingest git / index project", admin: true, writer: true, reader: false },
  { label: "Upload documents", admin: true, writer: true, reader: false },
  { label: "Delete lessons / workspace", admin: true, writer: false, reader: false },
  { label: "Manage projects / groups", admin: true, writer: false, reader: false },
  { label: "Manage API keys / roles", admin: true, writer: false, reader: false },
];

export default function AccessControlPage() {
  const { projects } = useProject();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"keys" | "permissions">("keys");

  // Generate modal
  const [genOpen, setGenOpen] = useState(false);
  const [genName, setGenName] = useState("");
  const [genRole, setGenRole] = useState<string>("writer");
  const [genScope, setGenScope] = useState("");
  const [generating, setGenerating] = useState(false);

  // Key reveal
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  // Revoke
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await api.listApiKeys();
      setKeys(res.keys ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  // Reset form on open
  useEffect(() => {
    if (genOpen) { setGenName(""); setGenRole("writer"); setGenScope(""); setRevealedKey(null); }
  }, [genOpen]);

  const handleGenerate = async () => {
    if (!genName.trim()) return;
    setGenerating(true);
    try {
      const res = await api.createApiKey({
        name: genName.trim(),
        role: genRole,
        project_scope: genScope || undefined,
      });
      setRevealedKey(res.key);
      fetchKeys();
      toastRef.current("success", "API key generated");
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Failed to generate key");
    } finally { setGenerating(false); }
  };

  const handleRevoke = async () => {
    if (!revokeId) return;
    try {
      await api.revokeApiKey(revokeId);
      toastRef.current("success", "Key revoked");
      setRevokeId(null);
      fetchKeys();
    } catch (err) {
      toastRef.current("error", err instanceof Error ? err.message : "Revoke failed");
    }
  };

  const activeKeys = keys.filter((k) => !k.revoked);
  const revokedKeys = keys.filter((k) => k.revoked);

  return (
    <div className="p-6">
      <Breadcrumb items={[{ label: "Settings", href: "/settings" }, { label: "Access Control" }]} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Access Control</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Manage API keys and permissions for agents and users</p>
        </div>
        <Button size="sm" onClick={() => setGenOpen(true)}>
          <Plus size={14} className="mr-1" /> Generate Key
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800 pb-px">
        <button
          onClick={() => setTab("keys")}
          className={cn("px-4 py-2 text-xs font-medium", tab === "keys" ? "text-blue-400 border-b-2 border-blue-400" : "text-zinc-500 hover:text-zinc-300")}
        >
          API Keys
        </button>
        <button
          onClick={() => setTab("permissions")}
          className={cn("px-4 py-2 text-xs font-medium", tab === "permissions" ? "text-blue-400 border-b-2 border-blue-400" : "text-zinc-500 hover:text-zinc-300")}
        >
          Permissions
        </button>
      </div>

      {/* Keys Tab */}
      {tab === "keys" && (
        <div className="space-y-3">
          {activeKeys.length === 0 && !loading && (
            <p className="text-xs text-zinc-600 py-8 text-center">No API keys yet. Click &quot;Generate Key&quot; to create one.</p>
          )}
          {activeKeys.map((k) => (
            <div key={k.key_id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-zinc-200">{k.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">active</span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded", roleBadge[k.role] ?? "bg-zinc-700 text-zinc-400")}>{k.role}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-[11px] font-mono text-zinc-500 bg-zinc-950 px-2 py-0.5 rounded">{k.key_prefix}</code>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-600">
                    <span>Created {relTime(k.created_at)}</span>
                    {k.last_used_at && <span>Last used {relTime(k.last_used_at)}</span>}
                    <span>Scope: {k.project_scope ?? "all projects"}</span>
                  </div>
                </div>
                <button
                  onClick={() => setRevokeId(k.key_id)}
                  className="text-xs text-zinc-500 hover:text-red-400 transition-colors shrink-0"
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}

          {/* Revoked keys (collapsed) */}
          {revokedKeys.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs text-zinc-600 mb-2">Revoked ({revokedKeys.length})</h3>
              <div className="space-y-2">
                {revokedKeys.map((k) => (
                  <div key={k.key_id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 opacity-60">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-400 line-through">{k.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">revoked</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Permissions Tab */}
      {tab === "permissions" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="text-center px-4 py-3 text-zinc-500 font-medium">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p.label} className="border-b border-zinc-800/50">
                  <td className="px-4 py-2.5 text-zinc-300">{p.label}</td>
                  <td className="text-center">{p.admin ? <span className="text-emerald-400">&#10003;</span> : <span className="text-zinc-600">&mdash;</span>}</td>
                  <td className="text-center">{p.writer ? <span className="text-emerald-400">&#10003;</span> : <span className="text-zinc-600">&mdash;</span>}</td>
                  <td className="text-center">{p.reader ? <span className="text-emerald-400">&#10003;</span> : <span className="text-zinc-600">&mdash;</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Generate Key Modal */}
      {genOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => !revealedKey && setGenOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div role="dialog" aria-modal="true" aria-labelledby="gen-key-title" className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-5 pb-4 border-b border-zinc-800 flex items-center justify-between">
                <h2 id="gen-key-title" className="text-base font-semibold text-zinc-100">
                  {revealedKey ? "Key Generated" : "Generate API Key"}
                </h2>
                <button onClick={() => setGenOpen(false)} aria-label="Close" className="text-zinc-500 hover:text-zinc-300 p-1">
                  <X size={18} />
                </button>
              </div>

              {revealedKey ? (
                /* Key reveal */
                <div className="px-6 py-5">
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle size={16} className="text-amber-400" />
                      <span className="text-xs text-amber-400 font-medium">Copy this key now — it won&apos;t be shown again</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm font-mono text-zinc-200 bg-zinc-950 px-3 py-2 rounded-md border border-zinc-800 break-all select-all">
                        {revealedKey}
                      </code>
                      <button
                        onClick={() => { navigator.clipboard.writeText(revealedKey); toastRef.current("success", "Copied to clipboard"); }}
                        className="px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 hover:bg-zinc-700 transition-colors shrink-0"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => setGenOpen(false)}>Done</Button>
                  </div>
                </div>
              ) : (
                /* Generate form */
                <>
                  <div className="px-6 py-5 space-y-4">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">Name <span className="text-red-400">*</span></label>
                      <input type="text" value={genName} onChange={(e) => setGenName(e.target.value)}
                        placeholder="e.g. Production Agent"
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600" />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">Role</label>
                      <select value={genRole} onChange={(e) => setGenRole(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600">
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5">Project Scope</label>
                      <select value={genScope} onChange={(e) => setGenScope(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none appearance-none cursor-pointer focus:border-zinc-600">
                        <option value="">All projects</option>
                        {projects.map((p) => <option key={p.project_id} value={p.project_id}>{p.name ?? p.project_id}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="px-6 py-4 border-t border-zinc-800 flex justify-end gap-2">
                    <button onClick={() => setGenOpen(false)} className="px-3 py-1.5 text-xs border border-zinc-700 rounded-md text-zinc-400">Cancel</button>
                    <button onClick={handleGenerate} disabled={generating || !genName.trim()}
                      className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-white font-medium">
                      {generating ? "Generating..." : "Generate"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Revoke confirm */}
      <ConfirmDialog
        open={!!revokeId}
        onClose={() => setRevokeId(null)}
        onConfirm={handleRevoke}
        title="Revoke API Key"
        description="This will immediately invalidate this key. Any agents or services using it will lose access."
        confirmText="Revoke"
        destructive
      />
    </div>
  );
}
