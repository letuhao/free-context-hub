import * as dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { getEnv } from './env.js';
import { applyMigrations } from './db/applyMigrations.js';
import { indexProject } from './services/indexer.js';
import { searchCode } from './services/retriever.js';
import { addLesson, getPreferences } from './services/lessons.js';
import { checkGuardrails } from './services/guardrails.js';

dotenv.config();

function assertWorkspaceToken(token: string) {
  const env = getEnv();
  if (token !== env.CONTEXT_HUB_WORKSPACE_TOKEN) {
    // MCP clients will surface this as a tool error.
    throw new Error('Unauthorized: invalid workspace_token');
  }
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
    'index_project',
    {
      description: 'Idempotent project indexing: discovers files, chunks, embeds, and stores vectors.',
      inputSchema: z.object({
        workspace_token: z.string().describe('MVP workspace token'),
        project_id: z.string().describe('Project identifier (scoped memory)').min(1),
        root: z.string().describe('Root directory path to index').min(1),
        options: z
          .object({
            lines_per_chunk: z.number().int().positive().optional(),
            embedding_batch_size: z.number().int().positive().optional(),
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
    async ({ workspace_token, project_id, root, options }) => {
      assertWorkspaceToken(workspace_token);
      const result = await indexProject({
        projectId: project_id,
        root,
        linesPerChunk: options?.lines_per_chunk,
        embeddingBatchSize: options?.embedding_batch_size,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  server.registerTool(
    'search_code',
    {
      description: 'Semantic code search over indexed chunks using vector similarity.',
      inputSchema: z.object({
        workspace_token: z.string(),
        project_id: z.string().min(1),
        query: z.string().min(1),
        filters: z
          .object({
            path_glob: z.string().min(1).optional(),
          })
          .optional(),
        limit: z.number().int().positive().optional(),
        debug: z.boolean().optional(),
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
    async ({ workspace_token, project_id, query, filters, limit, debug }) => {
      assertWorkspaceToken(workspace_token);
      const result = await searchCode({
        projectId: project_id,
        query,
        pathGlob: filters?.path_glob,
        limit,
        debug,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  server.registerTool(
    'get_preferences',
    {
      description: 'Fetch preference lessons (tags: preference-*) for a project.',
      inputSchema: z.object({
        workspace_token: z.string(),
        project_id: z.string().min(1),
      }),
      outputSchema: z.object({
        preferences: z.array(
          z.object({
            lesson_id: z.string(),
            lesson_type: z.string(),
            title: z.string(),
            content: z.string(),
            tags: z.array(z.string()),
            source_refs: z.array(z.string()),
            created_at: z.any(),
            updated_at: z.any(),
            captured_by: z.string().nullable().optional(),
          }),
        ),
      }),
    },
    async ({ workspace_token, project_id }) => {
      assertWorkspaceToken(workspace_token);
      const preferences = await getPreferences(project_id);
      const result = { preferences };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  server.registerTool(
    'add_lesson',
    {
      description: 'Capture a decision/preference/guardrail/workaround/general_note as a durable lesson.',
      inputSchema: z.object({
        workspace_token: z.string(),
        lesson_payload: z.object({
          project_id: z.string().min(1),
          lesson_type: z.enum(['decision', 'preference', 'guardrail', 'workaround', 'general_note']),
          title: z.string().min(1),
          content: z.string().min(1),
          tags: z.array(z.string()).optional(),
          source_refs: z.array(z.string()).optional(),
          captured_by: z.string().optional(),
          guardrail: z
            .object({
              trigger: z.string().min(1),
              requirement: z.string().min(1),
              verification_method: z.string().min(1),
            })
            .optional(),
        }),
      }),
      outputSchema: z.object({
        status: z.enum(['ok', 'error']).default('ok'),
        lesson_id: z.string(),
      }),
    },
    async ({ workspace_token, lesson_payload }) => {
      assertWorkspaceToken(workspace_token);
      const result = await addLesson(lesson_payload as any);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  server.registerTool(
    'check_guardrails',
    {
      description: 'Evaluate guardrails before risky actions.',
      inputSchema: z.object({
        workspace_token: z.string(),
        action_context: z
          .object({
            // Some clients might use `workspace` as the project identifier.
            action: z.string().min(1),
            project_id: z.string().optional(),
            workspace: z.string().optional(),
          })
          .passthrough(),
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
    async ({ workspace_token, action_context }) => {
      assertWorkspaceToken(workspace_token);
      const projectId = action_context.project_id ?? action_context.workspace;
      if (!projectId) {
        throw new Error('Missing project identifier in action_context (expected project_id or workspace)');
      }

      const result = await checkGuardrails(String(projectId), action_context);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  return server;
}

async function main() {
  const env = getEnv();
  await applyMigrations();

  const server = createMcpToolsServer();

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
      console.error('[mcp] error', error);
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

