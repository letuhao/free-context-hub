# Sprint 16.1 C4 — Code Surface Drafts Review (67 rows)

Read each row's **ideal_answer** + **facts**. For any that need changes:
- type the **id** + your edit in chat, OR
- edit `qc/queries.json` directly

When done, tell me to bulk-set `reviewed_by: letuhao1994@gmail.com`.

---

## 1. `auth-workspace-token-validate` — group: mcp-auth — 57w

**Query:** Where is workspace_token validated for MCP tool calls?

**Targets:** `src/index.ts`

**Ideal answer:** Token validation for MCP tool calls occurs in src/mcp/auth.ts via `resolveMcpCallerScope`, which is called as `resolveMcpCallerScopeOrThrow` at the top of every MCP tool handler in src/mcp/index.ts. When `MCP_AUTH_ENABLED=false`, auth is skipped. Otherwise the token is matched against the legacy env token or looked up in the api_keys table, returning a CallerScope that scopes all subsequent service calls.

**Must contain facts:**
  - token resolution happens at the start of every MCP tool handler
  - resolveMcpCallerScope is the function that performs token validation
  - MCP_AUTH_ENABLED controls whether validation is enforced
  - the token is matched against a legacy env var or an api_keys table row
  - a CallerScope value is returned and passed through to service functions

---

## 2. `mcp-streamable-http-endpoint` — group: mcp-server — 47w

**Query:** Where is the MCP HTTP endpoint implemented and what routes are exposed?

**Targets:** `src/index.ts`

**Ideal answer:** The MCP HTTP endpoint is implemented in src/index.ts. Both `POST /mcp` and `GET /mcp` are registered on an Express app created via `createMcpExpressApp()`. Each request creates a fresh stateless `StreamableHTTPServerTransport` (no session IDs) and a new `McpServer` instance returned by `createMcpToolsServer()`, then `handleRequest` dispatches the JSON-RPC payload.

**Must contain facts:**
  - POST /mcp and GET /mcp routes are both registered
  - a fresh StreamableHTTPServerTransport is created per request
  - the server is stateless — no session IDs are used
  - createMcpToolsServer() provides the tool implementations

---

## 3. `index-project-main-pipeline` — group: indexing — 60w

**Query:** How does index_project discover files, chunk them, embed, and write to Postgres?

**Targets:** `src/services/indexer.ts`, `src/services/embedder.ts`

**Ideal answer:** `indexProject` in src/services/indexer.ts uses fast-glob to enumerate files under the project root, skipping binary and oversized files. Each text file is split into chunks via smart or line-based chunking, then batches are sent to `embedTexts` in src/services/embedder.ts, which calls the `/v1/embeddings` API. Embeddings are validated for dimension, then upserted into the Postgres `chunks` table as pgvector literals inside a transaction.

**Must contain facts:**
  - fast-glob discovers files under the project root
  - files are chunked using smart or line-based chunking
  - embedTexts sends batches to the /v1/embeddings endpoint
  - embedding dimension is validated against EMBEDDINGS_DIM
  - chunk vectors are written to the chunks table as pgvector literals

---

## 4. `ignore-rules-loading` — group: indexing — 47w

**Query:** Where do ignore patterns come from and what default ignores are applied?

**Targets:** `src/utils/ignore.ts`, `src/services/indexer.ts`

**Ideal answer:** `loadIgnorePatternsFromRoot` in src/utils/ignore.ts merges three layers: built-in secret patterns (`.env`, `*.key`, lock files), built-in build-output patterns (`dist/`, `.next/`, `coverage/`, etc.), and optional user overrides from `.contexthub/ignore` in the project root. The indexer in src/services/indexer.ts then appends `**/.git/**` and `**/node_modules/**` unconditionally before passing the combined list to fast-glob.

**Must contain facts:**
  - loadIgnorePatternsFromRoot merges three pattern layers
  - default secret patterns cover env files and credential files
  - default build-output patterns cover dist, .next, coverage, and similar directories
  - user patterns can be added via a .contexthub/ignore file in the project root
  - the indexer appends .git and node_modules unconditionally

---

## 5. `embedding-request-shape` — group: embeddings — 48w

**Query:** How does the embeddings client call /v1/embeddings and validate dimensions?

**Targets:** `src/services/embedder.ts`

**Ideal answer:** `embedTexts` in src/services/embedder.ts sends a POST to `EMBEDDINGS_BASE_URL/v1/embeddings` with the model name and input texts, adding a Bearer token from `EMBEDDINGS_API_KEY` if set. After receiving the response, it sorts returned embeddings by `index` and validates each vector's length against `EMBEDDINGS_DIM`, throwing a dimension mismatch error if they differ.

**Must contain facts:**
  - the POST request goes to EMBEDDINGS_BASE_URL/v1/embeddings
  - EMBEDDINGS_API_KEY is sent as a Bearer Authorization header when set
  - response embeddings are sorted by the index field
  - each embedding length is validated against EMBEDDINGS_DIM
  - a dimension mismatch throws an error with the expected and actual values

---

## 6. `project-snapshot-rebuild` — group: snapshots — 44w

**Query:** Where is the project snapshot rebuilt and when does it update?

**Targets:** `src/services/snapshot.ts`, `src/services/indexer.ts`, `src/services/lessons.ts`

**Ideal answer:** `rebuildProjectSnapshot` in src/services/snapshot.ts queries the top 200 active lessons for the project and writes a markdown summary to the `project_snapshots` table via an upsert. It is called from src/services/lessons.ts after lesson add or status changes, ensuring the snapshot stays current whenever lesson data changes.

**Must contain facts:**
  - rebuildProjectSnapshot is defined in src/services/snapshot.ts
  - it reads up to 200 active lessons ordered by update time
  - the snapshot body is written to the project_snapshots table
  - the write uses an upsert so there is always at most one row per project
  - the function is called from the lessons service after add or status change

---

## 7. `kg-bootstrap` — group: kg — 43w

**Query:** How is the Neo4j Knowledge Graph bootstrapped on startup and schema ensured?

**Targets:** `src/kg/bootstrap.ts`, `src/kg/schema.ts`, `src/kg/client.ts`

**Ideal answer:** `bootstrapKgIfEnabled` in src/kg/bootstrap.ts returns immediately when `KG_ENABLED=false`. Otherwise it obtains the singleton Neo4j driver from `getNeo4jDriver` (src/kg/client.ts, lazy-initialized via the neo4j-driver package) and calls `ensureKgSchema` (src/kg/schema.ts), which creates uniqueness constraints for Project, File, Symbol, and Lesson nodes if they do not already exist.

**Must contain facts:**
  - bootstrapKgIfEnabled is a no-op when KG_ENABLED is false
  - the Neo4j driver is a singleton obtained from getNeo4jDriver
  - ensureKgSchema creates uniqueness constraints for the four node types
  - schema enforcement runs inside a write transaction

---

## 8. `kg-upsert-from-indexer` — group: kg — 49w

**Query:** Where is file graph upsert triggered during indexing?

**Targets:** `src/services/indexer.ts`, `src/kg/upsert.ts`

**Ideal answer:** After each file's chunks are committed to Postgres, src/services/indexer.ts calls `upsertFileGraphFromDisk` from src/kg/upsert.ts. That function skips silently when `KG_ENABLED=false` or the Neo4j driver is unavailable; otherwise it uses ts-morph to extract symbols and edges from the file and upserts them into Neo4j, clearing the file's prior graph data first.

