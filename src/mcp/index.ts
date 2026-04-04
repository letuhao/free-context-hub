import * as z from 'zod/v4';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import {
  // errors & auth
  ContextHubError,
  assertWorkspaceToken as coreAssertWorkspaceToken,
  resolveProjectIdOrThrow as coreResolveProjectIdOrThrow,
  // env & startup
  getEnv,
  // knowledge graph
  getLessonImpact,
  getSymbolNeighbors,
  searchSymbols,
  traceDependencyPath,
  // services
  indexProject,
  searchCode,
  tieredSearch,
  addLesson,
  deleteWorkspace,
  listLessons,
  searchLessons,
  searchLessonsMulti,
  listLessonVersions,
  updateLesson,
  updateLessonStatus,
  checkGuardrails,
  getProjectSnapshotBody,
  compressText,
  reflectOnTopic,
  analyzeCommitImpact,
  getCommit,
  ingestGitHistory,
  linkCommitToLesson,
  listCommits,
  suggestLessonsFromCommits,
  configureProjectSource,
  getProjectSource,
  prepareRepo,
  enqueueJob,
  listJobs,
  runNextJob,
  listWorkspaceRoots,
  registerWorkspaceRoot,
  scanWorkspaceChanges,
  resolveProjectRoot,
  getGeneratedDocument,
  listGeneratedDocuments,
  promoteGeneratedDocument,
  // project groups
  createGroup,
  deleteGroup,
  listGroups,
  listGroupMembers,
  addProjectToGroup,
  removeProjectFromGroup,
  listGroupsForProject,
  resolveProjectIds,
} from '../core/index.js';
import { formatToolResponse, OutputFormatSchema } from './formatters.js';

// ── MCP error boundary: convert ContextHubError → McpError at protocol edge ──
const CONTEXT_HUB_TO_MCP_CODE: Record<string, number> = {
  UNAUTHORIZED: ErrorCode.InvalidParams,
  BAD_REQUEST: ErrorCode.InvalidParams,
  NOT_FOUND: ErrorCode.InvalidParams,
  INTERNAL: ErrorCode.InternalError,
};

function assertWorkspaceToken(token?: string) {
  try { coreAssertWorkspaceToken(token); }
  catch (e) {
    if (e instanceof ContextHubError) throw new McpError(CONTEXT_HUB_TO_MCP_CODE[e.code] ?? ErrorCode.InternalError, e.message);
    throw e;
  }
}

function resolveProjectIdOrThrow(project_id?: string) {
  try { return coreResolveProjectIdOrThrow(project_id); }
  catch (e) {
    if (e instanceof ContextHubError) throw new McpError(CONTEXT_HUB_TO_MCP_CODE[e.code] ?? ErrorCode.InternalError, e.message);
    throw e;
  }
}

/** Parsed once at startup for tool schemas/help text (matches server defaults). */
const startupEnv = getEnv();

