"use client";

import { useEffect, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function SlideOver({ open, onClose, title, subtitle, children, footer, wide }: SlideOverProps) {
  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleEsc);
      return () => document.removeEventListener("keydown", handleEsc);
    }
  }, [open, handleEsc]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]" onClick={onClose} />

      {/* Panel */}
      <div
        className={cn(
          "relative bg-zinc-900 border-l border-zinc-800 flex flex-col h-full animate-[slideInRight_0.2s_ease-out]",
          wide ? "w-[480px]" : "w-[380px]",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100 truncate">{title}</h2>
            {subtitle && <div className="mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none ml-4">
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-5 py-3 border-t border-zinc-800 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Section within a SlideOver body. */
export function SlideOverSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">{title}</h3>
      <div className="text-sm text-zinc-400 leading-relaxed">{children}</div>
    </div>
  );
}