**Must contain facts:**
  - upsertFileGraphFromDisk is called from the indexer after each file's chunks are written
  - the function is a no-op when KG_ENABLED is false or the driver is unavailable
  - prior graph data for the file is cleared before writing new symbols

---

## 9. `kg-ts-morph-extractor` — group: kg — 49w

**Query:** How do we extract TypeScript/JavaScript symbols and edges using ts-morph?

**Targets:** `src/kg/extractor/tsMorphExtractor.ts`

**Ideal answer:** `extractTsMorphFileGraph` in src/kg/extractor/tsMorphExtractor.ts parses a source file with the ts-morph `Project` API using in-memory analysis. It walks declarations (functions, classes, interfaces, enums, variables) to produce `ExtractedSymbol` entries, and records edges of types IMPORTS, CALLS, EXTENDS, and IMPLEMENTS. Fully qualified names are constructed from the file-relative path and declaration nesting.

**Must contain facts:**
  - ts-morph Project is used to parse each file in memory
  - declarations are walked to extract symbol name, kind, fqn, and signature
  - four edge types are produced: IMPORTS, CALLS, EXTENDS, IMPLEMENTS
  - fully qualified names combine the normalized file path with declaration context

---

## 10. `kg-query-tools` — group: kg — 44w

**Query:** Where are the KG MCP tools implemented (search_symbols, neighbors, trace path, lesson impact)?

**Targets:** `src/kg/query.ts`

**Ideal answer:** All four KG query functions live in src/kg/query.ts. `searchSymbols` does case-insensitive substring matching on Neo4j Symbol nodes. `getSymbolNeighbors` runs a variable-depth Cypher traversal. `traceDependencyPath` uses `shortestPath`. All functions return an empty result with a warning message when `KG_ENABLED=false` or the Neo4j driver is unavailable.

**Must contain facts:**
  - searchSymbols, getSymbolNeighbors, traceDependencyPath, and getLessonImpact are all in src/kg/query.ts
  - all four functions return an empty result with a warning when KG is disabled
  - searchSymbols performs case-insensitive substring matching on symbol name and fqn
  - getSymbolNeighbors uses a variable-depth Cypher graph traversal

---

## 11. `lessons-storage-and-search` — group: lessons — 63w

**Query:** Where are lessons stored and how does search_lessons retrieve matches?

**Targets:** `src/services/lessons.ts`

**Ideal answer:** Lessons are stored in the Postgres `lessons` table with a pgvector embedding column. `searchLessons` in src/services/lessons.ts embeds the query, then runs a hybrid SQL query combining cosine distance on the embedding column and FTS on the `fts` column, falling back to FTS-only when embeddings are unavailable. A salience boost from access history and optional LLM reranking are applied before returning the ranked list.

**Must contain facts:**
  - lessons are stored in the Postgres lessons table with a pgvector embedding column
  - searchLessons embeds the query and scores by cosine distance
  - FTS on the fts column provides a lexical fallback when embeddings are unavailable
  - a salience boost from access frequency can be blended into the score
  - optional LLM reranking is applied to the top candidates

---

## 12. `guardrails-check` — group: guardrails — 60w

**Query:** How does check_guardrails evaluate rules and return prompts?

**Targets:** `src/services/guardrails.ts`, `src/index.ts`

**Ideal answer:** `checkGuardrails` in src/services/guardrails.ts loads all active guardrail rules for the project, then tests the action string against each rule's trigger using exact match or regex. If no rule matches it returns `{pass: true}`. When a rule matches, it returns `{pass: false, needs_confirmation: true, prompt}` with the first matched rule's requirement as the prompt text, and writes an audit log entry.

**Must contain facts:**
  - checkGuardrails is defined in src/services/guardrails.ts
  - each rule trigger can be a literal string or a regex pattern
  - pass: true is returned when no trigger matches
  - a matching rule sets pass: false and needs_confirmation: true
  - every evaluation writes an entry to the guardrail_audit_logs table

---

## 13. `git-ingest-core` — group: git — 44w

**Query:** How does ingest_git_history parse git log/diff and upsert commits + files?

**Targets:** `src/services/gitIntelligence.ts`, `src/services/gitCommitFileParse.ts`

**Ideal answer:** `ingestGitHistory` in src/services/gitIntelligence.ts runs `git log` with record-separator format to parse commits, then calls `parseCommitFilesFromOutputs` (src/services/gitCommitFileParse.ts) on each commit's `--name-status` and `--numstat` output to produce per-file change rows. Both commits and file rows are upserted idempotently into `git_commits` and `git_commit_files` tables using ON CONFLICT.

**Must contain facts:**
  - git log is executed with a record-separator format for reliable parsing
  - parseCommitFilesFromOutputs parses both name-status and numstat output per commit
  - commits are upserted into the git_commits table
  - per-file rows are upserted into the git_commit_files table
  - both upserts use ON CONFLICT for idempotency

---

## 14. `git-deleted-files-handling` — group: git — 54w

**Query:** How are deleted files represented during commit ingestion (D change kind) and why aren't they dropped?

**Targets:** `src/services/gitCommitFileParse.ts`

**Ideal answer:** In `isIgnoredPath` in src/services/gitCommitFileParse.ts, when a file's change kind is `D` (deleted) the function immediately returns `false`, meaning the file is never filtered out by ignore patterns. This preserves historical accuracy — a deleted file no longer exists on disk, so glob-matching would falsely exclude it, but it still belongs in the commit record.

**Must contain facts:**
  - isIgnoredPath returns false unconditionally for change kind D
  - deleted files are kept to preserve historical commit accuracy
  - glob matching would incorrectly exclude deleted files because they no longer exist on disk

---

## 15. `git-proposal-upsert-idempotent` — group: git — 44w

**Query:** Where is idempotent draft proposal upsert implemented for suggest_lessons_from_commits?

**Targets:** `src/services/gitLessonProposalUpsert.ts`, `src/services/gitIntelligence.ts`

**Ideal answer:** `upsertGitLessonProposalDraft` in src/services/gitLessonProposalUpsert.ts inserts into the `git_lesson_proposals` table using an `ON CONFLICT` clause on `(project_id, source_commit_sha) WHERE status='draft'`. When a draft already exists for that commit it updates the content fields instead of inserting a duplicate. `suggestLessonsFromCommits` in src/services/gitIntelligence.ts calls this helper per commit.

**Must contain facts:**
  - upsertGitLessonProposalDraft is defined in src/services/gitLessonProposalUpsert.ts
  - the ON CONFLICT target is (project_id, source_commit_sha) filtered to status=draft
  - a conflicting draft row is updated in place rather than duplicated
  - suggestLessonsFromCommits calls this function once per commit

---

## 16. `repo-source-config` — group: sources — 47w

**Query:** How is remote git source configuration stored and retrieved?

**Targets:** `src/services/repoSources.ts`

**Ideal answer:** `configureProjectSource` in src/services/repoSources.ts upserts a row into the `project_sources` table with `source_type='remote_git'`, storing `git_url`, `default_ref`, and `repo_root`. The primary key is `(project_id, source_type)`, so repeated calls for the same project update the existing row. This table is also written by `prepareRepo` after a successful clone or fetch.

**Must contain facts:**
  - configureProjectSource is defined in src/services/repoSources.ts
  - configuration is stored in the project_sources table
  - the primary key is (project_id, source_type) enabling upsert semantics
  - git_url, default_ref, and repo_root are the stored fields

---

