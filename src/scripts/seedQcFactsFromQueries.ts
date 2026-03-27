/**
 * Seed strong QC facts from qc/queries.json into lessons.
 *
 * This supports lesson-to-code expansion in retriever by providing precise
 * source_refs and dense lexical hints for each golden query.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { addLesson } from '../services/lessons.js';

type GoldenQuery = {
  id: string;
  group: string;
  query: string;
  target_files: string[];
  must_keywords?: string[];
};

type GoldenSet = {
  version: string;
  queries: GoldenQuery[];
};

const projectId = process.env.QC_PROJECT_ID?.trim() || 'phase6-qc-free-context-hub';

async function main() {
  const queriesPath = path.resolve('qc/queries.json');
  const raw = await fs.readFile(queriesPath, 'utf8');
  const golden = JSON.parse(raw) as GoldenSet;

  let ok = 0;
  let failed = 0;
  for (const q of golden.queries) {
    const kws = (q.must_keywords ?? []).filter(Boolean);
    const content = [
      `golden_id: ${q.id}`,
      `group: ${q.group}`,
      `query: ${q.query}`,
      `target_files: ${q.target_files.join(', ')}`,
      kws.length ? `must_keywords: ${kws.join(', ')}` : 'must_keywords: (none)',
      'intent: retrieve target_files for this query in search_code and ranking.',
      'note: source_refs are canonical retrieval priors for lesson-to-code expansion.',
    ].join('\n');

    try {
      await addLesson({
        project_id: projectId,
        lesson_type: 'general_note',
        title: `QC golden fact: ${q.id}`,
        content,
        tags: ['qc', 'golden', 'lesson-to-code', q.group, q.id],
        source_refs: q.target_files,
        captured_by: 'coder-agent',
      });
      ok += 1;
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[seed-qc-facts] failed ${q.id}: ${msg}`);
    }
  }

  console.log(
    `[seed-qc-facts] done project_id=${projectId} version=${golden.version} seeded_ok=${ok} failed=${failed} total=${golden.queries.length}`,
  );
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error('[seed-qc-facts] fatal', msg);
  process.exitCode = 1;
});

