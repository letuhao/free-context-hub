"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Breadcrumb, PageHeader, SearchBar } from "@/components/ui";
import { CATALOG, TOTALS, type Area } from "./catalog";
import {
  BookOpen, Search, Shield, GitBranch, Files, Network, Scale,
  KeyRound, FolderOpen, LayoutDashboard, Zap, Terminal, Server,
  MonitorSmartphone, ArrowUpRight, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  BookOpen, Search, Shield, GitBranch, Files, Network, Scale,
  KeyRound, FolderOpen, LayoutDashboard, Zap,
};

function matches(area: Area, q: string): Area | null {
  if (!q.trim()) return area;
  const needle = q.toLowerCase();
  const areaHit = area.title.toLowerCase().includes(needle) || area.blurb.toLowerCase().includes(needle);
  const features = area.features.filter((f) => {
    if (areaHit) return true;
    const inText = f.name.toLowerCase().includes(needle) || f.description.toLowerCase().includes(needle);
    const inMcp = (f.surface.mcp ?? []).some((t) => t.toLowerCase().includes(needle));
    const inRest = (f.surface.rest ?? "").toLowerCase().includes(needle);
    const inGui = (f.surface.gui?.label ?? "").toLowerCase().includes(needle);
    return inText || inMcp || inRest || inGui;
  });
  if (areaHit) return area;
  if (features.length === 0) return null;
  return { ...area, features };
}

export default function GuidePage() {
  const [query, setQuery] = useState("");

  const areas = useMemo(
    () => CATALOG.map((a) => matches(a, query)).filter((a): a is Area => a !== null),
    [query],
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <PageHeader
        title="Feature Guide"
        subtitle="Everything free-context-hub can do — and how to reach it from agents (MCP), integrations (REST), and the GUI."
        breadcrumb={<Breadcrumb items={[{ label: "Knowledge", href: "/lessons" }, { label: "Feature Guide" }]} />}
      />

      {/* Surface legend + totals */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { icon: Terminal, label: "MCP tools", value: TOTALS.mcpTools, hint: "for AI agents" },
          { icon: Server, label: "REST endpoints", value: `~${TOTALS.restEndpoints}`, hint: "for integrations" },
          { icon: MonitorSmartphone, label: "GUI pages", value: TOTALS.guiPages, hint: "for humans" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center gap-2 text-zinc-400">
              <s.icon size={16} strokeWidth={1.5} />
              <span className="text-xs uppercase tracking-wide">{s.label}</span>
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-zinc-100">{s.value}</div>
            <div className="text-[11px] text-zinc-600">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search features, tools, or endpoints… (press /)"
        />
      </div>

      {areas.length === 0 && (
        <div className="text-center text-zinc-500 py-16 text-sm">
          No features match “{query}”.
        </div>
      )}

      <div className="space-y-8">
        {areas.map((area) => {
          const Icon = ICONS[area.icon] ?? BookOpen;
          return (
            <section key={area.id} id={area.id} className="scroll-mt-6">
              <div className="flex items-start gap-3 mb-3">
                <div className="rounded-md bg-zinc-800/70 p-2 text-zinc-300 shrink-0">
                  <Icon size={18} strokeWidth={1.5} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-zinc-100">{area.title}</h2>
                  <p className="text-sm text-zinc-500">{area.blurb}</p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                {area.features.map((f) => (
                  <div
                    key={f.name}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2.5"
                  >
                    <div>
                      <div className="text-sm font-medium text-zinc-100">{f.name}</div>
                      <p className="text-xs text-zinc-500 mt-0.5">{f.description}</p>
                    </div>

                    <div className="mt-auto flex flex-wrap items-center gap-1.5">
                      {(f.surface.mcp ?? []).slice(0, 3).map((tool) => (
                        <span
                          key={tool}
                          className="inline-flex items-center gap-1 rounded bg-blue-500/10 text-blue-300 px-1.5 py-0.5 text-[10px] font-mono"
                          title="MCP tool"
                        >
                          <Terminal size={10} /> {tool}
                        </span>
                      ))}
                      {(f.surface.mcp?.length ?? 0) > 3 && (
                        <span className="text-[10px] text-zinc-600">+{(f.surface.mcp!.length - 3)} more</span>
                      )}
                      {f.surface.rest && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-zinc-700/40 text-zinc-300 px-1.5 py-0.5 text-[10px] font-mono"
                          title="REST endpoint"
                        >
                          <Server size={10} /> {f.surface.rest}
                        </span>
                      )}
                      {f.surface.gui && (
                        <Link
                          href={f.surface.gui.href}
                          className="inline-flex items-center gap-1 rounded bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 text-[10px] hover:bg-emerald-500/20 transition-colors"
                          title="Open in GUI"
                        >
                          <MonitorSmartphone size={10} /> {f.surface.gui.label}
                          <ArrowUpRight size={10} />
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-10 border-t border-zinc-800 pt-4 text-xs text-zinc-600">
        Full reference: <code className="text-zinc-400">FEATURES.md</code> ·{" "}
        <code className="text-zinc-400">docs/features/</code> ·{" "}
        <code className="text-zinc-400">docs/USER_GUIDE.md</code>. Agents: call{" "}
        <code className="text-zinc-400">help()</code> over MCP for the always-current tool reference.
      </div>
    </div>
  );
}
