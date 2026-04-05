import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon = "📭", title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center border border-dashed border-zinc-800 rounded-lg">
      <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-full w-16 h-16 flex items-center justify-center mb-3">
        <span className="text-3xl opacity-40">{icon}</span>
      </div>
      <div className="text-sm text-zinc-400 mb-1">{title}</div>
      {description && <div className="text-xs text-zinc-600 mb-4">{description}</div>}
      {action}
    </div>
  );
}
