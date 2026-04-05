"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { LESSON_STATUSES } from "./types";
import { useLessonTypes } from "@/lib/use-lesson-types";

interface FilterPanelProps {
  open: boolean;
  onClose: () => void;
  filterType: string | undefined;
  filterStatus: string | undefined;
  onTypeChange: (value: string | undefined) => void;
  onStatusChange: (value: string | undefined) => void;
  onClear: () => void;
}

export function FilterPanel({
  open,
  onClose,
  filterType,
  filterStatus,
  onTypeChange,
  onStatusChange,
  onClear,
}: FilterPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { typeKeys } = useLessonTypes();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const optClass = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-xs cursor-pointer border transition-colors ${
      active ? "bg-zinc-800 text-zinc-100 border-zinc-700" : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400"
    }`;

  return (
    <div ref={ref} className="absolute top-full right-0 mt-1 w-[280px] bg-zinc-900 border border-zinc-700 rounded-xl p-4 z-20 shadow-2xl">
      <div className="mb-3.5">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Type</div>
        <div className="flex flex-wrap gap-1">
          <button className={optClass(!filterType)} onClick={() => onTypeChange(undefined)}>All</button>
          {typeKeys.map((t) => (
            <button key={t} className={optClass(filterType === t)} onClick={() => onTypeChange(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3.5">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Status</div>
        <div className="flex flex-wrap gap-1">
          <button className={optClass(!filterStatus)} onClick={() => onStatusChange(undefined)}>All</button>
          {LESSON_STATUSES.map((s) => (
            <button key={s} className={optClass(filterStatus === s)} onClick={() => onStatusChange(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-between pt-3 border-t border-zinc-800">
        <Button variant="ghost" size="sm" onClick={onClear}>Clear All</Button>
        <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
