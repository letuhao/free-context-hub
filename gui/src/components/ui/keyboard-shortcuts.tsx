"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Search } from "lucide-react";

type Shortcut = { keys: string[]; description: string };
type ShortcutGroup = { title: string; shortcuts: Shortcut[] };

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["Ctrl", "K"], description: "Open command palette" },
      { keys: ["G", "then", "D"], description: "Go to Dashboard" },
      { keys: ["G", "then", "L"], description: "Go to Lessons" },
      { keys: ["G", "then", "R"], description: "Go to Review Inbox" },
      { keys: ["G", "then", "C"], description: "Go to Chat" },
      { keys: ["Ctrl", "B"], description: "Toggle sidebar" },
      { keys: ["/"], description: "Focus search" },
      { keys: ["?"], description: "Show shortcuts" },
    ],
  },
  {
    title: "Lessons & Editor",
    shortcuts: [
      { keys: ["Ctrl", "S"], description: "Save changes" },
      { keys: ["Escape"], description: "Close modal / cancel edit" },
      { keys: ["Enter"], description: "Confirm action" },
      { keys: ["↑", "↓"], description: "Navigate table rows" },
    ],
  },
  {
    title: "AI & Actions",
    shortcuts: [
      { keys: ["Ctrl", "Enter"], description: "Send chat message" },
      { keys: ["Ctrl", "Shift", "N"], description: "New lesson" },
    ],
  },
];

interface KeyboardShortcutsProps {
  open: boolean;
  onClose: () => void;
}

function Kbd({ children }: { children: string }) {
  if (children === "then") {
    return <span className="text-[10px] text-zinc-600 mx-0.5">then</span>;
  }
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[10px] font-mono text-zinc-300">
      {children}
    </kbd>
  );
}

export function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
  const [filter, setFilter] = useState("");

  // Reset filter when opened
  useEffect(() => {
    if (open) setFilter("");
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const filteredGroups = useMemo(() => {
    if (!filter) return SHORTCUT_GROUPS;
    const q = filter.toLowerCase();
    return SHORTCUT_GROUPS.map((g) => ({
      ...g,
      shortcuts: g.shortcuts.filter(
        (s) =>
          s.description.toLowerCase().includes(q) ||
          s.keys.some((k) => k.toLowerCase().includes(q))
      ),
    })).filter((g) => g.shortcuts.length > 0);
  }, [filter]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] animate-[fadeIn_0.15s_ease-out]"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-6">
        <div role="dialog" aria-label="Keyboard shortcuts" className="w-full max-w-2xl max-h-[80vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col animate-[fadeInScale_0.15s_ease-out]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-sm font-semibold text-zinc-100">Keyboard Shortcuts</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Search */}
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg">
              <Search size={14} strokeWidth={1.5} className="text-zinc-500 shrink-0" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter shortcuts..."
                autoFocus
                className="flex-1 bg-transparent border-none text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
              />
            </div>
          </div>

          {/* Content: 3-column grid */}
          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {filteredGroups.length === 0 ? (
              <div className="text-center text-sm text-zinc-600 py-8">No shortcuts match your filter</div>
            ) : (
              <div className="grid grid-cols-3 gap-6">
                {filteredGroups.map((group) => (
                  <div key={group.title}>
                    <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">
                      {group.title}
                    </h3>
                    <div className="space-y-2">
                      {group.shortcuts.map((shortcut) => (
                        <div key={shortcut.description} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-zinc-400 truncate">{shortcut.description}</span>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {shortcut.keys.map((key, i) => (
                              <Kbd key={`${key}-${i}`}>{key}</Kbd>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-zinc-800 px-5 py-3 text-center">
            <span className="text-[11px] text-zinc-600">
              Press <Kbd>?</Kbd> to toggle this panel
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
