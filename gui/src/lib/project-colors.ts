/** Project color presets — maps color key to Tailwind gradient classes */
export const PROJECT_COLORS = [
  { key: "blue",    from: "from-blue-600",    to: "to-blue-800",    ring: "ring-blue-400"    },
  { key: "emerald", from: "from-emerald-600", to: "to-emerald-800", ring: "ring-emerald-400" },
  { key: "purple",  from: "from-purple-600",  to: "to-purple-800",  ring: "ring-purple-400"  },
  { key: "amber",   from: "from-amber-600",   to: "to-amber-800",   ring: "ring-amber-400"   },
  { key: "red",     from: "from-red-600",     to: "to-red-800",     ring: "ring-red-400"     },
  { key: "pink",    from: "from-pink-600",    to: "to-pink-800",    ring: "ring-pink-400"    },
  { key: "cyan",    from: "from-cyan-600",    to: "to-cyan-800",    ring: "ring-cyan-400"    },
] as const;

export type ProjectColorKey = (typeof PROJECT_COLORS)[number]["key"];

export function getColorClasses(color: string | null | undefined) {
  const found = PROJECT_COLORS.find((c) => c.key === color);
  return found ?? PROJECT_COLORS[0]; // default to blue
}

/** Generate 1-2 letter initials from a project name or ID */
export function getInitials(name: string): string {
  if (!name || !name.trim()) return "??";
  const parts = name.replace(/[-_]/g, " ").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  // Single word: take first 2 chars, pad if needed
  const word = parts[0];
  return (word.length >= 2 ? word.slice(0, 2) : word[0] + word[0]).toUpperCase();
}
