"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, action?: Toast["action"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((type: ToastType, message: string, action?: Toast["action"]) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, type, message, action }]);
    if (type !== "error") {
      setTimeout(() => removeToast(id), 5000);
    }
  }, [removeToast]);

  const styles: Record<ToastType, string> = {
    success: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    error: "bg-red-500/10 border-red-500/20 text-red-400",
    info: "bg-blue-500/10 border-blue-500/20 text-blue-400",
  };

  const icons: Record<ToastType, string> = {
    success: "\u2713",
    error: "\u2715",
    info: "\u2139",
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn("flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm", styles[t.type])}
          >
            <span>{icons[t.type]}</span>
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button onClick={t.action.onClick} className="underline text-xs ml-1">
                {t.action.label}
              </button>
            )}
            <button onClick={() => removeToast(t.id)} className="text-zinc-600 hover:text-zinc-400 ml-1">
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
