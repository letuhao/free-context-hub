/**
 * DEFERRED-032 — ingest the ai-engineering corpus into free-context-hub.
 *
 * Drives the REAL ingestion path (the same HTTP API a user would use) over the
 * 8 `corpus/ai-engineering/*.md` docs so the gen-eval run measures grounded RAG:
 *   1. DELETE any prior doc with the same `corpus:<name>` (idempotent re-ingest).
 *   2. POST /api/documents  → create the doc with markdown content.
 *   3. POST /api/documents/:id/extract {mode:'fast', template:'hierarchical'}
 *      → chunk + bge-m3 embed; logs chunk_count.
 *
 * Usage:
 *   API_BASE_URL=http://127.0.0.1:3001 npx tsx src/qc/ingestCorpus.ts
 *   (optional) CORPUS_DIR=corpus/ai-engineering  PROJECT_ID=free-context-hub
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const API = (process.env.API_BASE_URL?.trim() || 'http://127.0.0.1:3001').replace(/\/$/, '');
const PROJECT = process.env.PROJECT_ID?.trim() || 'free-context-hub';
const CORPUS_DIR = process.env.CORPUS_DIR?.trim() || 'corpus/ai-engineering';
/** Stable name prefix so re-ingest can find + delete the prior copies. */
const NAME_PREFIX = 'corpus:ai-engineering/';

async function api(method: string, route: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }
  if (!res.ok) {
    throw new Error(`${method} ${route} → HTTP ${res.status}: ${(text || '').slice(0, 300)}`);
  }
  return json;
}

async function deleteExisting(): Promise<number> {
  const list = await api('GET', `/api/documents?project_id=${encodeURIComponent(PROJECT)}&limit=500`);
  const docs: any[] = Array.isArray(list) ? list : (list?.documents ?? list?.items ?? []);
  const mine = docs.filter((d) => typeof d?.name === 'string' && d.name.startsWith(NAME_PREFIX));
  for (const d of mine) {
    const id = d.doc_id ?? d.id;
    await api('DELETE', `/api/documents/${id}?project_id=${encodeURIComponent(PROJECT)}`);
    console.log(`  deleted prior doc ${id} (${d.name})`);
  }
  return mine.length;
}

async function main() {
  console.log(`[ingest] API=${API} project=${PROJECT} dir=${CORPUS_DIR}`);
  const files = (await fs.readdir(CORPUS_DIR)).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) throw new Error(`no .md files in ${CORPUS_DIR}`);

  console.log(`[ingest] clearing prior corpus docs...`);
  const deleted = await deleteExisting();
  console.log(`[ingest] removed ${deleted} prior doc(s)`);

  let totalChunks = 0;
  for (const f of files) {
    const name = `${NAME_PREFIX}${f.replace(/\.md$/, '')}`;
    const content = await fs.readFile(path.join(CORPUS_DIR, f), 'utf-8');
    const created = await api('POST', '/api/documents', {
      project_id: PROJECT,
      name,
      doc_type: 'markdown',
      content,
      description: 'DEFERRED-032 ai-engineering corpus',
      tags: ['corpus', 'ai-engineering', 'deferred-032'],
    });
    const docId = created.doc_id ?? created.id ?? created.document?.doc_id;
    if (!docId) throw new Error(`create returned no doc_id for ${name}: ${JSON.stringify(created).slice(0, 200)}`);

    const extracted = await api('POST', `/api/documents/${docId}/extract`, {
      project_id: PROJECT,
      mode: 'fast',
      template: 'hierarchical',
    });
    // runExtraction returns { status:'ok', mode, chunks: DocumentChunk[], pages }.
    const n = Array.isArray(extracted.chunks) ? extracted.chunks.length : (extracted.chunk_count ?? 0);
    totalChunks += n;
    console.log(`  ✓ ${name} → doc ${docId}, status=${extracted.status ?? '?'}, chunks=${n}`);
  }

  console.log(`\n[ingest] done: ${files.length} docs, ${totalChunks} chunks total.`);
}

main().catch((e) => {
  console.error('[ingest] FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
