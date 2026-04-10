import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumb?: ReactNode;
  /** Project context badge — rendered between breadcrumb and title. */
  projectBadge?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, breadcrumb, projectBadge, actions }: PageHeaderProps) {
  return (
    <div className="border-b border-zinc-800 pb-4 mb-6">
      {(breadcrumb || projectBadge) && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5">
          {projectBadge}
          {projectBadge && breadcrumb && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-600 shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
          )}
          {breadcrumb}
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
          {subtitle && <p className="text-sm text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
