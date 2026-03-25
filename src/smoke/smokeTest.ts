import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

function getEnvOrThrow(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function extractFirstTextJson(result: any) {
  const content = result?.content ?? [];
  const firstText = content.find((c: any) => c?.type === 'text')?.text;
  if (typeof firstText !== 'string') {
    throw new Error(`Tool result did not contain text content; got: ${JSON.stringify(content)}`);
  }
  return JSON.parse(firstText);
}

async function main() {
  const token = getEnvOrThrow('CONTEXT_HUB_WORKSPACE_TOKEN');
  const projectId = process.env.SMOKE_PROJECT_ID ?? 'demo-project';
  const root = process.env.SMOKE_ROOT ?? process.cwd();
  const serverUrl = process.env.MCP_SERVER_URL ?? 'http://localhost:3000/mcp';

  const client = new Client(
    { name: 'contexthub-smoke-client', version: '0.1.0' },
    {
      capabilities: {},
    },
  );

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {});
  await client.connect(transport);

  console.log('[smoke] connected');

  try {
    const listTools = await client.request(
      { method: 'tools/list', params: {} },
      ListToolsResultSchema,
    );
    console.log('[smoke] tools:', listTools.tools.map((t: any) => t.name).join(', '));
  } catch (e) {
    console.warn('[smoke] tools/list failed (continuing):', e);
  }

  console.log('[smoke] index_project...');
  const indexedResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'index_project',
        arguments: {
          workspace_token: token,
          project_id: projectId,
          root,
          options: {
            lines_per_chunk: 120,
            embedding_batch_size: 8,
          },
        },
      },
    },
    CallToolResultSchema,
  );
  const indexedJson = extractFirstTextJson(indexedResult);
  console.log('[smoke] index_project result:', indexedJson);

  console.log('[smoke] search_code...');
  const searchResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          workspace_token: token,
          project_id: projectId,
          query: 'guardrails',
          filters: { path_glob: 'docs/**/*.md' },
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchJson = extractFirstTextJson(searchResult);
  console.log('[smoke] search_code matches:', searchJson.matches?.length ?? 0);

  console.log('[smoke] add_lesson (preference)...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'add_lesson',
        arguments: {
          workspace_token: token,
          lesson_payload: {
            project_id: projectId,
            lesson_type: 'preference',
            title: 'Use TypeScript',
            content: 'We use strict TypeScript for all services.',
            tags: ['preference-typescript'],
            source_refs: ['smoke-test'],
          },
        },
      },
    },
    CallToolResultSchema,
  );

  console.log('[smoke] get_preferences...');
  const prefsResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'get_preferences',
        arguments: {
          workspace_token: token,
          project_id: projectId,
        },
      },
    },
    CallToolResultSchema,
  );
  const prefsJson = extractFirstTextJson(prefsResult);
  console.log('[smoke] preferences:', prefsJson.preferences?.length ?? 0);

  console.log('[smoke] add_lesson (guardrail)...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'add_lesson',
        arguments: {
          workspace_token: token,
          lesson_payload: {
            project_id: projectId,
            lesson_type: 'guardrail',
            title: 'No push without tests',
            content: 'Do not push without running tests.',
            tags: ['guardrail-ci', 'preference-safety'],
            guardrail: {
              trigger: 'git push',
              requirement: 'Run tests locally before any git push.',
              verification_method: 'user_confirmation',
            },
          },
        },
      },
    },
    CallToolResultSchema,
  );

  console.log('[smoke] check_guardrails...');
  const guardResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'check_guardrails',
        arguments: {
          workspace_token: token,
          action_context: { action: 'git push', workspace: projectId },
        },
      },
    },
    CallToolResultSchema,
  );
  const guardJson = extractFirstTextJson(guardResult);
  console.log('[smoke] check_guardrails result:', guardJson);

  console.log('[smoke] delete_workspace...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'delete_workspace',
        arguments: {
          workspace_token: token,
          project_id: projectId,
        },
      },
    },
    CallToolResultSchema,
  );

  console.log('[smoke] get_preferences after delete (expect 0)...');
  const prefsAfterResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'get_preferences',
        arguments: {
          workspace_token: token,
          project_id: projectId,
        },
      },
    },
    CallToolResultSchema,
  );
  const prefsAfterJson = extractFirstTextJson(prefsAfterResult);
  const prefsCountAfter = prefsAfterJson.preferences?.length ?? 0;
  console.log('[smoke] preferences after delete:', prefsCountAfter);
  if (prefsCountAfter !== 0) {
    throw new Error(`delete_workspace did not fully clear lessons for project_id=${projectId}`);
  }

  console.log('[smoke] search_code after delete (expect matches=0)...');
  const searchAfterResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          workspace_token: token,
          project_id: projectId,
          query: 'guardrails',
          filters: { path_glob: 'docs/**/*.md' },
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchAfterJson = extractFirstTextJson(searchAfterResult);
  const matchesAfter = searchAfterJson.matches?.length ?? 0;
  console.log('[smoke] matches after delete:', matchesAfter);
  if (matchesAfter !== 0) {
    throw new Error(`delete_workspace did not fully clear chunks for project_id=${projectId}`);
  }

  await transport.close();
  console.log('[smoke] done');
}

main().catch((err: any) => {
  console.error('[smoke] failed:', err instanceof McpError ? `${err.code}: ${err.message}` : err);
  process.exit(1);
});

