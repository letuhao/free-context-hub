import { cn } from "@/lib/cn";

interface StatCardProps {
  value: number | string;
  label: string;
  highlight?: boolean;
  onClick?: () => void;
}

export function StatCard({ value, label, highlight, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "min-w-[140px] p-4 border border-zinc-800 rounded-lg bg-zinc-900 transition-colors",
        onClick && "cursor-pointer hover:border-zinc-700",
      )}
    >
      <div className={cn("text-2xl font-bold", highlight ? "text-amber-400" : "text-zinc-100")}>
        {value}
      </div>
      <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}
