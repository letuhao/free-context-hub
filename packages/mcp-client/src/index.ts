#!/usr/bin/env node
/**
 * ContextHub MCP Client — stdio transport → REST API proxy.
 *
 * Usage:
 *   CONTEXTHUB_API_URL=http://localhost:3001 contexthub-mcp
 *   CONTEXTHUB_API_URL=http://localhost:3001 CONTEXTHUB_TOKEN=xxx contexthub-mcp
 *
 * Claude Code config (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "contexthub": {
 *         "command": "npx",
 *         "args": ["@contexthub/mcp-client"],
 *         "env": {
 *           "CONTEXTHUB_API_URL": "http://localhost:3001",
 *           "CONTEXTHUB_TOKEN": "your-token"
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { RestClient, RestApiError } from './rest-client.js';

/** Wrap a tool handler to convert RestApiError → McpError for clear AI agent errors. */
function wrapHandler<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof RestApiError) {
        const code = err.status === 401 ? ErrorCode.InvalidParams
          : err.status === 400 ? ErrorCode.InvalidParams
          : ErrorCode.InternalError;
        throw new McpError(code, err.message);
      }
      throw err;
    }
  }) as T;
}

const apiUrl = process.env.CONTEXTHUB_API_URL ?? 'http://localhost:3001';
const token = process.env.CONTEXTHUB_TOKEN;
const defaultProject = process.env.CONTEXTHUB_PROJECT_ID;

const client = new RestClient({ baseUrl: apiUrl, token });

function resolveProject(input?: string): string | undefined {
  return input ?? defaultProject;
}

const server = new McpServer({
  name: 'contexthub-client',
  version: '0.1.0',
  description: 'ContextHub MCP client — proxies tool calls to the REST API.',
});

// ── search_lessons ──
server.registerTool(
  'search_lessons',
  {
    description: 'Semantic search across lessons, decisions, workarounds, and guardrails.',
    inputSchema: z.object({
      project_id: z.string().optional().describe('Project ID (uses CONTEXTHUB_PROJECT_ID if omitted).'),
      query: z.string().describe('Natural language search query.'),
      limit: z.number().optional().describe('Max results (default 10).'),
    }),
  },
  wrapHandler(async ({ project_id, query, limit }) => {
    const result = await client.searchLessons({
      project_id: resolveProject(project_id),
      query,
      limit,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }),
);

// ── check_guardrails ──
server.registerTool(
  'check_guardrails',
  {
    description: 'Check if an action is allowed by project guardrails.',
    inputSchema: z.object({
      project_id: z.string().optional(),
      action_context: z.object({
        action: z.string().describe('Description of the action to check.'),
      }),
    }),
  },
  wrapHandler(async ({ project_id, action_context }) => {
    const result = await client.checkGuardrails({
      project_id: resolveProject(project_id),
      action_context,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }),
);

// ── search_code_tiered ──
server.registerTool(
  'search_code_tiered',
  {
    description: 'Tiered code search: exact → glob → FTS → semantic.',
    inputSchema: z.object({
      project_id: z.string().optional(),
      query: z.string().describe('Identifier, file path, or natural language query.'),
      kind: z.string().optional().describe("Filter: 'source', 'test', 'doc', 'config', etc."),
      max_files: z.number().optional(),
    }),
  },
  wrapHandler(async ({ project_id, query, kind, max_files }) => {
    const result = await client.searchCodeTiered({
      project_id: resolveProject(project_id),
      query,
      kind,
      max_files,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }),
);

// ── add_lesson ──
server.registerTool(
  'add_lesson',
  {
    description: 'Add a lesson (decision, workaround, preference, guardrail, general_note).',
    inputSchema: z.object({
      project_id: z.string().optional(),
      lesson_type: z.enum(['decision', 'preference', 'guardrail', 'workaround', 'general_note']),
      title: z.string(),
      content: z.string(),
      tags: z.array(z.string()).optional(),
    }),
  },
  wrapHandler(async (input) => {
    const result = await client.addLesson({
      ...input,
      project_id: resolveProject(input.project_id),
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }),
);

// ── list_lessons ──
server.registerTool(
  'list_lessons',
  {
    description: 'List lessons with pagination and filters.',
    inputSchema: z.object({
      project_id: z.string().optional(),
      limit: z.number().optional(),
      after: z.string().optional().describe('Cursor from previous response.'),
      lesson_type: z.string().optional(),
      status: z.string().optional(),
    }),
  },
  wrapHandler(async ({ project_id, limit, after, lesson_type, status }) => {
    const result = await client.listLessons({
      project_id: resolveProject(project_id),
      limit,
      after,
      lesson_type,
      status,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }),
);

// ── get_project_summary ──
server.registerTool(
  'get_project_summary',
  {
    description: 'Get project snapshot summary.',
    inputSchema: z.object({
      project_id: z.string().optional(),
    }),
  },
  wrapHandler(async ({ project_id }) => {
    const pid = resolveProject(project_id);
    if (!pid) throw new McpError(ErrorCode.InvalidParams, 'project_id required (set CONTEXTHUB_PROJECT_ID or pass explicitly)');
    const result = await client.getProjectSummary(pid);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }),
);

// ── reflect ──
server.registerTool(
  'reflect',
  {
    description: 'Reflect on a topic using project knowledge.',
    inputSchema: z.object({
      project_id: z.string().optional(),
      topic: z.string(),
      bullets: z.array(z.string()).optional(),
    }),
  },
  wrapHandler(async ({ project_id, topic, bullets }) => {
    const pid = resolveProject(project_id);
    if (!pid) throw new McpError(ErrorCode.InvalidParams, 'project_id required (set CONTEXTHUB_PROJECT_ID or pass explicitly)');
    const result = await client.reflect(pid, { topic, bullets });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }),
);

// ── index_project ──
server.registerTool(
  'index_project',
  {
    description: 'Trigger project code indexing.',
    inputSchema: z.object({
      project_id: z.string().optional(),
      root: z.string().optional().describe('Path to project root.'),
    }),
  },
  wrapHandler(async ({ project_id, root }) => {
    const pid = resolveProject(project_id);
    if (!pid) throw new McpError(ErrorCode.InvalidParams, 'project_id required (set CONTEXTHUB_PROJECT_ID or pass explicitly)');
    const result = await client.indexProject(pid, { root });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }),
);

// ── Connect stdio transport ──
async function main() {
  // Validate connection before accepting tool calls.
  await client.checkHealth();
  process.stderr.write(`[contexthub-mcp] Connected to ${apiUrl}\n`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
