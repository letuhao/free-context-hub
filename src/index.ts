import * as dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { ErrorCode, McpError, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { getEnv } from './env.js';
import { applyMigrations } from './db/applyMigrations.js';
import { indexProject } from './services/indexer.js';
import { searchCode } from './services/retriever.js';
import { addLesson, deleteWorkspace, listLessons, searchLessons } from './services/lessons.js';
import { checkGuardrails } from './services/guardrails.js';

dotenv.config();

const OutputFormatSchema = z.enum(['auto_both', 'json_only', 'json_pretty', 'summary_only']);
type OutputFormat = z.infer<typeof OutputFormatSchema>;

function formatToolResponse<T>(
  result: T,
  summary: string,
  output_format: OutputFormat,
) {
  const jsonMin = JSON.stringify(result);
  const jsonPretty = JSON.stringify(result, null, 2);

  let text: string;
  switch (output_format) {
    case 'json_only':
      text = jsonMin;
      break;
    case 'json_pretty':
      text = jsonPretty;
      break;
    case 'summary_only':
      text = summary;
      break;
    case 'auto_both':
    default:
      text = `${summary}\n${jsonMin}`;
      break;
  }

  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: result,
  };
}

function assertWorkspaceToken(token?: string) {
  const env = getEnv();
  if (!env.MCP_AUTH_ENABLED) return;

  if (!token || token !== env.CONTEXT_HUB_WORKSPACE_TOKEN) {
    // MCP clients will surface this as a tool error.
    throw new McpError(ErrorCode.InvalidParams, 'Unauthorized: invalid workspace_token');
  }
}

function resolveProjectIdOrThrow(project_id?: string) {
  if (project_id && project_id.trim().length) return project_id;
  const env = getEnv();
  if (env.DEFAULT_PROJECT_ID && env.DEFAULT_PROJECT_ID.trim().length) return env.DEFAULT_PROJECT_ID;
  throw new McpError(ErrorCode.InvalidParams, 'Bad Request: missing project_id and DEFAULT_PROJECT_ID is not set');
}

