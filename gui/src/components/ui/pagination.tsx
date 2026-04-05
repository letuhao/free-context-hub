"use client";

import { useState } from "react";

interface PaginationProps {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, totalCount, pageSize, onPageChange }: PaginationProps) {
  const [jumpValue, setJumpValue] = useState("");

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  // Build page number array with ellipses
  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  const handleJump = () => {
    const n = parseInt(jumpValue, 10);
    if (n >= 1 && n <= totalPages) {
      onPageChange(n);
      setJumpValue("");
    }
  };

  const btnClass = (active: boolean, disabled?: boolean) =>
    `min-w-[28px] h-7 inline-flex items-center justify-center rounded-md text-xs cursor-pointer border transition-colors ${
      disabled ? "opacity-30 cursor-default border-transparent text-zinc-600" :
      active ? "bg-zinc-800 text-zinc-100 border-zinc-700" :
      "border-transparent text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
    }`;

  return (
    <div className="flex items-center justify-between py-3 text-xs text-zinc-500">
      <span>Showing {from}–{to} of {totalCount} items</span>
      <div className="flex items-center gap-1">
        <button
          className={btnClass(false, page === 1)}
          onClick={() => page > 1 && onPageChange(page - 1)}
          disabled={page === 1}
        >
          &larr;
        </button>
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`e${i}`} className="px-1 text-zinc-700">&hellip;</span>
          ) : (
            <button
              key={p}
              className={btnClass(p === page)}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          className={btnClass(false, page === totalPages)}
          onClick={() => page < totalPages && onPageChange(page + 1)}
          disabled={page === totalPages}
        >
          &rarr;
        </button>

        <div className="flex items-center gap-1 ml-3">
          <span className="text-zinc-600">Go to</span>
          <input
            type="text"
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && handleJump()}
            placeholder="#"
            className="w-10 px-1.5 py-1 bg-zinc-900 border border-zinc-800 rounded text-[11px] text-zinc-400 text-center outline-none focus:border-zinc-700"
          />
        </div>
      </div>
    </div>
  );
}
