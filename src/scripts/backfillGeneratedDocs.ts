import * as dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';
import { upsertGeneratedDocument } from '../services/generatedDocs.js';

dotenv.config();

function toPosix(p: string) {
  return p.replace(/\\/g, '/');
}

async function main() {
  const projectId = process.env.BACKFILL_PROJECT_ID ?? process.env.DEFAULT_PROJECT_ID ?? 'free-context-hub';
  const root = path.resolve(process.env.BACKFILL_ROOT ?? process.cwd());

  const faqFiles = await fg('docs/faq/**/*.md', { cwd: root, onlyFiles: true, dot: false });
  const raptorFiles = await fg('docs/.raptor/**/*.md', { cwd: root, onlyFiles: true, dot: false });

  let count = 0;
  for (const rel of [...faqFiles, ...raptorFiles]) {
    const abs = path.join(root, rel);
    const content = await fs.readFile(abs, 'utf8').catch(() => '');
    if (!content.trim()) continue;
    const posix = toPosix(rel);
    const docType = posix.startsWith('docs/faq/') ? 'faq' : 'raptor';
    const docKey = posix.replace(/^docs\//, '').replace(/\.md$/, '');
    await upsertGeneratedDocument({
      projectId,
      docType,
      docKey,
      title: `Backfill ${docType}: ${docKey}`,
      pathHint: posix,
      content,
      metadata: { backfilled: true, source: posix },
    });
    count += 1;
  }

  console.log(`[backfill-generated-docs] project=${projectId} root=${toPosix(root)} count=${count}`);
}

main().catch(err => {
  console.error('[backfill-generated-docs] failed', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

