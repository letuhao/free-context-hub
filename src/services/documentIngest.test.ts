/**
 * M1 / FIX-3 — ingestUrlAsDocument unit tests (real test DB, injected fetcher).
 *
 * Design ref: docs/specs/2026-06-22-m1-mcp-ingest-document-design.md §4
 *
 * Covers: created path, content_hash dedup, binary base64 encoding, and the
 * security-critical "authorize BEFORE fetch" ordering (auth-ON cross-tenant
 * reject must not even call the fetcher).
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { ingestUrlAsDocument } from './documentIngest.js';
import { createPrincipal } from './principals.js';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import type { FetchResult } from './urlFetch.js';

const PREFIX = '__test_doc_ingest__';
const P = `${PREFIX}projP`;
const Q = `${PREFIX}projQ`;

const savedAuth = process.env.MCP_AUTH_ENABLED;
async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}

/** Build a stub fetcher that returns fixed bytes and counts its invocations. */
function stubFetcher(opts: { text?: string; docType?: string; filename?: string; finalUrl?: string }) {
  const state = { calls: 0 };
  const fetcher = async (_url: string): Promise<FetchResult> => {
    state.calls++;
    return {
      buffer: Buffer.from(opts.text ?? 'hello world', 'utf-8'),
      mimeType: 'text/plain',
      docType: opts.docType ?? 'text',
      filename: opts.filename ?? 'doc.txt',
      finalUrl: opts.finalUrl ?? 'http://example.test/doc.txt',
    };
  };
  return { fetcher, state };
}

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM documents WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

before(async () => { await setAuth(false); await cleanup(); });
beforeEach(cleanup);
after(async () => {
  await cleanup();
  process.env.MCP_AUTH_ENABLED = savedAuth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

test('created: ingests a text URL into a new document', async () => {
  const { fetcher } = stubFetcher({ text: 'alpha beta', docType: 'text', filename: 'a.txt', finalUrl: 'http://x.test/a.txt' });
  const r = await ingestUrlAsDocument({ projectId: P, sourceUrl: 'http://x.test/a.txt', fetcher });
  assert.equal(r.status, 'created');
  if (r.status !== 'created') return;
  assert.equal(r.document.doc_type, 'text');
  assert.equal(r.document.url, 'http://x.test/a.txt');
  assert.equal(r.document.content, 'alpha beta');
  assert.equal(r.document.name, 'a.txt');
});

test('duplicate: same bytes in the same project return duplicate, no second row', async () => {
  const first = stubFetcher({ text: 'same bytes', finalUrl: 'http://x.test/1.txt', filename: '1.txt' });
  const a = await ingestUrlAsDocument({ projectId: P, sourceUrl: 'http://x.test/1.txt', fetcher: first.fetcher });
  assert.equal(a.status, 'created');

  // A different URL/name but identical bytes → same content_hash → duplicate.
  const second = stubFetcher({ text: 'same bytes', finalUrl: 'http://x.test/2.txt', filename: '2.txt' });
  const b = await ingestUrlAsDocument({ projectId: P, sourceUrl: 'http://x.test/2.txt', fetcher: second.fetcher });
  assert.equal(b.status, 'duplicate');
  if (b.status !== 'duplicate') return;
  assert.ok(b.existing_doc_id, 'duplicate carries the existing doc id');

  const pool = getDbPool();
  const count = await pool.query(`SELECT count(*)::int AS n FROM documents WHERE project_id = $1`, [P]);
  assert.equal(count.rows[0].n, 1, 'only one row stored');
});

test('binary docType is stored base64-encoded', async () => {
  const { fetcher } = stubFetcher({ text: '%PDF-1.4 fake', docType: 'pdf', filename: 'f.pdf', finalUrl: 'http://x.test/f.pdf' });
  const r = await ingestUrlAsDocument({ projectId: P, sourceUrl: 'http://x.test/f.pdf', fetcher });
  assert.equal(r.status, 'created');
  if (r.status !== 'created') return;
  assert.equal(r.document.doc_type, 'pdf');
  assert.ok(r.document.content?.startsWith('data:base64;'), 'pdf stored as base64 data uri');
});

test('SECURITY: auth-ON unauthorized caller is rejected BEFORE the fetch runs', async () => {
  await setAuth(true);
  try {
    const principal = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}nogrants` })).principal_id;
    const { fetcher, state } = stubFetcher({ text: 'secret probe' });
    // principal has NO grant on project Q → write must be denied.
    await assert.rejects(
      ingestUrlAsDocument({ projectId: Q, actingPrincipalId: principal, sourceUrl: 'http://x.test/p.txt', fetcher }),
      (e: unknown) => e instanceof ContextHubError && (e.code === 'FORBIDDEN' || e.code === 'NOT_FOUND'),
    );
    assert.equal(state.calls, 0, 'the fetcher must NOT be called for an unauthorized caller (authz before fetch)');
  } finally {
    await setAuth(false);
  }
});
