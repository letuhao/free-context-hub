"use client";

/**
 * W2.2 — resolve coordination/governance actor UUIDs → human display names.
 *
 * After the actor→principal migration, every coordination surface stores actor identities as
 * principal UUIDs. Showing "by 6e6dc2ec-…" is unreadable. This hook loads the principal roster
 * once (module-cached across pages), maps id→display_name, and falls back to a shortened id for
 * unknown / legacy-string / non-UUID actors. `/api/principals` is admin-gated, so a non-admin
 * operator's failed load degrades gracefully to the shortened-id fallback (never throws).
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Compact an actor id for display: UUIDs → first 8 chars + ellipsis; short strings as-is. */
export function shortActor(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 20 ? `${id.slice(0, 8)}…` : id;
}

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

function loadNames(): Promise<Map<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .listPrincipals()
      .then((r) => {
        const m = new Map<string, string>();
        for (const p of r.principals ?? []) m.set(p.principal_id, p.display_name);
        cache = m;
        return m;
      })
      .catch(() => {
        // Non-admin operator (403) or transient failure — cache an empty map so every actor
        // falls back to the shortened id and we don't refetch in a loop.
        const m = new Map<string, string>();
        cache = m;
        return m;
      });
  }
  return inflight;
}

/** Returns `nameOf(id)` → display name, or a shortened id when unresolved. */
export function useActorNames(): (id: string | null | undefined) => string {
  const [map, setMap] = useState<Map<string, string>>(cache ?? new Map());
  useEffect(() => {
    let active = true;
    loadNames().then((m) => {
      if (active) setMap(new Map(m));
    });
    return () => {
      active = false;
    };
  }, []);
  return useCallback(
    (id: string | null | undefined): string => {
      if (!id) return "—";
      return map.get(id) ?? shortActor(id);
    },
    [map],
  );
}
