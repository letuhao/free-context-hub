/**
 * Seed 15 general_note lessons that mirror qc/queries.json worst-case retrieval targets.
 *
 * Helps **search_lessons** / agent workflows — **not** `search_code` (RAG QC harness does not read lessons).
 * Use together with `src/ragQcCanonicalHints.ts` + re-index for chunk-based recall.
 *
 *   QC_PROJECT_ID=phase6-qc-free-context-hub tsx src/scripts/seedQcWorst15Lessons.ts
 */
import * as dotenv from 'dotenv';
import { addLesson } from '../services/lessons.js';

dotenv.config();

const projectId = process.env.QC_PROJECT_ID?.trim() || 'phase6-qc-free-context-hub';

const items: Array<{ id: string; title: string; content: string; source_refs: string[] }> = [
  {
    id: 'auth-workspace-token-validate',
    title: 'MCP workspace_token validation',
    content:
      'Where is workspace_token validated for MCP tool calls? Canonical: src/index.ts — assertWorkspaceToken, MCP_AUTH_ENABLED, tools/call.',
    source_refs: ['src/index.ts'],
  },
  {
    id: 'index-project-main-pipeline',
    title: 'index_project pipeline',
    content:
      'How does index_project discover files, chunk, embed, write Postgres? Canonical: src/services/indexer.ts, src/services/embedder.ts (fast-glob, embedTexts, pgvector).',
    source_refs: ['src/services/indexer.ts', 'src/services/embedder.ts'],
  },
  {
    id: 'embedding-request-shape',
    title: 'Embeddings HTTP client',
    content:
      'How does the embeddings client call /v1/embeddings and validate dimensions? Canonical: src/services/embedder.ts.',
    source_refs: ['src/services/embedder.ts'],
  },
  {
    id: 'kg-bootstrap',
    title: 'Neo4j KG bootstrap',
    content:
      'How is Neo4j KG bootstrapped and schema ensured? Canonical: src/kg/bootstrap.ts, src/kg/schema.ts, src/kg/client.ts.',
    source_refs: ['src/kg/bootstrap.ts', 'src/kg/schema.ts', 'src/kg/client.ts'],
  },
  {
    id: 'kg-upsert-from-indexer',
    title: 'KG upsert from indexer',
    content:
      'Where is file graph upsert triggered during indexing? Canonical: src/services/indexer.ts, src/kg/upsert.ts — upsertFileGraphFromDisk.',
    source_refs: ['src/services/indexer.ts', 'src/kg/upsert.ts'],
  },
  {
    id: 'kg-query-tools',
    title: 'KG MCP query tools',
    content:
      'Where are search_symbols, getSymbolNeighbors, traceDependencyPath, getLessonImpact implemented? Canonical: src/kg/query.ts.',
    source_refs: ['src/kg/query.ts'],
  },
  {
    id: 'guardrails-check',
    title: 'check_guardrails',
    content:
      'How does check_guardrails evaluate rules? Canonical: src/services/guardrails.ts; tool registered from src/index.ts.',
    source_refs: ['src/services/guardrails.ts', 'src/index.ts'],
  },
  {
    id: 's3-source-artifacts',
    title: 'S3 source artifacts',
    content:
      'How are source artifacts synced to S3 and materialized (git bundle)? Canonical: src/services/sourceArtifacts.ts.',
    source_refs: ['src/services/sourceArtifacts.ts'],
  },
  {
    id: 'env-schema-queue-s3',
    title: 'QUEUE and S3 env validation',
    content:
      'Where are QUEUE_* and S3_* env vars validated? Canonical: src/env.ts (Zod + superRefine).',
    source_refs: ['src/env.ts'],
  },
  {
    id: 'tool-output-formatting',
    title: 'MCP tool output formats',
    content:
      'How are json_only / summary_only / auto_both formatted? Canonical: src/utils/outputFormat.ts, src/index.ts.',
    source_refs: ['src/utils/outputFormat.ts', 'src/index.ts'],
  },
  {
    id: 'output-format-parser-smoke',
    title: 'Smoke tests for MCP output parsing',
    content:
      'Where do clients parse MCP tool outputs with summary+json? Canonical: src/smoke/smokeTest.ts, src/smoke/phase5WorkerValidation.ts.',
    source_refs: ['src/smoke/smokeTest.ts', 'src/smoke/phase5WorkerValidation.ts'],
  },
  {
    id: 'env-boolean-parser',
    title: 'Boolean env parsing',
    content:
      'How are boolean environment variables parsed safely? Canonical: src/env.ts — parseBooleanEnv.',
    source_refs: ['src/env.ts'],
  },
  {
    id: 'worker-rabbitmq-consumer',
    title: 'Worker RabbitMQ consumer',
    content:
      'How does the worker consume RabbitMQ and ack/nack? Canonical: src/worker.ts.',
    source_refs: ['src/worker.ts'],
  },
  {
    id: 'worker-fallback-postgres-polling',
    title: 'Worker Postgres job polling',
    content:
      'Postgres fallback polling and job execution: src/worker.ts (runNextJob), src/services/jobExecutor.ts.',
    source_refs: ['src/worker.ts', 'src/services/jobExecutor.ts'],
  },
  {
    id: 'repo-sync-fanout',
    title: 'repo.sync enqueue fan-out',
    content:
      'When repo.sync succeeds, where are git.ingest / index.run enqueued with correlation_id? Canonical: src/services/jobExecutor.ts.',
    source_refs: ['src/services/jobExecutor.ts'],
  },
];

async function main() {
  for (const it of items) {
    const r = await addLesson({
      project_id: projectId,
      lesson_type: 'general_note',
      title: `[QC grounding] ${it.title}`,
      content: it.content,
      tags: ['qc-grounding', 'rag', it.id],
      source_refs: it.source_refs,
      captured_by: 'seedQcWorst15Lessons',
    });
    console.log('[seed] added lesson', it.id, r.lesson_id);
  }
  console.log('[seed] done — remember: RAG QC harness uses search_code only; lessons help search_lessons.');
}

main().catch(err => {
  console.error('[seed] failed', err instanceof Error ? err.message : err);
  process.exit(1);
});