## 17. `prepare-repo-clone-fetch-checkout` — group: sources — 63w

**Query:** How does prepare_repo clone/fetch/checkout and record last_sync_commit?

**Targets:** `src/services/repoSources.ts`

**Ideal answer:** `prepareRepo` in src/services/repoSources.ts checks for an existing `.git` directory. If absent it tries to restore from S3 and falls back to `git clone`. If present it runs `git fetch --all --tags`. Either way it then runs `git checkout <ref>` followed by `git pull --ff-only`, then captures the resolved commit SHA via `git rev-parse HEAD` and stores it as `last_sync_commit` in the returned result.

**Must contain facts:**
  - existing .git directory triggers fetch rather than clone
  - missing repo attempts S3 restore before falling back to git clone
  - git checkout is called after clone or fetch
  - resolved SHA is captured via git rev-parse HEAD
  - the SHA is returned as last_sync_commit in the result

---

## 18. `s3-source-artifacts` — group: sources — 44w

**Query:** How are source artifacts synced to S3 and materialized back to disk (git bundle)?

**Targets:** `src/services/sourceArtifacts.ts`

**Ideal answer:** `syncSourceArtifactToS3` in src/services/sourceArtifacts.ts runs `git bundle create` to produce a bundle file, then uploads it to S3 via `PutObjectCommand` along with a `latest.json` metadata object. `materializeRepoFromS3` downloads the bundle via `GetObjectCommand` and unbundles it to disk. Both operations are no-ops when `SOURCE_STORAGE_MODE` is `local`.

**Must contain facts:**
  - a git bundle file is created before uploading to S3
  - PutObjectCommand uploads the bundle and a metadata JSON to S3
  - GetObjectCommand downloads the bundle for materialization to disk
  - both operations are skipped when SOURCE_STORAGE_MODE is local

---

## 19. `job-queue-postgres-claim` — group: queue — 55w

**Query:** How are async jobs stored and claimed from Postgres (SKIP LOCKED)?

**Targets:** `src/services/jobQueue.ts`

**Ideal answer:** Jobs are inserted into the `async_jobs` Postgres table with status `queued`. `claimNextQueuedJob` in src/services/jobQueue.ts uses a CTE with `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` to atomically select the oldest available job and update its status to `running`. This pattern prevents two workers from claiming the same job and avoids blocking on locked rows.

**Must contain facts:**
  - jobs are stored in the async_jobs Postgres table
  - claiming uses SELECT FOR UPDATE SKIP LOCKED inside a CTE
  - the claim atomically updates the row status to running
  - SKIP LOCKED prevents workers from blocking each other

---

## 20. `job-queue-rabbitmq` — group: queue — 50w

**Query:** How does RabbitMQ publishing work and how does the worker consume messages?

**Targets:** `src/services/jobQueue.ts`, `src/worker.ts`

**Ideal answer:** When `QUEUE_BACKEND=rabbitmq`, `enqueueJob` in src/services/jobQueue.ts asserts a durable queue, binds it to the topic exchange with `jobs.#`, and publishes the job_id via `channel.publish`. In src/worker.ts `startRabbitConsumer` calls `channel.consume` with `noAck: false`; on each message it calls `runJobById` then acks. On error it nacks without requeue, delegating retry to Postgres state.

**Must contain facts:**
  - enqueueJob asserts a durable queue and binds it to a topic exchange
  - the published message payload contains the job_id
  - startRabbitConsumer in worker.ts calls channel.consume to receive messages
  - successful processing calls channel.ack
  - errors call channel.nack without requeue, delegating retry to Postgres

---

## 21. `job-executor-dispatch` — group: queue — 45w

**Query:** Where does the worker dispatch job types to prepareRepo/ingestGitHistory/indexProject?

**Targets:** `src/services/jobExecutor.ts`

**Ideal answer:** `executeByType` in src/services/jobExecutor.ts is the central switch that dispatches job types. `repo.sync` calls `prepareRepo` then enqueues `git.ingest` and `index.run` as chained jobs with the same `correlation_id`. `git.ingest` calls `ingestGitHistory` and `index.run` calls `indexProject`. All worker-internal chain jobs set `callerScope: null` to document the trusted-global-actor intent.

**Must contain facts:**
  - executeByType is the dispatch switch in src/services/jobExecutor.ts
  - repo.sync calls prepareRepo and then enqueues git.ingest and index.run
  - chained jobs propagate the same correlation_id
  - worker-internal enqueues use callerScope: null

---

## 22. `workspace-scan-porcelain` — group: workspace — 48w

**Query:** How does scan_workspace detect modified/untracked/staged files in a local git workspace?

**Targets:** `src/services/workspaceTracker.ts`

**Ideal answer:** `scanWorkspaceChanges` in src/services/workspaceTracker.ts runs `git status --porcelain` in the workspace root, then parses each line's XY status code: staged files have a non-space first character (X), modified files have a non-space second character (Y), and `??` lines are untracked. The three sets are inserted into the `workspace_deltas` table.

**Must contain facts:**
  - git status --porcelain provides the raw output
  - the X (index) status column identifies staged files
  - the Y (worktree) status column identifies modified files
  - ?? lines identify untracked files
  - the three file sets are stored in the workspace_deltas table

---

## 23. `env-schema-queue-s3` — group: config — 39w

**Query:** Where are QUEUE_* and S3_* environment variables validated?

**Targets:** `src/env.ts`

**Ideal answer:** All environment variables are validated in `EnvSchema` in src/env.ts using Zod. `QUEUE_ENABLED` defaults to false; when enabled with `QUEUE_BACKEND=rabbitmq`, a `superRefine` rule requires `RABBITMQ_URL`. S3 variables (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) are required only when `SOURCE_STORAGE_MODE` is `s3` or `hybrid`.

**Must contain facts:**
  - all env vars are validated via a Zod EnvSchema in src/env.ts
  - QUEUE_ENABLED defaults to false
  - RABBITMQ_URL is required only when QUEUE_BACKEND is rabbitmq
  - S3 credentials are required only when SOURCE_STORAGE_MODE is s3 or hybrid

---

## 24. `migrations-git-intelligence` — group: db — 44w

**Query:** Which migration creates git intelligence tables and draft proposal uniqueness?

**Targets:** `migrations/0005_git_intelligence.sql`, `migrations/0007_git_lesson_proposals_draft_unique.sql`

**Ideal answer:** Migration `0005_git_intelligence.sql` creates `git_commits`, `git_commit_files`, `git_ingest_runs`, and `git_lesson_proposals`, including a partial unique index `uq_git_lesson_proposals_draft_per_commit` on `(project_id, source_commit_sha)` filtered to draft rows. Migration `0007_git_lesson_proposals_draft_unique.sql` is a backfill-safe re-apply of that same index using `CREATE UNIQUE INDEX IF NOT EXISTS` for databases that skipped migration 5.

**Must contain facts:**
  - 0005 creates git_commits with a (project_id, sha) primary key
  - 0005 creates git_commit_files with a change_kind check constraint
  - 0005 creates the git_lesson_proposals table
  - the partial unique index prevents duplicate draft proposals per commit
  - 0007 is a backfill migration that re-creates the same unique index idempotently

---

## 25. `migrations-sources-jobs` — group: db — 42w

**Query:** Which migration creates project_sources, project_workspaces, workspace_deltas, async_jobs?

**Targets:** `migrations/0006_sources_and_jobs.sql`

