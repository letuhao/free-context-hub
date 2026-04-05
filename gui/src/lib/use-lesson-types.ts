"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export interface LessonTypeInfo {
  type_key: string;
  display_name: string;
  description: string | null;
  color: string;
  is_builtin: boolean;
}

/** Fetches lesson types from API on mount. Falls back to built-in defaults if API is unavailable. */
export function useLessonTypes() {
  const [types, setTypes] = useState<LessonTypeInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.listLessonTypes()
      .then((res) => setTypes(res.types ?? []))
      .catch(() => {
        // Fallback to hardcoded defaults if API unavailable
        setTypes([
          { type_key: "decision", display_name: "Decision", description: null, color: "blue", is_builtin: true },
          { type_key: "preference", display_name: "Preference", description: null, color: "purple", is_builtin: true },
          { type_key: "guardrail", display_name: "Guardrail", description: null, color: "red", is_builtin: true },
          { type_key: "workaround", display_name: "Workaround", description: null, color: "amber", is_builtin: true },
          { type_key: "general_note", display_name: "General Note", description: null, color: "zinc", is_builtin: true },
        ]);
      })
      .finally(() => setLoaded(true));
  }, []);

  return { types, typeKeys: types.map((t) => t.type_key), loaded };
}

/** Map a lesson type color key to Tailwind badge classes */
const COLOR_TO_BADGE: Record<string, string> = {
  blue: "bg-blue-500/10 text-blue-400",
  purple: "bg-purple-500/10 text-purple-400",
  red: "bg-red-500/10 text-red-400",
  amber: "bg-amber-500/10 text-amber-400",
  emerald: "bg-emerald-500/10 text-emerald-400",
  cyan: "bg-cyan-500/10 text-cyan-400",
  pink: "bg-pink-500/10 text-pink-400",
  zinc: "bg-zinc-700 text-zinc-300",
};

export function getTypeBadgeStyle(color: string): string {
  return COLOR_TO_BADGE[color] ?? "bg-zinc-700 text-zinc-300";
}
