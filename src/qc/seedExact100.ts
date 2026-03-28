/**
 * Seed exactly 100 unique lessons simulating a real small project.
 * Mix: architecture, bugs, business logic, design, deployment, team workflow.
 *
 * Usage: npx tsx src/qc/seedExact100.ts
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

type L = { lesson_type: string; title: string; content: string; tags: string[]; source_refs?: string[]; guardrail?: any };

const LESSONS: L[] = [
  // ══════════════════════════════════════════════
  // ARCHITECTURE (15)
  // ══════════════════════════════════════════════
  { lesson_type: 'decision', title: 'Use 12-kind chunk classification for data types', content: 'We classify indexed code chunks into 12 kinds: source, type_def, test, migration, config, dependency, api_spec, doc, script, infra, style, generated. Priority order: generated > test > migration > api_spec > type_def > dependency > doc > style > config > infra > script > source.', tags: ['architecture', 'indexing'], source_refs: ['src/utils/languageDetect.ts'] },
  { lesson_type: 'decision', title: 'Tiered search: deterministic first, semantic as fallback only', content: 'search_code_tiered uses 4 tiers: ripgrep, symbol ILIKE, FTS, then semantic vector search as fallback only when fewer than threshold files found.', tags: ['architecture', 'search'], source_refs: ['src/services/tieredRetriever.ts'] },
  { lesson_type: 'decision', title: 'Three search profiles auto-selected by kind parameter', content: 'code-search (default): ripgrep > symbol > FTS > semantic. relationship (kind=test): convention paths > KG imports > filtered ripgrep. semantic-first (kind=doc/script): semantic primary at full weight.', tags: ['architecture', 'search'], source_refs: ['src/services/tieredRetriever.ts'] },
  { lesson_type: 'decision', title: 'Persistent memory is the core value, not code search', content: 'The primary value is persistent cross-session knowledge: decisions, preferences, workarounds, guardrails. Code search is supplementary — agents already have Grep/Glob.', tags: ['architecture', 'priority'], source_refs: ['README.md'] },
  { lesson_type: 'decision', title: 'Hybrid lesson search: semantic + FTS keyword boost', content: 'Lesson search blends semantic embedding similarity with 0.40 * FTS keyword rank. FTS catches exact keyword matches that semantic misses. Formula: LEAST(1.0, semantic + 0.40 * fts_rank).', tags: ['architecture', 'search'], source_refs: ['src/services/lessons.ts'] },
  { lesson_type: 'decision', title: 'Embed lesson title + content together for query matching', content: 'Lessons embed title prepended to content: embedTexts([title + ". " + content]). Short agent queries match titles better than long content paragraphs.', tags: ['architecture', 'embeddings'], source_refs: ['src/services/lessons.ts'] },
  { lesson_type: 'decision', title: 'Dynamic rerank budget scales with lesson count', content: 'Rerank pool scales: <20 lessons skip rerank, <50 rerank top 10, <200 top 20, <500 top 30, then cap at 30. Fetch pool is 2x rerank budget. Enterprise pattern: retrieval cheap, reranking expensive.', tags: ['architecture', 'reranking'], source_refs: ['src/services/lessons.ts'] },
  { lesson_type: 'decision', title: 'Query classification: identifier patterns take priority', content: 'classifyQuery checks identifiers (camelCase, snake_case) before NL keywords. Words like get/list/find are common identifier prefixes. NL detection requires space-separated keywords.', tags: ['architecture', 'search'], source_refs: ['src/services/tieredRetriever.ts'] },
  { lesson_type: 'decision', title: 'MCP server uses StreamableHTTP transport', content: 'MCP uses StreamableHTTPServerTransport, not SSE. Clients must send Accept: application/json, text/event-stream. Endpoint is POST /mcp.', tags: ['architecture', 'mcp'], source_refs: ['src/index.ts'] },
  { lesson_type: 'decision', title: 'Knowledge graph is optional via KG_ENABLED flag', content: 'Neo4j KG is fully optional. When KG_ENABLED=false, graph tools return empty with warning. No core features affected. Set KG_ENABLED=true with NEO4J_URI to enable.', tags: ['architecture', 'knowledge-graph'] },
  { lesson_type: 'decision', title: 'Git intelligence gated by GIT_INGEST_ENABLED', content: 'Git history ingestion requires GIT_INGEST_ENABLED=true. ingest_git_history parses commits into git_commits table. suggest_lessons_from_commits auto-drafts lessons from commit messages.', tags: ['architecture', 'git'] },
  { lesson_type: 'decision', title: 'Migrations run sequentially in transaction per file', content: 'applyMigrations.ts executes each SQL file in its own transaction, tracking in schema_migrations. Files sorted alphabetically — use numeric prefixes (0001_, 0002_).', tags: ['architecture', 'database'], source_refs: ['src/db/applyMigrations.ts'] },
  { lesson_type: 'decision', title: 'Job queue supports PostgreSQL polling and RabbitMQ', content: 'QUEUE_BACKEND: postgres (polling, simpler) or rabbitmq (event-driven, faster). Jobs stored in async_jobs table regardless. Worker processes via run_next_job.', tags: ['architecture', 'queue'], source_refs: ['src/services/jobQueue.ts'] },
  { lesson_type: 'decision', title: 'Generated documents are DB-first with optional filesystem export', content: 'FAQ, RAPTOR summaries, QC reports stored in generated_documents table. Canonical source is always DB. Optional export to filesystem or S3.', tags: ['architecture', 'storage'], source_refs: ['src/services/generatedDocs.ts'] },
  { lesson_type: 'decision', title: 'Workspace token auth is optional via MCP_AUTH_ENABLED', content: 'When MCP_AUTH_ENABLED=true, every tool call needs workspace_token. When false (default), token ignored. For local dev keep auth disabled.', tags: ['architecture', 'security'], source_refs: ['src/index.ts'] },

  // ══════════════════════════════════════════════
  // EMBEDDING & MODEL SELECTION (10)
  // ══════════════════════════════════════════════
  { lesson_type: 'decision', title: 'Use qwen3-embedding-0.6b as the embedding model', content: 'After benchmarking 8 models on 18 queries: qwen3-embedding-0.6b (1024d) wins with 18/18 pass, avg 0.652. Beats bge-m3 (0.575), mxbai-large (0.648 but 17/18).', tags: ['embeddings', 'model-selection'], source_refs: ['docs/benchmarks/2026-03-28-embedding-model-benchmark.md'] },
  { lesson_type: 'decision', title: 'Code embedding models are wrong for lesson search', content: 'nomic-embed-code scored worst (avg 0.381) because lessons are natural language, not code. Code search uses ripgrep/FTS. A general-purpose text model is correct.', tags: ['embeddings', 'model-selection'] },
  { lesson_type: 'decision', title: 'Recommended combo: qwen3-embedding + coder-7b + reranker-4b', content: 'Embeddings: qwen3-embedding-0.6b (1024d). Distillation: qwen2.5-coder-7b-instruct. Reranker: qwen3-reranker-4b (needs RERANK_LLM_MAX_TOKENS=500).', tags: ['embeddings', 'model-selection'], source_refs: ['.env.example'] },
  { lesson_type: 'general_note', title: 'pgvector HNSW index limited to 2000 dimensions', content: 'HNSW and IVFFlat only support up to 2000 dims. For >2000d models use halfvec type (supports up to 4000 dims HNSW). Or choose a <=2000d model.', tags: ['embeddings', 'pgvector'] },
  { lesson_type: 'general_note', title: 'Embedding dimension mismatch crashes index_project silently', content: 'If model output dim does not match EMBEDDINGS_DIM, index_project returns 0 files with no error. Check docker logs for dimension mismatch message. Verify after switching models.', tags: ['embeddings', 'debugging'] },
  { lesson_type: 'general_note', title: 'EmbeddingGemma-300M has highest scores but worst discrimination', content: 'EmbeddingGemma-300M had avg 0.699 (highest) but 3 failures because scores are so uniformly high that negative tests cannot distinguish relevant from irrelevant (all >0.5).', tags: ['embeddings', 'benchmark'] },
  { lesson_type: 'general_note', title: 'Embedding batch size affects indexing throughput', content: 'INDEX_EMBEDDING_BATCH_SIZE (default 8) controls chunks per API call. Higher reduces HTTP overhead but risks timeout. For local LM Studio, 8 is safe.', tags: ['embeddings', 'performance'] },
  { lesson_type: 'general_note', title: 'Qwen3 reranker needs max_tokens=500 for thinking mode', content: 'qwen3-reranker-4b uses thinking mode — reasoning tokens consume budget before JSON answer. Default 250 tokens truncates output. Set RERANK_LLM_MAX_TOKENS=500.', tags: ['reranking', 'debugging'] },
  { lesson_type: 'general_note', title: 'Reranker comparison: qwen3-reranker-4b beats zerank-2', content: 'At 98 lessons with wider pool: qwen3-reranker-4b scored 29/33 (88%), zerank-2 scored 27/33 (82%). qwen3 makes better ranking decisions for technical content.', tags: ['reranking', 'benchmark'] },
  { lesson_type: 'general_note', title: 'Reranker bottleneck is retrieval pool, not model quality', content: 'Both rerankers perform similarly because the bottleneck is whether the correct lesson is in the retrieval pool. Widening fetch from 8 to 20 candidates improved accuracy more than switching reranker models.', tags: ['reranking', 'architecture'] },

  // ══════════════════════════════════════════════
  // WORKAROUNDS & BUG FIXES (15)
  // ══════════════════════════════════════════════
  { lesson_type: 'workaround', title: 'Docker build cache prevents new migration files from loading', content: 'docker compose build caches COPY . . layer. Always use docker compose build --no-cache when migration files change, then --force-recreate.', tags: ['docker', 'deployment'] },
  { lesson_type: 'workaround', title: 'Redis cache must be flushed after retrieval logic changes', content: 'search_code and search_code_tiered cache in Redis. After changing scoring or pipeline, run: docker compose exec redis redis-cli FLUSHALL.', tags: ['redis', 'cache'] },
  { lesson_type: 'workaround', title: 'CREATE INDEX CONCURRENTLY fails in migration runner', content: 'Migration runner wraps each file in a transaction. CREATE INDEX CONCURRENTLY cannot run in transaction. Use regular CREATE INDEX. Same for IVFFlat.', tags: ['postgresql', 'migrations'] },
  { lesson_type: 'workaround', title: 'MCP add_lesson requires lesson_payload wrapper', content: 'add_lesson expects { lesson_payload: { project_id, lesson_type, title, content } }. check_guardrails needs project_id inside action_context. Not flat args.', tags: ['mcp', 'api'] },
  { lesson_type: 'workaround', title: 'MCP session ID error after server restart', content: 'After restart, clients get "No valid session ID" error. Must reconnect with new transport instance. Sessions are ephemeral in MCP SDK.', tags: ['mcp', 'debugging'] },
  { lesson_type: 'workaround', title: 'Slow embedding models timeout index_project on client', content: 'Large models (4B+) may cause client-side timeout (60s default). Server continues indexing. Increase client timeout or use smaller model.', tags: ['embeddings', 'timeout'] },
  { lesson_type: 'decision', title: 'Guardrails bug fix: must check lesson lifecycle status', content: 'checkGuardrails was querying guardrails table without checking parent lesson status. Superseded/archived guardrails still blocked. Fixed: JOIN lessons table, filter to active/draft.', tags: ['guardrails', 'bug-fix'], source_refs: ['src/services/guardrails.ts'] },
  { lesson_type: 'general_note', title: 'Integration tests caught guardrails bug on first run', content: 'The guardrail-superseded test failed immediately, revealing that superseded guardrails still blocked. Fixed the same day. Tests pay for themselves.', tags: ['testing', 'guardrails'] },
  { lesson_type: 'general_note', title: 'Bare .sql files should not be classified as migrations', content: 'Original MIGRATION_PATTERNS included /.sql$/ which misclassified query files. Fixed: only match SQL in migrations/ dirs or with numbered prefixes like 0001_init.sql.', tags: ['classification', 'bug-fix'], source_refs: ['src/utils/languageDetect.ts'] },
  { lesson_type: 'workaround', title: 'QC runner needs separate project_id from main project', content: 'ragQcRunner uses QC_PROJECT_ID (default: qc-free-context-hub). Must index QC project separately. Prevents test data polluting production.', tags: ['testing', 'configuration'] },
  { lesson_type: 'workaround', title: 'pgvector requires CREATE EXTENSION before vector columns', content: 'Initial migration must include CREATE EXTENSION IF NOT EXISTS vector. Error: "type vector does not exist" means extension missing from the database.', tags: ['postgresql', 'pgvector'] },
  { lesson_type: 'general_note', title: 'FTS backfill needed after adding fts column to existing data', content: 'When fts tsvector column was added to chunks/lessons tables, existing rows had NULL fts. Required backfill migration: UPDATE SET fts = to_tsvector(title || content).', tags: ['database', 'fts'] },
  { lesson_type: 'general_note', title: 'Incremental indexing checks fts IS NOT NULL', content: 'The indexer skips files with matching content hash. But it also checks fts IS NOT NULL to force re-index when FTS column was added after initial indexing.', tags: ['indexing', 'fts'], source_refs: ['src/services/indexer.ts'] },
  { lesson_type: 'workaround', title: 'Use tsx for running TypeScript scripts without compilation', content: 'Dev scripts use tsx (TypeScript Execute): npx tsx src/qc/runner.ts. Avoids build step. Production Docker uses compiled JS via npm run build.', tags: ['typescript', 'tooling'] },
  { lesson_type: 'general_note', title: 'Stop-word filtering removes common English words from FTS', content: 'FTS query builder skips words like how, where, what, does, is, are, can. Prevents matching every document. List in FTS_STOP_WORDS set in ftsTokenizer.ts.', tags: ['fts', 'search'], source_refs: ['src/utils/ftsTokenizer.ts'] },

  // ══════════════════════════════════════════════
  // PREFERENCES & PATTERNS (12)
  // ══════════════════════════════════════════════
  { lesson_type: 'preference', title: 'FTS uses AND mode for identifiers, OR for natural language', content: 'Identifier/path queries use AND (&) to require all terms. Natural language uses OR (|) for broader recall. Prevents assertWorkspaceToken matching every file with "token".', tags: ['search', 'fts'], source_refs: ['src/utils/ftsTokenizer.ts'] },
  { lesson_type: 'preference', title: 'Ripgrep ignore patterns cover all ecosystems', content: 'Defaults cover JS (node_modules, dist), Python (__pycache__, .venv), Go (vendor), Rust (target), Java (.gradle, build). Configurable per project.', tags: ['search', 'ripgrep'], source_refs: ['src/utils/ripgrepSearch.ts'] },
  { lesson_type: 'preference', title: 'Test files excluded from search by default', content: 'search_code_tiered excludes kind=test by default. Auto-enabled when kind filter includes test. Prevents test clutter in code search.', tags: ['search', 'test-files'] },
  { lesson_type: 'preference', title: 'Short identifiers (2-3 chars) are valid search tokens', content: 'Minimum token length is 2 chars. Tokens like env, db, pg, api are kept unless in EXTRACT_STOP_WORDS. Lowered from 4 to improve short-identifier search.', tags: ['search', 'tokens'] },
  { lesson_type: 'preference', title: 'Use Zod v4 for runtime schema validation', content: 'MCP tool schemas use Zod v4 (zod/v4). Note: some v3 methods not available — use .nonnegative() instead of .nonneg().', tags: ['typescript', 'validation'] },
  { lesson_type: 'preference', title: 'Use pino for structured JSON logging', content: 'createModuleLogger(module) creates child loggers. Always structured context objects, not string interpolation. Levels: info normal, warn degradation, error failures.', tags: ['typescript', 'logging'], source_refs: ['src/utils/logger.ts'] },
  { lesson_type: 'preference', title: 'ESM modules require .js extension in TypeScript imports', content: 'Project uses ESM (type: module). Imports must use .js extensions even for .ts files. Required for Node.js ESM resolution with NodeNext module.', tags: ['typescript', 'esm'] },
  { lesson_type: 'preference', title: 'Default chunk size is 120 lines', content: 'CHUNK_LINES=120. Smart chunker may produce larger when function spans more. Smaller gives precision but more embedding calls. 120 is tested balance.', tags: ['indexing', 'configuration'] },
  { lesson_type: 'preference', title: 'Never log secrets or API keys', content: 'logStartupEnvSummary masks secrets as [set]/[not set]. API keys, tokens, passwords never in logs. DATABASE_URL has password replaced with ***.', tags: ['security', 'logging'], source_refs: ['src/index.ts'] },
  { lesson_type: 'preference', title: 'Integration tests over unit tests for MCP tools', content: 'MCP tools depend on DB, embeddings, server state. Best tested via live tool calls. npm run test:integration connects to running server with real assertions.', tags: ['testing', 'preference'], source_refs: ['src/qc/integrationTestRunner.ts'] },
  { lesson_type: 'preference', title: 'output_format json_only for programmatic tool calls', content: 'Agents parsing JSON should use output_format: json_only. Default auto_both returns summary + JSON which is harder to parse. json_pretty for debugging.', tags: ['mcp', 'api'] },
  { lesson_type: 'preference', title: 'Use correlation_id to track related jobs in a pipeline', content: 'enqueue_job sets correlation_id. Child jobs (git.ingest, index.run) inherit it. list_jobs with correlation_id filter tracks all jobs in one run.', tags: ['queue', 'tracing'] },

  // ══════════════════════════════════════════════
  // GUARDRAILS (8)
  // ══════════════════════════════════════════════
  { lesson_type: 'guardrail', title: 'Re-index after changing chunk classification logic', content: 'When classifyKind or languageDetect.ts patterns change, run index_project. Stale chunk_kind values break kind filters.', tags: ['indexing', 'guardrail'],
    guardrail: { trigger: '/classify|languageDetect|chunk.kind/', requirement: 'Re-index project after classification changes', verification_method: 'user_confirmation' } },
  { lesson_type: 'guardrail', title: 'Flush Redis after changing search logic', content: 'Search results cached in Redis. Any scoring/FTS/tier/profile change requires FLUSHALL before testing.', tags: ['redis', 'guardrail'],
    guardrail: { trigger: '/retriev|scoring|fts|search.*tier/', requirement: 'Flush Redis cache before testing search changes', verification_method: 'user_confirmation' } },
  { lesson_type: 'guardrail', title: 'Run integration tests before merging', content: 'npm run test:integration — 13 tests covering lessons, guardrails, bootstrap, tiered search. Must all pass.', tags: ['testing', 'guardrail'],
    guardrail: { trigger: '/push|merge|deploy/', requirement: 'All 13 integration tests must pass', verification_method: 'user_confirmation' } },
  { lesson_type: 'guardrail', title: 'Never commit .env files to git', content: '.env contains secrets. Only .env.example with placeholders should be committed. Check git diff before committing.', tags: ['security', 'guardrail'],
    guardrail: { trigger: '/commit|push|git add/', requirement: 'No .env or secrets in staged changes', verification_method: 'user_confirmation' } },
  { lesson_type: 'guardrail', title: 'Verify embedding dimension after switching models', content: 'After changing EMBEDDINGS_MODEL, verify EMBEDDINGS_DIM matches. Mismatch causes silent failures (0 files indexed).', tags: ['embeddings', 'guardrail'],
    guardrail: { trigger: '/embed.*model|EMBEDDINGS_MODEL/', requirement: 'Verify EMBEDDINGS_DIM matches new model output', verification_method: 'user_confirmation' } },
  { lesson_type: 'guardrail', title: 'Use --no-cache when Docker migrations change', content: 'Docker caches COPY layer. New migration files may not load without --no-cache build flag.', tags: ['docker', 'guardrail'],
    guardrail: { trigger: '/docker.*build|migration/', requirement: 'Use docker compose build --no-cache for migration changes', verification_method: 'user_confirmation' } },
  { lesson_type: 'guardrail', title: 'Review delete_workspace calls carefully', content: 'delete_workspace removes ALL data: lessons, chunks, guardrails, snapshots. No undo. Only on explicit user request.', tags: ['workspace', 'guardrail'],
    guardrail: { trigger: '/delete_workspace/', requirement: 'Confirm with user before deleting workspace', verification_method: 'user_confirmation' } },
  { lesson_type: 'guardrail', title: 'Backup lessons before large-scale operations', content: 'Before delete_workspace, model migration, or major schema change, export lessons. No built-in backup yet — use pg_dump.', tags: ['database', 'guardrail'],
    guardrail: { trigger: '/delete_workspace|migration.*vector|drop.*column/', requirement: 'Export lessons before destructive operations', verification_method: 'user_confirmation' } },

  // ══════════════════════════════════════════════
  // GENERAL NOTES & KNOWLEDGE (40)
  // ══════════════════════════════════════════════
  { lesson_type: 'general_note', title: 'Smart chunker detects boundaries for 11 languages', content: 'AST-heuristic in smartChunker.ts: TS, JS, Python, Go, Rust, Java, C#, Ruby, PHP, Kotlin, Swift. Falls back to line-based for data files.', tags: ['indexing', 'chunking'], source_refs: ['src/utils/smartChunker.ts'] },
  { lesson_type: 'general_note', title: 'Convention-based test path inference supports 6 languages', content: 'Relationship profile generates patterns for: TS/JS (.test.ts, .spec.ts), Go (_test.go), Python (test_*.py), Java (AuthTest.java), Ruby (_spec.rb). Also checks __tests__/ dirs.', tags: ['search', 'test-discovery'] },
  { lesson_type: 'general_note', title: 'Ripgrep circuit breaker detects binary once', content: 'isRipgrepAvailable() caches result after first check. If rg not installed, all tier 1 calls skip with warning. Concurrent checks coalesced.', tags: ['search', 'ripgrep'], source_refs: ['src/utils/ripgrepSearch.ts'] },
  { lesson_type: 'general_note', title: 'Tiered and semantic search are complementary', content: 'Golden set: tiered fixes worst semantic groups (config 0.25→1.0, mcp-auth 0.33→1.0). But tiered loses where kind=source excludes expected targets. Use both.', tags: ['search', 'quality'] },
  { lesson_type: 'general_note', title: 'QC golden set has 67 queries across 19 groups', content: 'qc/queries.json: 67 queries in groups (mcp-auth, indexing, kg, lessons, guardrails, git, queue, config, db, etc). Each has target_files and must_keywords.', tags: ['testing', 'qc'], source_refs: ['qc/queries.json'] },
  { lesson_type: 'general_note', title: 'Project snapshot rebuilds on every index_project', content: 'index_project calls rebuildProjectSnapshot() generating text summary of project. Returned by get_project_summary and get_context.', tags: ['indexing', 'snapshots'], source_refs: ['src/services/snapshot.ts'] },
  { lesson_type: 'general_note', title: 'KG extracts TypeScript symbols via ts-morph', content: 'When KG_ENABLED, index_project runs ts-morph on TS/JS files. Nodes: Project, File, Symbol, Lesson. Edges: DECLARES, CALLS, IMPORTS, EXTENDS, IMPLEMENTS.', tags: ['knowledge-graph'] },
  { lesson_type: 'general_note', title: 'Git commit parser handles merges and empty commits', content: 'gitCommitFileParse.ts uses git diff-tree. Handles multi-parent merges, empty commits. Statuses: Added, Modified, Deleted, Renamed, Copied.', tags: ['git'], source_refs: ['src/services/gitCommitFileParse.ts'] },
  { lesson_type: 'general_note', title: 'Distillation generates summary and quick_action', content: 'add_lesson with DISTILLATION_ENABLED calls distillLesson() for summary + quick_action via chat model. If fails, lesson saved as draft.', tags: ['distillation'], source_refs: ['src/services/distiller.ts'] },
  { lesson_type: 'general_note', title: 'Reflect synthesizes answers from multiple lessons', content: 'reflect tool searches relevant lessons, then chat model synthesizes coherent answer. Requires DISTILLATION_ENABLED=true. Good for "how does X work" questions.', tags: ['distillation', 'reflect'] },
  { lesson_type: 'general_note', title: 'DB connection pool is singleton via getDbPool', content: 'Single Pool instance from getDbPool() in db/client.ts. Created once, reused. Pool size from DATABASE_URL connection string.', tags: ['database'], source_refs: ['src/db/client.ts'] },
  { lesson_type: 'general_note', title: 'Chunks table indexed by project_id + file_path', content: 'Primary key: chunk_id (UUID). Key indexes: idx_chunks_project_file, idx_chunks_embedding_hnsw (vector), idx_chunks_fts (GIN), idx_chunks_kind.', tags: ['database', 'schema'] },
  { lesson_type: 'general_note', title: 'Lesson lifecycle: draft → active → superseded → archived', content: 'Lessons have 4 statuses. Superseded/archived excluded from search by default. include_all_statuses: true to see them. update_lesson_status changes lifecycle.', tags: ['lessons', 'lifecycle'] },
  { lesson_type: 'general_note', title: 'HNSW index trades build time for query speed', content: 'pgvector HNSW gives sub-millisecond ANN search for <10k vectors. Build time increases with data. At 100k+ consider IVFFlat or tuning ef_construction.', tags: ['performance', 'pgvector'] },
  { lesson_type: 'general_note', title: 'DEFAULT_PROJECT_ID simplifies agent configuration', content: 'When set in .env, tools accept calls without project_id. Resolution in resolveProjectIdOrThrow(). Simplifies agent setup for single-project teams.', tags: ['configuration', 'mcp'] },
  { lesson_type: 'general_note', title: 'S3-compatible storage for source artifacts', content: 'SOURCE_STORAGE_MODE: local, s3, or hybrid. S3 uses MinIO locally or any compatible service. Hybrid keeps local cache + S3 backup.', tags: ['storage', 's3'] },
  { lesson_type: 'general_note', title: 'Job correlation_id tracks pipeline runs', content: 'Parent jobs (repo.sync) set correlation_id. Children (git.ingest, index.run) inherit. list_jobs filters by correlation to track one run.', tags: ['queue'] },
  { lesson_type: 'general_note', title: 'Workspace scan detects changed files for delta indexing', content: 'scan_workspace uses git status to find changed files since last index. Triggers targeted re-indexing instead of full reindex.', tags: ['workspace', 'indexing'], source_refs: ['src/services/workspaceTracker.ts'] },
  { lesson_type: 'general_note', title: 'Workspace roots registered for ripgrep search', content: 'register_workspace_root stores filesystem path. Enables tier 1 ripgrep. Resolved from project_workspaces table or chunks.root fallback.', tags: ['workspace', 'ripgrep'] },
  { lesson_type: 'general_note', title: 'camelCase expansion in FTS tokenizer', content: 'expandForFtsIndex splits identifiers: parseBooleanEnv → parse boolean env parsebooleanenv. Enables FTS matching on sub-words of compound identifiers.', tags: ['fts', 'indexing'], source_refs: ['src/utils/ftsTokenizer.ts'] },
];

async function main() {
  const client = new Client({ name: 'seed-100', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  console.log(`Seeding ${LESSONS.length} lessons...\n`);
  let ok = 0, fail = 0;
  for (const l of LESSONS) {
    const r = await call(client, 'add_lesson', { lesson_payload: { project_id: PID, ...l }, output_format: 'json_only' }) as any;
    if (r?.lesson_id) ok++;
    else { fail++; console.log(`  WARN: "${l.title.slice(0, 50)}" → ${JSON.stringify(r).slice(0, 80)}`); }
  }

  console.log(`\nSeeded: ${ok}/${LESSONS.length} (${fail} failed)`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
