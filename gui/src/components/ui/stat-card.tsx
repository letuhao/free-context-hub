import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

interface StatCardProps {
  value: number | string;
  label: string;
  highlight?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
}

export function StatCard({ value, label, highlight, onClick, icon }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "min-w-[120px] flex-1 px-4 py-3 border rounded-lg bg-zinc-900 transition-colors",
        highlight ? "border-amber-500/30" : "border-zinc-800",
        onClick && "cursor-pointer hover:border-zinc-600 hover:bg-zinc-900/80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className={cn("text-xl font-bold", highlight ? "text-amber-400" : "text-zinc-100")}>
            {value}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">{label}</div>
        </div>
        {icon && (
          <div className="text-zinc-700">{icon}</div>
        )}
      </div>
    </div>
  );
}
