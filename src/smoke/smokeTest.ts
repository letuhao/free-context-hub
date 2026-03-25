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

  // Default `output_format=auto_both` may prefix summary text.
  // Extract the first JSON object/array substring and parse it.
  const raw = firstText.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const firstObj = raw.indexOf('{');
    const firstArr = raw.indexOf('[');
    let start = -1;
    if (firstObj >= 0 && firstArr >= 0) start = Math.min(firstObj, firstArr);
    else start = firstObj >= 0 ? firstObj : firstArr;

    const lastObj = raw.lastIndexOf('}');
    const lastArr = raw.lastIndexOf(']');
    let end = -1;
    if (lastObj >= 0 && lastArr >= 0) end = Math.max(lastObj, lastArr);
    else end = lastObj >= 0 ? lastObj : lastArr;

    if (start >= 0 && end >= start) {
      return JSON.parse(raw.slice(start, end + 1));
    }

    throw new Error(`Failed to parse JSON from tool content.text: ${raw.slice(0, 200)}`);
  }
}

async function main() {
  const mcpAuthEnabled = (process.env.MCP_AUTH_ENABLED ?? 'false').toLowerCase() === 'true';
  const token = mcpAuthEnabled ? getEnvOrThrow('CONTEXT_HUB_WORKSPACE_TOKEN') : undefined;
  const tokenArgs = mcpAuthEnabled ? { workspace_token: token as string } : {};
  const projectIdA = process.env.SMOKE_PROJECT_ID_A ?? 'demo-project-A';
  const projectIdB = process.env.SMOKE_PROJECT_ID_B ?? 'demo-project-B';
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
  console.log(`[smoke] index_project(A=${projectIdA})...`);
  const indexedResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'index_project',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
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
  const indexedJsonA = extractFirstTextJson(indexedResultA);
  console.log('[smoke] index_project(A) result:', indexedJsonA);

  console.log(`[smoke] index_project(B=${projectIdB})...`);
  const indexedResultB = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'index_project',
        arguments: {
          ...tokenArgs,
          project_id: projectIdB,
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
  const indexedJsonB = extractFirstTextJson(indexedResultB);
  console.log('[smoke] index_project(B) result:', indexedJsonB);

  console.log('[smoke] search_code (before delete)...');
  const searchResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          query: 'guardrails',
          filters: { path_glob: 'docs/**/*.md' },
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchJsonA = extractFirstTextJson(searchResultA);
  const matchesBeforeA = searchJsonA.matches?.length ?? 0;
  console.log('[smoke] search_code matches (A):', matchesBeforeA);

  const searchResultB = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          ...tokenArgs,
          project_id: projectIdB,
          query: 'guardrails',
          filters: { path_glob: 'docs/**/*.md' },
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchJsonB = extractFirstTextJson(searchResultB);
  const matchesBeforeB = searchJsonB.matches?.length ?? 0;
  console.log('[smoke] search_code matches (B):', matchesBeforeB);

  if (matchesBeforeA === 0) {
    throw new Error(`Precondition failed: search_code matches for project A is 0 (projectIdA=${projectIdA})`);
  }
  if (matchesBeforeB === 0) {
    throw new Error(`Precondition failed: search_code matches for project B is 0 (projectIdB=${projectIdB})`);
  }

  console.log('[smoke] add_lesson (preference) for A...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'add_lesson',
        arguments: {
          ...tokenArgs,
          lesson_payload: {
            project_id: projectIdA,
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

  console.log('[smoke] add_lesson (preference) for B...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'add_lesson',
        arguments: {
          ...tokenArgs,
          lesson_payload: {
            project_id: projectIdB,
            lesson_type: 'preference',
            title: 'Use PostgreSQL',
            content: 'We store metadata in PostgreSQL.',
            tags: ['preference-postgres'],
            source_refs: ['smoke-test'],
          },
        },
      },
    },
    CallToolResultSchema,
  );

  console.log('[smoke] get_preferences (before delete)...');
  const prefsResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'get_preferences',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
        },
      },
    },
    CallToolResultSchema,
  );
  const prefsJsonA = extractFirstTextJson(prefsResultA);
  const prefsCountBeforeA = prefsJsonA.preferences?.length ?? 0;
  console.log('[smoke] preferences (A):', prefsCountBeforeA);

  const prefsResultB = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'get_preferences',
        arguments: {
          ...tokenArgs,
          project_id: projectIdB,
        },
      },
    },
    CallToolResultSchema,
  );
  const prefsJsonB = extractFirstTextJson(prefsResultB);
  const prefsCountBeforeB = prefsJsonB.preferences?.length ?? 0;
  console.log('[smoke] preferences (B):', prefsCountBeforeB);

  if (prefsCountBeforeA === 0) {
    throw new Error(`Precondition failed: get_preferences for project A is empty (projectIdA=${projectIdA})`);
  }
  if (prefsCountBeforeB === 0) {
    throw new Error(`Precondition failed: get_preferences for project B is empty (projectIdB=${projectIdB})`);
  }

  console.log('[smoke] add_lesson (guardrail) for A...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'add_lesson',
        arguments: {
          ...tokenArgs,
          lesson_payload: {
            project_id: projectIdA,
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

  console.log('[smoke] check_guardrails for A...');
  const guardResult = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'check_guardrails',
        arguments: {
          ...tokenArgs,
          action_context: { action: 'git push', workspace: projectIdA },
        },
      },
    },
    CallToolResultSchema,
  );
  const guardJson = extractFirstTextJson(guardResult);
  console.log('[smoke] check_guardrails result:', guardJson);

  console.log('[smoke] delete_workspace (only for A)...');
  await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'delete_workspace',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
        },
      },
    },
    CallToolResultSchema,
  );

  console.log('[smoke] get_preferences after delete (A expect 0)...');
  const prefsAfterResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'get_preferences',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
        },
      },
    },
    CallToolResultSchema,
  );
  const prefsAfterJsonA = extractFirstTextJson(prefsAfterResultA);
  const prefsCountAfterA = prefsAfterJsonA.preferences?.length ?? 0;
  console.log('[smoke] preferences after delete (A):', prefsCountAfterA);
  if (prefsCountAfterA !== 0) {
    throw new Error(`delete_workspace did not fully clear lessons for projectIdA=${projectIdA}`);
  }

  console.log('[smoke] get_preferences after delete (B should remain >0)...');
  const prefsAfterResultB = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'get_preferences',
        arguments: {
          ...tokenArgs,
          project_id: projectIdB,
        },
      },
    },
    CallToolResultSchema,
  );
  const prefsAfterJsonB = extractFirstTextJson(prefsAfterResultB);
  const prefsCountAfterB = prefsAfterJsonB.preferences?.length ?? 0;
  console.log('[smoke] preferences after delete (B):', prefsCountAfterB);
  if (prefsCountAfterB === 0) {
    throw new Error(`delete_workspace incorrectly cleared lessons for projectIdB=${projectIdB}`);
  }

  console.log('[smoke] search_code after delete (A expect matches=0)...');
  const searchAfterResultA = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          ...tokenArgs,
          project_id: projectIdA,
          query: 'guardrails',
          filters: { path_glob: 'docs/**/*.md' },
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchAfterJsonA = extractFirstTextJson(searchAfterResultA);
  const matchesAfterA = searchAfterJsonA.matches?.length ?? 0;
  console.log('[smoke] matches after delete (A):', matchesAfterA);
  if (matchesAfterA !== 0) {
    throw new Error(`delete_workspace did not fully clear chunks for projectIdA=${projectIdA}`);
  }

  console.log('[smoke] search_code after delete (B should remain >0)...');
  const searchAfterResultB = await client.request(
    {
      method: 'tools/call',
      params: {
        name: 'search_code',
        arguments: {
          ...tokenArgs,
          project_id: projectIdB,
          query: 'guardrails',
          filters: { path_glob: 'docs/**/*.md' },
          limit: 3,
        },
      },
    },
    CallToolResultSchema,
  );
  const searchAfterJsonB = extractFirstTextJson(searchAfterResultB);
  const matchesAfterB = searchAfterJsonB.matches?.length ?? 0;
  console.log('[smoke] matches after delete (B):', matchesAfterB);
  if (matchesAfterB === 0) {
    throw new Error(`delete_workspace incorrectly cleared chunks for projectIdB=${projectIdB}`);
  }

  await transport.close();
  console.log('[smoke] done');
}

main().catch((err: any) => {
  console.error('[smoke] failed:', err instanceof McpError ? `${err.code}: ${err.message}` : err);
  process.exit(1);
});

