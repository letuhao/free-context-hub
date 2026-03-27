/**
 * Parse git show --name-status / --numstat output into normalized file rows.
 * Kept separate for unit tests (deleted paths, ignore rules).
 */

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

export async function isIgnoredPath(
  root: string,
  filePath: string,
  ignorePatterns: string[],
  changeKind: string,
): Promise<boolean> {
  // Deleted paths may not exist in current working tree; keep them for historical accuracy.
  if (changeKind === 'D') return false;
  const rel = normalizePath(filePath);
  const mod = await import('fast-glob');
  const fgFn = (mod.default ?? mod) as (patterns: string[], opts: Record<string, unknown>) => Promise<string[]>;
  const matches = await fgFn([rel], { cwd: root, dot: true, onlyFiles: true, ignore: ignorePatterns });
  return matches.length === 0;
}

export async function parseCommitFilesFromOutputs(
  root: string,
  nameStatus: string,
  numstat: string,
  ignorePatterns: string[],
): Promise<Array<{ file_path: string; change_kind: string; additions: number | null; deletions: number | null }>> {
  const statsByPath = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const line of numstat.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    const addRaw = parts[0];
    const delRaw = parts[1];
    const file = normalizePath(parts[parts.length - 1] ?? '');
    if (!file) continue;
    statsByPath.set(file, {
      additions: addRaw === '-' ? null : Number(addRaw),
      deletions: delRaw === '-' ? null : Number(delRaw),
    });
  }

  const out: Array<{ file_path: string; change_kind: string; additions: number | null; deletions: number | null }> = [];
  for (const line of nameStatus.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t').filter(Boolean);
    if (parts.length < 2) continue;
    const kindRaw = parts[0] ?? 'M';
    const kind = kindRaw.charAt(0).toUpperCase();
    const file = normalizePath(parts[parts.length - 1] ?? '');
    if (!file) continue;
    if (await isIgnoredPath(root, file, ignorePatterns, kind)) continue;
    const st = statsByPath.get(file) ?? { additions: null, deletions: null };
    out.push({ file_path: file, change_kind: kind || 'M', additions: st.additions, deletions: st.deletions });
  }

  return out;
}
