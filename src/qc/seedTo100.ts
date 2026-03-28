/**
 * Seed additional lessons to reach 100 total.
 * Covers: MCP protocol, DB internals, Node.js patterns, security, performance, team workflows.
 *
 * Usage: npx tsx src/qc/seedTo100.ts
 */
import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const PID = 'free-context-hub';

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const r = await client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema,
    { timeout: 60000 },
  );
  const txt = (r.content as any)[0]?.text || '';
  try { const s = txt.indexOf('{'); return JSON.parse(txt.slice(s, txt.lastIndexOf('}') + 1)); }
  catch { return txt; }
}

const LESSONS = [
  // === MCP Protocol & Server ===
  { lesson_type: 'decision', title: 'MCP server uses StreamableHTTP transport, not SSE',
    content: 'The MCP server uses StreamableHTTPServerTransport from the MCP SDK, not Server-Sent Events. Clients must send Accept: application/json, text/event-stream header. The server endpoint is POST /mcp for all tool calls.',
    tags: ['mcp', 'transport', 'protocol'], source_refs: ['src/index.ts'] },

  { lesson_type: 'decision', title: 'MCP tools use output_format parameter for response shaping',
    content: 'All MCP tools accept output_format: auto_both (default, summary + JSON), json_only, json_pretty, or summary_only. The formatToolResponse helper in index.ts handles this. Agents parsing JSON should use json_only to avoid parsing mixed text+JSON.',
    tags: ['mcp', 'api-design'], source_refs: ['src/index.ts'] },

  { lesson_type: 'workaround', title: 'MCP session ID error after server restart',
    content: 'After restarting the MCP server, existing client connections get "Bad Request: No valid session ID provided" errors. Clients must reconnect with a new transport instance. This is expected MCP SDK behavior — sessions are ephemeral.',
    tags: ['mcp', 'debugging', 'sessions'] },

  { lesson_type: 'decision', title: 'DEFAULT_PROJECT_ID allows omitting project_id in tool calls',
    content: 'When DEFAULT_PROJECT_ID is set in .env, MCP tools accept calls without project_id and use the default. This simplifies agent configuration. If both are missing, the tool returns an error. The resolution logic is in resolveProjectIdOrThrow() in index.ts.',
    tags: ['mcp', 'configuration'], source_refs: ['src/index.ts', 'src/env.ts'] },

  // === Database & PostgreSQL ===
  { lesson_type: 'decision', title: 'Migrations run sequentially in a transaction per file',
    content: 'The migration runner in applyMigrations.ts executes each SQL file in its own transaction, tracking applied files in a schema_migrations table. Files are sorted alphabetically by name, so use numeric prefixes like 0001_, 0002_ for ordering.',
    tags: ['database', 'migrations'], source_refs: ['src/db/applyMigrations.ts'] },

  { lesson_type: 'decision', title: 'PostgreSQL connection pool is singleton via getDbPool',
    content: 'Database connections use a single Pool instance from getDbPool() in src/db/client.ts. The pool is created once on first call and reused. Pool size and connection timeout come from the DATABASE_URL connection string.',
    tags: ['database', 'postgresql', 'connection'], source_refs: ['src/db/client.ts'] },

  { lesson_type: 'workaround', title: 'pgvector requires CREATE EXTENSION before vector columns',
    content: 'The initial migration must include CREATE EXTENSION IF NOT EXISTS vector before creating tables with vector columns. If you get "type vector does not exist", the extension is missing. It needs to be created in the same database used by the application.',
    tags: ['database', 'pgvector'], source_refs: ['migrations/0001_init.sql'] },

  { lesson_type: 'general_note', title: 'Chunks table uses composite key: project_id + file_path',
    content: 'The chunks table stores indexed code. Primary key is chunk_id (UUID). Querying always filters by project_id first. Key indexes: idx_chunks_project_file (project_id, file_path), idx_chunks_embedding_hnsw (HNSW for vector search), idx_chunks_fts (GIN for full-text search).',
    tags: ['database', 'schema'], source_refs: ['migrations/0001_init.sql'] },

  { lesson_type: 'general_note', title: 'Lessons table stores all persistent knowledge types',
    content: 'The lessons table has: lesson_id (UUID PK), project_id, lesson_type (decision/preference/guardrail/workaround/general_note), title, content, tags (text[]), source_refs (text[]), embedding (vector), status (draft/active/superseded/archived), fts (tsvector). Guardrails are lessons with an associated row in the guardrails table.',
    tags: ['database', 'schema'], source_refs: ['migrations/0001_init.sql'] },

  // === Node.js & TypeScript Patterns ===
  { lesson_type: 'preference', title: 'Use Zod v4 for runtime schema validation',
    content: 'All MCP tool input/output schemas use Zod v4 (imported as zod/v4). Note: some Zod v3 methods like .nonneg() are not available in v4. Use .nonnegative() or .min(0) instead. Schema definitions are in src/index.ts for MCP tools.',
    tags: ['typescript', 'validation', 'zod'], source_refs: ['src/index.ts'] },

  { lesson_type: 'preference', title: 'Use pino for structured JSON logging',
    content: 'Logging uses pino via createModuleLogger(module) in src/utils/logger.ts. Each module gets a child logger with a module field. Log levels: info for normal operations, warn for degradation, error for failures. Always include structured context objects, not string interpolation.',
    tags: ['typescript', 'logging', 'pino'], source_refs: ['src/utils/logger.ts'] },

  { lesson_type: 'decision', title: 'ESM modules with .js extension in imports',
    content: 'The project uses ESM (type: module in package.json). TypeScript imports must use .js extensions (e.g., import from "./foo.js") even though source files are .ts. This is required for Node.js ESM resolution. The tsconfig uses NodeNext module resolution.',
    tags: ['typescript', 'esm', 'imports'] },

  { lesson_type: 'workaround', title: 'Use tsx for running TypeScript directly without compilation',
    content: 'Development scripts and QC tools use tsx (TypeScript Execute) to run .ts files directly: npx tsx src/qc/runner.ts. This avoids the build step. Production Docker uses compiled JS via npm run build.',
    tags: ['typescript', 'tooling', 'development'] },

  // === Indexing & Chunking ===
  { lesson_type: 'decision', title: 'Smart chunker detects function and class boundaries',
    content: 'The AST-heuristic smart chunker in smartChunker.ts detects function/class/interface boundaries for 11 languages (TS, JS, Python, Go, Rust, Java, C#, Ruby, PHP, Kotlin, Swift). Falls back to line-based chunking for data files (JSON, YAML, Markdown). Each chunk gets symbol_name and symbol_type metadata.',
    tags: ['indexing', 'chunking'], source_refs: ['src/utils/smartChunker.ts'] },

  { lesson_type: 'decision', title: 'Incremental indexing skips unchanged files',
    content: 'index_project is idempotent. It computes a content hash for each file and skips files that have not changed since last index. The check also verifies fts IS NOT NULL to force re-index when FTS column was added after initial indexing.',
    tags: ['indexing', 'performance'], source_refs: ['src/services/indexer.ts'] },

  { lesson_type: 'preference', title: 'Default chunk size is 120 lines (CHUNK_LINES)',
    content: 'Chunks are 120 lines by default (CHUNK_LINES env var). The smart chunker may produce larger chunks when a function spans more lines. Smaller chunks (60-80 lines) give better precision but more embedding calls. 120 is the tested balance.',
    tags: ['indexing', 'configuration'] },

  { lesson_type: 'general_note', title: 'Index_project also rebuilds the project snapshot',
    content: 'After indexing files, index_project calls rebuildProjectSnapshot() which generates a text summary of the project (file count, languages, key directories). This snapshot is returned by get_project_summary and included in get_context bootstrap.',
    tags: ['indexing', 'snapshots'], source_refs: ['src/services/snapshot.ts', 'src/services/indexer.ts'] },

  // === Knowledge Graph ===
  { lesson_type: 'decision', title: 'Knowledge graph is optional and gated by KG_ENABLED',
    content: 'Neo4j knowledge graph is fully optional. When KG_ENABLED=false, all graph tools (search_symbols, get_symbol_neighbors, trace_dependency_path, get_lesson_impact) return empty results with a warning. No Phase 1-3 features are affected. Set KG_ENABLED=true and provide NEO4J_URI/USERNAME/PASSWORD to enable.',
    tags: ['knowledge-graph', 'neo4j', 'configuration'] },

  { lesson_type: 'general_note', title: 'KG extracts TypeScript symbols via ts-morph during indexing',
    content: 'When KG_ENABLED=true, index_project runs ts-morph extraction on TypeScript/JavaScript files to build a symbol graph in Neo4j. Nodes: Project, File, Symbol, Lesson. Edges: DECLARES, CALLS, IMPORTS, EXTENDS, IMPLEMENTS, MENTIONS, CONSTRAINS, PREFERS.',
    tags: ['knowledge-graph', 'ts-morph'], source_refs: ['src/kg/extractor/tsMorphExtractor.ts'] },

  // === Git Intelligence ===
  { lesson_type: 'decision', title: 'Git ingestion is optional and gated by GIT_INGEST_ENABLED',
    content: 'Git history ingestion requires GIT_INGEST_ENABLED=true. The ingest_git_history tool parses commits and stores them in git_commits and git_commit_files tables. suggest_lessons_from_commits can auto-draft lessons from commit messages. All Phase 5 tools noop gracefully when disabled.',
    tags: ['git', 'configuration'] },

  { lesson_type: 'general_note', title: 'Git commit parsing handles both single-parent and merge commits',
    content: 'The git commit file parser in gitCommitFileParse.ts uses git diff-tree to extract changed files. It handles merge commits (multiple parents) and empty commits. File status includes: Added, Modified, Deleted, Renamed, Copied.',
    tags: ['git', 'parsing'], source_refs: ['src/services/gitCommitFileParse.ts'] },

  // === Security ===
  { lesson_type: 'decision', title: 'Workspace token auth is optional (MCP_AUTH_ENABLED)',
    content: 'When MCP_AUTH_ENABLED=true, every MCP tool call must include workspace_token matching CONTEXT_HUB_WORKSPACE_TOKEN. When false (default), token is ignored. The check is in assertWorkspaceToken() in index.ts. For local development, keep auth disabled.',
    tags: ['security', 'authentication'], source_refs: ['src/index.ts'] },

  { lesson_type: 'preference', title: 'Never log secrets or API keys',
    content: 'The startup env summary in logStartupEnvSummary() masks all secret values as [set] or [not set]. API keys (EMBEDDINGS_API_KEY, S3_SECRET_ACCESS_KEY, etc.) are never printed in logs. DATABASE_URL has password replaced with ***.',
    tags: ['security', 'logging'], source_refs: ['src/index.ts'] },

  { lesson_type: 'guardrail', title: 'Never commit .env files to git',
    content: '.env files contain secrets (database passwords, API keys, workspace tokens). Only .env.example (with placeholder values) should be committed. The .gitignore must include .env. Always check git diff before committing to ensure no secrets leak.',
    tags: ['security', 'git', 'guardrail'],
    guardrail: { trigger: '/commit|push|git add/', requirement: 'Verify no .env files or secrets in staged changes', verification_method: 'user_confirmation' } },

  // === Performance ===
  { lesson_type: 'general_note', title: 'Embedding batch size affects indexing throughput',
    content: 'INDEX_EMBEDDING_BATCH_SIZE (default 8) controls how many chunks are embedded per API call. Higher values reduce HTTP overhead but increase memory and risk timeouts. For local LM Studio, 8 is safe. For faster GPU servers, try 16-32.',
    tags: ['performance', 'indexing', 'configuration'] },

  { lesson_type: 'general_note', title: 'HNSW index trades build time for query speed',
    content: 'The pgvector HNSW index on embedding columns gives fast approximate nearest neighbor search (sub-millisecond for <10k vectors). Build time increases with data size. For 1300 chunks, index build is instant. At 100k+ chunks, consider IVFFlat or tuning HNSW ef_construction parameter.',
    tags: ['performance', 'pgvector', 'database'] },

  { lesson_type: 'workaround', title: 'Slow embedding models can timeout index_project',
    content: 'Large embedding models (4B+ params) may cause index_project to timeout on the MCP client side (default 60s). The server continues indexing even after client timeout. Either increase client timeout, use a smaller model, or run indexing in multiple batches.',
    tags: ['performance', 'embeddings', 'timeout'] },

  // === Worker & Queue ===
  { lesson_type: 'decision', title: 'Job queue supports PostgreSQL polling and RabbitMQ backends',
    content: 'QUEUE_BACKEND can be postgres (polling-based, simpler) or rabbitmq (event-driven, faster). RabbitMQ requires RABBITMQ_URL and RABBITMQ_EXCHANGE. Jobs are stored in async_jobs table regardless of backend. Worker processes jobs via run_next_job tool.',
    tags: ['queue', 'worker', 'configuration'], source_refs: ['src/services/jobQueue.ts'] },

  { lesson_type: 'general_note', title: 'Job correlation_id tracks related jobs in a pipeline',
    content: 'When enqueue_job creates a parent job (e.g., repo.sync), child jobs (git.ingest, index.run) inherit the same correlation_id. Use list_jobs with correlation_id filter to track all jobs in one pipeline run.',
    tags: ['queue', 'worker', 'tracing'], source_refs: ['src/services/jobQueue.ts'] },

  // === Distillation & Reflection ===
  { lesson_type: 'decision', title: 'Distillation generates summary and quick_action for lessons',
    content: 'When DISTILLATION_ENABLED=true, add_lesson calls distillLesson() which uses the chat model to generate a summary (short description) and quick_action (one-line actionable takeaway). If distillation fails, the lesson is saved as draft status instead of active.',
    tags: ['distillation', 'lessons'], source_refs: ['src/services/distiller.ts', 'src/services/lessons.ts'] },

  { lesson_type: 'general_note', title: 'Reflect synthesizes answers from multiple lessons',
    content: 'The reflect tool searches for relevant lessons, then asks the chat model to synthesize a coherent answer from them. It requires DISTILLATION_ENABLED=true. The synthesis prompt includes lesson titles and content as context. Useful for "how does X work in this project" questions.',
    tags: ['distillation', 'reflect'], source_refs: ['src/services/distiller.ts'] },

  // === Storage ===
  { lesson_type: 'decision', title: 'Generated documents are DB-first with optional filesystem export',
    content: 'FAQ, RAPTOR summaries, QC reports, and benchmark artifacts are stored in the generated_documents table (DB-first). They can optionally be exported to filesystem or S3. The canonical source is always the database. Query via list_generated_documents and get_generated_document MCP tools.',
    tags: ['storage', 'generated-docs'], source_refs: ['src/services/generatedDocs.ts'] },

  { lesson_type: 'decision', title: 'S3-compatible storage for source artifacts (SOURCE_STORAGE_MODE)',
    content: 'SOURCE_STORAGE_MODE can be local (filesystem only), s3 (S3 only), or hybrid (both). S3 storage uses MinIO locally or any S3-compatible service. Configure S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY. Hybrid mode keeps local cache + S3 backup.',
    tags: ['storage', 's3', 'configuration'] },

  // === Testing & QC ===
  { lesson_type: 'preference', title: 'Use integration tests for MCP tool validation, not unit tests',
    content: 'MCP tools are best tested via live tool calls (integration tests) rather than unit tests, because they depend on DB, embeddings, and server state. The integration test runner (npm run test:integration) connects to the running server and exercises real tool calls with assertions.',
    tags: ['testing', 'integration'], source_refs: ['src/qc/integrationTestRunner.ts'] },

  { lesson_type: 'general_note', title: 'QC golden set has 67 queries across 19 groups',
    content: 'The QC golden set (qc/queries.json) contains 67 queries organized into 19 groups (mcp-auth, mcp-server, indexing, embeddings, kg, lessons, guardrails, git, queue, config, db, etc.). Each query has target_files and optional must_keywords. Run via npm run qc:rag.',
    tags: ['testing', 'qc', 'golden-set'], source_refs: ['qc/queries.json'] },

  { lesson_type: 'workaround', title: 'QC runner needs its own project_id separate from main project',
    content: 'The ragQcRunner uses QC_PROJECT_ID (default: qc-free-context-hub) which is separate from the main project. This prevents test data from polluting production lessons. You must index the QC project separately before running qc:rag.',
    tags: ['testing', 'qc', 'configuration'] },

  // === Workspace Management ===
  { lesson_type: 'decision', title: 'delete_workspace is destructive and only for explicit user request',
    content: 'delete_workspace removes ALL data for a project_id: lessons, chunks, guardrails, snapshots, generated documents. It should only be called on explicit user instruction, never automatically. There is no undo.',
    tags: ['workspace', 'destructive-action'] },

  { lesson_type: 'general_note', title: 'Workspace roots are registered for ripgrep search',
    content: 'register_workspace_root stores the filesystem path for a project, enabling ripgrep (tier 1) search. The root is resolved from project_workspaces table or chunks.root as fallback. Without a registered root, ripgrep is skipped with a warning.',
    tags: ['workspace', 'ripgrep'], source_refs: ['src/services/workspaceTracker.ts'] },
];

async function main() {
  const client = new Client({ name: 'seed-100', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  // Check current count
  const list = await call(client, 'list_lessons', { project_id: PID, page: { limit: 1 }, output_format: 'json_only' }) as any;
  console.log(`Current lessons (estimated from first page): seeding ${LESSONS.length} more...\n`);

  let seeded = 0;
  let failed = 0;
  for (const l of LESSONS) {
    const r = await call(client, 'add_lesson', { lesson_payload: { project_id: PID, ...l }, output_format: 'json_only' }) as any;
    if (r?.lesson_id) {
      seeded++;
    } else {
      failed++;
      console.log(`  WARN: "${l.title.slice(0, 50)}" → ${JSON.stringify(r).slice(0, 80)}`);
    }
  }

  console.log(`\nSeeded: ${seeded}/${LESSONS.length} (${failed} failed)`);
  console.log('Done. Run DB count to verify total.');

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
