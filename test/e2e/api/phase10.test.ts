/**
 * Layer 2 — Phase 10 Extraction Pipeline Tests (Sprint 10.6 T1-T4)
 *
 * Covers the full Phase 10 surface:
 *   - Happy-path flow: upload -> extract -> chunks -> update -> search -> delete
 *   - Chunk CRUD endpoints (PUT / DELETE with optimistic lock)
 *   - Chunk search service + validation (400 on bad chunk_type)
 *   - Global search chunks group
 *   - Vision-path smoke (async queue + progress + cancel) — SKIPPED unless
 *     LM Studio is reachable at EMBEDDINGS_BASE_URL + a vision model is
 *     configured. Controlled by SKIP_VISION_TESTS=false env var.
 *   - Bulk re-extract endpoint smoke
 *
 * These tests run against a live Docker stack — no mocks. Every test
 * cleans up after itself via the CleanupRegistry.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';
import { callTool } from '../shared/mcpClient.js';

const GROUP = 'phase10';

const SKIP_VISION = process.env.SKIP_VISION_TESTS !== 'false';

function phaseTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
  return async (ctx) => {
    const start = Date.now();
    try {
      await fn(ctx);
      return pass(name, GROUP, Date.now() - start);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes('SKIP:')) return skip(name, GROUP, msg.replace('SKIP: ', ''));
      return fail(name, GROUP, Date.now() - start, msg);
    }
  };
}

/** Upload a small markdown doc and return its doc_id.
 *  Uses markdown (not PDF) so fast extraction runs entirely in-process —
 *  no pandoc / vision dependencies needed for the happy path.
 *
 *  Each call gets a unique nonce so the content_hash dedupe (which
 *  returns 409 on identical uploads) doesn't collide when multiple
 *  tests call this helper in the same run. */
async function uploadMarkdownDoc(api: any, projectId: string, marker: string, cleanup: any): Promise<string> {
  const nonce = Math.random().toString(36).slice(2, 10);
  const content = `# Retry Strategy RFC ${marker}-${nonce}

## Context
This document describes the retry and backoff policy for all outbound HTTP calls.

## Decision
- Exponential backoff with base 1s, multiplier 2
- Maximum 3 retry attempts
- Retry on 5xx and network errors; never on 4xx

## Configuration

| Parameter   | Default | Description                  |
|-------------|---------|------------------------------|
| maxRetries  | 3       | Hard cap on attempts         |
| baseDelayMs | 1000    | Initial delay                |
| multiplier  | 2       | Exponential growth factor    |

## Consequences
Users see slower failures on persistent outages, but we avoid thundering herds.`;

  const blob = new Blob([content], { type: 'text/markdown' });
  const fd = new FormData();
  fd.append('file', blob, `phase10-${marker}-${nonce}.md`);
  fd.append('project_id', projectId);
  const r = await api.upload('/api/documents/upload', fd);
  expectStatus(r, 201);
  const docId = r.body?.doc_id ?? r.body?.document_id;
  if (!docId) throw new Error('upload returned no doc_id');
  cleanup.documentIds.push(docId);
  return docId;
}

/** Upload a fixture file. On content_hash collision (409 duplicate) the
 *  helper returns the existing doc_id from the response — which matches
 *  the real user experience of re-uploading the same file. */
