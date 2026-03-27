import { createHash } from 'node:crypto';

import { getDbPool } from '../db/client.js';

export type GeneratedDocType = 'faq' | 'raptor' | 'qc_report' | 'qc_artifact' | 'benchmark_artifact';

export async function upsertGeneratedDocument(input: {
  projectId: string;
  docType: GeneratedDocType;
  docKey: string;
  content: string;
  title?: string;
  pathHint?: string;
  metadata?: Record<string, unknown>;
  sourceJobId?: string;
  correlationId?: string;
}): Promise<{ doc_id: string }> {
  const pool = getDbPool();
  const res = await pool.query(
    `INSERT INTO generated_documents(
       project_id, doc_type, doc_key, source_job_id, correlation_id, title, path_hint, content, metadata, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, now())
     ON CONFLICT (project_id, doc_type, doc_key)
     DO UPDATE SET
       source_job_id = EXCLUDED.source_job_id,
       correlation_id = EXCLUDED.correlation_id,
       title = EXCLUDED.title,
       path_hint = EXCLUDED.path_hint,
       content = EXCLUDED.content,
       metadata = EXCLUDED.metadata,
       updated_at = now()
     RETURNING doc_id`,
    [
      input.projectId,
      input.docType,
      input.docKey,
      input.sourceJobId ?? null,
      input.correlationId ?? null,
      input.title ?? null,
      input.pathHint ?? null,
      input.content,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return { doc_id: String(res.rows[0]?.doc_id) };
}

export async function listGeneratedDocuments(params: {
  projectId: string;
  docType?: GeneratedDocType;
  limit?: number;
  includeContent?: boolean;
}): Promise<
  Array<{
    doc_id: string;
    doc_type: GeneratedDocType;
    doc_key: string;
    title: string | null;
    path_hint: string | null;
    content: string;
    metadata: Record<string, unknown>;
    updated_at: any;
  }>
> {
  const pool = getDbPool();
  const values: unknown[] = [params.projectId];
  const clauses = ['project_id=$1'];
  if (params.docType) {
    values.push(params.docType);
    clauses.push(`doc_type=$${values.length}`);
  }
  values.push(Math.min(Math.max(params.limit ?? 500, 1), 5000));
  const contentSelect = params.includeContent ?? false ? 'content,' : "''::text as content,";
  const res = await pool.query(
    `SELECT doc_id, doc_type, doc_key, title, path_hint, ${contentSelect} metadata, updated_at
     FROM generated_documents
     WHERE ${clauses.join(' AND ')}
     ORDER BY updated_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return (res.rows ?? []).map((r: any) => ({
    doc_id: String(r.doc_id),
    doc_type: String(r.doc_type) as GeneratedDocType,
    doc_key: String(r.doc_key),
    title: r.title ? String(r.title) : null,
    path_hint: r.path_hint ? String(r.path_hint) : null,
    content: String(r.content ?? ''),
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    updated_at: r.updated_at,
  }));
}

export async function getGeneratedDocument(params: {
  projectId: string;
  docId?: string;
  docType?: GeneratedDocType;
  docKey?: string;
}): Promise<{
  doc_id: string;
  project_id: string;
  doc_type: GeneratedDocType;
  doc_key: string;
  source_job_id: string | null;
  correlation_id: string | null;
  title: string | null;
  path_hint: string | null;
  content: string;
  metadata: Record<string, unknown>;
  created_at: any;
  updated_at: any;
} | null> {
  const pool = getDbPool();
  if (params.docId) {
    const byId = await pool.query(
      `SELECT doc_id, project_id, doc_type, doc_key, source_job_id, correlation_id, title, path_hint, content, metadata, created_at, updated_at
       FROM generated_documents
       WHERE project_id=$1 AND doc_id=$2
       LIMIT 1`,
      [params.projectId, params.docId],
    );
    const r = byId.rows[0] as any;
    if (!r) return null;
    return {
      doc_id: String(r.doc_id),
      project_id: String(r.project_id),
      doc_type: String(r.doc_type) as GeneratedDocType,
      doc_key: String(r.doc_key),
      source_job_id: r.source_job_id ? String(r.source_job_id) : null,
      correlation_id: r.correlation_id ? String(r.correlation_id) : null,
      title: r.title ? String(r.title) : null,
      path_hint: r.path_hint ? String(r.path_hint) : null,
      content: String(r.content ?? ''),
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  if (!params.docType || !params.docKey) {
    throw new Error('Either docId or (docType + docKey) is required');
  }

  const byKey = await pool.query(
    `SELECT doc_id, project_id, doc_type, doc_key, source_job_id, correlation_id, title, path_hint, content, metadata, created_at, updated_at
     FROM generated_documents
     WHERE project_id=$1 AND doc_type=$2 AND doc_key=$3
     LIMIT 1`,
    [params.projectId, params.docType, params.docKey],
  );
  const r = byKey.rows[0] as any;
  if (!r) return null;
  return {
    doc_id: String(r.doc_id),
    project_id: String(r.project_id),
    doc_type: String(r.doc_type) as GeneratedDocType,
    doc_key: String(r.doc_key),
    source_job_id: r.source_job_id ? String(r.source_job_id) : null,
    correlation_id: r.correlation_id ? String(r.correlation_id) : null,
    title: r.title ? String(r.title) : null,
    path_hint: r.path_hint ? String(r.path_hint) : null,
    content: String(r.content ?? ''),
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function recordGeneratedExport(input: { docId: string; exportPath: string; content: string }): Promise<void> {
  const pool = getDbPool();
  const hash = createHash('sha256').update(input.content).digest('hex');
  await pool.query(
    `INSERT INTO generated_exports(doc_id, export_path, content_hash, exported_at)
     VALUES ($1,$2,$3, now())`,
    [input.docId, input.exportPath, hash],
  );
}

