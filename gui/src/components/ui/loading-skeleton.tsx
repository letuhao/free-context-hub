import { cn } from "@/lib/cn";

function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-3.5 rounded bg-zinc-800 animate-pulse",
        className,
      )}
    />
  );
}

/** Skeleton for a row of stat cards. */
export function StatCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="min-w-[140px] h-20 rounded-lg bg-zinc-800 animate-pulse" />
      ))}
    </div>
  );
}

/** Skeleton for a data table. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonBar key={i} className={i % 2 === 0 ? "w-4/5" : "w-3/5"} />
      ))}
    </div>
  );
}

/** Generic line skeleton. */
export function LineSkeleton({ lines = 3 }: { lines?: number }) {
  const widths = ["w-4/5", "w-3/5", "w-full", "w-2/5"];
  return (
    <div className="space-y-2.5">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBar key={i} className={widths[i % widths.length]} />
      ))}
    </div>
  );
}
