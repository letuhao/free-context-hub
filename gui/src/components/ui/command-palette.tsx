"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  detail?: string;
  shortcut?: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  items: CommandItem[];
}

export function CommandPalette({ items }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setActiveIndex(0);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = items.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      item.group.toLowerCase().includes(query.toLowerCase()),
  );

  // Group items
  const groups: Record<string, CommandItem[]> = {};
  for (const item of filtered) {
    (groups[item.group] ??= []).push(item);
  }

  const flatFiltered = filtered;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flatFiltered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && flatFiltered[activeIndex]) {
        flatFiltered[activeIndex].onSelect();
        setOpen(false);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [flatFiltered, activeIndex],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="relative w-[480px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <span className="text-zinc-500 text-sm">&#x1F50D;</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, lessons, actions..."
            className="flex-1 bg-transparent border-none text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <kbd className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-1">
          {Object.entries(groups).map(([group, groupItems]) => (
            <div key={group}>
              <div className="px-3 py-1 text-[11px] uppercase text-zinc-600 tracking-wide">{group}</div>
              {groupItems.map((item) => {
                const idx = flatFiltered.indexOf(item);
                return (
                  <div
                    key={item.id}
                    onClick={() => { item.onSelect(); setOpen(false); }}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex items-center justify-between px-3 py-2 mx-1 rounded-md text-sm cursor-pointer ${
                      idx === activeIndex ? "bg-zinc-800 text-zinc-100" : "text-zinc-400"
                    }`}
                  >
                    <span>{item.label}</span>
                    {(item.shortcut || item.detail) && (
                      <span className="text-xs text-zinc-600 font-mono">{item.shortcut ?? item.detail}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {flatFiltered.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-zinc-600">No results</div>
          )}
        </div>
      </div>
    </div>
  );
}