function createMcpToolsServer() {
  const server = new McpServer(
    {
      name: 'contexthub-self-hosted',
      version: '0.1.0',
      description: 'Self-hosted ContextHub (index/search/lessons/guardrails + optional Phase 4 Neo4j graph)',
    },
    {},
  );

  server.registerTool(
    'help',
    {
      description: 'Explain how to use this MCP server: tools, parameters, and sample workflows.',
      inputSchema: z.object({
        workspace_token: z
          .string()
          .optional()
          .describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        server: z.object({
          name: z.string(),
          version: z.string(),
          endpoint: z.string(),
          transport: z.string(),
        }),
        auth: z.object({
          mcp_auth_enabled: z.boolean(),
          workspace_token_required_when: z.string(),
          how_to_pass_token: z.string(),
        }),
        project_id: z.object({
          required_for: z.array(z.string()),
          optional_for: z.array(z.string()),
          default_env: z.string(),
          missing_behavior: z.string(),
        }),
        tools: z.array(
          z.object({
            name: z.string(),
            purpose: z.string(),
            key_parameters: z.array(z.object({ path: z.string(), required: z.boolean(), notes: z.string() })),
          }),
        ),
        workflows: z.array(
          z.object({
            name: z.string(),
            intent: z.string(),
            steps: z.array(
              z.object({
                tool: z.string(),
                arguments_template: z.any(),
                expected: z.string(),
              }),
            ),
          }),
        ),
        tool_call_templates: z.array(
          z.object({
            title: z.string(),
            request: z.any(),
          }),
        ),
        troubleshooting: z.array(z.object({ error: z.string(), cause: z.string(), fix: z.string() })),
        links: z.object({ readme: z.string(), quickstart: z.string() }),
      }),
    },
    async ({ workspace_token, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const env = getEnv();

      const endpoint = `http://localhost:${env.MCP_PORT}/mcp`;
      const requiredFor: string[] = [];
      const optionalFor = [
        'index_project',
        'search_code',
        'search_code_tiered',
        'add_lesson',
        'delete_workspace',
        'list_lessons',
        'search_lessons',
        'get_context',
        'check_guardrails',
        'help',
        'list_lesson_versions',
        'update_lesson',
        'update_lesson_status',
        'get_project_summary',
        'reflect',
        'compress_context',
        'search_symbols',
        'get_symbol_neighbors',
        'trace_dependency_path',
        'get_lesson_impact',
        'ingest_git_history',
        'list_commits',
        'get_commit',
        'suggest_lessons_from_commits',
        'link_commit_to_lesson',
        'analyze_commit_impact',
        'list_generated_documents',
        'get_generated_document',
        'promote_generated_document',
        'configure_project_source',
        'get_project_source',
        'prepare_repo',
        'enqueue_job',
        'list_jobs',
        'run_next_job',
        'register_workspace_root',
        'list_workspace_roots',
        'scan_workspace',
      ];

      const tokenNote = env.MCP_AUTH_ENABLED
        ? 'workspace_token is required for every tools/call.'
        : 'workspace_token is optional; server ignores it when MCP_AUTH_ENABLED=false.';

      const tools = [
        {
          name: 'index_project',
          purpose: 'Index files under a root into chunks + embeddings (idempotent). root auto-resolved from project config.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID from server env if omitted.' },
            { path: 'root', required: false, notes: 'Auto-resolved from project_sources/workspace. Pass to override.' },
            {
              path: 'options.lines_per_chunk',
              required: false,
              notes: `Default: ${startupEnv.CHUNK_LINES} (CHUNK_LINES).`,
            },
            {
              path: 'options.embedding_batch_size',
              required: false,
              notes: `Default: ${startupEnv.INDEX_EMBEDDING_BATCH_SIZE} (INDEX_EMBEDDING_BATCH_SIZE).`,
            },
          ],
        },
        {
          name: 'search_code',
          purpose: 'Semantic search over indexed code chunks (pgvector). Legacy tool — use search_code_tiered for better accuracy.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'query', required: true, notes: 'Natural language query.' },
            { path: 'filters.path_glob', required: false, notes: "Optional filter, e.g. 'src/**/*.ts'." },
            { path: 'limit', required: false, notes: 'Top-k results (default 10).' },
          ],
        },
        {
          name: 'search_code_tiered',
          purpose: 'Multi-tier search with 3 auto-selected profiles: code-search (ripgrep > symbol > FTS > semantic), relationship (convention paths > KG > filtered ripgrep for tests), semantic-first (vector > FTS for docs). Returns ALL candidate files with tier/kind labels.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'query', required: true, notes: 'Identifier, file path, or natural language query.' },
            { path: 'kind', required: false, notes: "Filter by data kind: 'source', 'type_def', 'test', 'migration', 'config', 'dependency', 'api_spec', 'doc', 'script', 'infra', 'style', 'generated'. Or array." },
            { path: 'max_files', required: false, notes: 'Max files to return (default 50).' },
            { path: 'semantic_threshold', required: false, notes: 'Min deterministic results before semantic is skipped (default 3). Set 0 to always include semantic.' },
          ],
        },
        {
          name: 'list_lessons',
          purpose: 'List lessons with cursor pagination + filters (type/tags).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'filters.lesson_type', required: false, notes: 'Optional lesson type filter.' },
            { path: 'filters.tags_any', required: false, notes: 'Any-overlap tag filter.' },
            { path: 'filters.status', required: false, notes: 'Optional lifecycle filter (draft/active/superseded/archived).' },
            { path: 'page.limit', required: false, notes: 'Default: 20 (max 100).' },
            { path: 'page.after', required: false, notes: 'Cursor from previous response.' },
          ],
        },
        {
          name: 'search_lessons',
          purpose: 'Semantic search across all lesson types using lesson embeddings.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'query', required: true, notes: 'Natural language query.' },
            { path: 'filters.lesson_type', required: false, notes: 'Optional lesson type filter.' },
            { path: 'filters.tags_any', required: false, notes: 'Optional tags filter.' },
            { path: 'filters.include_all_statuses', required: false, notes: 'Include superseded/archived when true.' },
            { path: 'limit', required: false, notes: 'Top-k results (default 10, max 50).' },
          ],
        },
        {
          name: 'list_generated_documents',
          purpose: 'List DB-first generated artifacts (FAQ/RAPTOR/QC/benchmarks) for audit.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'doc_type', required: false, notes: 'Optional filter: faq|raptor|qc_report|qc_artifact|benchmark_artifact.' },
            { path: 'doc_status', required: false, notes: "Optional: 'draft' | 'active' (filters metadata.status)." },
            { path: 'limit', required: false, notes: 'Default 100, max 1000.' },
            { path: 'include_content', required: false, notes: 'Include full content when true (default false).' },
          ],
        },
        {
          name: 'get_generated_document',
          purpose: 'Get one generated artifact by doc_id or (doc_type + doc_key).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'doc_id', required: false, notes: 'Preferred direct lookup key.' },
            { path: 'doc_type', required: false, notes: 'Required with doc_key when doc_id is omitted.' },
            { path: 'doc_key', required: false, notes: 'Required with doc_type when doc_id is omitted.' },
          ],
        },
        {
          name: 'promote_generated_document',
          purpose: 'Promote a draft generated document to active (sets metadata.status=active).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'doc_id', required: false, notes: 'Lookup by id, or use doc_type + doc_key.' },
            { path: 'doc_type', required: false, notes: 'With doc_key when doc_id omitted.' },
            { path: 'doc_key', required: false, notes: 'With doc_type when doc_id omitted.' },
          ],
        },
        {
          name: 'add_lesson',
          purpose: 'Persist a durable lesson; optionally also creates a guardrail rule.',
          key_parameters: [
            { path: 'lesson_payload.project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'lesson_payload.lesson_type', required: true, notes: 'decision|preference|guardrail|workaround|general_note.' },
            { path: 'lesson_payload.title', required: true, notes: 'Short label.' },
            { path: 'lesson_payload.content', required: true, notes: 'Full content (embedded for semantic search).' },
            { path: 'lesson_payload.tags', required: false, notes: 'Array of tag strings for filtering (e.g., ["auth", "security"]).' },
            { path: 'lesson_payload.source_refs', required: false, notes: 'Array of file paths or links (e.g., ["src/auth.ts"]).' },
            { path: 'lesson_payload.guardrail', required: false, notes: 'Required when lesson_type="guardrail". Object with: trigger (string or /regex/), requirement (string), verification_method (string, e.g., "user_confirmation"). All 3 subfields required.' },
          ],
        },
        {
          name: 'check_guardrails',
          purpose: 'Evaluate guardrails for a proposed action; returns pass/fail + confirmation prompt.',
          key_parameters: [
            { path: 'action_context.action', required: true, notes: "Action string, e.g. 'git push'." },
            {
              path: 'action_context.project_id|workspace',
              required: false,
              notes: 'Optional; uses DEFAULT_PROJECT_ID if both are omitted.',
            },
          ],
        },
        {
          name: 'get_context',
          purpose: 'Bootstrap context: returns docs refs + suggested next tool calls (no large bundles).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'task.intent', required: false, notes: 'High-level intent (used for suggestions).' },
            { path: 'task.query', required: false, notes: 'Optional query string for suggestions.' },
            { path: 'task.path_glob', required: false, notes: 'Optional path filter for suggested search_code.' },
          ],
        },
        {
          name: 'list_lesson_versions',
          purpose: 'List version history for a lesson (previous snapshots before each edit).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'lesson_id', required: true, notes: 'Lesson UUID.' },
          ],
        },
        {
          name: 'update_lesson',
          purpose: 'Update lesson content, title, tags, or source_refs. Auto re-embeds and creates version history.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'lesson_id', required: true, notes: 'Lesson UUID.' },
            { path: 'title', required: false, notes: 'New title.' },
            { path: 'content', required: false, notes: 'New content.' },
            { path: 'tags', required: false, notes: 'New tags array (replaces all).' },
            { path: 'changed_by', required: false, notes: 'Who made the change (audit).' },
            { path: 'change_summary', required: false, notes: 'Short description of the change.' },
          ],
        },
        {
          name: 'update_lesson_status',
          purpose: 'Set lesson lifecycle status and optional supersession link.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'lesson_id', required: true, notes: 'Lesson UUID.' },
            { path: 'status', required: true, notes: 'draft|active|superseded|archived.' },
            { path: 'superseded_by', required: false, notes: 'Replacement lesson UUID when superseding.' },
          ],
        },
        {
          name: 'get_project_summary',
          purpose: 'Read the pre-built project snapshot text (fast).',
          key_parameters: [{ path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' }],
        },
        {
          name: 'reflect',
          purpose: 'LLM synthesis over retrieved lessons for a topic (requires distillation enabled).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'topic', required: true, notes: 'Topic/question string.' },
          ],
        },
        {
          name: 'compress_context',
          purpose: 'Compress arbitrary text using the configured chat model (optional).',
          key_parameters: [
            { path: 'text', required: true, notes: 'Input text.' },
            { path: 'max_output_chars', required: false, notes: 'Soft output cap.' },
          ],
        },
        {
          name: 'delete_workspace',
          purpose: 'Delete all stored data for a project_id (lessons, chunks, guardrails, logs).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
          ],
        },
        {
          name: 'search_symbols',
          purpose: 'Search TS/JS symbols in the Neo4j graph (Phase 4; requires KG_ENABLED=true).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'query', required: true, notes: 'Substring match against symbol name / FQN.' },
            { path: 'limit', required: false, notes: 'Default 10.' },
          ],
        },
        {
          name: 'get_symbol_neighbors',
          purpose: 'Expand a symbol neighborhood in the Neo4j graph (depth 1..4).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'symbol_id', required: true, notes: 'Deterministic symbol id from search_symbols / indexing.' },
            { path: 'depth', required: false, notes: 'Default 1.' },
            { path: 'limit', required: false, notes: 'Default 40.' },
          ],
        },
        {
          name: 'trace_dependency_path',
          purpose: 'Shortest path between two symbols (same project) in the Neo4j graph.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'from_symbol_id', required: true, notes: 'Start symbol id.' },
            { path: 'to_symbol_id', required: true, notes: 'End symbol id.' },
            { path: 'max_hops', required: false, notes: 'Upper bound for shortestPath (default 12).' },
          ],
        },
        {
          name: 'get_lesson_impact',
          purpose: 'Show lesson-to-symbol links and impacted files from the Neo4j graph.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'lesson_id', required: true, notes: 'Lesson UUID.' },
            { path: 'limit', required: false, notes: 'Cap linked symbols (default 50).' },
          ],
        },
        {
          name: 'ingest_git_history',
          purpose: 'Ingest git commits/files into Postgres for automation memory (Phase 5).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'root', required: true, notes: 'Repository root path on server host/container.' },
            { path: 'since', required: false, notes: 'Optional git --since expression.' },
            { path: 'max_commits', required: false, notes: 'Optional cap (default from env).' },
          ],
        },
        {
          name: 'list_commits',
          purpose: 'List ingested commits for a project.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'limit', required: false, notes: 'Max results (default 20).' },
          ],
        },
        {
          name: 'get_commit',
          purpose: 'Get one ingested commit with changed files.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'sha', required: true, notes: 'Git commit SHA.' },
          ],
        },
        {
          name: 'suggest_lessons_from_commits',
          purpose: 'Create draft lesson proposals from ingested commits (Phase 5).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'commit_shas', required: false, notes: 'Optional SHA list; defaults to latest commits.' },
            { path: 'limit', required: false, notes: 'Proposal count cap.' },
          ],
        },
        {
          name: 'link_commit_to_lesson',
          purpose: 'Attach commit refs/files into an existing lesson and refresh symbol links.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'commit_sha', required: true, notes: 'Git commit SHA.' },
            { path: 'lesson_id', required: true, notes: 'Existing lesson UUID.' },
          ],
        },
        {
          name: 'analyze_commit_impact',
          purpose: 'Analyze commit impact using changed files and KG symbol/lesson links.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'commit_sha', required: true, notes: 'Git commit SHA.' },
            { path: 'limit', required: false, notes: 'Result cap for symbols/lessons.' },
          ],
        },
        {
          name: 'configure_project_source',
          purpose: 'Configure remote git source for a project (URL, branch, credentials).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'git_url', required: true, notes: 'Remote git repository URL (https).' },
            { path: 'branch', required: false, notes: 'Default branch (default: main).' },
          ],
        },
        {
          name: 'prepare_repo',
          purpose: 'Clone or fetch a remote repo to local cache for indexing.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'git_url', required: true, notes: 'Remote git repository URL.' },
          ],
        },
        {
          name: 'enqueue_job',
          purpose: 'Enqueue async worker job. MOST jobs require payload.root. repo.sync requires payload.git_url.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'job_type', required: true, notes: 'repo.sync | index.run | git.ingest | faq.build | raptor.build | quality.eval | knowledge.*.' },
            { path: 'payload.root', required: false, notes: 'REQUIRED for most jobs (filesystem path to project). Not needed for repo.sync, quality.eval, knowledge.loop.*.' },
            { path: 'payload.git_url', required: false, notes: 'REQUIRED for repo.sync only (remote git URL).' },
          ],
        },
        {
          name: 'list_jobs',
          purpose: 'List async worker jobs. Use correlation_id to track jobs from one pipeline run.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'correlation_id', required: false, notes: 'Filter by pipeline run correlation ID.' },
            { path: 'status', required: false, notes: 'Filter: queued|running|succeeded|failed|dead_letter.' },
          ],
        },
        {
          name: 'run_next_job',
          purpose: 'Execute the next queued job (worker process). Call repeatedly to drain queue.',
          key_parameters: [
            { path: 'queue_name', required: false, notes: 'Queue to poll (default: "default").' },
          ],
        },
        {
          name: 'register_workspace_root',
          purpose: 'Register filesystem root path for a project (enables ripgrep search).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'root_path', required: true, notes: 'Absolute filesystem path to project root.' },
          ],
        },
        {
          name: 'list_workspace_roots',
          purpose: 'List registered workspace roots for a project.',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
          ],
        },
        {
          name: 'scan_workspace',
          purpose: 'Scan workspace for changed files since last index (uses git status).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'root', required: true, notes: 'Workspace root path to scan.' },
          ],
        },
      ];

      const workspaceToken = env.MCP_AUTH_ENABLED ? 'REQUIRED_TOKEN' : undefined;
      const projectId = env.DEFAULT_PROJECT_ID ?? 'your-project-id';

      const tool_call_templates = [
        {
          title: 'Call help',
          request: {
            method: 'tools/call',
            params: { name: 'help', arguments: { workspace_token: workspaceToken, output_format: 'json_pretty' } },
          },
        },
        {
          title: 'Index this repo',
          request: {
            method: 'tools/call',
            params: {
              name: 'index_project',
              arguments: {
                workspace_token: workspaceToken,
                project_id: projectId,
                root: 'D:/path/to/repo',
                options: {
                  lines_per_chunk: startupEnv.CHUNK_LINES,
                  embedding_batch_size: startupEnv.INDEX_EMBEDDING_BATCH_SIZE,
                },
              },
            },
          },
        },
        {
          title: 'Search code by intent',
          request: {
            method: 'tools/call',
            params: {
              name: 'search_code',
              arguments: {
                workspace_token: workspaceToken,
                project_id: projectId,
                query: 'Where do we validate workspace tokens?',
                filters: { path_glob: 'src/**/*.ts' },
                limit: 5,
              },
            },
          },
        },
      ];

      const workflows = [
        {
          name: 'SessionStart',
          intent: 'Bootstrap minimal context and decide next searches.',
          steps: [
            {
              tool: 'get_context',
              arguments_template: { workspace_token: workspaceToken, project_id: projectId, task: { intent: 'Your task' } },
              expected: 'context_refs + suggested_next_calls',
            },
            {
              tool: 'search_lessons',
              arguments_template: { workspace_token: workspaceToken, project_id: projectId, query: 'Your task', limit: 5 },
              expected: 'matches[] of relevant lessons',
            },
            {
              tool: 'search_code',
              arguments_template: { workspace_token: workspaceToken, project_id: projectId, query: 'Your task', limit: 5 },
              expected: 'matches[] of relevant code snippets',
            },
          ],
        },
        {
          name: 'CaptureAndReusePreference',
          intent: 'Save a preference once and retrieve it later.',
          steps: [
            {
              tool: 'add_lesson',
              arguments_template: {
                workspace_token: workspaceToken,
                lesson_payload: {
                  project_id: projectId,
                  lesson_type: 'preference',
                  title: 'Prefer strict TypeScript',
                  content: 'We use strict TypeScript for all services.',
                  tags: ['preference-typescript'],
                },
              },
              expected: 'lesson_id',
            },
            {
              tool: 'search_lessons',
              arguments_template: { workspace_token: workspaceToken, project_id: projectId, query: 'TypeScript preference', limit: 5 },
              expected: 'matches[] includes the saved preference',
            },
          ],
        },
      ];

      const troubleshooting = [
        {
          error: 'Unauthorized: invalid workspace_token',
          cause: 'MCP_AUTH_ENABLED=true but workspace_token missing or incorrect.',
          fix: 'Set CONTEXT_HUB_WORKSPACE_TOKEN and pass workspace_token in every tools/call.',
        },
        {
          error: 'Bad Request: missing project_id and DEFAULT_PROJECT_ID is not set',
          cause: 'Tool was called without project_id and server has no DEFAULT_PROJECT_ID.',
          fix: 'Pass project_id explicitly or set DEFAULT_PROJECT_ID in env.',
        },
        {
          error: 'Embedding dimension mismatch',
          cause: 'Embedding model output dim != EMBEDDINGS_DIM / DB vector dimension.',
          fix: 'Ensure EMBEDDINGS_DIM=1024 and model matches DB schema.',
        },
      ];

      const result = {
        server: { name: 'contexthub-self-hosted', version: '0.1.0', endpoint, transport: 'streamableHttp' },
        auth: {
          mcp_auth_enabled: Boolean(env.MCP_AUTH_ENABLED),
          workspace_token_required_when: 'Required only when MCP_AUTH_ENABLED=true.',
          how_to_pass_token: tokenNote,
        },
        project_id: {
          required_for: requiredFor,
          optional_for: optionalFor,
          default_env: 'DEFAULT_PROJECT_ID',
          missing_behavior:
            'InvalidParams if neither project_id nor DEFAULT_PROJECT_ID is set. When DEFAULT_PROJECT_ID is set, all tools may omit project_id.',
        },
        tools,
        workflows,
        tool_call_templates,
        troubleshooting,
        links: { readme: 'README.md', quickstart: 'docs/QUICKSTART.md' },
      };

      const summary = `help: tools=${tools.length}, workflows=${workflows.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'index_project',
    {
      description: 'Idempotent project indexing: discovers files, chunks, embeds, and stores vectors.',
      inputSchema: z.object({
        workspace_token: z
          .string()
          .optional()
          .describe('MVP workspace token (required only if MCP_AUTH_ENABLED=true)'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier for scoping stored vectors. Optional if DEFAULT_PROJECT_ID is set on the server.'),
        root: z.string().min(1).optional().describe('Project root path. Optional — auto-resolved from project_sources/workspace when omitted. Just pass project_id.'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
        options: z
          .object({
            lines_per_chunk: z
              .number()
              .int()
              .positive()
              .optional()
              .describe(`Chunk size in lines (default: ${startupEnv.CHUNK_LINES} from CHUNK_LINES).`),
            embedding_batch_size: z
              .number()
              .int()
              .positive()
              .optional()
              .describe(`Embedding batch size (default: ${startupEnv.INDEX_EMBEDDING_BATCH_SIZE} from INDEX_EMBEDDING_BATCH_SIZE).`),
          })
          .optional(),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error']),
        files_indexed: z.number().int().nonnegative(),
        generated_docs_indexed: z.number().int().nonnegative().optional(),
        generated_chunks_indexed: z.number().int().nonnegative().optional(),
        duration_ms: z.number().int().nonnegative(),
        errors: z.array(
          z.object({
            path: z.string(),
            message: z.string(),
          }),
        ),
      }),
    },
    async ({ workspace_token, project_id, root, output_format, options }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(project_id);
      const resolvedRoot = await resolveProjectRoot(projectId, root);
      const result = await indexProject({
        projectId,
        root: resolvedRoot,
        linesPerChunk: options?.lines_per_chunk,
        embeddingBatchSize: options?.embedding_batch_size,
      });
      const summary = `index_project: status=${result.status}, files_indexed=${result.files_indexed}, duration_ms=${result.duration_ms}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'search_code',
    {
      description: 'Semantic code search over indexed chunks using vector similarity.',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier to search within. Optional if DEFAULT_PROJECT_ID is set on the server.'),
        query: z.string().min(1).describe('Natural language query to embed and search against.'),
        filters: z
          .object({
            path_glob: z.string().min(1).optional().describe("Optional path glob filter (stored paths are POSIX-like). Example: 'src/**/*.ts'."),
            include_tests: z.boolean().optional().describe('When true, include *.test.ts and __tests__ paths (default: false).'),
            include_smoke: z.boolean().optional().describe('When true, include src/smoke/* paths (default: false).'),
            prefer_paths: z
              .array(z.string().min(1))
              .optional()
              .describe("Optional list of preferred path globs to boost (MVP examples: 'src/index.ts', 'src/services/**')."),
            qc_no_cap: z
              .boolean()
              .optional()
              .describe('QC-only debug flag: disable per-file cap in retriever ranking (not for normal production usage).'),
            lexical_boost: z.boolean().optional().describe('When true, apply lightweight lexical boosting (default: true).'),
            kg_assist: z.boolean().optional().describe('When true and KG_ENABLED=true, use KG symbol search to boost relevant files (default: false).'),
            lesson_to_code: z
              .boolean()
              .optional()
              .describe('When true, expand query via semantically similar lesson source_refs and boost those code paths (default: true).'),
            rerank_mode: z
              .enum(['off', 'llm'])
              .optional()
              .describe('Optional rerank mode for online interactive queries (default: off).'),
            hybrid_mode: z
              .enum(['off', 'lexical'])
              .optional()
              .describe('Optional hybrid retrieval mode. lexical enables semantic + lexical candidate expansion (default: off).'),
          })
          .optional(),
        limit: z.number().int().positive().optional().describe('Max number of matches to return (default: 10).'),
        debug: z.boolean().optional().describe('When true, include debug explanations.'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        matches: z.array(
          z.object({
            path: z.string(),
            start_line: z.number().int().nonnegative(),
            end_line: z.number().int().nonnegative(),
            snippet: z.string(),
            score: z.number(),
            match_type: z.enum(['semantic']),
          }),
        ),
        explanations: z.array(z.string()),
      }),
    },
    async ({ workspace_token, project_id, query, filters, limit, debug, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(project_id);
      const result = await searchCode({
        projectId,
        query,
        pathGlob: filters?.path_glob,
        includeTests: filters?.include_tests,
        includeSmoke: filters?.include_smoke,
        preferPaths: filters?.prefer_paths,
        qcNoCap: filters?.qc_no_cap,
        rerankMode: filters?.rerank_mode,
        lexicalBoost: filters?.lexical_boost,
        kgAssist: filters?.kg_assist,
        lessonToCode: filters?.lesson_to_code,
        hybridMode: filters?.hybrid_mode,
        limit,
        debug,
      });
      const summary = `search_code: matches=${result.matches.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  // ── Tiered Search (deterministic-first, for coder agents) ──────────────
  server.registerTool(
    'search_code_tiered',
    {
      description:
        'Multi-tier code search optimized for coder agents. Automatically selects search profile based on kind: ' +
        'code/config/type files use deterministic-first search (ripgrep > symbol > FTS > semantic fallback); ' +
        'test files use relationship-aware search (convention paths > KG imports > filtered ripgrep); ' +
        'doc/script files use semantic-first search (vector similarity > FTS > ripgrep). ' +
        'Returns ALL candidate files grouped by tier and kind, so the agent can choose what to read.',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier. Optional if DEFAULT_PROJECT_ID is set.'),
        query: z.string().min(1).describe('Search query. Can be an identifier (parseBooleanEnv), a path (src/env.ts), or natural language.'),
        kind: z
          .union([
            z.enum(['source', 'type_def', 'test', 'migration', 'config', 'dependency', 'api_spec', 'doc', 'script', 'infra', 'style', 'generated']),
            z.array(z.enum(['source', 'type_def', 'test', 'migration', 'config', 'dependency', 'api_spec', 'doc', 'script', 'infra', 'style', 'generated'])),
          ])
          .optional()
          .describe(
            'Filter by data kind: source (implementation code), type_def (interfaces/models/schemas), test, ' +
            'migration (DB migrations/seeds), config (.env/yaml/json settings), dependency (package.json/go.mod), ' +
            'api_spec (OpenAPI/GraphQL/protobuf), doc (markdown/README), script (utility scripts), ' +
            'infra (CI/CD/Docker/Terraform), style (CSS/SCSS), generated (lock/codegen). Default: all.',
          ),
        filters: z
          .object({
            include_tests: z.boolean().optional().describe('Include test files (default: false). Auto-enabled when kind includes "test".'),
          })
          .optional(),
        max_files: z.number().int().positive().optional().describe('Max files to return (default: 50).'),
        semantic_threshold: z
          .number()
          .int()

          .optional()
          .describe('Min deterministic results before semantic search is skipped (default: 3). Set to 0 to always include semantic.'),
        debug: z.boolean().optional().describe('When true, include debug explanations.'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format.'),
      }),
      outputSchema: z.object({
        files: z.array(
          z.object({
            path: z.string(),
            tier: z.enum(['exact_match', 'symbol_match', 'fts_match', 'semantic', 'convention_match']),
            kind: z.enum(['source', 'type_def', 'test', 'migration', 'config', 'dependency', 'api_spec', 'doc', 'script', 'infra', 'style', 'generated']),
            score: z.number(),
            symbols: z.array(z.string()),
            sample_lines: z.array(z.string()),
          }),
        ),
        total_files: z.number().int(),
        tiers_executed: z.array(z.string()),
        tiers_skipped: z.array(z.string()),
        query_classification: z.enum(['identifier', 'path', 'natural_language', 'mixed']),
        search_profile: z.enum(['code-search', 'relationship', 'semantic-first']),
        explanations: z.array(z.string()),
        warnings: z.array(z.string()),
      }),
    },
    async ({ workspace_token, project_id, query, kind, filters, max_files, semantic_threshold, debug, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(project_id);
      const result = await tieredSearch({
        projectId,
        query,
        kind: kind as any,
        includeTests: filters?.include_tests,
        maxFiles: max_files,
        semanticThreshold: semantic_threshold,
        debug,
      });
      const tierCounts = result.tiers_executed
        .map(t => `${t}:${result.files.filter(f => f.tier === t).length}`)
        .join(' ');
      let summary = `search_code_tiered [${result.search_profile}]: ${result.files.length} files (${tierCounts})`;
      if (result.warnings.length) summary += ` [WARNINGS: ${result.warnings.join('; ')}]`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'list_lessons',
    {
      description: 'List lessons for a project (cursor pagination + filters).',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier. Optional if DEFAULT_PROJECT_ID is set; otherwise required.'),
        filters: z
          .object({
            lesson_type: z
              .enum(['decision', 'preference', 'guardrail', 'workaround', 'general_note'])
              .optional()
              .describe('Optional lesson type filter.'),
            tags_any: z.array(z.string().min(1)).optional().describe('Optional tags-any filter (overlap).'),
            status: z
              .enum(['draft', 'active', 'superseded', 'archived'])
              .optional()
              .describe('Optional lifecycle status filter (Phase 3).'),
          })
          .optional(),
        page: z
          .object({
            limit: z.number().int().positive().optional().describe('Page size (default: 20; max: 100).'),
            after: z.string().min(1).optional().describe('Cursor from previous response `next_cursor`.'),
          })
          .optional(),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        items: z.array(
          z.object({
            lesson_id: z.string(),
            project_id: z.string(),
            lesson_type: z.enum(['decision', 'preference', 'guardrail', 'workaround', 'general_note']),
            title: z.string(),
            content: z.string(),
            tags: z.array(z.string()),
            source_refs: z.array(z.string()),
            created_at: z.any(),
            updated_at: z.any(),
            captured_by: z.string().nullable(),
            summary: z.string().nullable().optional(),
            quick_action: z.string().nullable().optional(),
            status: z.enum(['draft', 'active', 'superseded', 'archived']).optional(),
            superseded_by: z.string().nullable().optional(),
          }),
        ),
        next_cursor: z.string().optional(),
        total_count: z.number().int().nonnegative(),
      }),
    },
    async ({ workspace_token, project_id, filters, page, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(project_id);
      const result = await listLessons({
        projectId,
        limit: page?.limit,
        after: page?.after,
        filters: filters as { lesson_type?: any; tags_any?: string[]; status?: any },
      });
      const summary = `list_lessons: items=${result.items.length}, total_count=${result.total_count}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'search_lessons',
    {
      description: 'Semantic search over lesson embeddings. Supports single project, multi-project, group-based, or include-all-groups search.',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier. Optional if DEFAULT_PROJECT_ID is set; otherwise required.'),
        project_ids: z
          .array(z.string().min(1))
          .optional()
          .describe('Search across multiple projects at once. When provided, searches all listed projects in a single query.'),
        group_id: z
          .string()
          .min(1)
          .optional()
          .describe('Search lessons stored in a specific group project. Useful for shared/integration knowledge.'),
        include_groups: z
          .boolean()
          .optional()
          .default(false)
          .describe('When true with project_id, also searches all groups this project belongs to.'),
        query: z.string().min(1).describe('Natural language query to embed and search against lesson embeddings.'),
        filters: z
          .object({
            lesson_type: z
              .enum(['decision', 'preference', 'guardrail', 'workaround', 'general_note'])
              .optional()
              .describe('Optional lesson type filter.'),
            tags_any: z.array(z.string().min(1)).optional().describe('Optional tags-any filter (overlap).'),
            include_all_statuses: z
              .boolean()
              .optional()
              .describe('When true, include superseded/archived lessons. Default: false (Phase 3).'),
          })
          .optional(),
        limit: z.number().int().positive().optional().describe('Max number of matches to return (default: 10; max: 50).'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        matches: z.array(
          z.object({
            lesson_id: z.string(),
            project_id: z.string().optional(),
            lesson_type: z.enum(['decision', 'preference', 'guardrail', 'workaround', 'general_note']),
            title: z.string(),
            content_snippet: z.string(),
            tags: z.array(z.string()),
            score: z.number(),
            status: z.enum(['draft', 'active', 'superseded', 'archived']).optional(),
          }),
        ),
        explanations: z.array(z.string()),
      }),
    },
    async ({ workspace_token, project_id, project_ids, group_id, include_groups, query, filters, limit, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const filtersTyped = filters as { lesson_type?: any; tags_any?: string[]; include_all_statuses?: boolean } | undefined;

      // Priority: project_ids > group_id > project_id + include_groups > project_id alone
      let resolvedIds: string[] | null = null;

      if (project_ids && project_ids.length > 0) {
        // Explicit multi-project search.
        resolvedIds = project_ids;
      } else if (group_id) {
        // Search a specific group's project.
        resolvedIds = [group_id];
      } else {
        const projectId = resolveProjectIdOrThrow(project_id);
        if (include_groups) {
          // Expand to include all groups this project belongs to.
          resolvedIds = await resolveProjectIds(projectId, true);
        } else {
          // Single project search (backwards compat — identical to previous behavior).
          const result = await searchLessons({ projectId, query, limit, filters: filtersTyped });
          const summary = `search_lessons: matches=${result.matches.length}`;
          return formatToolResponse(result, summary, output_format);
        }
      }

      const result = await searchLessonsMulti({ projectIds: resolvedIds, query, limit, filters: filtersTyped });
      const summary = `search_lessons: matches=${result.matches.length} (multi-project: ${resolvedIds.length})`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'list_generated_documents',
    {
      description: 'List generated documents stored canonically in Postgres for audit.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        doc_type: z.enum(['faq', 'raptor', 'qc_report', 'qc_artifact', 'benchmark_artifact']).optional(),
        doc_status: z.enum(['draft', 'active']).optional().describe("Filter by metadata.status ('active' = not draft)."),
        include_content: z.boolean().optional().default(false),
        limit: z.number().int().positive().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        items: z.array(
          z.object({
            doc_id: z.string(),
            doc_type: z.enum(['faq', 'raptor', 'qc_report', 'qc_artifact', 'benchmark_artifact']),
            doc_key: z.string(),
            title: z.string().nullable(),
            path_hint: z.string().nullable(),
            content: z.string(),
            metadata: z.record(z.string(), z.unknown()),
            updated_at: z.any(),
          }),
        ),
      }),
    },
    async ({ workspace_token, project_id, doc_type, doc_status, include_content, limit, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(project_id);
      const items = await listGeneratedDocuments({
        projectId,
        docType: doc_type,
        docStatus: doc_status,
        includeContent: include_content,
        limit: Math.min(Math.max(limit ?? 100, 1), 1000),
      });
      const result = { items };
      const summary = `list_generated_documents: items=${items.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'get_generated_document',
    {
      description: 'Get one generated document by doc_id or by (doc_type + doc_key).',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        doc_id: z.string().optional(),
        doc_type: z.enum(['faq', 'raptor', 'qc_report', 'qc_artifact', 'benchmark_artifact']).optional(),
        doc_key: z.string().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        item: z
          .object({
            doc_id: z.string(),
            project_id: z.string(),
            doc_type: z.enum(['faq', 'raptor', 'qc_report', 'qc_artifact', 'benchmark_artifact']),
            doc_key: z.string(),
            source_job_id: z.string().nullable(),
            correlation_id: z.string().nullable(),
            title: z.string().nullable(),
            path_hint: z.string().nullable(),
            content: z.string(),
            metadata: z.record(z.string(), z.unknown()),
            created_at: z.any(),
            updated_at: z.any(),
          })
          .nullable(),
      }),
    },
    async ({ workspace_token, project_id, doc_id, doc_type, doc_key, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(project_id);
      if (!doc_id && (!doc_type || !doc_key)) {
        throw new McpError(ErrorCode.InvalidParams, 'Provide doc_id or both doc_type + doc_key');
      }
      const item = await getGeneratedDocument({
        projectId,
        docId: doc_id,
        docType: doc_type,
        docKey: doc_key,
      });
      const result = { item };
      const summary = `get_generated_document: found=${Boolean(item).toString()}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'promote_generated_document',
    {
      description: 'Promote a draft generated document to active (metadata.status). Human gate for Phase 6 artifacts.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        doc_id: z.string().optional(),
        doc_type: z.enum(['faq', 'raptor', 'qc_report', 'qc_artifact', 'benchmark_artifact']).optional(),
        doc_key: z.string().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        doc_id: z.string(),
        promoted: z.boolean(),
      }),
    },
    async ({ workspace_token, project_id, doc_id, doc_type, doc_key, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(project_id);
      if (!doc_id && (!doc_type || !doc_key)) {
        throw new McpError(ErrorCode.InvalidParams, 'Provide doc_id or both doc_type + doc_key');
      }
      const result = await promoteGeneratedDocument({
        projectId,
        docId: doc_id,
        docType: doc_type,
        docKey: doc_key,
      });
      const summary = `promote_generated_document: doc_id=${result.doc_id}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'add_lesson',
    {
      description: 'Capture a decision/preference/guardrail/workaround/general_note as a durable lesson.',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        lesson_payload: z.object({
          project_id: z
            .string()
            .min(1)
            .optional()
            .describe('Project identifier for scoping this lesson. Optional if DEFAULT_PROJECT_ID is set on the server.'),
          lesson_type: z
            .enum(['decision', 'preference', 'guardrail', 'workaround', 'general_note'])
            .describe('Lesson type (required).'),
          title: z.string().min(1).describe('Short title (required).'),
          content: z.string().min(1).describe('Full content (required; embedded for semantic search).'),
          tags: z.array(z.string()).optional().describe('Optional tags for filtering/grouping.'),
          source_refs: z.array(z.string()).optional().describe('Optional references (paths, links, notes).'),
          captured_by: z.string().optional().describe('Optional author/captor identifier.'),
          guardrail: z
            .object({
              trigger: z.string().min(1).describe("Trigger string or /regex/ matched against action_context.action."),
              requirement: z.string().min(1).describe('Human-readable requirement to enforce.'),
              verification_method: z.string().min(1).describe('Verification method (e.g., user_confirmation).'),
            })
            .optional(),
        }).describe('Lesson payload to persist.'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error']).default('ok'),
        lesson_id: z.string(),
        summary: z.string().nullable().optional(),
        quick_action: z.string().nullable().optional(),
        guardrail_inserted: z.boolean().optional(),
        distillation: z
          .object({
            status: z.enum(['skipped', 'ok', 'failed']),
            reason: z.string().optional(),
          })
          .optional(),
        conflict_suggestions: z
          .array(
            z.object({
              lesson_id: z.string(),
              title: z.string(),
              similarity: z.number(),
            }),
          )
          .optional(),
      }),
    },
    async ({ workspace_token, lesson_payload, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(lesson_payload.project_id);
      const result = await addLesson({ ...lesson_payload, project_id: projectId } as any);
      const summary = `add_lesson: lesson_id=${result.lesson_id ?? '(unknown)'}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'check_guardrails',
    {
      description: 'Evaluate guardrails before risky actions. Supports include_groups to check group-level guardrails.',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        action_context: z
          .object({
            // Some clients might use `workspace` as the project identifier.
            action: z.string().min(1).describe("Action identifier to check (e.g., 'git push')."),
            project_id: z.string().optional().describe('Project identifier (preferred).'),
            workspace: z.string().optional().describe('Alternative project identifier field for some clients.'),
          })
          .passthrough(),
        include_groups: z
          .boolean()
          .optional()
          .default(false)
          .describe('When true, also checks guardrails from all groups this project belongs to.'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        pass: z.boolean(),
        rules_checked: z.number().int().nonnegative(),
        needs_confirmation: z.boolean().optional(),
        prompt: z.string().optional(),
        matched_rules: z
          .array(
            z.object({
              rule_id: z.string(),
              verification_method: z.string(),
              requirement: z.string(),
            }),
          )
          .optional(),
      }),
    },
    async ({ workspace_token, action_context, include_groups, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const explicit = action_context.project_id ?? action_context.workspace;
      const projectId = explicit && String(explicit).trim() ? String(explicit) : resolveProjectIdOrThrow(undefined);

      if (include_groups) {
        // Check guardrails from project + all its groups. Merge results.
        const allIds = await resolveProjectIds(projectId, true);
        let totalChecked = 0;
        const allMatched: Array<{ rule_id: string; verification_method: string; requirement: string }> = [];
        let anyFailed = false;
        let firstPrompt: string | undefined;

        for (const pid of allIds) {
          const r = await checkGuardrails(pid, action_context);
          totalChecked += r.rules_checked;
          if (!r.pass) {
            anyFailed = true;
            if (!firstPrompt && r.prompt) firstPrompt = r.prompt;
            if (r.matched_rules) allMatched.push(...r.matched_rules);
          }
        }

        const merged = {
          pass: !anyFailed,
          rules_checked: totalChecked,
          needs_confirmation: anyFailed ? true : undefined,
          prompt: firstPrompt,
          matched_rules: allMatched.length > 0 ? allMatched : undefined,
        };
        const summary = `check_guardrails: pass=${merged.pass}, rules_checked=${merged.rules_checked} (${allIds.length} projects)`;
        return formatToolResponse(merged, summary, output_format);
      }

      const result = await checkGuardrails(projectId, action_context);
      const summary = `check_guardrails: pass=${result.pass}, rules_checked=${result.rules_checked}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'get_context',
    {
      description: 'Return minimal context references and suggested next tool calls for a task (no noisy bundles).',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier. Optional if DEFAULT_PROJECT_ID is set; otherwise required.'),
        task: z
          .object({
            intent: z.string().min(1).describe('High-level intent for the task (used to craft suggestions).'),
            query: z.string().min(1).optional().describe('Optional query string for suggested searches.'),
            path_glob: z.string().min(1).optional().describe("Optional path glob for suggested search_code (e.g., 'src/**/*.ts')."),
          })
          .optional(),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        project_id: z.string(),
        context_refs: z.array(z.string()),
        project_snapshot: z.string().nullable().optional(),
        suggested_next_calls: z.array(
          z.object({
            tool: z.string(),
            arguments: z.any(),
            reason: z.string(),
          }),
        ),
        notes: z.array(z.string()),
      }),
    },
    async ({ workspace_token, project_id, task, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const env = getEnv();

      const context_refs = [
        'docs/context/PROJECT_INVARIANTS.md',
        'docs/context/MVP_CONTEXT.md',
        'docs/sessions/SESSION_PATCH.md',
      ];

      const project_snapshot = await getProjectSnapshotBody(pid);

      const suggested_next_calls: Array<{ tool: string; arguments: any; reason: string }> = [];
      const q = task?.query ?? task?.intent ?? '';
      const pathGlob = task?.path_glob;

      suggested_next_calls.push({
        tool: 'get_project_summary',
        arguments: { workspace_token, project_id: pid },
        reason: 'Read the pre-built project snapshot (fast, no embedding call).',
      });

      if (q.trim().length) {
        suggested_next_calls.push({
          tool: 'search_lessons',
          arguments: {
            project_id: pid,
            query: q,
            limit: 5,
          },
          reason: 'Find prior decisions/preferences/guardrails related to the task.',
        });
        suggested_next_calls.push({
          tool: 'search_code',
          arguments: {
            project_id: pid,
            query: q,
            filters: pathGlob ? { path_glob: pathGlob } : undefined,
            limit: 5,
          },
          reason: 'Find relevant code locations by intent.',
        });
      }

      const notes: string[] = [];
      notes.push(`embeddings_model=${env.EMBEDDINGS_MODEL}`);
      notes.push(`embeddings_dim=${env.EMBEDDINGS_DIM}`);
      notes.push('get_context returns refs + suggested tool calls; it does not bundle large content.');

      const result = { project_id: pid, context_refs, project_snapshot, suggested_next_calls, notes };
      const summary = `get_context: project_id=${pid}, refs=${context_refs.length}, suggestions=${suggested_next_calls.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'list_lesson_versions',
    {
      description: 'List version history for a lesson. Returns snapshots of previous states before each content/title edit, ordered newest first.',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z.string().min(1).optional().describe('Project identifier.'),
        lesson_id: z.string().min(1).describe('Lesson UUID.'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format.'),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error']),
        error: z.string().optional(),
        versions: z.array(z.object({
          version_number: z.number(),
          title: z.string(),
          content: z.string(),
          tags: z.array(z.string()),
          changed_by: z.string().nullable(),
          changed_at: z.string(),
          change_summary: z.string().nullable(),
        })).optional(),
        total_count: z.number().optional(),
      }),
    },
    async ({ workspace_token, project_id, lesson_id, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await listLessonVersions({ projectId: pid, lessonId: lesson_id });
      const summary = `list_lesson_versions: ${result.total_count ?? 0} version(s)`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'update_lesson',
    {
      description: 'Update lesson content, title, tags, or source_refs. Re-embeds automatically when title or content changes. Creates a version snapshot before overwriting.',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier. Optional if DEFAULT_PROJECT_ID is set; otherwise required.'),
        lesson_id: z.string().min(1).describe('Lesson UUID to update.'),
        title: z.string().min(1).optional().describe('New title (optional).'),
        content: z.string().min(1).optional().describe('New content (optional).'),
        tags: z.array(z.string()).optional().describe('New tags array — replaces all existing tags (optional).'),
        source_refs: z.array(z.string()).optional().describe('New source refs — replaces all existing refs (optional).'),
        changed_by: z.string().optional().describe('Who made the change (for version history audit).'),
        change_summary: z.string().optional().describe('Short description of what changed (for version history).'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error']),
        error: z.string().optional(),
        re_embedded: z.boolean().optional(),
        version_number: z.number().optional(),
      }),
    },
    async ({ workspace_token, project_id, lesson_id, title, content, tags, source_refs, changed_by, change_summary, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await updateLesson({
        projectId: pid,
        lessonId: lesson_id,
        title,
        content,
        tags,
        source_refs,
        changedBy: changed_by,
        changeSummary: change_summary,
      });
      const summary = `update_lesson: status=${result.status}, re_embedded=${result.re_embedded}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'update_lesson_status',
    {
      description: 'Update lifecycle status for a lesson (draft/active/superseded/archived) and optional supersession link.',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier. Optional if DEFAULT_PROJECT_ID is set; otherwise required.'),
        lesson_id: z.string().min(1).describe('Lesson UUID to update.'),
        status: z.enum(['draft', 'active', 'superseded', 'archived']).describe('New lifecycle status.'),
        superseded_by: z.string().min(1).optional().describe('Optional replacement lesson UUID when superseding.'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error']),
        error: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, lesson_id, status, superseded_by, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await updateLessonStatus({
        projectId: pid,
        lessonId: lesson_id,
        status: status as any,
        supersededBy: superseded_by,
      });
      const summary = `update_lesson_status: status=${result.status}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'get_project_summary',
    {
      description: 'Return the pre-built project snapshot text (no embedding call).',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier. Optional if DEFAULT_PROJECT_ID is set; otherwise required.'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        project_id: z.string(),
        body: z.string(),
        updated_hint: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const body = (await getProjectSnapshotBody(pid)) ?? '';
      const result = { project_id: pid, body, updated_hint: 'Snapshot rebuilds on add_lesson and index_project.' };
      const summary = `get_project_summary: chars=${body.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'reflect',
    {
      description: 'LLM synthesis across retrieved lessons for a topic (requires DISTILLATION_ENABLED=true).',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier. Optional if DEFAULT_PROJECT_ID is set; otherwise required.'),
        topic: z.string().min(1).describe('Topic/question to reflect on.'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        project_id: z.string(),
        topic: z.string(),
        answer: z.string(),
        warning: z.string().optional(),
        retrieved_lessons: z.number().int().nonnegative(),
      }),
    },
    async ({ workspace_token, project_id, topic, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const retrieved = await searchLessons({
        projectId: pid,
        query: topic,
        limit: 12,
        filters: { include_all_statuses: false },
      });
      const bullets = retrieved.matches.map(m => `- ${m.title}: ${m.content_snippet}`);
      const synth = await reflectOnTopic({ topic, bullets });
      const result = {
        project_id: pid,
        topic,
        answer: synth.answer,
        warning: synth.warning,
        retrieved_lessons: retrieved.matches.length,
      };
      const summary = `reflect: retrieved=${retrieved.matches.length}, answered=${Boolean(synth.answer).toString()}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'compress_context',
    {
      description: 'Compress arbitrary text using the configured chat model (optional; respects DISTILLATION_ENABLED).',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        text: z.string().min(1).describe('Text to compress.'),
        max_output_chars: z.number().int().positive().optional().describe('Soft cap for output size (default: 4000).'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        compressed: z.string(),
        warning: z.string().optional(),
      }),
    },
    async ({ workspace_token, text, max_output_chars, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const result = await compressText({ text, maxOutputChars: max_output_chars });
      const summary = `compress_context: out_chars=${result.compressed.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'delete_workspace',
    {
      description: 'Delete all ContextHub data for the given project_id (lessons, chunks, guardrails, etc.).',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier to delete. Optional if DEFAULT_PROJECT_ID is set on the server.'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error']),
        deleted: z.boolean(),
        deleted_project_id: z.string(),
      }),
    },
    async ({ workspace_token, project_id, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(project_id);
      const result = await deleteWorkspace(projectId);
      const summary = `delete_workspace: deleted=${result.deleted}, project_id=${result.deleted_project_id}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'search_symbols',
    {
      description: 'Search TS/JS symbols in the Neo4j knowledge graph (Phase 4).',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z.string().min(1).optional().describe('Project identifier (optional if DEFAULT_PROJECT_ID is set).'),
        query: z.string().min(1).describe('Search string (substring match).'),
        limit: z.number().int().positive().optional().describe('Max matches (default 10).'),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        matches: z.array(
          z.object({
            symbol_id: z.string(),
            name: z.string(),
            kind: z.string(),
            file_path: z.string(),
            score: z.number(),
          }),
        ),
        warning: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, query, limit, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await searchSymbols({ projectId: pid, query, limit });
      const summary = `search_symbols: matches=${result.matches.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'get_symbol_neighbors',
    {
      description: 'Return a symbol neighborhood (nodes + immediate edges) from Neo4j.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        symbol_id: z.string().min(1),
        depth: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        center: z
          .object({
            symbol_id: z.string(),
            name: z.string(),
            kind: z.string(),
            file_path: z.string(),
            score: z.number(),
          })
          .nullable(),
        neighbors: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            kind: z.string(),
            file_path: z.string(),
            depth: z.number(),
            labels: z.array(z.string()),
          }),
        ),
        edges: z.array(z.object({ from: z.string(), to: z.string(), type: z.string() })),
        warning: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, symbol_id, depth, limit, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await getSymbolNeighbors({ projectId: pid, symbolId: symbol_id, depth, limit });
      const summary = `get_symbol_neighbors: neighbors=${result.neighbors.length}, edges=${result.edges.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'trace_dependency_path',
    {
      description: 'Find a shortest path between two symbols in Neo4j (same project).',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        from_symbol_id: z.string().min(1),
        to_symbol_id: z.string().min(1),
        max_hops: z.number().int().positive().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        found: z.boolean(),
        path_nodes: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string(), file_path: z.string() })),
        path_edges: z.array(z.object({ from: z.string(), to: z.string(), type: z.string() })),
        hops: z.number(),
        warning: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, from_symbol_id, to_symbol_id, max_hops, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await traceDependencyPath({
        projectId: pid,
        fromSymbolId: from_symbol_id,
        toSymbolId: to_symbol_id,
        maxHops: max_hops,
      });
      const summary = `trace_dependency_path: found=${result.found}, hops=${result.hops}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'get_lesson_impact',
    {
      description: 'Summarize lesson-to-symbol links and impacted files from Neo4j.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        lesson_id: z.string().min(1),
        limit: z.number().int().positive().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        lesson: z
          .object({
            lesson_id: z.string(),
            title: z.string(),
            lesson_type: z.string(),
          })
          .nullable(),
        linked_symbols: z.array(
          z.object({
            symbol_id: z.string(),
            name: z.string(),
            kind: z.string(),
            file_path: z.string(),
            edge: z.string(),
          }),
        ),
        affected_files: z.array(z.string()),
        rationale: z.string(),
        warning: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, lesson_id, limit, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await getLessonImpact({ projectId: pid, lessonId: lesson_id, limit });
      const summary = `get_lesson_impact: linked_symbols=${result.linked_symbols.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'ingest_git_history',
    {
      description: 'Ingest git history (commits/files) into ContextHub storage (Phase 5).',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        root: z.string().min(1).optional().describe('Repository root path. Optional — auto-resolved from project_sources when omitted.'),
        since: z.string().min(1).optional(),
        max_commits: z.number().int().positive().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error', 'skipped']),
        run_id: z.string().optional(),
        commits_seen: z.number().int().nonnegative(),
        commits_upserted: z.number().int().nonnegative(),
        files_upserted: z.number().int().nonnegative(),
        warning: z.string().optional(),
        error: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, root, since, max_commits, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const resolvedRoot = await resolveProjectRoot(pid, root);
      const result = await ingestGitHistory({
        projectId: pid,
        root: resolvedRoot,
        since,
        maxCommits: max_commits,
      });
      const summary = `ingest_git_history: status=${result.status}, commits=${result.commits_upserted}, files=${result.files_upserted}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'list_commits',
    {
      description: 'List ingested git commits for a project (Phase 5).',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        limit: z.number().int().positive().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        items: z.array(
          z.object({
            project_id: z.string().optional(),
            sha: z.string(),
            parent_shas: z.array(z.string()),
            author_name: z.string(),
            author_email: z.string(),
            committed_at: z.any(),
            message: z.string(),
            summary: z.string().nullable().optional(),
            ingested_at: z.any(),
          }),
        ),
        warning: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, limit, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await listCommits({ projectId: pid, limit });
      const summary = `list_commits: items=${result.items.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'get_commit',
    {
      description: 'Get one ingested git commit and its changed files (Phase 5).',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        sha: z.string().min(1),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        commit: z
          .object({
            project_id: z.string().optional(),
            sha: z.string(),
            parent_shas: z.array(z.string()),
            author_name: z.string(),
            author_email: z.string(),
            committed_at: z.any(),
            message: z.string(),
            summary: z.string().nullable().optional(),
            ingested_at: z.any(),
          })
          .nullable(),
        files: z.array(
          z.object({
            file_path: z.string(),
            change_kind: z.string(),
            additions: z.number().nullable().optional(),
            deletions: z.number().nullable().optional(),
          }),
        ),
        warning: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, sha, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await getCommit({ projectId: pid, sha });
      const summary = `get_commit: found=${Boolean(result.commit).toString()}, files=${result.files.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'suggest_lessons_from_commits',
    {
      description: 'Generate and persist draft lesson proposals from ingested commits (Phase 5).',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        commit_shas: z.array(z.string().min(1)).optional(),
        limit: z.number().int().positive().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        proposals: z.array(
          z.object({
            proposal_id: z.string(),
            commit_sha: z.string(),
            lesson_type: z.enum(['decision', 'preference', 'guardrail', 'workaround', 'general_note']),
            title: z.string(),
            content: z.string(),
            tags: z.array(z.string()),
            source_refs: z.array(z.string()),
            rationale: z.string(),
            status: z.literal('draft'),
          }),
        ),
        warning: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, commit_shas, limit, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await suggestLessonsFromCommits({
        projectId: pid,
        commitShas: commit_shas,
        limit,
      });
      const summary = `suggest_lessons_from_commits: proposals=${result.proposals.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'link_commit_to_lesson',
    {
      description: 'Attach commit refs/files to an existing lesson and refresh symbol links (Phase 5).',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        commit_sha: z.string().min(1),
        lesson_id: z.string().min(1),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error', 'skipped']),
        linked_refs: z.number().int().nonnegative(),
        warning: z.string().optional(),
        error: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, commit_sha, lesson_id, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await linkCommitToLesson({
        projectId: pid,
        commitSha: commit_sha,
        lessonId: lesson_id,
      });
      const summary = `link_commit_to_lesson: status=${result.status}, linked_refs=${result.linked_refs}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'analyze_commit_impact',
    {
      description: 'Analyze commit impact (files, symbols, related lessons) using Phase 4 KG links.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        commit_sha: z.string().min(1),
        limit: z.number().int().positive().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        commit_sha: z.string(),
        affected_files: z.array(z.string()),
        affected_symbols: z.array(
          z.object({
            symbol_id: z.string(),
            name: z.string(),
            kind: z.string(),
            file_path: z.string(),
          }),
        ),
        related_lessons: z.array(
          z.object({
            lesson_id: z.string(),
            title: z.string(),
            edge: z.string(),
          }),
        ),
        warning: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, commit_sha, limit, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await analyzeCommitImpact({
        projectId: pid,
        commitSha: commit_sha,
        limit,
      });
      const summary = `analyze_commit_impact: files=${result.affected_files.length}, symbols=${result.affected_symbols.length}, lessons=${result.related_lessons.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'configure_project_source',
    {
      description: 'Configure project source: set git_url so other tools can auto-resolve paths. Call this once per project.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        source_type: z.enum(['remote_git', 'local_workspace']).describe('Use remote_git for team shared repos.'),
        git_url: z.string().min(1).optional().describe('Remote git URL (required for remote_git).'),
        default_ref: z.string().min(1).optional().describe('Default branch (e.g., main).'),
        enabled: z.boolean().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        status: z.literal('ok'),
        project_id: z.string(),
        source_type: z.enum(['remote_git', 'local_workspace']),
      }),
    },
    async ({ workspace_token, project_id, source_type, git_url, default_ref, enabled, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await configureProjectSource({
        projectId: pid,
        sourceType: source_type,
        gitUrl: git_url,
        defaultRef: default_ref,
        repoRoot: undefined, // auto-set by prepare_repo
        enabled,
      });
      const summary = `configure_project_source: project_id=${result.project_id}, source_type=${result.source_type}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'prepare_repo',
    {
      description: 'Clone/fetch/checkout remote repository into server cache and persist source metadata. After this, other tools can auto-resolve root from project_id.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        git_url: z.string().min(1).describe('Remote git repository URL (https).'),
        ref: z.string().min(1).optional().describe('Branch or tag to checkout (default: main).'),
        depth: z.number().int().positive().optional().describe('Shallow clone depth (optional).'),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error']),
        project_id: z.string(),
        repo_root: z.string(),
        resolved_ref: z.string().optional(),
        last_sync_commit: z.string().optional(),
        source_storage_mode: z.enum(['local', 's3', 'hybrid']).optional(),
        s3_sync: z
          .object({
            uploaded: z.boolean(),
            artifact_key: z.string().optional(),
            metadata_key: z.string().optional(),
            warning: z.string().optional(),
          })
          .optional(),
        error: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, git_url, ref, depth, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const env = getEnv();
      const result = await prepareRepo({
        projectId: pid,
        gitUrl: git_url,
        ref,
        depth,
        cacheRoot: env.REPO_CACHE_ROOT,
        sourceStorageMode: env.SOURCE_STORAGE_MODE as any,
      });
      const summary = `prepare_repo: status=${result.status}, repo_root=${result.repo_root}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'get_project_source',
    {
      description: 'Read configured source mode details for a project.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        source_type: z.enum(['remote_git', 'local_workspace']).default('remote_git'),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        source: z
          .object({
            project_id: z.string(),
            source_type: z.enum(['remote_git', 'local_workspace']),
            git_url: z.string().nullable(),
            default_ref: z.string(),
            repo_root: z.string().nullable(),
            enabled: z.boolean(),
          })
          .nullable(),
      }),
    },
    async ({ workspace_token, project_id, source_type, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const source = await getProjectSource(pid, source_type);
      const result = { source };
      const summary = `get_project_source: found=${Boolean(source).toString()}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'register_workspace_root',
    {
      description: 'Register workspace root for a project (enables ripgrep code search). Optional if project already configured via prepare_repo.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        root_path: z.string().min(1).optional().describe('Workspace root. Optional — auto-resolved from project config when omitted.'),
        active: z.boolean().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        status: z.literal('ok'),
        workspace_id: z.string(),
        project_id: z.string(),
        root_path: z.string(),
      }),
    },
    async ({ workspace_token, project_id, root_path, active, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const resolvedRoot = await resolveProjectRoot(pid, root_path);
      const result = await registerWorkspaceRoot({ projectId: pid, rootPath: resolvedRoot, active });
      const summary = `register_workspace_root: workspace_id=${result.workspace_id}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'list_workspace_roots',
    {
      description: 'List workspace roots configured for a project.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        items: z.array(
          z.object({
            workspace_id: z.string(),
            root_path: z.string(),
            is_active: z.boolean(),
            updated_at: z.any(),
          }),
        ),
      }),
    },
    async ({ workspace_token, project_id, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const result = await listWorkspaceRoots(pid);
      const summary = `list_workspace_roots: items=${result.items.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'scan_workspace',
    {
      description: 'Scan workspace for changed files (git status) and optionally run delta indexing.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        root_path: z.string().min(1).optional().describe('Workspace root. Optional — auto-resolved from project config when omitted.'),
        run_delta_index: z.boolean().optional().default(false),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error']),
        root_path: z.string(),
        modified_files: z.array(z.string()),
        untracked_files: z.array(z.string()),
        staged_files: z.array(z.string()),
        delta_id: z.string().optional(),
        index_result: z
          .object({
            status: z.enum(['ok', 'error']),
            files_indexed: z.number().int(),
            generated_docs_indexed: z.number().int().optional(),
            generated_chunks_indexed: z.number().int().optional(),
            duration_ms: z.number().int(),
            errors: z.array(z.object({ path: z.string(), message: z.string() })),
          })
          .optional(),
        error: z.string().optional(),
      }),
    },
    async ({ workspace_token, project_id, root_path, run_delta_index, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = resolveProjectIdOrThrow(project_id);
      const resolvedRoot = await resolveProjectRoot(pid, root_path);
      const result = await scanWorkspaceChanges({
        projectId: pid,
        rootPath: resolvedRoot,
        runDeltaIndex: run_delta_index,
      });
      const summary = `scan_workspace: status=${result.status}, modified=${result.modified_files.length}, untracked=${result.untracked_files.length}, staged=${result.staged_files.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'enqueue_job',
    {
      description:
        'Enqueue async job for worker pipeline (RabbitMQ/Postgres backend). ' +
        'payload.root is auto-resolved from project_sources or chunks when omitted — just pass project_id. ' +
        'Or pass payload.root explicitly to override. repo.sync requires payload.git_url (not root). ' +
        'Job types: repo.sync (clones repo, chains git.ingest + index.run), index.run, git.ingest, ' +
        'workspace.scan, workspace.delta_index, faq.build, raptor.build, knowledge.memory.build, ' +
        'quality.eval, knowledge.refresh, knowledge.loop.shallow, knowledge.loop.deep.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        job_type: z.enum([
          'repo.sync',
          'workspace.scan',
          'workspace.delta_index',
          'index.run',
          'git.ingest',
          'quality.eval',
          'knowledge.refresh',
          'faq.build',
          'raptor.build',
          'knowledge.loop.shallow',
          'knowledge.loop.deep',
          'knowledge.memory.build',
        ]).describe(
          'Job type. MOST jobs require payload.root (filesystem path). repo.sync requires payload.git_url instead.',
        ),
        payload: z.record(z.string(), z.unknown()).optional().describe(
          'Job-specific payload. root is auto-resolved from project_sources when omitted — just pass project_id. ' +
          'repo.sync needs { git_url: "https://..." } (not root). ' +
          'Pass { root: "/path" } to override auto-resolution. ' +
          'Optional fields: ref, since, max_commits, modules, path_glob, max_items, max_levels.',
        ),
        correlation_id: z.string().optional(),
        queue_name: z.string().min(1).optional(),
        max_attempts: z.number().int().positive().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        status: z.literal('queued'),
        job_id: z.string(),
        backend: z.enum(['postgres', 'rabbitmq']),
      }),
    },
    async ({ workspace_token, project_id, job_type, payload, correlation_id, queue_name, max_attempts, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = project_id ? resolveProjectIdOrThrow(project_id) : undefined;
      const result = await enqueueJob({
        project_id: pid,
        job_type,
        payload: payload ?? {},
        correlation_id,
        queue_name,
        max_attempts,
      });
      const summary = `enqueue_job: job_id=${result.job_id}, backend=${result.backend}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'list_jobs',
    {
      description:
        'List async worker jobs and statuses. Optional correlation_id scopes rows to one enqueue/run (child jobs from repo.sync/workspace.scan share the parent correlation).',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional(),
        correlation_id: z.string().min(1).optional(),
        status: z.enum(['queued', 'running', 'succeeded', 'failed', 'dead_letter']).optional(),
        limit: z.number().int().positive().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        items: z.array(
          z.object({
            job_id: z.string(),
            project_id: z.string().nullable(),
            job_type: z.string(),
            correlation_id: z.string().nullable(),
            status: z.enum(['queued', 'running', 'succeeded', 'failed', 'dead_letter']),
            attempts: z.number().int(),
            max_attempts: z.number().int(),
            queued_at: z.any(),
            started_at: z.any(),
            finished_at: z.any(),
            error_message: z.string().nullable(),
          }),
        ),
      }),
    },
    async ({ workspace_token, project_id, correlation_id, status, limit, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const pid = project_id ? resolveProjectIdOrThrow(project_id) : undefined;
      const result = await listJobs({ projectId: pid, correlationId: correlation_id, status, limit });
      const summary = `list_jobs: items=${result.items.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'run_next_job',
    {
      description: 'Run one queued job immediately (useful for local/dev without long-running worker process).',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        queue_name: z.string().min(1).optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        status: z.enum(['idle', 'ok', 'error']),
        job_id: z.string().optional(),
        job_type: z.string().optional(),
        result: z.record(z.string(), z.unknown()).optional(),
        error: z.string().optional(),
      }),
    },
    async ({ workspace_token, queue_name, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const result = await runNextJob(queue_name);
      const summary = `run_next_job: status=${result.status}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  // ── Project Groups ──

  server.registerTool(
    'list_groups',
    {
      description: 'List all project groups with member counts.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        groups: z.array(z.object({
          group_id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          member_count: z.number(),
        })),
      }),
    },
    async ({ workspace_token, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const groups = await listGroups();
      const summary = `list_groups: count=${groups.length}`;
      return formatToolResponse({ groups }, summary, output_format);
    },
  );

  server.registerTool(
    'create_group',
    {
      description: 'Create a project group. Projects added as members can share knowledge via include_groups in search_lessons.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        group_id: z.string().min(1).describe('Unique identifier for the group (e.g. "order-payment-team").'),
        name: z.string().min(1).describe('Human-readable group name.'),
        description: z.string().optional().describe('Optional description of what knowledge this group shares.'),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        group_id: z.string(),
        name: z.string(),
        description: z.string().nullable(),
      }),
    },
    async ({ workspace_token, group_id, name, description, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const result = await createGroup({ group_id, name, description });
      const summary = `create_group: group_id=${result.group_id}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'delete_group',
    {
      description: 'Delete a project group. Members are removed automatically; shared lessons remain in the group project.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        group_id: z.string().min(1),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({ deleted: z.boolean() }),
    },
    async ({ workspace_token, group_id, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const result = await deleteGroup(group_id);
      const summary = `delete_group: deleted=${result.deleted}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'add_project_to_group',
    {
      description: 'Add a project to a group so it shares knowledge with other group members.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        group_id: z.string().min(1),
        project_id: z.string().min(1),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({ added: z.boolean() }),
    },
    async ({ workspace_token, group_id, project_id, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const result = await addProjectToGroup(group_id, project_id);
      const summary = `add_project_to_group: group=${group_id} project=${project_id} added=${result.added}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'remove_project_from_group',
    {
      description: 'Remove a project from a group.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        group_id: z.string().min(1),
        project_id: z.string().min(1),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({ removed: z.boolean() }),
    },
    async ({ workspace_token, group_id, project_id, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const result = await removeProjectFromGroup(group_id, project_id);
      const summary = `remove_project_from_group: group=${group_id} project=${project_id} removed=${result.removed}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'list_group_members',
    {
      description: 'List all project IDs that belong to a group.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        group_id: z.string().min(1),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({ group_id: z.string(), members: z.array(z.string()) }),
    },
    async ({ workspace_token, group_id, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const members = await listGroupMembers(group_id);
      const summary = `list_group_members: group=${group_id} count=${members.length}`;
      return formatToolResponse({ group_id, members }, summary, output_format);
    },
  );

  server.registerTool(
    'list_project_groups',
    {
      description: 'List all groups a project belongs to.',
      inputSchema: z.object({
        workspace_token: z.string().optional(),
        project_id: z.string().min(1).optional().describe('Project ID. Optional if DEFAULT_PROJECT_ID is set.'),
        output_format: OutputFormatSchema.default('auto_both'),
      }),
      outputSchema: z.object({
        project_id: z.string(),
        groups: z.array(z.object({ group_id: z.string(), name: z.string(), description: z.string().nullable() })),
      }),
    },
    async ({ workspace_token, project_id, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(project_id);
      const groups = await listGroupsForProject(projectId);
      const summary = `list_project_groups: project=${projectId} groups=${groups.length}`;
      return formatToolResponse({ project_id: projectId, groups }, summary, output_format);
    },
  );

  return server;
}

export { createMcpToolsServer };
