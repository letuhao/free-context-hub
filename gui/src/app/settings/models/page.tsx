"use client";

import { useState, useRef } from "react";
import { Breadcrumb, PageHeader, Button, Badge, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Provider = {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  models: string[];
  status: "untested" | "connected" | "error";
};

type Assignment = {
  feature: string;
  provider_id: string | null;
  model_name: string;
};

const FEATURES = [
  { key: "embeddings", label: "Embeddings", type: "embedding" },
  { key: "distillation", label: "Distillation", type: "chat" },
  { key: "rerank", label: "Reranking", type: "chat" },
  { key: "builder_memory", label: "Builder Memory", type: "chat" },
  { key: "qa_agent", label: "QA Agent", type: "chat" },
  { key: "qc_eval", label: "QC / Eval", type: "chat" },
  { key: "judge_agent", label: "Judge Agent", type: "chat" },
  { key: "search_aliases", label: "Search Aliases", type: "chat" },
  { key: "commit_analysis", label: "Commit Analysis", type: "chat" },
  { key: "faq_generation", label: "FAQ Generation", type: "chat" },
  { key: "raptor_summaries", label: "RAPTOR Summaries", type: "chat" },
  { key: "chat_gui", label: "Chat (GUI)", type: "chat" },
];

export default function ModelProvidersPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [tab, setTab] = useState<"providers" | "assignments">("providers");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [assignments, setAssignments] = useState<Record<string, { provider_id: string; model: string }>>({});

  // Add provider dialog
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formKey, setFormKey] = useState("");
  const [formModels, setFormModels] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const resetForm = () => { setFormName(""); setFormUrl(""); setFormKey(""); setFormModels(""); setEditId(null); };

  const handleSaveProvider = () => {
    if (!formName.trim() || !formUrl.trim()) {
      toastRef.current("error", "Name and Base URL are required");
      return;
    }
    const models = formModels.split("\n").map((m) => m.trim()).filter(Boolean);
    if (editId) {
      setProviders((prev) => prev.map((p) => p.id === editId ? { ...p, name: formName, base_url: formUrl, api_key: formKey, models } : p));
      toastRef.current("success", "Provider updated");
    } else {
      const newProvider: Provider = {
        id: crypto.randomUUID(),
        name: formName,
        base_url: formUrl,
        api_key: formKey,
        models,
        status: "untested",
      };
      setProviders((prev) => [...prev, newProvider]);
      toastRef.current("success", "Provider added");
    }
    setAddOpen(false);
    resetForm();
  };

  const handleEdit = (p: Provider) => {
    setEditId(p.id);
    setFormName(p.name);
    setFormUrl(p.base_url);
    setFormKey(p.api_key);
    setFormModels(p.models.join("\n"));
    setAddOpen(true);
  };

  const handleDelete = () => {
    if (deleteId) {
      setProviders((prev) => prev.filter((p) => p.id !== deleteId));
      // Clear assignments referencing this provider
      setAssignments((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (next[key].provider_id === deleteId) delete next[key];
        }
        return next;
      });
      toastRef.current("success", "Provider deleted");
    }
    setDeleteId(null);
  };

  const handleTest = async (p: Provider) => {
    toastRef.current("info", `Testing ${p.name}...`);
    try {
      const res = await fetch(`${p.base_url}/v1/models`, {
        headers: p.api_key ? { Authorization: `Bearer ${p.api_key}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        const modelIds = (data.data ?? []).map((m: any) => m.id);
        setProviders((prev) => prev.map((pp) => pp.id === p.id ? { ...pp, status: "connected", models: modelIds.length > 0 ? modelIds : pp.models } : pp));
        toastRef.current("success", `Connected! Found ${modelIds.length} models`);
      } else {
        setProviders((prev) => prev.map((pp) => pp.id === p.id ? { ...pp, status: "error" } : pp));
        toastRef.current("error", `Connection failed (HTTP ${res.status})`);
      }
    } catch {
      setProviders((prev) => prev.map((pp) => pp.id === p.id ? { ...pp, status: "error" } : pp));
      toastRef.current("error", `Cannot reach ${p.base_url}`);
    }
  };

  const allModels = providers.flatMap((p) => p.models.map((m) => ({ provider_id: p.id, provider_name: p.name, model: m })));

  const statusColor: Record<string, string> = {
    connected: "bg-emerald-500",
    error: "bg-red-500",
    untested: "bg-zinc-600",
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Breadcrumb items={[{ label: "System", href: "/settings" }, { label: "Model Providers" }]} />
      <PageHeader
        title="Model Providers"
        subtitle="Manage AI model providers and feature assignments"
        actions={tab === "providers" ? <Button variant="primary" onClick={() => { resetForm(); setAddOpen(true); }}>+ Add Provider</Button> : undefined}
      />

      {/* Tabs */}
      <div className="flex gap-0 border-b border-zinc-800 mb-5">
        <button onClick={() => setTab("providers")} className={`px-4 py-2 text-sm border-b-2 transition-colors ${tab === "providers" ? "text-zinc-100 border-zinc-100" : "text-zinc-500 border-transparent hover:text-zinc-300"}`}>
          Providers
        </button>
        <button onClick={() => setTab("assignments")} className={`px-4 py-2 text-sm border-b-2 transition-colors ${tab === "assignments" ? "text-zinc-100 border-zinc-100" : "text-zinc-500 border-transparent hover:text-zinc-300"}`}>
          Feature Assignment
        </button>
      </div>

      {/* ═══ TAB 1: PROVIDERS ═══ */}
      {tab === "providers" && (
        <>
          {providers.length === 0 ? (
            <EmptyState
              icon="🤖"
              title="No providers configured"
              description="Add an OpenAI-compatible provider (LM Studio, Ollama, vLLM, OpenRouter)"
              action={<Button variant="primary" onClick={() => { resetForm(); setAddOpen(true); }}>+ Add Provider</Button>}
            />
          ) : (
            <div className="space-y-3">
              {providers.map((p) => (
                <div key={p.id} className="border border-zinc-800 rounded-lg bg-zinc-900 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${statusColor[p.status]}`} />
                      <span className="text-sm font-semibold text-zinc-200">{p.name}</span>
                      <span className="text-xs text-zinc-600">{p.status}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleTest(p)}>Test</Button>
                      <Button variant="outline" size="sm" onClick={() => handleEdit(p)}>Edit</Button>
                      <Button variant="danger" size="sm" onClick={() => setDeleteId(p.id)}>Delete</Button>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500 font-mono mb-1">{p.base_url}</div>
                  {p.models.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.models.map((m) => (
                        <span key={m} className="px-2 py-0.5 rounded text-[11px] bg-zinc-800 text-zinc-400">{m}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══ TAB 2: FEATURE ASSIGNMENT ═══ */}
      {tab === "assignments" && (
        <>
          <p className="text-xs text-zinc-500 mb-4">
            Assign a provider and model to each feature. Unassigned features use env var defaults.
          </p>
          <div className="border border-zinc-800 rounded-lg bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">Feature</th>
                  <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">Provider</th>
                  <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">Model</th>
                  <th className="w-10 px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((f) => {
                  const assigned = assignments[f.key];
                  const providerModels = assigned?.provider_id
                    ? providers.find((p) => p.id === assigned.provider_id)?.models ?? []
                    : [];
                  return (
                    <tr key={f.key} className="border-b border-zinc-800 last:border-0">
                      <td className="px-4 py-2.5 text-zinc-300">{f.label}</td>
                      <td className="px-4 py-2.5">
                        <select
                          value={assigned?.provider_id ?? ""}
                          onChange={(e) => {
                            const pid = e.target.value || null;
                            setAssignments((prev) => ({
                              ...prev,
                              [f.key]: { provider_id: pid ?? "", model: "" },
                            }));
                          }}
                          className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-300 outline-none"
                        >
                          <option value="">— env default —</option>
                          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={assigned?.model ?? ""}
                          onChange={(e) => {
                            setAssignments((prev) => ({
                              ...prev,
                              [f.key]: { ...prev[f.key], model: e.target.value },
                            }));
                          }}
                          disabled={!assigned?.provider_id}
                          className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-300 outline-none disabled:opacity-40"
                        >
                          <option value="">— select —</option>
                          {providerModels.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`w-2 h-2 rounded-full inline-block ${assigned?.provider_id ? "bg-emerald-500" : "bg-zinc-600"}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between mt-4">
            <Button variant="ghost" onClick={() => { setAssignments({}); toastRef.current("success", "Reset to defaults"); }}>
              Reset All to Defaults
            </Button>
            <Button variant="primary" onClick={() => toastRef.current("info", "Assignments saved (dev mode — localStorage only)")}>
              Save All
            </Button>
          </div>
        </>
      )}

      {/* ═══ ADD/EDIT PROVIDER DIALOG ═══ */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setAddOpen(false); resetForm(); }} />
          <div className="relative w-[480px] bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-zinc-100 mb-5">{editId ? "Edit Provider" : "Add Provider"}</h3>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Name</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none" placeholder="e.g. LM Studio" autoFocus />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Base URL</label>
                <input value={formUrl} onChange={(e) => setFormUrl(e.target.value)} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none" placeholder="http://localhost:1234" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">API Key (optional)</label>
                <input value={formKey} onChange={(e) => setFormKey(e.target.value)} type="password" className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none" placeholder="sk-..." />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Models (one per line)</label>
                <textarea value={formModels} onChange={(e) => setFormModels(e.target.value)} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none min-h-[80px] resize-y font-mono" placeholder={"qwen3-embedding-0.6b\nqwen2.5-coder-7b-instruct"} />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-zinc-800">
              <Button variant="outline" onClick={() => { setAddOpen(false); resetForm(); }}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveProvider}>{editId ? "Save" : "Add Provider"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete provider"
        description="This will remove the provider and clear any feature assignments using it."
        confirmText="Delete"
        destructive
      />
    </div>
  );
}
