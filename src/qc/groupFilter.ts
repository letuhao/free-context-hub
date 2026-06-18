/**
 * Golden-query group filter — Phase 17.2 CoVe A/B support.
 *
 * `runBaseline.ts` runs whole surface golden sets. For a targeted A/B (e.g.
 * CoVe vs standard on only the 25 hallucination-prone edge-case rows) we need
 * to restrict a run to specific `group` values without authoring a throwaway
 * golden file. This is the pure, side-effect-free filter behind `--groups`.
 *
 * Kept in its own module (not inline in runBaseline.ts) because runBaseline's
 * `main()` runs on import — a test importing it would try to reach the stack.
 */

/** Filter golden queries by `group`.
 *
 *  Each pattern is an exact group name, OR a `*`-suffixed prefix:
 *    - `edge-no-answer`  → exact match
 *    - `edge-*`          → matches any group starting with `edge-`
 *
 *  `patterns` null / undefined / empty → no filter (returns a copy of all).
 *  Matching is case-sensitive (group names are authored lowercase-kebab).
 *  Blank patterns are ignored. If non-blank patterns are supplied but match
 *  nothing, the result is empty — the caller logs the post-filter count so an
 *  empty run is visible rather than silently running everything.
 */
export function filterQueriesByGroup<T extends { group?: string }>(
  queries: ReadonlyArray<T>,
  patterns: ReadonlyArray<string> | null | undefined,
): T[] {
  if (!patterns) return [...queries];
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const raw of patterns) {
    const p = raw.trim();
    if (!p) continue;
    if (p.endsWith('*')) prefixes.push(p.slice(0, -1));
    else exact.add(p);
  }
  // No effective patterns (e.g. `--groups ""` or all-blank) → treat as no filter.
  if (exact.size === 0 && prefixes.length === 0) return [...queries];

  return queries.filter((q) => {
    const g = q.group;
    if (typeof g !== 'string') return false;
    if (exact.has(g)) return true;
    for (const pre of prefixes) if (g.startsWith(pre)) return true;
    return false;
  });
}

/** Parse a `--groups` CLI value (comma-separated) into a pattern list, or null
 *  when the flag is absent / empty (→ no filter). */
export function parseGroupsArg(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return parts.length ? parts : null;
}