**Ideal answer:** Migration `0006_sources_and_jobs.sql` creates all four tables. `project_sources` has a `(project_id, source_type)` primary key with a type check allowing `remote_git` or `local_workspace`. `workspace_deltas` stores three `TEXT[]` arrays: `modified_files`, `untracked_files`, and `staged_files`. `async_jobs` has a status check constraint and `correlation_id` and `payload JSONB` columns.

**Must contain facts:**
  - 0006 creates project_sources, project_workspaces, workspace_deltas, and async_jobs
  - project_sources source_type is constrained to remote_git or local_workspace
  - workspace_deltas stores modified, untracked, and staged file arrays
  - async_jobs includes a correlation_id column and a JSONB payload column

---

## 26. `tool-output-formatting` — group: mcp-server — 43w

**Query:** How does the server format MCP tool responses (json_only/summary_only/auto_both)?

**Targets:** `src/utils/outputFormat.ts`, `src/index.ts`

**Ideal answer:** `formatToolResponse` in src/mcp/formatters.ts accepts an `OutputFormat` enum value and serializes the result accordingly: `json_only` emits minified JSON, `json_pretty` emits indented JSON, `summary_only` emits the human-readable summary string, and `auto_both` (the default) concatenates the summary text followed by minified JSON on the next line.

**Must contain facts:**
  - formatToolResponse is the formatting function used by all MCP tools
  - json_only emits minified JSON
  - summary_only emits only the human-readable summary string
  - auto_both concatenates summary text and minified JSON

---

## 27. `output-format-parser-smoke` — group: mcp-server — 46w

**Query:** Where do our clients parse MCP tool outputs that may contain summary+json (auto_both)?

**Targets:** `src/smoke/smokeTest.ts`, `src/smoke/phase5WorkerValidation.ts`

**Ideal answer:** Both `extractFirstTextJson` in src/smoke/smokeTest.ts and `extractJson` in src/smoke/phase5WorkerValidation.ts handle `auto_both` output by first attempting `JSON.parse` on the full text, then falling back to scanning for the first `{` and last `}` positions and parsing that substring. This tolerates the summary prefix emitted before the JSON payload.

**Must contain facts:**
  - extractFirstTextJson in smokeTest.ts handles auto_both output
  - extractJson in phase5WorkerValidation.ts applies the same pattern
  - both functions first attempt full JSON.parse
  - on failure they scan for the first and last brace to extract the JSON substring

---

## 28. `env-boolean-parser` — group: config — 52w

**Query:** How are boolean environment variables parsed safely?

**Targets:** `src/env.ts`

**Ideal answer:** `parseBooleanEnv` in src/env.ts converts a raw env value to boolean or undefined. It recognizes `true/1/yes/y/on` as true and `false/0/no/n/off` as false (case-insensitive), returns undefined for empty strings, and is used as a Zod `preprocess` step for every boolean flag in the schema so unrecognized strings produce validation errors rather than silently defaulting.

**Must contain facts:**
  - parseBooleanEnv is defined in src/env.ts
  - truthy strings include true, 1, yes, y, on
  - falsy strings include false, 0, no, n, off
  - empty or unrecognized values return undefined
  - it is used as a Zod preprocess wrapper for all boolean env flags

---

## 29. `mcp-tool-registrations` — group: mcp-server — 51w

**Query:** Where are MCP tools registered and which modules implement them?

**Targets:** `src/index.ts`

