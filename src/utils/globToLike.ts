export function globToSqlLike(glob: string): string {
  // Convert a minimal subset of glob to SQL LIKE:
  // - '*' and '**' => '%'
  // - '?' => '_'
  // Note: We keep this MVP-simple; it is intended for path filters only.
  const normalized = glob.replaceAll('\\', '/');
  let out = normalized;
  out = out.replaceAll('**', '%');
  out = out.replaceAll('*', '%');
  out = out.replaceAll('?', '_');

  // LIKE patterns shouldn't be raw; we assume input comes from trusted config/tool args.
  return out;
}

