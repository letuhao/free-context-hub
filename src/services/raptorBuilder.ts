import fs from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

import { compressText } from './distiller.js';
import { recordGeneratedExport, upsertGeneratedDocument } from './generatedDocs.js';
import { qaSummarize } from './qaAgent.js';
import { createModuleLogger } from '../utils/logger.js';

function toPosix(p: string) {
  return p.replace(/\\/g, '/');
}

function safeSlug(rel: string) {
  return rel.replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/-+/g, '-');
}

const logger = createModuleLogger('raptorBuilder');

export async function buildRaptorSummaries(input: {
  projectId: string;
  root: string;
  pathGlob?: string;
  maxLevels?: number;
  sourceJobId?: string;
  correlationId?: string;
}): Promise<{ status: 'ok'; written_files: string[]; files_scanned: number }> {
  const startedAt = Date.now();
  const maxLevels = Math.max(1, Math.min(Number(input.maxLevels ?? 2), 3));
  const glob = String(input.pathGlob ?? 'docs/**/*.md');
  logger.info({ project_id: input.projectId, root: input.root, path_glob: glob, max_levels: maxLevels }, 'raptor build started');

  const absRoot = path.resolve(input.root);
  const matches = await fg(glob, { cwd: absRoot, dot: false, onlyFiles: true, unique: true });
  logger.info({ files_matched: matches.length }, 'raptor files matched');

  const outDir = path.join(absRoot, 'docs', '.raptor');
  await fs.mkdir(outDir, { recursive: true });

  const written: string[] = [];
  const fileSummaries: Array<{ rel: string; summary: string }> = [];

  // Level 1: per-file summaries.
  for (let i = 0; i < matches.length; i++) {
    const rel = matches[i];
    if (i === 0 || i === matches.length - 1 || (i + 1) % 10 === 0) {
      logger.info({ level: 1, progress: `${i + 1}/${matches.length}`, file: rel }, 'raptor level1 progress');
    }
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
    const upserted = await upsertGeneratedDocument({
      projectId: input.projectId,
      docType: 'raptor',
      docKey: `level1/${safeSlug(rel)}`,
      title: `RAPTOR L1 ${toPosix(rel)}`,
      pathHint: outRel,
      content: md,
      metadata: { level: 1, source_relpath: toPosix(rel) },
      sourceJobId: input.sourceJobId,
      correlationId: input.correlationId,
    });
    await fs.writeFile(outAbs, md, 'utf8');
    await recordGeneratedExport({ docId: upserted.doc_id, exportPath: outRel, content: md });
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
    let dirIndex = 0;
    for (const [dir, items] of byDir.entries()) {
      dirIndex += 1;
      logger.info({ level: 2, progress: `${dirIndex}/${byDir.size}`, directory: dir, items: items.length }, 'raptor level2 progress');
      const ctx =
        `DIRECTORY: ${dir}\n\n` +
        items.map(it => `FILE: ${it.rel}\nSUMMARY:\n${it.summary}\n`).join('\n');
      const qaSummary = await qaSummarize({ text: ctx, maxChars: 2000 });
      const compressed = qaSummary ? { compressed: qaSummary } : await compressText({ text: ctx, maxOutputChars: 2000 });
      const outRel = toPosix(path.join('docs', '.raptor', 'level2', safeSlug(`${dir}.md`)));
      const outAbs = path.join(absRoot, outRel);
      await fs.mkdir(path.dirname(outAbs), { recursive: true });
      const md = `# RAPTOR L2 directory summary — ${dir}\n\nProject: \`${input.projectId}\`\n\n${compressed.compressed.trim()}\n`;
      const upserted = await upsertGeneratedDocument({
        projectId: input.projectId,
        docType: 'raptor',
        docKey: `level2/${safeSlug(`${dir}.md`)}`,
        title: `RAPTOR L2 ${dir}`,
        pathHint: outRel,
        content: md,
        metadata: { level: 2, directory: dir, items: items.length },
        sourceJobId: input.sourceJobId,
        correlationId: input.correlationId,
      });
      await fs.writeFile(outAbs, md, 'utf8');
      await recordGeneratedExport({ docId: upserted.doc_id, exportPath: outRel, content: md });
      written.push(toPosix(outRel));
    }
  }

  logger.info(
    { files_scanned: matches.length, written_files: written.length, duration_ms: Date.now() - startedAt },
    'raptor build completed',
  );
  return { status: 'ok', written_files: written, files_scanned: matches.length };
}

