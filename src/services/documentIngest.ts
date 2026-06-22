/**
 * M1 / FIX-3 — shared URL→document ingestion.
 *
 * Lifts the fetch → hash → dedup → createDocument flow out of the REST
 * /api/documents/ingest-url handler so the MCP `ingest_document` tool and the
 * REST route share ONE implementation (no duplicated SSRF/dedup logic).
 *
 * Design ref: docs/specs/2026-06-22-m1-mcp-ingest-document-design.md
 *
 * Security (design §5):
 *  - Project-write authorization is asserted FIRST — before any outbound fetch or
 *    dedup query — so an unauthorized caller can neither use the fetcher as an
 *    SSRF proxy nor probe another project's content_hash existence via the
 *    'duplicate' response. (The inline REST flow asserted only inside
 *    createDocument, AFTER the dedup SELECT; this service closes that gap and the
 *    refactored route inherits the fix.)
 *  - The outbound fetch stays the SSRF-hardened fetchUrlAsDocument (IP pinning,
 *    redirect re-check, private-range reject, size cap, MIME allowlist).
 */

import { createHash } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { assertAuthorized } from './authorize.js';
import { createDocument, type Document } from './documents.js';
import { fetchUrlAsDocument, type FetchResult } from './urlFetch.js';

/** docTypes stored base64-encoded (matches /upload + the REST ingest-url path). */
const BINARY_DOC_TYPES = ['pdf', 'docx', 'image', 'epub', 'odt', 'rtf'];

/** Filename sanitization shared with the upload route (control chars, traversal). */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\x00-\x1f\x7f]/g, '') // control chars
    .replace(/\.\.+/g, '_')          // .. → _
    .replace(/[\\/]/g, '_')          // path separators → _
    .replace(/^\.+/, '')             // leading dots
    .slice(0, 255)
    .trim() || 'unnamed';
}

export type IngestUrlResult =
  | { status: 'created'; document: Document }
  | { status: 'duplicate'; existing_doc_id: string; existing_name: string; existing_uploaded_at: string };

export async function ingestUrlAsDocument(params: {
  projectId: string;
  actingPrincipalId?: string | null;
  sourceUrl: string;
  name?: string;
  description?: string;
  tags?: string[];
  /** Injectable for tests; defaults to the real SSRF-hardened fetcher. */
  fetcher?: (url: string) => Promise<FetchResult>;
}): Promise<IngestUrlResult> {
  // 1. Authorize BEFORE fetching or probing (design §5) — fail closed.
  await assertAuthorized(params.actingPrincipalId, 'write', { kind: 'project', id: params.projectId });

  const fetch = params.fetcher ?? fetchUrlAsDocument;
  const fetched = await fetch(params.sourceUrl);

  const name = sanitizeFilename(
    params.name && params.name.trim() ? params.name.trim() : fetched.filename,
  );
  const contentHash = createHash('sha256').update(fetched.buffer).digest('hex');

  const pool = getDbPool();
  const dup = await pool.query<{ doc_id: string; name: string; created_at: string }>(
    `SELECT doc_id, name, created_at FROM documents
      WHERE project_id = $1 AND content_hash = $2 LIMIT 1`,
    [params.projectId, contentHash],
  );
  if (dup.rows.length > 0) {
    const e = dup.rows[0];
    return { status: 'duplicate', existing_doc_id: e.doc_id, existing_name: e.name, existing_uploaded_at: e.created_at };
  }

  const isBinary = BINARY_DOC_TYPES.includes(fetched.docType);
  const content = isBinary
    ? `data:base64;${fetched.buffer.toString('base64')}`
    : fetched.buffer.toString('utf-8');

  try {
    const document = await createDocument({
      projectId: params.projectId,
      actingPrincipalId: params.actingPrincipalId,
      name,
      docType: fetched.docType as Document['doc_type'],
      url: fetched.finalUrl,
      content,
      contentHash,
      fileSizeBytes: fetched.buffer.length,
      description: params.description,
      tags: params.tags,
    });
    return { status: 'created', document };
  } catch (insErr: unknown) {
    // 23505 race: a concurrent insert won the content_hash unique index.
    const e = insErr as { code?: string; constraint?: string };
    if (e?.code === '23505' && e?.constraint === 'idx_documents_project_hash') {
      const again = await pool.query<{ doc_id: string; name: string; created_at: string }>(
        `SELECT doc_id, name, created_at FROM documents
          WHERE project_id = $1 AND content_hash = $2 LIMIT 1`,
        [params.projectId, contentHash],
      );
      const row = again.rows[0];
      return { status: 'duplicate', existing_doc_id: row.doc_id, existing_name: row.name, existing_uploaded_at: row.created_at };
    }
    throw insErr;
  }
}