async function uploadFixture(
  api: any,
  projectId: string,
  fixturePath: string,
  filename: string,
  mime: string,
  cleanup: any,
): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(fixturePath);
  } catch {
    throw new Error(`SKIP: ${fixturePath} not available`);
  }
  const blob = new Blob([bytes as any], { type: mime });
  const fd = new FormData();
  fd.append('file', blob, filename);
  fd.append('project_id', projectId);
  const r = await api.upload('/api/documents/upload', fd);

  // Duplicate: reuse existing doc_id, don't fail the test
  if (r.status === 409 && r.body?.status === 'duplicate' && r.body?.existing_doc_id) {
    // Don't add to cleanup — the doc existed before this test and may be
    // shared by other tests in the same run.
    return r.body.existing_doc_id as string;
  }
  if (r.status !== 201) {
    throw new Error(`fixture upload failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  const docId = r.body?.doc_id ?? r.body?.document_id;
  if (!docId) throw new Error('fixture upload returned no doc_id');
  cleanup.documentIds.push(docId);
  return docId;
}

async function uploadImageDoc(api: any, projectId: string, marker: string, cleanup: any): Promise<string> {
  return uploadFixture(
    api,
    projectId,
    path.resolve('test-data/sample.png'),
    `phase10-${marker}.png`,
    'image/png',
    cleanup,
  );
}

async function pollVisionJob(
  api: any,
  projectId: string,
  docId: string,
  maxWaitMs: number,
): Promise<{ status: string; pct: number; message: string; job_id: string }> {
  const deadline = Date.now() + maxWaitMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const r = await api.get(`/api/documents/${docId}/extraction-status?project_id=${projectId}`);
    expectStatus(r, 200);
    const job = r.body?.job;
    last = job;
    if (!job) throw new Error('no job row for doc');
    if (['succeeded', 'failed', 'cancelled', 'dead_letter'].includes(job.status)) {
      return {
        status: job.status,
        pct: job.progress_pct ?? 0,
        message: job.progress_message ?? '',
        job_id: job.job_id,
      };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`vision job did not terminate within ${maxWaitMs}ms (last: ${JSON.stringify(last).slice(0, 200)})`);
}

export const allPhase10Tests: TestFn[] = [
  // ──────────────────────────────────────────────────────────────────
  // T2 — Happy path: upload -> fast extract -> chunks -> edit -> delete
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase10-happy-path-fast-extract', async ({ api, projectId, runMarker, cleanup }) => {
    const docId = await uploadMarkdownDoc(api, projectId, runMarker, cleanup);

    // 1. Extract (fast mode — sync)
    const extractR = await api.post(`/api/documents/${docId}/extract`, {
      project_id: projectId,
      mode: 'fast',
    });
    expectStatus(extractR, 200);
    if (extractR.body?.status !== 'ok') throw new Error(`extract status: ${extractR.body?.status}`);
    const extractedChunks = extractR.body?.chunks ?? [];
    if (extractedChunks.length < 2) {
      throw new Error(`expected >=2 chunks from fast extract, got ${extractedChunks.length}`);
    }

    // Verify a table chunk is detected in the markdown fixture
    const hasTable = extractedChunks.some((c: any) => c.chunk_type === 'table');
    if (!hasTable) {
      throw new Error(`expected a table chunk in extracted chunks, got types: ${extractedChunks.map((c: any) => c.chunk_type).join(',')}`);
    }

    // 2. List chunks via GET — must return updated_at
    const listR = await api.get(`/api/documents/${docId}/chunks?project_id=${projectId}`);
    expectStatus(listR, 200);
    const chunks = listR.body?.chunks ?? [];
    if (chunks.length !== extractedChunks.length) {
      throw new Error(`list/extract chunk count mismatch: ${chunks.length} vs ${extractedChunks.length}`);
    }
    const firstChunk = chunks[0];
    if (!firstChunk.updated_at) throw new Error('chunk missing updated_at — Sprint 10.4 trigger regressed');

    // 3. Update chunk content with optimistic lock (should succeed)
    const editedContent = `EDITED by phase10 e2e test ${runMarker}`;
    const updR = await api.put(`/api/documents/${docId}/chunks/${firstChunk.chunk_id}`, {
      project_id: projectId,
      content: editedContent,
      expected_updated_at: firstChunk.updated_at,
    });
    expectStatus(updR, 200);
    if (updR.body?.status !== 'ok') throw new Error(`update status: ${updR.body?.status}`);
    const updatedChunk = updR.body?.chunk;
    if (updatedChunk?.content !== editedContent) {
      throw new Error(`updated content mismatch`);
    }
    // The returned updated_at must be a string (Sprint 10.4 Date->ISO fix)
    if (typeof updatedChunk?.updated_at !== 'string') {
      throw new Error(`updated_at not normalized to string: ${typeof updatedChunk?.updated_at}`);
    }

    // 4. Stale timestamp should 409
    const staleR = await api.put(`/api/documents/${docId}/chunks/${firstChunk.chunk_id}`, {
      project_id: projectId,
      content: 'stale edit',
      expected_updated_at: firstChunk.updated_at, // old TS
    });
    if (staleR.status !== 409) {
      throw new Error(`expected 409 for stale TS, got ${staleR.status}`);
    }

    // 5. Delete a chunk
    const deleteR = await api.delete(`/api/documents/${docId}/chunks/${chunks[1].chunk_id}?project_id=${projectId}`);
    expectStatus(deleteR, 200);

    // 6. Verify count decreased
    const listR2 = await api.get(`/api/documents/${docId}/chunks?project_id=${projectId}`);
    expectStatus(listR2, 200);
    if ((listR2.body?.chunks ?? []).length !== chunks.length - 1) {
      throw new Error(`chunk count after delete mismatch`);
    }

    // 7. Cascade: delete the doc, chunks should vanish
    const delDocR = await api.delete(`/api/documents/${docId}?project_id=${projectId}`);
    expectStatus(delDocR, 200);
    cleanup.documentIds = cleanup.documentIds.filter((id: string) => id !== docId);

    const afterR = await api.get(`/api/documents/${docId}/chunks?project_id=${projectId}`);
    // Either 404 or empty chunks — both acceptable
    if (afterR.status === 200 && (afterR.body?.chunks ?? []).length > 0) {
      throw new Error('chunks not cascaded on doc delete');
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // T2b — Chunk search happy path
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase10-chunk-search-hybrid', async ({ api, projectId, runMarker, cleanup }) => {
    const docId = await uploadMarkdownDoc(api, projectId, runMarker, cleanup);

    await api.post(`/api/documents/${docId}/extract`, {
      project_id: projectId,
      mode: 'fast',
    });

    // Semantic query
    const sR = await api.post('/api/documents/chunks/search', {
      project_id: projectId,
      query: 'exponential backoff retry policy',
      limit: 5,
    });
    expectStatus(sR, 200);
    const matches = sR.body?.matches ?? [];
    if (matches.length === 0) throw new Error('chunk search returned zero matches');
    const top = matches[0];
    if (typeof top.score !== 'number' || top.score <= 0) {
      throw new Error(`top score invalid: ${top.score}`);
    }
    if (!top.doc_name || !top.doc_name.includes(runMarker)) {
      throw new Error(`top match doc_name doesn't reference our test doc: ${top.doc_name}`);
    }
    // Explanations should mention hybrid (or semantic only / fts only fallback)
    if (!Array.isArray(sR.body?.explanations)) {
      throw new Error('explanations missing');
    }

    // Filter: tables only
    const tR = await api.post('/api/documents/chunks/search', {
      project_id: projectId,
      query: 'retry parameters',
      limit: 5,
      chunk_types: ['table'],
    });
    expectStatus(tR, 200);
    const tableMatches = tR.body?.matches ?? [];
    for (const m of tableMatches) {
      if (m.chunk_type !== 'table') {
        throw new Error(`filter leaked non-table chunk: ${m.chunk_type}`);
      }
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // T2c — Validation: bad chunk_type returns 400
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase10-chunk-search-invalid-type-400', async ({ api, projectId }) => {
    const r = await api.post('/api/documents/chunks/search', {
      project_id: projectId,
      query: 'anything',
      chunk_types: ['evil'],
    });
    if (r.status !== 400) {
      throw new Error(`expected 400 for bad chunk_type, got ${r.status}`);
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // T2d — Empty query rejected
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase10-chunk-search-empty-query-400', async ({ api, projectId }) => {
    const r = await api.post('/api/documents/chunks/search', {
      project_id: projectId,
      query: '   ',
    });
    if (r.status !== 400) {
      throw new Error(`expected 400 for empty query, got ${r.status}`);
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // T4 — Global search includes chunks group
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase10-global-search-chunks-group', async ({ api, projectId, runMarker, cleanup }) => {
    const docId = await uploadMarkdownDoc(api, projectId, runMarker, cleanup);
    await api.post(`/api/documents/${docId}/extract`, {
      project_id: projectId,
      mode: 'fast',
    });

    const r = await api.get(`/api/search/global?project_id=${projectId}&q=retry&limit=5`);
    expectStatus(r, 200);
    if (!Array.isArray(r.body?.chunks)) {
      throw new Error('global search response missing chunks array');
    }
    if (r.body.chunks.length === 0) {
      throw new Error('global search returned zero chunks for "retry"');
    }
    // Each chunk entry must have doc_name and chunk_type
    const c = r.body.chunks[0];
    if (!c.doc_name || !c.chunk_type) {
      throw new Error(`global search chunk missing doc_name/chunk_type: ${JSON.stringify(c)}`);
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // T2e — Thumbnail endpoint (image doc) — Sprint 10.5 perf fix
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase10-image-thumbnail-endpoint', async ({ api, projectId, runMarker, cleanup }) => {
    let docId: string;
    try {
      docId = await uploadImageDoc(api, projectId, runMarker, cleanup);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.startsWith('SKIP:')) throw err;
      throw err;
    }

    const r = await api.get(`/api/documents/${docId}/thumbnail?project_id=${projectId}`);
    if (r.status !== 200) {
      throw new Error(`thumbnail returned ${r.status} instead of 200`);
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // T3 — Vision async flow + cancel (skipped unless SKIP_VISION_TESTS=false)
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase10-vision-async-flow', async ({ api, projectId, runMarker, cleanup }) => {
    if (SKIP_VISION) throw new Error('SKIP: set SKIP_VISION_TESTS=false and start LM Studio to run vision tests');

    const docId = await uploadFixture(
      api,
      projectId,
      path.resolve('test-data/sample.pdf'),
      `phase10-vision-${runMarker}.pdf`,
      'application/pdf',
      cleanup,
    );

    // Estimate
    const estR = await api.post(`/api/documents/${docId}/extract/estimate`, {
      project_id: projectId,
      mode: 'vision',
    });
    expectStatus(estR, 200);
    if (typeof estR.body?.page_count !== 'number' || estR.body.page_count < 1) {
      throw new Error(`estimate page_count invalid: ${estR.body?.page_count}`);
    }

    // Queue async vision
    const qR = await api.post(`/api/documents/${docId}/extract`, {
      project_id: projectId,
      mode: 'vision',
      prompt_template: 'default',
    });
    if (qR.status !== 202) throw new Error(`vision queue expected 202, got ${qR.status}`);
    if (qR.body?.status !== 'queued') throw new Error('vision response not queued');

    // Poll to completion (up to 180s for 3 pages)
    const term = await pollVisionJob(api, projectId, docId, 180_000);
    if (term.status !== 'succeeded') {
      throw new Error(`vision job did not succeed: status=${term.status} msg=${term.message}`);
    }
    if (term.pct !== 100) {
      throw new Error(`vision succeeded but pct != 100: ${term.pct}`);
    }

    // Chunks should exist and be typed
    const cR = await api.get(`/api/documents/${docId}/chunks?project_id=${projectId}`);
    expectStatus(cR, 200);
    const chunks = cR.body?.chunks ?? [];
    if (chunks.length === 0) throw new Error('vision produced zero chunks');
    const visionChunks = chunks.filter((c: any) => c.extraction_mode === 'vision');
    if (visionChunks.length === 0) throw new Error('no chunks marked extraction_mode=vision');
  }),

  // ──────────────────────────────────────────────────────────────────
  // T3b — Vision cancel flow
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase10-vision-cancel-flow', async ({ api, projectId, runMarker, cleanup }) => {
    if (SKIP_VISION) throw new Error('SKIP: set SKIP_VISION_TESTS=false and start LM Studio to run vision tests');

    const docId = await uploadFixture(
      api,
      projectId,
      path.resolve('test-data/sample.pdf'),
      `phase10-cancel-${runMarker}.pdf`,
      'application/pdf',
      cleanup,
    );

    const qR = await api.post(`/api/documents/${docId}/extract`, {
      project_id: projectId,
      mode: 'vision',
    });
    if (qR.status !== 202) throw new Error(`queue failed: ${qR.status}`);
    const jobId = qR.body?.job_id;
    if (!jobId) throw new Error('no job_id on vision queue');

    // Cancel quickly — worker may or may not have started processing
    await new Promise((r) => setTimeout(r, 500));
    const cancelR = await api.post(`/api/documents/${docId}/jobs/${jobId}/cancel`, {
      project_id: projectId,
    });
    // Either 200 (successfully cancelled a running/queued job) or 409
    // (worker already finished — race, acceptable)
    if (cancelR.status !== 200 && cancelR.status !== 409) {
      throw new Error(`cancel returned unexpected ${cancelR.status}`);
    }

    // Cross-tenant attempt with bogus project should also return 409
    const crossR = await api.post(`/api/documents/${docId}/jobs/${jobId}/cancel`, {
      project_id: 'definitely-not-a-real-project-' + runMarker,
    });
    // May 400 (project_id not found) or 409 (not cancellable in that tenant)
    if (crossR.status < 400) {
      throw new Error(`cross-tenant cancel should fail, got ${crossR.status}`);
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // T3c — Bulk re-extract endpoint smoke (Sprint 10.6 P5)
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase10-bulk-extract-smoke', async ({ api, projectId, runMarker, cleanup }) => {
    if (SKIP_VISION) throw new Error('SKIP: set SKIP_VISION_TESTS=false to exercise bulk vision extraction');

    await uploadFixture(
      api,
      projectId,
      path.resolve('test-data/sample.pdf'),
      `phase10-bulk-${runMarker}.pdf`,
      'application/pdf',
      cleanup,
    );

    const r = await api.post('/api/documents/bulk-extract', {
      project_id: projectId,
    });
    if (r.status !== 202) throw new Error(`bulk-extract expected 202, got ${r.status}`);
    if (typeof r.body?.queued !== 'number' || r.body.queued < 1) {
      throw new Error(`expected >=1 queued job, got ${r.body?.queued}`);
    }
    if (!Array.isArray(r.body?.jobs)) {
      throw new Error('jobs array missing');
    }
  }),

  // ──────────────────────────────────────────────────────────────────
  // T4b — MCP chunk search tool smoke (registered via MCP server)
  // ──────────────────────────────────────────────────────────────────
  phaseTest('phase10-mcp-chunk-search-tool', async ({ api, projectId, runMarker, cleanup, mcp }) => {
    if (!mcp) throw new Error('SKIP: MCP client not available in test context');

    const docId = await uploadMarkdownDoc(api, projectId, runMarker, cleanup);
    await api.post(`/api/documents/${docId}/extract`, {
      project_id: projectId,
      mode: 'fast',
    });

    // Call MCP tool — extractJson returns { matches, explanations } directly
    let res: any;
    try {
      res = await callTool(mcp, 'search_document_chunks', {
        project_id: projectId,
        query: 'retry backoff policy',
        limit: 5,
      });
    } catch (err) {
      throw new Error(`MCP search_document_chunks call failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res || !Array.isArray(res.matches)) {
      throw new Error(`MCP tool response missing matches array: ${JSON.stringify(res).slice(0, 300)}`);
    }
    if (res.matches.length === 0) {
      throw new Error('MCP chunk search returned zero matches for seeded doc');
    }
  }),
];