function createMcpToolsServer() {
  const server = new McpServer(
    {
      name: 'contexthub-self-hosted',
      version: '0.1.0',
      description: 'Self-hosted ContextHub MVP (index/search/lessons/guardrails)',
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
      const requiredFor = ['index_project', 'search_code', 'add_lesson', 'delete_workspace'];
      const optionalFor = ['list_lessons', 'search_lessons', 'get_context', 'check_guardrails', 'help'];

      const tokenNote = env.MCP_AUTH_ENABLED
        ? 'workspace_token is required for every tools/call.'
        : 'workspace_token is optional; server ignores it when MCP_AUTH_ENABLED=false.';

      const tools = [
        {
          name: 'index_project',
          purpose: 'Index files under a root into chunks + embeddings (idempotent).',
          key_parameters: [
            { path: 'project_id', required: true, notes: 'Project scope for stored chunks.' },
            { path: 'root', required: true, notes: 'Root directory to index.' },
            { path: 'options.lines_per_chunk', required: false, notes: 'Default: 120.' },
            { path: 'options.embedding_batch_size', required: false, notes: 'Default: 8.' },
          ],
        },
        {
          name: 'search_code',
          purpose: 'Semantic search over indexed code chunks (pgvector).',
          key_parameters: [
            { path: 'project_id', required: true, notes: 'Search within a single project scope.' },
            { path: 'query', required: true, notes: 'Natural language query.' },
            { path: 'filters.path_glob', required: false, notes: "Optional filter, e.g. 'src/**/*.ts'." },
            { path: 'limit', required: false, notes: 'Top-k results (default 10).' },
          ],
        },
        {
          name: 'list_lessons',
          purpose: 'List lessons with cursor pagination + filters (type/tags).',
          key_parameters: [
            { path: 'project_id', required: false, notes: 'Optional; uses DEFAULT_PROJECT_ID if omitted.' },
            { path: 'filters.lesson_type', required: false, notes: 'Optional lesson type filter.' },
            { path: 'filters.tags_any', required: false, notes: 'Any-overlap tag filter.' },
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
            { path: 'limit', required: false, notes: 'Top-k results (default 10, max 50).' },
          ],
        },
        {
          name: 'add_lesson',
          purpose: 'Persist a durable lesson; optionally also creates a guardrail rule.',
          key_parameters: [
            { path: 'lesson_payload.project_id', required: true, notes: 'Project scope.' },
            { path: 'lesson_payload.lesson_type', required: true, notes: 'decision|preference|guardrail|workaround|general_note.' },
            { path: 'lesson_payload.title', required: true, notes: 'Short label.' },
            { path: 'lesson_payload.content', required: true, notes: 'Full content (embedded).' },
            { path: 'lesson_payload.guardrail', required: false, notes: 'Optional guardrail rule payload.' },
          ],
        },
        {
          name: 'check_guardrails',
          purpose: 'Evaluate guardrails for a proposed action; returns pass/fail + confirmation prompt.',
          key_parameters: [
            { path: 'action_context.action', required: true, notes: "Action string, e.g. 'git push'." },
            { path: 'action_context.project_id|workspace', required: true, notes: 'Project identifier for loading rules.' },
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
          name: 'delete_workspace',
          purpose: 'Delete all stored data for a project_id (lessons, chunks, guardrails, logs).',
          key_parameters: [{ path: 'project_id', required: true, notes: 'Project to delete.' }],
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
                options: { lines_per_chunk: 120, embedding_batch_size: 8 },
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
          missing_behavior: 'InvalidParams (Bad Request) if project_id missing and DEFAULT_PROJECT_ID not set.',
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
        project_id: z.string().min(1).describe('Project identifier for scoping stored vectors/metadata (required).'),
        root: z.string().min(1).describe('Root directory path to index (absolute or relative to server process cwd).'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
        options: z
          .object({
            lines_per_chunk: z.number().int().positive().optional().describe('Chunk size in lines (default: 120).'),
            embedding_batch_size: z.number().int().positive().optional().describe('Embedding batch size (default: 8).'),
          })
          .optional(),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error']),
        files_indexed: z.number().int().nonnegative(),
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
      const result = await indexProject({
        projectId: project_id,
        root,
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
        project_id: z.string().min(1).describe('Project identifier to search within (required).'),
        query: z.string().min(1).describe('Natural language query to embed and search against.'),
        filters: z
          .object({
            path_glob: z.string().min(1).optional().describe("Optional path glob filter (stored paths are POSIX-like). Example: 'src/**/*.ts'."),
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
      const result = await searchCode({
        projectId: project_id,
        query,
        pathGlob: filters?.path_glob,
        limit,
        debug,
      });
      const summary = `search_code: matches=${result.matches.length}`;
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
        filters: filters as any,
      });
      const summary = `list_lessons: items=${result.items.length}, total_count=${result.total_count}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'search_lessons',
    {
      description: 'Semantic search over lesson embeddings for a project.',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z
          .string()
          .min(1)
          .optional()
          .describe('Project identifier. Optional if DEFAULT_PROJECT_ID is set; otherwise required.'),
        query: z.string().min(1).describe('Natural language query to embed and search against lesson embeddings.'),
        filters: z
          .object({
            lesson_type: z
              .enum(['decision', 'preference', 'guardrail', 'workaround', 'general_note'])
              .optional()
              .describe('Optional lesson type filter.'),
            tags_any: z.array(z.string().min(1)).optional().describe('Optional tags-any filter (overlap).'),
          })
          .optional(),
        limit: z.number().int().positive().optional().describe('Max number of matches to return (default: 10; max: 50).'),
        output_format: OutputFormatSchema.default('auto_both').describe('Response format: auto_both | json_only | json_pretty | summary_only.'),
      }),
      outputSchema: z.object({
        matches: z.array(
          z.object({
            lesson_id: z.string(),
            lesson_type: z.enum(['decision', 'preference', 'guardrail', 'workaround', 'general_note']),
            title: z.string(),
            content_snippet: z.string(),
            tags: z.array(z.string()),
            score: z.number(),
          }),
        ),
        explanations: z.array(z.string()),
      }),
    },
    async ({ workspace_token, project_id, query, filters, limit, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = resolveProjectIdOrThrow(project_id);
      const result = await searchLessons({
        projectId,
        query,
        limit,
        filters: filters as any,
      });
      const summary = `search_lessons: matches=${result.matches.length}`;
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
          project_id: z.string().min(1).describe('Project identifier for scoping this lesson (required).'),
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
      }),
    },
    async ({ workspace_token, lesson_payload, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const result = await addLesson(lesson_payload as any);
      const summary = `add_lesson: lesson_id=${result.lesson_id ?? '(unknown)'}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'check_guardrails',
    {
      description: 'Evaluate guardrails before risky actions.',
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
    async ({ workspace_token, action_context, output_format }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = action_context.project_id ?? action_context.workspace;
      if (!projectId) {
        throw new Error('Missing project identifier in action_context (expected project_id or workspace)');
      }

      const result = await checkGuardrails(String(projectId), action_context);
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

      const suggested_next_calls: Array<{ tool: string; arguments: any; reason: string }> = [];
      const q = task?.query ?? task?.intent ?? '';
      const pathGlob = task?.path_glob;

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

      const result = { project_id: pid, context_refs, suggested_next_calls, notes };
      const summary = `get_context: project_id=${pid}, refs=${context_refs.length}, suggestions=${suggested_next_calls.length}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  server.registerTool(
    'delete_workspace',
    {
      description: 'Delete all ContextHub data for the given project_id (lessons, chunks, guardrails, etc.).',
      inputSchema: z.object({
        workspace_token: z.string().optional().describe('Workspace token (required only if MCP_AUTH_ENABLED=true).'),
        project_id: z.string().min(1).describe('Project identifier to delete (required).'),
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
      const result = await deleteWorkspace(project_id);
      const summary = `delete_workspace: deleted=${result.deleted}, project_id=${result.deleted_project_id}`;
      return formatToolResponse(result, summary, output_format);
    },
  );

  return server;
}

async function main() {
  const env = getEnv();
  await applyMigrations();

  const app = createMcpExpressApp();
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  const useJsonResponse = true;

  app.post('/mcp', async (req: any, res: any) => {
    const sessionId = req.headers['mcp-session-id'];

    try {
      let transport: StreamableHTTPServerTransport;
      if (sessionId && transports[String(sessionId)]) {
        transport = transports[String(sessionId)];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // MCP SDK requires a Protocol/McpServer instance to be connected to a single transport.
        // For each new initialization (new transport/session), create a fresh server instance.
        const server = createMcpToolsServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: useJsonResponse,
          onsessioninitialized: sid => {
            transports[sid] = transport;
          },
          // Note: in MVP we keep state in-memory.
        });

        await server.connect(transport);
        await transport.handleRequest(req as any, res as any, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req as any, res as any, req.body);
    } catch (error) {
      console.log('[mcp] error', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Per MCP Streamable HTTP spec, clients may attempt GET for SSE streams.
  // In JSON response mode we don't support SSE here, so return 405.
  app.get('/mcp', async (_req: any, res: any) => {
    res.status(405).set('Allow', 'POST').send('Method Not Allowed');
  });

  const port = env.MCP_PORT;
  app.listen(port, () => {
    console.log(`[mcp] ContextHub MCP server listening on :${port} (/mcp)`);
  });

  process.on('SIGINT', async () => {
    const sids = Object.keys(transports);
    for (const sid of sids) {
      try {
        await transports[sid].close();
      } catch {
        // ignore
      }
      delete transports[sid];
    }
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

