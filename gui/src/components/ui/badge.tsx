import { cn } from "@/lib/cn";

const typeStyles: Record<string, string> = {
  decision: "bg-blue-500/10 text-blue-400",
  guardrail: "bg-red-500/10 text-red-400",
  workaround: "bg-amber-500/10 text-amber-400",
  preference: "bg-purple-500/10 text-purple-400",
  general_note: "bg-zinc-700 text-zinc-300",
};

const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400",
  draft: "bg-zinc-500/20 text-zinc-400",
  superseded: "bg-amber-500/10 text-amber-400",
  archived: "bg-zinc-500/15 text-zinc-500",
};

const jobStatusStyles: Record<string, string> = {
  running: "text-blue-400",
  queued: "text-zinc-400",
  succeeded: "text-emerald-400",
  failed: "text-red-400",
  dead_letter: "text-red-400",
};

const jobDots: Record<string, string> = {
  running: "bg-blue-500 animate-pulse",
  queued: "border border-zinc-500 bg-transparent",
  succeeded: "bg-emerald-500",
  failed: "bg-red-500",
  dead_letter: "bg-red-500",
};

export function Badge({ value, variant = "type" }: { value: string; variant?: "type" | "status" }) {
  const styles = variant === "type" ? typeStyles : statusStyles;
  return (
    <span className={cn("inline-block px-2.5 py-0.5 rounded-full text-xs font-medium", styles[value] ?? "bg-zinc-700 text-zinc-300")}>
      {value}
    </span>
  );
}

export function JobStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", jobStatusStyles[status])}>
      <span className={cn("w-2 h-2 rounded-full shrink-0", jobDots[status])} />
      {status}
    </span>
  );
}