**Ideal answer:** MCP tools are registered via `server.registerTool` calls inside `createMcpToolsServer` in src/mcp/index.ts. Each registration provides a Zod input schema and an async handler that calls the appropriate service function imported from src/services/* or src/kg/*. The function returns the McpServer instance which is connected to a fresh transport per HTTP request in src/index.ts.

**Must contain facts:**
  - tools are registered via server.registerTool in src/mcp/index.ts
  - each registration includes a Zod input schema and an async handler
  - handlers call service functions from src/services or src/kg
  - createMcpToolsServer returns the McpServer instance

---

## 30. `db-migrations-apply` — group: db — 46w

**Query:** How does the server apply SQL migrations on startup?

**Targets:** `src/db/applyMigrations.ts`

**Ideal answer:** `applyMigrations` in src/db/applyMigrations.ts reads all `.sql` files from the `migrations/` directory in sorted order. It acquires a Postgres advisory lock (key `839201741`) to serialize concurrent processes, then for each file checks `schema_migrations` and skips already-applied files. New files are run in a transaction and recorded atomically.

**Must contain facts:**
  - migration files are read from the migrations/ directory in sorted order
  - a Postgres advisory lock prevents concurrent migration runs
  - schema_migrations table tracks which files have been applied
  - each new migration runs inside a BEGIN/COMMIT transaction

---

## 31. `db-pool-singleton` — group: db — 49w

**Query:** Where is the Postgres connection pool created and reused?

**Targets:** `src/db/client.ts`

**Ideal answer:** `getDbPool` in src/db/client.ts lazily creates a single `pg.Pool` instance backed by `DATABASE_URL`. A module-level variable holds the pool and is reused on every subsequent call, so the pool is a singleton for the process lifetime. The pool's `statement_timeout` is set to zero to allow long-running embedding and indexing statements.

**Must contain facts:**
  - getDbPool is defined in src/db/client.ts
  - the pool is created from DATABASE_URL using pg.Pool
  - a module-level variable ensures only one pool instance exists per process
  - statement_timeout is set to zero to accommodate long indexing queries

---

## 32. `guardrails-storage` — group: guardrails — 45w

**Query:** Where are guardrails stored and how are triggers matched?

**Targets:** `src/services/guardrails.ts`

**Ideal answer:** Guardrails are stored in the `guardrails` table joined to the `lessons` table via `rule_id`. The `matchTrigger` function in src/services/guardrails.ts treats a trigger as a regex if it is wrapped in `/pattern/` syntax, otherwise it performs an exact string comparison against the incoming action context string.

**Must contain facts:**
  - guardrails are stored in the guardrails table and joined to lessons via rule_id
  - only rules whose parent lesson has active or draft status are evaluated
  - a trigger wrapped in /pattern/ is treated as a regex
  - other triggers require exact string equality with the action

---

## 33. `lessons-distillation-enabled` — group: lessons — 51w

**Query:** Where does distillation affect lesson creation, summary, and conflict suggestions?

**Targets:** `src/services/lessons.ts`, `src/services/distiller.ts`

**Ideal answer:** In `addLesson` (src/services/lessons.ts), when `DISTILLATION_ENABLED=true` it calls `distillLesson` from src/services/distiller.ts to generate a `summary` and `quick_action`, and sets the initial lesson status to `active`. When disabled or when distillation fails, `summary` is null and the lesson is stored as `draft`. Conflict suggestions via semantic similarity are computed regardless of distillation state.

**Must contain facts:**
  - distillLesson is called from addLesson when DISTILLATION_ENABLED is true
  - successful distillation populates the summary and quick_action fields
  - a failed or disabled distillation leaves summary null and sets status to draft
  - conflict suggestions via embedding similarity are computed independently of DISTILLATION_ENABLED

---

## 34. `distiller-commit-suggestion-schema` — group: distillation — 46w

**Query:** How do we validate LLM output schema for commit-to-lesson suggestions?

**Targets:** `src/services/distiller.ts`

**Ideal answer:** In `suggestLessonFromCommit` (src/services/distiller.ts), the LLM response is extracted as a JSON object via `extractJsonObject`, then validated with `CommitLessonSuggestionSchema.safeParse`. The Zod schema requires non-empty `lesson_type`, `title`, `content`, `tags`, and `source_refs` fields, and includes a `.transform` on `source_refs` to strip any `[object Object]` strings emitted by the model.

**Must contain facts:**
  - CommitLessonSuggestionSchema is a Zod schema used to validate LLM output
  - safeParse is called and an error is thrown listing all schema violations on failure
  - the source_refs field has a transform that removes object-stringified entries
  - the git commit SHA is prepended to source_refs after validation

---

## 35. `job-correlation-filter` — group: queue — 47w

**Query:** How does list_jobs filter by correlation_id and why is it important for per-run reporting?

**Targets:** `src/services/jobQueue.ts`, `src/index.ts`

**Ideal answer:** `listJobs` in src/services/jobQueue.ts accepts an optional `correlationId` parameter that adds `correlation_id=$N` to the WHERE clause. When a `repo.sync` job fans out into `git.ingest` and `index.run`, all three share the same `correlation_id`. Callers can query the full status of a pipeline run by filtering on that shared ID.

**Must contain facts:**
  - listJobs accepts a correlationId parameter that filters the query
  - correlation_id is shared across all jobs spawned from a single repo.sync
  - filtering by correlation_id retrieves the complete status of a chained pipeline run

---

## 36. `rabbitmq-queue-assert-bind` — group: queue — 46w

**Query:** Where do we assert/bind RabbitMQ queues and what routing keys are used?

**Targets:** `src/services/jobQueue.ts`

**Ideal answer:** `ensureRabbitQueue` in src/services/jobQueue.ts asserts a durable named queue, then binds it to the `contexthub.jobs` topic exchange with the wildcard `jobs.#` routing key, so all job-type messages are delivered. Job-type-specific routing keys follow the pattern `jobs.<job_type>` with dots replaced by underscores, produced by the `routingKey` helper function.

**Must contain facts:**
  - ensureRabbitQueue asserts a durable queue per queue name
  - the queue is bound to the contexthub.jobs topic exchange
  - the binding uses the wildcard routing key jobs.# to capture all job types
  - published messages use a per-job-type routing key formed from the job type string

---

## 37. `worker-rabbitmq-consumer` — group: queue — 49w

**Query:** How does the worker start a RabbitMQ consumer and ack/nack messages?

**Targets:** `src/worker.ts`

**Ideal answer:** `startRabbitConsumer` in src/worker.ts calls `ch.prefetch(1)` then `ch.consume` with `noAck: false`. For each message it parses the `job_id` from the payload and calls `runJobById`. On success it calls `ch.ack`; on any error it calls `ch.nack(msg, false, false)` to discard without requeue and relies on the Postgres retry mechanism for backoff.

**Must contain facts:**
  - ch.prefetch(1) limits in-flight messages to one at a time
  - ch.consume is called with noAck: false so explicit ack/nack is required
  - successful job execution calls ch.ack
  - errors call ch.nack with requeue=false to avoid poison-message loops

---

## 38. `worker-fallback-postgres-polling` — group: queue — 59w

**Query:** Does the worker still poll Postgres as a fallback and where is that loop implemented?

**Targets:** `src/worker.ts`, `src/services/jobExecutor.ts`

**Ideal answer:** Yes. In src/worker.ts the `main` function runs an infinite loop that calls `runNextJob` on every iteration regardless of whether RabbitMQ is active. When the result is `{status: 'idle'}` the loop sleeps 1 second before retrying. This means Postgres polling always runs as a fallback for jobs that were enqueued via the REST API or that RabbitMQ may have missed.

**Must contain facts:**
  - an infinite loop in src/worker.ts calls runNextJob unconditionally
  - idle status causes a 1-second sleep before the next poll
  - Postgres polling runs even when RabbitMQ is active, acting as a fallback

---

## 39. `repo-sync-fanout` — group: queue — 45w

**Query:** When repo.sync succeeds, where do we enqueue git.ingest and index.run and propagate correlation_id?

**Targets:** `src/services/jobExecutor.ts`

**Ideal answer:** In the `repo.sync` case of `executeByType` in src/services/jobExecutor.ts, after `prepareRepo` returns successfully, two `enqueueJob` calls are made — one for `git.ingest` and one for `index.run` — both receiving the parent job's `correlation_id` as `chainCorrelation`. Both use `callerScope: null` to mark them as trusted worker-internal chains.

**Must contain facts:**
  - fanout happens inside the repo.sync case in executeByType
  - two enqueueJob calls are made: one for git.ingest and one for index.run
  - the parent job's correlation_id is propagated to both chained jobs
  - callerScope is set to null on worker-internal enqueues

---

## 40. `project-sources-schema` — group: sources — 49w

**Query:** What is the schema for project_sources and how does it support remote_git and local_workspace?

**Targets:** `migrations/0006_sources_and_jobs.sql`

**Ideal answer:** The `project_sources` table (created in migration 0006) has a composite primary key `(project_id, source_type)` where `source_type` is constrained to `remote_git` or `local_workspace`. It stores `git_url` and `default_ref` for remote sources, and `repo_root` as the local filesystem path. The `enabled` boolean lets operators toggle a source without deleting the row.

**Must contain facts:**
  - the primary key is (project_id, source_type)
  - source_type is constrained to remote_git or local_workspace
  - git_url and default_ref store remote repository coordinates
  - repo_root stores the local filesystem path
  - an enabled flag allows toggling without deletion

---

## 41. `workspace-deltas-schema` — group: workspace — 33w

**Query:** What table stores workspace deltas and what fields capture modified/untracked/staged files?

**Targets:** `migrations/0006_sources_and_jobs.sql`

**Ideal answer:** The `workspace_deltas` table (migration 0006) stores one row per scan with `modified_files TEXT[]`, `untracked_files TEXT[]`, and `staged_files TEXT[]` columns. Each row also carries `project_id`, `workspace_id` (FK to `project_workspaces`), `root_path`, and a `scanned_at` timestamp.

**Must contain facts:**
  - workspace_deltas has three TEXT array columns: modified_files, untracked_files, staged_files
  - each row records a single scan event with a scanned_at timestamp
  - workspace_id is a foreign key to the project_workspaces table

---

## 42. `scan-workspace-delta-index` — group: workspace — 40w

**Query:** How does scan_workspace optionally trigger delta indexing?

**Targets:** `src/services/workspaceTracker.ts`, `src/index.ts`

**Ideal answer:** After recording the delta in `workspace_deltas`, `scanWorkspaceChanges` in src/services/workspaceTracker.ts checks the `runDeltaIndex` parameter. When true it calls `indexProject` immediately and includes the result in the response as `index_result`. MCP callers pass this as `run_delta_index` in the tool arguments via src/mcp/index.ts.

**Must contain facts:**
  - delta indexing is controlled by the runDeltaIndex boolean parameter
  - when true, indexProject is called synchronously after the scan
  - the indexing result is returned in the response as index_result
  - the MCP tool exposes this as the run_delta_index argument

---

## 43. `delete-workspace-cascades` — group: storage — 35w

**Query:** When delete_workspace is called, which tables are cleared for phase 5/6 features?

**Targets:** `src/services/lessons.ts`

**Ideal answer:** `deleteWorkspace` in src/services/lessons.ts runs a manual cascade inside a transaction, explicitly deleting rows from `workspace_deltas`, `project_workspaces`, `project_sources`, `async_jobs`, `git_lesson_proposals`, `git_commit_files`, `git_commits`, `git_ingest_runs`, `project_snapshots`, guardrail tables, `chunks`, `files`, and `lessons`, then deletes the project row itself.

**Must contain facts:**
  - deleteWorkspace is defined in src/services/lessons.ts
  - it deletes rows from project_sources and async_jobs for Phase 5/6 features
  - it also clears git_commits, git_commit_files, and git_lesson_proposals
  - all deletes run inside a single transaction

---

## 44. `kg-ids-deterministic` — group: kg — 47w

**Query:** How are deterministic IDs generated for KG nodes and symbols?

**Targets:** `src/kg/ids.ts`

**Ideal answer:** `makeFileGraphId` and `makeSymbolGraphId` in src/kg/ids.ts produce deterministic IDs by calling `sha256Hex` on a pipe-delimited string. File IDs are derived from `projectId|normalizedFilePath`. Symbol IDs also include the `fqn` and `signature`, so a symbol's ID is stable across re-indexing as long as its qualified name and signature are unchanged.

**Must contain facts:**
  - IDs are generated by SHA-256 hashing a pipe-delimited composite key
  - file IDs are derived from projectId and normalized file path
  - symbol IDs additionally include fqn and signature
  - path separators are normalized to forward slashes before hashing

---

## 45. `kg-linker-lessons` — group: kg — 52w

**Query:** How are lessons linked to code symbols in Neo4j and what heuristics are used?

**Targets:** `src/kg/linker.ts`

**Ideal answer:** `linkLessonToSymbols` in src/kg/linker.ts parses each lesson's `source_refs` for file path or `file:symbol` patterns, then creates a directed relationship in Neo4j. The edge type is chosen by lesson type: guardrail-class types get `CONSTRAINS`, `preference` gets `PREFERS`, and all others get `MENTIONS`. The set of guardrail types is read from the shared `GUARDRAIL_LESSON_TYPES` constant.

**Must contain facts:**
  - linkLessonToSymbols is defined in src/kg/linker.ts
  - source_refs are parsed to extract file path and optional symbol name
  - edge type is determined by lesson type: CONSTRAINS for guardrails, PREFERS for preference
  - all other lesson types produce a MENTIONS edge

---

## 46. `kg-project-graph-delete` — group: kg — 47w

**Query:** How do we delete graph data for a project (cleanup)?

**Targets:** `src/kg/projectGraph.ts`

**Ideal answer:** `deleteProjectGraph` in src/kg/projectGraph.ts runs a Cypher `MATCH (n {project_id: $project_id}) DETACH DELETE n` inside a write transaction, removing all nodes and relationships for that project from Neo4j. It returns `{status: 'skipped'}` when `KG_ENABLED=false` and is called from `deleteWorkspace` as a best-effort operation (failures are logged, not rethrown).

**Must contain facts:**
  - deleteProjectGraph is defined in src/kg/projectGraph.ts
  - it uses DETACH DELETE to remove all project nodes and relationships
  - it returns skipped when KG_ENABLED is false
  - the call from deleteWorkspace is best-effort and does not rethrow errors

---

## 47. `git-impact-analysis` — group: git — 47w

**Query:** How does analyze_commit_impact combine changed files with KG symbol/lesson links?

**Targets:** `src/services/gitIntelligence.ts`

**Ideal answer:** `analyzeCommitImpact` in src/services/gitIntelligence.ts fetches affected file paths from `git_commit_files`, then when `KG_ENABLED` is true queries Neo4j for Symbol nodes matching those paths. A second Cypher query finds Lesson nodes connected to those symbols via MENTIONS/CONSTRAINS/PREFERS edges. When KG is disabled it returns file-only impact with a warning.

**Must contain facts:**
  - analyzeCommitImpact is defined in src/services/gitIntelligence.ts
  - affected files are read from the git_commit_files Postgres table
  - Neo4j is queried for Symbol nodes whose file_path matches affected files
  - a second Neo4j query finds lessons linked to those symbols
  - file-only results are returned when KG_ENABLED is false

---

## 48. `git-link-commit-to-lesson` — group: git — 46w

**Query:** How does link_commit_to_lesson update lesson source_refs and refresh symbol links?

**Targets:** `src/services/gitIntelligence.ts`

**Ideal answer:** `linkCommitToLesson` in src/services/gitIntelligence.ts fetches the commit's changed file list from `git_commit_files`, merges them with the lesson's existing `source_refs` and the `git:<sha>` ref, deduplicates, and writes the merged array back to the `lessons` table. It then calls `linkLessonToSymbols` to refresh Neo4j edges for the new file references.

**Must contain facts:**
  - linkCommitToLesson is defined in src/services/gitIntelligence.ts
  - changed file paths are read from git_commit_files
  - the git:<sha> ref is added along with file paths
  - the merged unique source_refs are written back to the lessons table
  - linkLessonToSymbols is called to refresh Neo4j edges

---

## 49. `git-proposal-sanitization` — group: git — 47w

**Query:** Where do we sanitize source_refs to avoid [object Object] and ensure determinism?

**Targets:** `src/services/gitIntelligence.ts`, `src/services/distiller.ts`

**Ideal answer:** Two complementary guards prevent `[object Object]` from entering `source_refs`. In src/services/gitIntelligence.ts, `normalizeSourceRefs` filters strings that match the pattern `[object …` and also extracts a string from object entries' known path fields. In src/services/distiller.ts, `CommitLessonSuggestionSchema` applies a Zod `.transform` on `source_refs` that strips any such strings after `safeParse`.

**Must contain facts:**
  - normalizeSourceRefs in gitIntelligence.ts filters strings starting with [object
  - normalizeSourceRefs also extracts a file_path or path field from object entries
  - the CommitLessonSuggestionSchema in distiller.ts applies a transform to strip [object strings
  - both guards work together for defense-in-depth

---

## 50. `mcp-health-endpoint` — group: mcp-server — 34w

**Query:** Where is the health endpoint implemented and what does it return?

**Targets:** `src/index.ts`

**Ideal answer:** The health endpoint is `GET /api/system/health` implemented in src/api/routes/system.ts (not src/index.ts). It returns `{status: 'ok', timestamp: <ISO string>}`. A companion route `GET /api/system/info` returns feature-flag status for embeddings, distillation, KG, queue, and other subsystems.

**Must contain facts:**
  - the health endpoint is GET /api/system/health in src/api/routes/system.ts
  - it returns a JSON object with status ok and a timestamp
  - a companion /api/system/info route exposes feature flag states

---

## 51. `mcp-output-format-default` — group: mcp-server — 40w

**Query:** What is the default output_format behavior and how is auto_both constructed?

**Targets:** `src/utils/outputFormat.ts`

**Ideal answer:** The default `output_format` is `auto_both`. In `formatToolResponse` (src/mcp/formatters.ts), `auto_both` constructs the response text as `${summary}\n${minifiedJson}` — the human-readable summary on the first line followed by the full JSON on the next. Clients that want only machine-readable output should pass `json_only`.

**Must contain facts:**
  - auto_both is the default output_format value
  - auto_both concatenates the summary string and minified JSON separated by a newline
  - json_only returns only minified JSON without a summary prefix

---

## 52. `config-default-project-id` — group: config — 44w

**Query:** How does DEFAULT_PROJECT_ID work and where is it applied when project_id is omitted?

**Targets:** `src/index.ts`, `src/env.ts`

**Ideal answer:** `DEFAULT_PROJECT_ID` is an optional env var defined in src/env.ts. `resolveProjectIdOrThrow` in src/mcp/index.ts falls back to `DEFAULT_PROJECT_ID` when a tool call omits `project_id`. If the tool argument is absent and the env var is also unset, it throws a `BAD_REQUEST` error, preventing an unscoped operation.

**Must contain facts:**
  - DEFAULT_PROJECT_ID is an optional env var defined in src/env.ts
  - resolveProjectIdOrThrow uses it as a fallback when project_id is omitted
  - if both project_id and DEFAULT_PROJECT_ID are absent a BAD_REQUEST error is thrown

---

## 53. `config-env-loading-dotenv` — group: config — 50w

**Query:** Where do we load .env and validate environment variables at startup?

**Targets:** `src/env.ts`

**Ideal answer:** src/env.ts calls `dotenv.config()` at the module top level before any other logic, loading the `.env` file into `process.env`. `getEnv` then calls `EnvSchema.safeParse` (via Zod) on the merged env, caches the result in a module-level variable on first call, and throws a descriptive error listing all invalid fields if validation fails.

**Must contain facts:**
  - dotenv.config() is called at module load time in src/env.ts
  - EnvSchema is a Zod schema that validates all required and optional env vars
  - getEnv caches the parsed result to avoid repeated parsing
  - a failed parse throws an error listing all invalid field paths

---

## 54. `config-embeddings-base-url` — group: embeddings — 43w

**Query:** Where is EMBEDDINGS_BASE_URL used to call the OpenAI-compatible embeddings API?

**Targets:** `src/services/embedder.ts`, `src/env.ts`

**Ideal answer:** `EMBEDDINGS_BASE_URL` is defined in src/env.ts with a default of `http://127.0.0.1:1234`. In src/services/embedder.ts, `embedTexts` constructs the full URL as `new URL('/v1/embeddings', EMBEDDINGS_BASE_URL)` and adds a `Bearer` Authorization header if `EMBEDDINGS_API_KEY` is set. This design is compatible with LM Studio, Ollama, and any OpenAI-compatible server.

**Must contain facts:**
  - EMBEDDINGS_BASE_URL defaults to http://127.0.0.1:1234 in src/env.ts
  - embedTexts appends /v1/embeddings to the base URL
  - an Authorization: Bearer header is added when EMBEDDINGS_API_KEY is set

---

## 55. `config-embeddings-api-key` — group: embeddings — 44w

**Query:** Where is EMBEDDINGS_API_KEY read and sent to the embeddings server?

**Targets:** `src/services/embedder.ts`, `src/env.ts`

**Ideal answer:** `EMBEDDINGS_API_KEY` is declared as an optional string in the Zod `EnvSchema` in src/env.ts. In src/services/embedder.ts, `embedTexts` conditionally adds an `Authorization: Bearer <key>` header to the fetch request when the env var is present. When absent, no Authorization header is sent, supporting unauthenticated local endpoints.

**Must contain facts:**
  - EMBEDDINGS_API_KEY is declared as an optional string in EnvSchema in src/env.ts
  - embedTexts in embedder.ts adds Authorization: Bearer only when the key is present
  - when the key is absent no Authorization header is sent

---

## 56. `config-distillation-enabled` — group: distillation — 42w

**Query:** Where do we gate LLM distillation with DISTILLATION_ENABLED?

**Targets:** `src/services/distiller.ts`, `src/services/lessons.ts`

**Ideal answer:** `DISTILLATION_ENABLED` is checked in two places. In src/services/lessons.ts, `addLesson` skips calling `distillLesson` and sets distillation status to `skipped` when the flag is false. In src/services/distiller.ts, `reflectOnTopic`, `compressText`, and `suggestLessonFromCommit` each return early with a warning or throw when the flag is false.

**Must contain facts:**
  - DISTILLATION_ENABLED=false causes addLesson in lessons.ts to skip distillLesson
  - distillation status is set to skipped when the flag is off
  - reflectOnTopic and compressText in distiller.ts return early with a warning when disabled
  - suggestLessonFromCommit in distiller.ts throws when DISTILLATION_ENABLED is false

---

## 57. `config-kg-enabled` — group: kg — 48w

**Query:** Where is KG_ENABLED validated and how do KG tools behave when disabled?

**Targets:** `src/env.ts`, `src/kg/query.ts`

**Ideal answer:** `KG_ENABLED` is declared in the Zod `EnvSchema` in src/env.ts with a default of false; when true, Neo4j credentials are also required via superRefine. In src/kg/query.ts, every query function — `searchSymbols`, `getSymbolNeighbors`, `traceDependencyPath`, and `getLessonImpact` — returns an empty result set plus a `warning` field when `KG_ENABLED` is false.

**Must contain facts:**
  - KG_ENABLED defaults to false in EnvSchema in src/env.ts
  - when KG_ENABLED=true the Neo4j credentials are also validated
  - searchSymbols and getSymbolNeighbors in kg/query.ts return empty results when disabled
  - all KG query functions include a warning field when KG_ENABLED is false

---

## 58. `auth-tool-wrapper` — group: mcp-auth — 48w

**Query:** Where is assertWorkspaceToken called for each MCP tool and what error does it throw?

**Targets:** `src/index.ts`

**Ideal answer:** Per-tool token enforcement is handled by `resolveMcpCallerScopeOrThrow` in src/mcp/index.ts (not src/index.ts), which is called at the start of every registered MCP tool handler. When `MCP_AUTH_ENABLED=true` and the token is missing or invalid, it throws a `ContextHubError` with code `UNAUTHORIZED`, which the MCP transport converts to an error response.

**Must contain facts:**
  - per-tool auth enforcement is in src/mcp/index.ts not src/index.ts
  - resolveMcpCallerScopeOrThrow is called at the top of every tool handler
  - a ContextHubError with UNAUTHORIZED code is thrown on invalid or missing token
  - the check is a no-op when MCP_AUTH_ENABLED is false

---

## 59. `auth-workspace-token-env` — group: mcp-auth — 46w

**Query:** Where is the workspace token configured (CONTEXT_HUB_WORKSPACE_TOKEN) and checked?

**Targets:** `src/env.ts`, `src/index.ts`

**Ideal answer:** `CONTEXT_HUB_WORKSPACE_TOKEN` is declared as an optional string in `EnvSchema` in src/env.ts and is deprecated in favour of scoped api_keys rows. The token is checked in src/mcp/auth.ts inside `resolveMcpCallerScope`: if the presented token matches the env var it grants a global null scope (or throws when `MCP_LEGACY_TOKEN_DISABLED=true`).

**Must contain facts:**
  - CONTEXT_HUB_WORKSPACE_TOKEN is an optional string in EnvSchema in src/env.ts
  - it is deprecated; scoped api_keys rows are the preferred auth mechanism
  - resolveMcpCallerScope in src/mcp/auth.ts compares the token against the env var
  - a matching legacy token returns null scope unless MCP_LEGACY_TOKEN_DISABLED=true

---

## 60. `indexer-chunk-size-config` — group: indexing — 46w

**Query:** Where are chunk sizes/overlap configured for indexing (and what defaults are used)?

**Targets:** `src/services/indexer.ts`

**Ideal answer:** Chunk size is configured by `CHUNK_LINES` (default 120) and `INDEX_EMBEDDING_BATCH_SIZE` (default 8) in src/env.ts. In src/services/indexer.ts, `indexProject` reads these as `chunkLines` and `batchSize`; callers may also pass `linesPerChunk` and `embeddingBatchSize` directly to override the env defaults. There is no overlap — chunks are non-overlapping line ranges.

**Must contain facts:**
  - CHUNK_LINES env var controls lines per chunk with a default of 120
  - INDEX_EMBEDDING_BATCH_SIZE defaults to 8 in src/env.ts
  - indexProject accepts linesPerChunk and embeddingBatchSize to override env defaults
  - chunks are non-overlapping line ranges with no overlap window

---

## 61. `retriever-search-code-boosts` — group: retrieval — 65w

**Query:** Where is search_code implemented and how do semantic/lexical/KG boosts combine?

**Targets:** `src/services/retriever.ts`

**Ideal answer:** `searchCode` is implemented in src/services/retriever.ts. The final score formula is `sem + 0.40 * lex + kg(0.25) + priorExplicit + priorLesson + priorIntent - scaffold`, where `sem` is the cosine similarity, `lex` is a normalised lexical token hit rate, `kg` adds 0.25 when the file is in the Neo4j symbol result set, and prior boosts are capped path matches. A scaffolding penalty is subtracted last.

**Must contain facts:**
  - searchCode is in src/services/retriever.ts
  - the lexical contribution is multiplied by 0.40 before adding to the semantic score
  - a KG hit adds a flat 0.25 boost when the file appears in Neo4j symbol results
  - lesson-path and intent-path priors add capped boosts per matching glob
  - a scaffolding penalty is subtracted to demote QC and script files

---

## 62. `retriever-default-excludes` — group: retrieval — 52w

**Query:** What default excludes are applied in search_code (tests, __tests__, smoke)?

**Targets:** `src/services/retriever.ts`

**Ideal answer:** By default `searchCode` in src/services/retriever.ts excludes chunks whose file path ends with `.test.ts` or contains `/__tests__/`, and separately excludes files under `src/smoke/`. These filters are applied as SQL WHERE clauses on the `chunks` table. Callers can override both with `includeTests=true` or `includeSmoke=true`, or by passing a `pathGlob` that explicitly matches those paths.

**Must contain facts:**
  - files ending with .test.ts are excluded by default from search_code results
  - files under __tests__ directories are also excluded by default
  - files under src/smoke/ are excluded unless includeSmoke=true
  - the exclusions are applied as SQL WHERE conditions on the chunks table
  - passing includeTests=true or includeSmoke=true overrides the respective exclusion

---

## 63. `queue-backend-selection` — group: queue — 44w

**Query:** Where is the queue backend selected (postgres vs rabbitmq) and what env vars control it?

**Targets:** `src/env.ts`, `src/services/jobQueue.ts`

**Ideal answer:** Backend selection is controlled by `QUEUE_ENABLED` (default false) and `QUEUE_BACKEND` (enum `postgres` | `rabbitmq`, default `postgres`) defined in src/env.ts. In src/services/jobQueue.ts, `enqueueJob` always writes to the `async_jobs` Postgres table, then additionally publishes to RabbitMQ when `QUEUE_ENABLED=true` and `QUEUE_BACKEND=rabbitmq`. `RABBITMQ_URL` is required in that case.

**Must contain facts:**
  - QUEUE_ENABLED defaults to false and must be true to activate queue features
  - QUEUE_BACKEND is an enum of postgres or rabbitmq with a default of postgres
  - RABBITMQ_URL is required when QUEUE_BACKEND=rabbitmq
  - enqueueJob always writes to the async_jobs Postgres table regardless of backend
  - RabbitMQ publish happens additionally when both QUEUE_ENABLED and rabbitmq backend are set

---

## 64. `queue-job-types` — group: queue — 42w

**Query:** Where are job types enumerated and dispatched?

**Targets:** `src/services/jobExecutor.ts`, `src/services/jobQueue.ts`

**Ideal answer:** `JobType` is a union of string literals (repo.sync, index.run, git.ingest, workspace.scan, quality.eval, and others) defined in src/services/jobQueue.ts. Dispatch happens in `executeByType` in src/services/jobExecutor.ts via a switch statement; `repo.sync` chains downstream jobs with a shared correlationId by calling `enqueueJob` for `git.ingest` and `index.run`.

**Must contain facts:**
  - JobType is a TypeScript union of string literals defined in src/services/jobQueue.ts
  - executeByType in src/services/jobExecutor.ts dispatches each job type via a switch
  - repo.sync enqueues downstream git.ingest and index.run jobs with a shared correlationId
  - worker-internal enqueueJob calls use callerScope null to signal trusted origin

---

## 65. `smoke-queue-tools-block` — group: smoke — 51w

**Query:** Where is the smoke test block for queue/source tools (prepare_repo, enqueue_job, run_next_job, scan_workspace)?

**Targets:** `src/smoke/smokeTest.ts`

**Ideal answer:** The queue/source tool block is in src/smoke/smokeTest.ts and is gated on `SMOKE_QUEUE_TOOLS=true`. When enabled, the block first verifies that `configure_project_source`, `prepare_repo`, `enqueue_job`, `run_next_job`, and `scan_workspace` are present in the tool list, then exercises `prepare_repo` + `enqueue_job` + `run_next_job` and asserts that an `index.run` job reached `succeeded` status for the shared correlationId.

**Must contain facts:**
  - the queue tool block is in src/smoke/smokeTest.ts
  - the block executes only when SMOKE_QUEUE_TOOLS=true
  - it verifies prepare_repo enqueue_job run_next_job and scan_workspace are listed
  - it asserts an index.run job reached succeeded for the shared correlationId

---

## 66. `ci-phase5-worker-validation-workflow` — group: ci — 45w

**Query:** Where is the GitHub Actions workflow that runs validate:phase5-worker on a schedule?

**Targets:** `.github/workflows/phase5-worker-validation.yml`

**Ideal answer:** The workflow is at `.github/workflows/phase5-worker-validation.yml`. It runs on a weekly schedule (Monday 06:00 UTC) and on `workflow_dispatch`. The job starts a mock embeddings server via `scripts/ci-mock-embeddings.mjs`, brings up `db`, `mcp`, and `worker` with Docker Compose, waits for the MCP endpoint, then runs `npm run validate:phase5-worker`.

**Must contain facts:**
  - the workflow file is .github/workflows/phase5-worker-validation.yml
  - it triggers on a weekly cron schedule every Monday at 06:00 UTC
  - it also supports manual workflow_dispatch triggers
  - it starts the mock embeddings server before running Docker Compose
  - it runs npm run validate:phase5-worker after MCP becomes ready

---

## 67. `ci-mock-embeddings-server` — group: ci — 43w

**Query:** Where is the CI mock embeddings server implemented and what API does it expose?

**Targets:** `scripts/ci-mock-embeddings.mjs`

**Ideal answer:** The CI mock embeddings server is implemented as a plain Node.js HTTP server in `scripts/ci-mock-embeddings.mjs`. It listens on port 1234 (overridable via `MOCK_EMBEDDINGS_PORT`) and responds to `POST /v1/embeddings` with deterministic 1024-dimensional float vectors computed by a simple index-based formula, matching the `EMBEDDINGS_DIM=1024` default.

**Must contain facts:**
  - the mock server is at scripts/ci-mock-embeddings.mjs
  - it listens on port 1234 by default configurable via MOCK_EMBEDDINGS_PORT
  - it handles POST /v1/embeddings requests
  - it returns deterministic 1024-dimensional vectors based on input index

---
