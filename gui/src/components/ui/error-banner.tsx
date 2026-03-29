"use client";

import { cn } from "@/lib/cn";

interface ErrorBannerProps {
  message: string;
  variant?: "error" | "warning";
  onDismiss?: () => void;
}

export function ErrorBanner({ message, variant = "error", onDismiss }: ErrorBannerProps) {
  const styles = {
    error: "bg-red-500/8 border-red-500/15 text-red-300",
    warning: "bg-amber-500/8 border-amber-500/15 text-amber-300",
  };

  return (
    <div className={cn("flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm mb-4", styles[variant])}>
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-zinc-500 hover:text-zinc-300 ml-4">
          &times;
        </button>
      )}
    </div>
  );
}
