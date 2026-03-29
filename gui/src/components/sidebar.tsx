"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useProject } from "@/contexts/project-context";
import { cn } from "@/lib/cn";

const navItems = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/lessons", label: "Lessons", icon: "📚" },
  { href: "/guardrails", label: "Guardrails", icon: "🛡" },
  { href: "/projects", label: "Projects", icon: "📁" },
  { href: "/jobs", label: "Jobs", icon: "⚡" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { projectId, setProjectId } = useProject();
  const [collapsed, setCollapsed] = useState(false);
  const [healthy, setHealthy] = useState(true);

  // Health polling
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

  // Ctrl+B to toggle
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

  return (
    <aside
      className={cn(
        "shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col transition-all duration-150",
        collapsed ? "w-14" : "w-56",
      )}
    >
      {/* Logo */}
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

      {/* Project selector */}
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

      {/* Nav */}
      <nav className="flex-1 px-2 py-2 space-y-0.5">
        {navItems.map(({ href, label, icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md text-sm transition-colors",
                collapsed ? "justify-center px-0 py-2" : "px-3 py-2",
                active
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300",
              )}
            >
              <span className="text-base">{icon}</span>
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-zinc-800 px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={cn("w-2 h-2 rounded-full", healthy ? "bg-emerald-500" : "bg-red-500")}
          />
          {!collapsed && (
            <span className="text-[11px] text-zinc-600">
              {healthy ? "API connected" : "API offline"}
            </span>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="text-zinc-600 hover:text-zinc-400 text-xs"
            title="Collapse sidebar (Ctrl+B)"
          >
            ◀
          </button>
        )}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="text-zinc-600 hover:text-zinc-400 text-xs"
            title="Expand sidebar (Ctrl+B)"
          >
            ▶
          </button>
        )}
      </div>
    </aside>
  );
}
