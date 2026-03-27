import fs from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

import { compressText } from './distiller.js';
import { qaSummarize } from './qaAgent.js';

function toPosix(p: string) {
  return p.replace(/\\/g, '/');
}

function safeSlug(rel: string) {
  return rel.replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/-+/g, '-');
}

export async function buildRaptorSummaries(input: {
  projectId: string;
  root: string;
  pathGlob?: string;
  maxLevels?: number;
}): Promise<{ status: 'ok'; written_files: string[]; files_scanned: number }> {
  const maxLevels = Math.max(1, Math.min(Number(input.maxLevels ?? 2), 3));
  const glob = String(input.pathGlob ?? 'docs/**/*.md');

  const absRoot = path.resolve(input.root);
  const matches = await fg(glob, { cwd: absRoot, dot: false, onlyFiles: true, unique: true });

  const outDir = path.join(absRoot, 'docs', '.raptor');
  await fs.mkdir(outDir, { recursive: true });

  const written: string[] = [];
  const fileSummaries: Array<{ rel: string; summary: string }> = [];

  // Level 1: per-file summaries.
  for (const rel of matches) {
    const abs = path.join(absRoot, rel);
    const raw = await fs.readFile(abs, 'utf8').catch(() => '');
    if (!raw.trim()) continue;
    const qaSummary = await qaSummarize({ text: raw, maxChars: 1800 });
    const compressed = qaSummary ? { compressed: qaSummary } : await compressText({ text: raw, maxOutputChars: 1800 });
    const summary = compressed.compressed.trim();
    const outRel = toPosix(path.join('docs', '.raptor', 'level1', safeSlug(rel)));
    const outAbs = path.join(absRoot, outRel);
    await fs.mkdir(path.dirname(outAbs), { recursive: true });
    const md = `# RAPTOR L1 summary — ${toPosix(rel)}\n\nProject: \`${input.projectId}\`\n\n${summary}\n`;
    await fs.writeFile(outAbs, md, 'utf8');
    written.push(toPosix(outRel));
    fileSummaries.push({ rel: toPosix(rel), summary });
  }

  if (maxLevels >= 2 && fileSummaries.length) {
    // Level 2: per-directory summaries over L1.
    const byDir = new Map<string, Array<{ rel: string; summary: string }>>();
    for (const s of fileSummaries) {
      const dir = path.posix.dirname(s.rel);
      const arr = byDir.get(dir) ?? [];
      arr.push(s);
      byDir.set(dir, arr);
    }
    for (const [dir, items] of byDir.entries()) {
      const ctx =
        `DIRECTORY: ${dir}\n\n` +
        items.map(it => `FILE: ${it.rel}\nSUMMARY:\n${it.summary}\n`).join('\n');
      const qaSummary = await qaSummarize({ text: ctx, maxChars: 2000 });
      const compressed = qaSummary ? { compressed: qaSummary } : await compressText({ text: ctx, maxOutputChars: 2000 });
      const outRel = toPosix(path.join('docs', '.raptor', 'level2', safeSlug(`${dir}.md`)));
      const outAbs = path.join(absRoot, outRel);
      await fs.mkdir(path.dirname(outAbs), { recursive: true });
      const md = `# RAPTOR L2 directory summary — ${dir}\n\nProject: \`${input.projectId}\`\n\n${compressed.compressed.trim()}\n`;
      await fs.writeFile(outAbs, md, 'utf8');
      written.push(toPosix(outRel));
    }
  }

  return { status: 'ok', written_files: written, files_scanned: matches.length };
}

