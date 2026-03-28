/**
 * Execute ripgrep on disk for exact/literal code search.
 * This is the fastest and most accurate search tier — deterministic, no AI.
 */
import { execFile } from 'node:child_process';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('ripgrep');

export type RipgrepMatch = {
  file_path: string;       // relative to root
  line_number: number;
  line_content: string;
};

export type RipgrepResult = {
  matches: RipgrepMatch[];
  files: string[];          // unique file paths
  duration_ms: number;
  truncated: boolean;       // true if max_files was hit
};

/**
 * Search for a literal string (fixed-string mode) across the workspace.
 * Returns matching files + line numbers.
 */
export async function ripgrepLiteral(opts: {
  root: string;
  pattern: string;
  /** Glob patterns to exclude (e.g., ['node_modules/**', '.git/**']). */
  ignore?: string[];
  /** Max files to return. Default 100. */
  maxFiles?: number;
  /** Timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Max lines per file to capture. Default 3. */
  maxLinesPerFile?: number;
}): Promise<RipgrepResult> {
  const start = Date.now();
  const maxFiles = opts.maxFiles ?? 100;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const maxLinesPerFile = opts.maxLinesPerFile ?? 3;

  const args = [
    '--no-heading',
    '--line-number',
    '--fixed-strings',
    '--max-count', String(maxLinesPerFile),
    '--color', 'never',
    // Limit total output to prevent huge results
    '--max-filesize', '1M',
  ];

  // Add ignore patterns.
  for (const ig of (opts.ignore ?? ['node_modules/**', '.git/**', 'dist/**', '*.lock'])) {
    args.push('--glob', `!${ig}`);
  }

  args.push('--', opts.pattern, '.');

  return new Promise<RipgrepResult>((resolve) => {
    const child = execFile('rg', args, {
      cwd: opts.root,
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024, // 5MB
      encoding: 'utf8',
    }, (error, stdout) => {
      const duration_ms = Date.now() - start;

      // rg exits with 1 when no matches found — that's not an error.
      if (error && (error as any).code !== 1 && (error as any).killed !== true) {
        logger.warn({ pattern: opts.pattern, error: error.message, duration_ms }, 'ripgrep error');
      }

      const lines = (stdout ?? '').split('\n').filter(Boolean);
      const matches: RipgrepMatch[] = [];
      const fileSet = new Set<string>();

      for (const line of lines) {
        // Format: ./relative/path.ts:42:line content
        const firstColon = line.indexOf(':');
        if (firstColon < 0) continue;
        const secondColon = line.indexOf(':', firstColon + 1);
        if (secondColon < 0) continue;

        let filePath = line.slice(0, firstColon);
        // Normalize: remove leading ./
        if (filePath.startsWith('./')) filePath = filePath.slice(2);
        filePath = filePath.replace(/\\/g, '/');

        const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10);
        if (isNaN(lineNum)) continue;

        const lineContent = line.slice(secondColon + 1);

        if (fileSet.size >= maxFiles && !fileSet.has(filePath)) continue;
        fileSet.add(filePath);
        matches.push({ file_path: filePath, line_number: lineNum, line_content: lineContent.trim() });
      }

      resolve({
        matches,
        files: Array.from(fileSet),
        duration_ms,
        truncated: fileSet.size >= maxFiles,
      });
    });

    // Safety: kill if timeout exceeded (execFile timeout should handle this, but belt & suspenders).
    setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }, timeoutMs + 500);
  });
}

/**
 * Search for multiple patterns in parallel and merge results.
 * Returns files ranked by number of pattern hits (more patterns match = higher rank).
 */
export async function ripgrepMultiPattern(opts: {
  root: string;
  patterns: string[];
  ignore?: string[];
  maxFiles?: number;
  timeoutMs?: number;
}): Promise<{
  files: Array<{ path: string; hit_count: number; sample_lines: string[] }>;
  duration_ms: number;
}> {
  const start = Date.now();
  if (!opts.patterns.length) return { files: [], duration_ms: 0 };

  // Dedupe patterns and limit to 10 to control latency.
  const patterns = Array.from(new Set(opts.patterns)).slice(0, 10);

  const results = await Promise.allSettled(
    patterns.map(p => ripgrepLiteral({
      root: opts.root,
      pattern: p,
      ignore: opts.ignore,
      maxFiles: opts.maxFiles ?? 100,
      timeoutMs: opts.timeoutMs ?? 5000,
      maxLinesPerFile: 2,
    })),
  );

  // Merge: count how many patterns each file matches.
  const fileHits = new Map<string, { count: number; lines: string[] }>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const seenInThisPattern = new Set<string>();
    for (const m of r.value.matches) {
      if (!seenInThisPattern.has(m.file_path)) {
        seenInThisPattern.add(m.file_path);
        const entry = fileHits.get(m.file_path) ?? { count: 0, lines: [] };
        entry.count += 1;
        if (entry.lines.length < 3) entry.lines.push(m.line_content);
        fileHits.set(m.file_path, entry);
      }
    }
  }

  // Sort by hit count (most patterns matched first), then alphabetically.
  const files = Array.from(fileHits.entries())
    .map(([path, v]) => ({ path, hit_count: v.count, sample_lines: v.lines }))
    .sort((a, b) => b.hit_count - a.hit_count || a.path.localeCompare(b.path));

  return { files, duration_ms: Date.now() - start };
}
