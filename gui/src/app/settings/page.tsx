"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { Breadcrumb, PageHeader } from "@/components/ui";
import { LineSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";

type FeatureInfo = {
  enabled: boolean;
  model?: string | null;
  type?: string;
  backend?: string;
};

type SystemInfo = {
  name: string;
  version: string;
  mcp_port: number;
  api_port: number;
  features: Record<string, FeatureInfo>;
};

export default function SettingsPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);

  const fetchInfo = useCallback(async () => {
    try {
      const result = await api.info();
      setInfo(result);
    } catch {
      toastRef.current("error", "Failed to load system info");
    } finally {
      setInitialLoad(false);
    }
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  const featureRows = info ? Object.entries(info.features).map(([key, val]) => ({
    name: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    key,
    enabled: val.enabled,
    detail: val.model ?? val.type ?? val.backend ?? null,
  })) : [];

  return (
    <div className="p-6 max-w-[800px]">
      <Breadcrumb items={[{ label: "System", href: "/settings" }, { label: "Settings" }]} />
      <PageHeader title="Settings" subtitle="System configuration and feature status" />

      {initialLoad ? (
        <LineSkeleton lines={8} />
      ) : info ? (
        <>
          {/* Server Info */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-900 mb-5 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-300">Server</h3>
            </div>
            <div className="px-4 py-3 grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-zinc-500">Name:</span> <span className="text-zinc-200 font-mono">{info.name}</span></div>
              <div><span className="text-zinc-500">Version:</span> <span className="text-zinc-200 font-mono">{info.version}</span></div>
              <div><span className="text-zinc-500">MCP Port:</span> <span className="text-zinc-200 font-mono">{info.mcp_port}</span></div>
              <div><span className="text-zinc-500">API Port:</span> <span className="text-zinc-200 font-mono">{info.api_port}</span></div>
            </div>
          </div>

          {/* Feature Flags */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-300">Feature Flags</h3>
            </div>
            <div className="divide-y divide-zinc-800">
              {featureRows.map((f) => (
                <div key={f.key} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${f.enabled ? "bg-emerald-500" : "bg-zinc-600"}`} />
                    <span className={`text-sm ${f.enabled ? "text-zinc-200" : "text-zinc-500"}`}>{f.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.detail && <span className="text-xs text-zinc-500 font-mono">{f.detail}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${f.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}>
                      {f.enabled ? "enabled" : "disabled"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
