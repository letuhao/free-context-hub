"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { PageHeader, Badge, Button, EmptyState, SearchBar } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

interface FeatureCard {
  icon: string;
  title: string;
  description: string;
}

const KG_FEATURES: FeatureCard[] = [
  {
    icon: "\u{1F50D}",
    title: "Search Symbols",
    description:
      "Find functions, classes, and types across your codebase with semantic understanding of code structure.",
  },
  {
    icon: "\u{1F517}",
    title: "Explore Neighbors",
    description:
      "Discover related symbols — callers, callees, imports, and type dependencies for any node in the graph.",
  },
  {
    icon: "\u{1F9ED}",
    title: "Trace Dependencies",
    description:
      "Follow the dependency chain from any symbol to understand impact radius and coupling patterns.",
  },
  {
    icon: "\u{1F4A1}",
    title: "Lesson Impact",
    description:
      "See which lessons are relevant to a symbol and how code changes may affect existing project knowledge.",
  },
];

export default function GraphExplorerPage() {
  const { projectId } = useProject();
  const { toast } = useToast();

  const [kgEnabled, setKgEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const initialLoad = useRef(false);

  // Check if KG is enabled via system info
  const checkKgStatus = useCallback(async () => {
    try {
      const info = await api.info();
      const enabled = info?.features?.knowledge_graph?.enabled ?? false;
      setKgEnabled(enabled);
    } catch {
      // If info endpoint fails, assume KG is not available
      setKgEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    checkKgStatus();
  }, [checkKgStatus]);

  // Placeholder search handler — will wire to real KG endpoints when available
  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return;
      try {
        // Placeholder: uses searchCode as a stand-in until KG REST routes exist
        await api.searchCode({ project_id: projectId, query, kind: "symbol" });
        toast("info", "KG search endpoints are not yet available as REST routes");
      } catch {
        toast("info", "Knowledge Graph API routes coming soon");
      }
    },
    [projectId, toast],
  );

  // ── Loading state ──
  if (loading) {
    return (
      <div className="p-6 max-w-[1100px]">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-zinc-800 rounded" />
          <div className="h-4 w-72 bg-zinc-800/60 rounded" />
          <div className="h-12 w-full bg-zinc-800/40 rounded-lg mt-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-zinc-800/30 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── KG disabled state ──
  if (kgEnabled === false) {
    return (
      <div className="p-6 max-w-[1100px]">
        <PageHeader
          title="Knowledge Graph"
          subtitle="Explore symbols, dependencies, and code structure"
        />
        <EmptyState
          icon="\u{1F578}\uFE0F"
          title="Knowledge Graph is disabled"
          description="Enable KG_ENABLED=true to use this feature."
        />
      </div>
    );
  }

  // ── Main content ──
  return (
    <div className="p-6 max-w-[1100px]">
      <PageHeader
        title="Knowledge Graph"
        subtitle="Explore symbols, dependencies, and code structure"
        actions={
          <Badge value="Preview" variant="type" />
        }
      />

      {/* Symbol search bar */}
      <div className="mb-6">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search symbols, functions, types..."
          autoFocus
        />
        <div className="flex items-center gap-2 mt-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleSearch(searchQuery)}
            disabled={!searchQuery.trim()}
          >
            Search Graph
          </Button>
          <span className="text-xs text-zinc-600">
            Press / to focus search
          </span>
        </div>
      </div>

      {/* Graph visualization placeholder */}
      <div className="mb-8">
        <div className="border-2 border-dashed border-zinc-700 rounded-xl bg-zinc-900/50 flex flex-col items-center justify-center py-20 px-6">
          <div className="relative mb-6">
            {/* Decorative graph nodes */}
            <div className="flex items-center gap-6">
              <div className="w-12 h-12 rounded-full border-2 border-zinc-600 flex items-center justify-center text-zinc-500 text-lg">
                fn
              </div>
              <div className="flex flex-col gap-3">
                <div className="w-16 h-0.5 bg-zinc-700" />
                <div className="w-16 h-0.5 bg-zinc-700 ml-2" />
              </div>
              <div className="w-10 h-10 rounded-full border-2 border-zinc-700 flex items-center justify-center text-zinc-600 text-sm">
                T
              </div>
              <div className="flex flex-col gap-3">
                <div className="w-12 h-0.5 bg-zinc-700" />
              </div>
              <div className="w-14 h-14 rounded-full border-2 border-zinc-600 flex items-center justify-center text-zinc-500 text-lg">
                cls
              </div>
            </div>
          </div>
          <p className="text-sm text-zinc-400 font-medium mb-1">
            Graph visualization coming soon
          </p>
          <p className="text-xs text-zinc-600 max-w-md text-center">
            Interactive node-link diagram with zoom, pan, and click-to-explore.
            Symbols will appear as nodes with edges showing call and import relationships.
          </p>
        </div>
      </div>

      {/* Feature cards */}
      <div className="mb-2">
        <h2 className="text-sm font-medium text-zinc-300 mb-3">
          Planned Capabilities
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {KG_FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="border border-zinc-800 rounded-lg bg-zinc-900/60 p-5 hover:border-zinc-700 transition-colors"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-xl opacity-60">{feature.icon}</span>
                <h3 className="text-sm font-medium text-zinc-200">
                  {feature.title}
                </h3>
              </div>
              <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400">
                Coming Soon
              </span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              {feature.description}
            </p>
          </div>
        ))}
      </div>

      {/* Bottom note */}
      <div className="mt-6 flex items-center gap-2 text-xs text-zinc-600 border-t border-zinc-800/60 pt-4">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500/40" />
        KG routes will be added in a future release. The graph engine is powered by the existing code index.
      </div>
    </div>
  );
}
