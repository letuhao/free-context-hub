"use client";

import { useRef, useEffect } from "react";
import { Search } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  filterSlot?: React.ReactNode;
  autoFocus?: boolean;
}

export function SearchBar({ value, onChange, placeholder = "Search...", filterSlot, autoFocus }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex items-center gap-2 px-3 py-2 border border-zinc-800 rounded-lg bg-zinc-900">
      <Search size={18} strokeWidth={1.5} className="text-zinc-500 shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="flex-1 bg-transparent border-none text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
      />
      {filterSlot}
    </div>
  );
}
