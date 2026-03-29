"use client";

import { useState, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

// ── Column definition ──
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

// ── Props ──
interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  onHeaderClick?: (key: string) => void;
  selectable?: boolean;
  bulkActions?: { label: string; onClick: (ids: string[]) => void }[];
  // Pagination
  totalCount?: number;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  onNextPage?: () => void;
  onPrevPage?: () => void;
  pageLabel?: string;
  // Row actions
  rowActions?: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  onHeaderClick,
  selectable,
  bulkActions,
  totalCount,
  hasNextPage,
  hasPrevPage,
  onNextPage,
  onPrevPage,
  pageLabel,
  rowActions,
}: DataTableProps<T>) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allKeys = data.map(rowKey);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (allKeys.every((k) => prev.has(k))) return new Set();
      return new Set(allKeys);
    });
  }, [allKeys]);

  const toggleRow = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  return (
    <div>
      {/* Bulk action bar */}
      {selectable && selected.size > 0 && bulkActions && (
        <div className="flex items-center gap-3 px-4 py-2 mb-3 bg-blue-950/30 border border-blue-900/30 rounded-lg text-sm">
          <span className="text-blue-300 font-semibold">{selected.size} selected</span>
          {bulkActions.map((action) => (
            <Button
              key={action.label}
              variant="outline"
              size="sm"
              onClick={() => action.onClick(Array.from(selected))}
            >
              {action.label}
            </Button>
          ))}
          <button onClick={clearSelection} className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">
            Deselect all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              {selectable && (
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-blue-500"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => onHeaderClick?.(col.key)}
                  className={cn("text-left px-3 py-2 text-xs font-medium text-zinc-500", onHeaderClick && "cursor-pointer hover:text-zinc-400", col.className)}
                >
                  {col.header}
                </th>
              ))}
              {rowActions && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "border-b border-zinc-900 last:border-0 transition-colors",
                    onRowClick && "cursor-pointer",
                    "hover:bg-zinc-900/60",
                  )}
                >
                  {selectable && (
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggleRow(key)}
                        className="accent-blue-500"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-3 py-2.5 text-zinc-300", col.className)}>
                      {col.render(row)}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="px-3 py-2.5 text-zinc-500" onClick={(e) => e.stopPropagation()}>
                      {rowActions(row)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(totalCount !== undefined || hasNextPage || hasPrevPage) && (
        <div className="flex items-center justify-between px-1 py-3 text-xs text-zinc-500">
          <span>{pageLabel ?? (totalCount !== undefined ? `${data.length} of ${totalCount}` : "")}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={!hasPrevPage} onClick={onPrevPage}>
              &larr; Prev
            </Button>
            <Button variant="outline" size="sm" disabled={!hasNextPage} onClick={onNextPage}>
              Next &rarr;
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
