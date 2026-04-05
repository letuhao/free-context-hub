"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";
import { useProject } from "@/contexts/project-context";
import { cn } from "@/lib/cn";
import {
  LayoutDashboard, MessageSquare, BookOpen, Shield,
  FileText, Search, Network, FolderOpen, Users, Files,
  GitBranch, Link2, Zap, Settings, Bot, Bell, BarChart3, CheckCircle2,
  PanelLeftClose, PanelLeftOpen, ClipboardCheck, Activity, Menu, X,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: ReactNode; badge?: number };
type NavGroup = { title: string; items: NavItem[] };

const ICON_SIZE = 18;
const ICON_STROKE = 1.5;

const buildNavGroups = (reviewCount: number, notifCount: number): (NavItem | NavGroup)[] => [
  { href: "/", label: "Dashboard", icon: <LayoutDashboard size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { href: "/chat", label: "Chat", icon: <MessageSquare size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  {
    title: "Knowledge",
    items: [
      { href: "/lessons", label: "Lessons", icon: <BookOpen size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/review", label: "Review Inbox", icon: <ClipboardCheck size={ICON_SIZE} strokeWidth={ICON_STROKE} />, badge: reviewCount },
      { href: "/guardrails", label: "Guardrails", icon: <Shield size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/documents", label: "Documents", icon: <Files size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/getting-started", label: "Getting Started", icon: <CheckCircle2 size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/knowledge/docs", label: "Generated Docs", icon: <FileText size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/knowledge/search", label: "Code Search", icon: <Search size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/knowledge/graph", label: "Graph Explorer", icon: <Network size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
    ],
  },
  {
    title: "Project",
    items: [
      { href: "/projects", label: "Overview", icon: <FolderOpen size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/projects/groups", label: "Groups", icon: <Users size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/projects/git", label: "Git History", icon: <GitBranch size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/projects/sources", label: "Sources", icon: <Link2 size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/jobs", label: "Jobs", icon: <Zap size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/activity", label: "Activity", icon: <Activity size={ICON_SIZE} strokeWidth={ICON_STROKE} />, badge: notifCount },
      { href: "/analytics", label: "Analytics", icon: <BarChart3 size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/settings", label: "Settings", icon: <Settings size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
      { href: "/settings/models", label: "Model Providers", icon: <Bot size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
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
  const { projectId, setProjectId, projects, includeGroups, setIncludeGroups } = useProject();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Detect mobile
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handle = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
      if (e.matches) setMobileOpen(false);
    };
    handle(mq);
    mq.addEventListener("change", handle);
    return () => mq.removeEventListener("change", handle);
  }, []);

  // Auto-collapse on tablet
  useEffect(() => {
    if (isMobile) return;
    const mq = window.matchMedia("(max-width: 1024px)");
    const handle = (e: MediaQueryListEvent | MediaQueryList) => setCollapsed(e.matches);
    handle(mq);
    mq.addEventListener("change", handle);
    return () => mq.removeEventListener("change", handle);
  }, [isMobile]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const [healthy, setHealthy] = useState(true);
  const [reviewCount, setReviewCount] = useState(0);
  const [notifCount, setNotifCount] = useState(0);

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
    if (!projectId) return;
    const apiUrl = process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ?? "http://localhost:3001";
    let active = true;
    const fetchCount = () => {
      Promise.all([
        fetch(`${apiUrl}/api/lessons?project_id=${encodeURIComponent(projectId)}&status=draft&limit=1`).then(r => r.ok ? r.json() : { total_count: 0 }),
        fetch(`${apiUrl}/api/lessons?project_id=${encodeURIComponent(projectId)}&status=pending_review&limit=1`).then(r => r.ok ? r.json() : { total_count: 0 }),
      ]).then(([d, p]) => {
        if (active) setReviewCount((d.total_count ?? 0) + (p.total_count ?? 0));
      }).catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => { active = false; clearInterval(interval); };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const apiUrl = process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ?? "http://localhost:3001";
    let active = true;
    const fetchNotifs = () => {
      fetch(`${apiUrl}/api/notifications?project_id=${encodeURIComponent(projectId)}&unread=true&limit=1`)
        .then(r => r.ok ? r.json() : { total_count: 0 })
        .then((d) => { if (active) setNotifCount(d.total_count ?? d.unread_count ?? 0); })
        .catch(() => {});
    };
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 60_000);
    return () => { active = false; clearInterval(interval); };
  }, [projectId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        if (isMobile) setMobileOpen((prev) => !prev);
        else setCollapsed((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isMobile]);

  const renderItem = (item: NavItem) => {
    const active = isActive(item.href, pathname);
    const showLabel = isMobile || !collapsed;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={!showLabel ? item.label : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-md text-sm transition-colors",
          !showLabel ? "justify-center px-0 py-2" : "px-3 py-1.5",
          active
            ? "bg-zinc-800 text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300",
        )}
      >
        <span className="shrink-0">{item.icon}</span>
        {showLabel && <span>{item.label}</span>}
        {showLabel && item.badge !== undefined && item.badge > 0 && (
          <span className="ml-auto text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  const showLabel = isMobile || !collapsed;

  const sidebarContent = (
    <>
      <div className="px-4 py-4 border-b border-zinc-800">
        {showLabel ? (
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-zinc-100">ContextHub</h1>
              <p className="text-[11px] text-zinc-600 mt-0.5">Knowledge Dashboard</p>
            </div>
            {isMobile && (
              <button onClick={() => setMobileOpen(false)} className="text-zinc-500 hover:text-zinc-300 p-1">
                <X size={18} />
              </button>
            )}
          </div>
        ) : (
          <div className="text-center text-base font-bold text-zinc-100">C</div>
        )}
      </div>

      {showLabel && (
        <div className="px-3 py-2 space-y-1.5">
          {projects.length > 0 ? (
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none focus:border-zinc-700 appearance-none cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.name ?? p.project_id}
                  {p.groups.length > 0 ? ` (${p.groups.length} groups)` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-300 outline-none focus:border-zinc-700"
              placeholder="Project ID"
            />
          )}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeGroups}
              onChange={(e) => setIncludeGroups(e.target.checked)}
              className="w-3 h-3 rounded border-zinc-700 bg-zinc-800 accent-blue-500"
            />
            <span className="text-[10px] text-zinc-500">Include group knowledge</span>
          </label>
        </div>
      )}

      <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
        {buildNavGroups(reviewCount, notifCount).map((entry, i) => {
          if (isGroup(entry)) {
            return (
              <div key={entry.title} className="mt-3 first:mt-0">
                {showLabel && (
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
          {showLabel && (
            <span className="text-[11px] text-zinc-600">
              {healthy ? "API connected" : "API offline"}
            </span>
          )}
        </div>
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-zinc-600 hover:text-zinc-400"
            title={collapsed ? "Expand (Ctrl+B)" : "Collapse (Ctrl+B)"}
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        )}
      </div>
    </>
  );

  // Mobile: hidden sidebar + hamburger header
  if (isMobile) {
    return (
      <>
        {/* Mobile top bar */}
        <div className="fixed top-0 left-0 right-0 z-30 h-12 bg-zinc-950 border-b border-zinc-800 flex items-center px-4 gap-3">
          <button onClick={() => setMobileOpen(true)} className="text-zinc-400 hover:text-zinc-200 p-1">
            <Menu size={20} />
          </button>
          <span className="text-sm font-semibold text-zinc-100">ContextHub</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className={cn("w-2 h-2 rounded-full", healthy ? "bg-emerald-500" : "bg-red-500")} />
          </div>
        </div>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col animate-[slideInLeft_0.2s_ease-out]">
              {sidebarContent}
            </aside>
          </>
        )}
      </>
    );
  }

  // Desktop/tablet: normal sidebar
  return (
    <aside
      className={cn(
        "shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col transition-all duration-150",
        collapsed ? "w-14" : "w-56",
      )}
    >
      {sidebarContent}
    </aside>
  );
}
