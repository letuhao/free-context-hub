"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useProject } from "@/contexts/project-context";
import { cn } from "@/lib/cn";

type NavItem = { href: string; label: string; icon: string };
type NavGroup = { title: string; items: NavItem[] };

const navGroups: (NavItem | NavGroup)[] = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/chat", label: "Chat", icon: "💬" },
  {
    title: "Knowledge",
    items: [
      { href: "/lessons", label: "Lessons", icon: "📚" },
      { href: "/guardrails", label: "Guardrails", icon: "🛡" },
      { href: "/knowledge/docs", label: "Generated Docs", icon: "📄" },
      { href: "/knowledge/search", label: "Code Search", icon: "🔍" },
      { href: "/knowledge/graph", label: "Graph Explorer", icon: "🕸" },
    ],
  },
  {
    title: "Project",
    items: [
      { href: "/projects", label: "Overview", icon: "📁" },
      { href: "/projects/git", label: "Git History", icon: "📦" },
      { href: "/projects/sources", label: "Sources", icon: "🔗" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/jobs", label: "Jobs", icon: "⚡" },
      { href: "/settings", label: "Settings", icon: "⚙" },
      { href: "/settings/models", label: "Model Providers", icon: "🤖" },
    ],
  },
];

function isGroup(item: NavItem | NavGroup): item is NavGroup {
  return "title" in item;
}

function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  const { projectId, setProjectId } = useProject();
  const [collapsed, setCollapsed] = useState(false);
  const [healthy, setHealthy] = useState(true);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ?? "http://localhost:3001";
    let active = true;
    const check = () => {
      fetch(`${apiUrl}/api/system/health`)
        .then((r) => { if (active) setHealthy(r.ok); })
        .catch(() => { if (active) setHealthy(false); });
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        setCollapsed((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const renderItem = (item: NavItem) => {
    const active = isActive(item.href, pathname);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-md text-sm transition-colors",
          collapsed ? "justify-center px-0 py-2" : "px-3 py-1.5",
          active
            ? "bg-zinc-800 text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300",
        )}
      >
        <span className="text-sm">{item.icon}</span>
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col transition-all duration-150",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div className="px-4 py-4 border-b border-zinc-800">
        {collapsed ? (
          <div className="text-center text-base font-bold text-zinc-100">C</div>
        ) : (
          <>
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100">ContextHub</h1>
            <p className="text-[11px] text-zinc-600 mt-0.5">Knowledge Dashboard</p>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="px-3 py-2">
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none focus:border-zinc-700"
            placeholder="Project ID"
          />
        </div>
      )}

      <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
        {navGroups.map((entry, i) => {
          if (isGroup(entry)) {
            return (
              <div key={entry.title} className="mt-3 first:mt-0">
                {!collapsed && (
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-600 font-medium">
                    {entry.title}
                  </div>
                )}
                <div className="space-y-0.5">
                  {entry.items.map(renderItem)}
                </div>
              </div>
            );
          }
          return renderItem(entry);
        })}
      </nav>

      <div className="border-t border-zinc-800 px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={cn("w-2 h-2 rounded-full", healthy ? "bg-emerald-500" : "bg-red-500")} />
          {!collapsed && (
            <span className="text-[11px] text-zinc-600">
              {healthy ? "API connected" : "API offline"}
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-zinc-600 hover:text-zinc-400 text-xs"
          title={collapsed ? "Expand (Ctrl+B)" : "Collapse (Ctrl+B)"}
        >
          {collapsed ? "▶" : "◀"}
        </button>
      </div>
    </aside>
  );
}
